// TikTok Routes - Search, Download (no watermark), and Upload to YouTube
// ★ ทุกเหตุการณ์ emit ผ่าน Orchestrator → EventBus
const express = require('express');
const router = express.Router();
const fs = require('fs');
const tiktokService = require('../services/tiktok');
const youtubeService = require('../services/youtube');
const seoService = require('../services/seo');
const orchestrator = require('../services/orchestrator');
const { settings, uploads } = require('../utils/store');
const logger = require('../utils/logger');

// ==================== Duplicate Detection ====================

/**
 * Extract TikTok video ID from various URL formats
 */
function extractTikTokVideoId(url) {
  if (!url) return null;
  // Match /video/DIGITS or /photo/DIGITS
  const match = url.match(/\/(video|photo)\/(\d+)/);
  if (match) return match[2];
  // Short link - extract last segment
  const shortMatch = url.match(/\/([A-Za-z0-9]+)\/?$/);
  if (shortMatch) return shortMatch[1];
  return null;
}

/**
 * Check if a TikTok video has already been uploaded to YouTube
 * Checks by: source_url, tiktok_video_id, or title similarity
 */
function isDuplicateTikTok(videoUrl, videoId) {
  const allUploads = uploads.load();

  for (const record of allUploads) {
    // Check 1: Exact source URL match
    if (record.source_url && record.source_url === videoUrl) {
      return { duplicate: true, reason: 'exact_url', record };
    }

    // Check 2: TikTok video ID match (from source_url in history)
    if (record.source_url && videoId) {
      const existingId = extractTikTokVideoId(record.source_url);
      if (existingId && existingId === videoId) {
        return { duplicate: true, reason: 'video_id', record };
      }
    }

    // Check 3: tiktok_video_id field match
    if (record.tiktok_video_id && record.tiktok_video_id === videoId) {
      return { duplicate: true, reason: 'stored_id', record };
    }
  }

  return { duplicate: false };
}

// ==================== TikTok Batch Progress (SSE) ====================
let tiktokProgress = { current: 0, total: 0, currentFile: '', status: 'idle', phase: '', results: [] };

// Search TikTok videos by keyword (single or multiple)
// Accepts either { keyword: "cat" } or { keywords: ["cat", "dog", "..."] }
// Multiple keywords can also be sent as one comma/newline-separated string in `keyword`.
router.post('/search', async (req, res) => {
  const { keyword, keywords, count } = req.body;

  // Normalize input into a list of keywords
  let keywordList = [];
  if (Array.isArray(keywords)) {
    keywordList = keywords;
  } else if (typeof keywords === 'string') {
    keywordList = keywords.split(/[,\n]/);
  } else if (typeof keyword === 'string') {
    keywordList = keyword.split(/[,\n]/);
  }
  keywordList = keywordList.map(k => k.trim()).filter(Boolean);

  if (keywordList.length === 0) {
    return res.status(400).json({ error: 'กรุณาระบุคีย์เวิร์ดอย่างน้อย 1 คำ' });
  }

  // Cap to avoid abuse / excessive upstream load
  const MAX_KEYWORDS = 15;
  if (keywordList.length > MAX_KEYWORDS) {
    keywordList = keywordList.slice(0, MAX_KEYWORDS);
  }

  const countPerKeyword = count || 12;

  try {
    let videos, perKeyword;

    if (keywordList.length === 1) {
      videos = await tiktokService.searchVideos(keywordList[0], countPerKeyword);
      videos = videos.map(v => ({ ...v, matchedKeywords: [keywordList[0]] }));
      perKeyword = [{ keyword: keywordList[0], found: videos.length, error: null }];
    } else {
      const result = await tiktokService.searchMultipleKeywords(keywordList, countPerKeyword);
      videos = result.videos;
      perKeyword = result.perKeyword;
    }

    // Mark duplicates + attach SEO virality score & monetization risk to every result
    // so the UI can sort/filter/flag without an extra round-trip per video.
    const videosWithDuplicateInfo = videos.map(video => {
      const videoId = extractTikTokVideoId(video.videoUrl);
      const dupCheck = isDuplicateTikTok(video.videoUrl, videoId);
      const virality = seoService.calculateViralityScore(video);
      const validation = seoService.validateForMonetization(video, video.desc || '');
      return {
        ...video,
        alreadyUploaded: dupCheck.duplicate,
        youtubeUrl: dupCheck.duplicate ? dupCheck.record.youtube_url : null,
        uploadedAt: dupCheck.duplicate ? dupCheck.record.uploaded_at : null,
        virality,
        monetizationStatus: validation.status // 'ok' | 'warning' | 'blocked'
      };
    });

    // Best content first: sort by virality score (duplicates/blocked pushed down)
    videosWithDuplicateInfo.sort((a, b) => {
      if (a.alreadyUploaded !== b.alreadyUploaded) return a.alreadyUploaded ? 1 : -1;
      return (b.virality?.score || 0) - (a.virality?.score || 0);
    });

    res.json({
      videos: videosWithDuplicateInfo,
      keywords: keywordList,
      keyword: keywordList.join(', '), // backward-compat for old frontend
      perKeyword,
      totalFound: videosWithDuplicateInfo.length
    });
  } catch (error) {
    logger.error('TikTok search error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Discover trending videos WITHOUT a keyword (browse what's hot right now)
router.get('/trending', async (req, res) => {
  const region = req.query.region || 'TH';
  const count = parseInt(req.query.count) || 12;

  try {
    const videos = await tiktokService.getTrending(region, count);
    const enriched = videos.map(video => {
      const videoId = extractTikTokVideoId(video.videoUrl);
      const dupCheck = isDuplicateTikTok(video.videoUrl, videoId);
      const virality = seoService.calculateViralityScore(video);
      const validation = seoService.validateForMonetization(video, video.desc || '');
      return {
        ...video,
        alreadyUploaded: dupCheck.duplicate,
        youtubeUrl: dupCheck.duplicate ? dupCheck.record.youtube_url : null,
        virality,
        monetizationStatus: validation.status
      };
    }).sort((a, b) => (b.virality?.score || 0) - (a.virality?.score || 0));

    res.json({ videos: enriched, region, totalFound: enriched.length });
  } catch (error) {
    logger.error('TikTok trending error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Fetch latest videos from a specific creator (@username) — track creators
// whose content performs well and grab their newest clips.
router.get('/creator/:username', async (req, res) => {
  const { username } = req.params;
  const count = parseInt(req.query.count) || 12;

  try {
    const videos = await tiktokService.getCreatorVideos(username, count);
    const enriched = videos.map(video => {
      const videoId = extractTikTokVideoId(video.videoUrl);
      const dupCheck = isDuplicateTikTok(video.videoUrl, videoId);
      const virality = seoService.calculateViralityScore(video);
      const validation = seoService.validateForMonetization(video, video.desc || '');
      return {
        ...video,
        alreadyUploaded: dupCheck.duplicate,
        youtubeUrl: dupCheck.duplicate ? dupCheck.record.youtube_url : null,
        virality,
        monetizationStatus: validation.status
      };
    }).sort((a, b) => (b.virality?.score || 0) - (a.virality?.score || 0));

    res.json({ videos: enriched, username, totalFound: enriched.length });
  } catch (error) {
    logger.error('TikTok creator fetch error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Provider reliability stats (which downloader is currently most trustworthy)
router.get('/provider-stats', (req, res) => {
  res.json(tiktokService.getProviderStats());
});

// Check if a TikTok URL is a duplicate
router.post('/check-duplicate', (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'กรุณาระบุ URL' });

  const videoId = extractTikTokVideoId(videoUrl);
  const result = isDuplicateTikTok(videoUrl, videoId);

  res.json({
    duplicate: result.duplicate,
    reason: result.reason || null,
    youtubeUrl: result.duplicate ? result.record.youtube_url : null,
    uploadedAt: result.duplicate ? result.record.uploaded_at : null
  });
});

// Download TikTok video without watermark
router.post('/download', async (req, res) => {
  const { videoUrl, filename } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'กรุณาระบุ URL ของวิดีโอ' });

  try {
    const result = await tiktokService.downloadNoWatermark(videoUrl, filename);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('TikTok download error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Download and immediately upload to YouTube
router.post('/download-and-upload', async (req, res) => {
  const { videoUrl, title, description, tags, privacy, filename, force } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'กรุณาระบุ URL ของวิดีโอ' });

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
  }

  // Duplicate check (skip if force=true)
  if (!force) {
    const videoId = extractTikTokVideoId(videoUrl);
    const dupCheck = isDuplicateTikTok(videoUrl, videoId);
    if (dupCheck.duplicate) {
      return res.status(409).json({
        error: 'วิดีโอนี้เคยอัปโหลดไป YouTube แล้ว',
        duplicate: true,
        youtubeUrl: dupCheck.record.youtube_url,
        uploadedAt: dupCheck.record.uploaded_at
      });
    }
  }

  // ★ Monetization safety gate — block clearly policy-violating content
  // BEFORE downloading/uploading, unless the user explicitly forces it.
  // This is the enforcement layer for seoService.validateForMonetization,
  // which previously only generated a report but never blocked anything.
  if (!force) {
    const preCheck = seoService.validateForMonetization(
      { desc: title || req.body.desc || '', duration: req.body.duration || 0 },
      title || ''
    );
    if (preCheck.status === 'blocked') {
      return res.status(422).json({
        error: 'เนื้อหานี้ผิดนโยบาย YouTube — ถูกบล็อกอัตโนมัติเพื่อป้องกันการ demonetize/strike',
        blocked: true,
        validation: preCheck
      });
    }
  }

  try {
    // Step 1: Download from TikTok (no watermark)
    const downloadResult = await tiktokService.downloadNoWatermark(videoUrl, filename);

    // Step 2: Generate SEO-optimized metadata
    const config = settings.load();
    const seoMode = config.seoMode || 'auto';
    
    let videoTitle, videoDesc, videoTags, videoPrivacy, categoryId, publishAt;

    if (seoMode === 'auto' || seoMode === 'seo') {
      // Use SEO service for optimized metadata
      const tiktokData = {
        desc: title || req.body.desc || downloadResult.filename.replace('.mp4', ''),
        author: req.body.author || '',
        duration: req.body.duration || 0,
        videoUrl
      };
      const seoOptions = { schedulePublish: config.autoSchedule || false };
      const metadata = seoService.generateMetadata(tiktokData, seoOptions);

      // Re-validate now that we have the real downloaded filename/desc too —
      // catches risky content that only shows up after download (e.g. no
      // desc was passed by the caller but the file itself hints at it).
      if (metadata.validation.status === 'blocked' && !force) {
        if (fs.existsSync(downloadResult.filepath)) fs.unlinkSync(downloadResult.filepath);
        return res.status(422).json({
          error: 'เนื้อหานี้ผิดนโยบาย YouTube — ถูกบล็อกอัตโนมัติเพื่อป้องกันการ demonetize/strike',
          blocked: true,
          validation: metadata.validation
        });
      }

      videoTitle = title || metadata.title; // User override > SEO
      videoDesc = description || metadata.description;
      videoTags = tags || metadata.tags;
      videoPrivacy = privacy || metadata.privacy;
      categoryId = req.body.categoryId || metadata.categoryId;
      publishAt = req.body.publishAt || metadata.publishAt;

      logger.info('SEO metadata generated', { 
        title: videoTitle, categoryId, 
        tagsCount: Array.isArray(videoTags) ? videoTags.length : 0,
        scheduled: !!publishAt 
      });
    } else {
      // Manual mode — use raw values
      videoTitle = title || downloadResult.filename.replace('.mp4', '');
      videoDesc = description || config.defaultDescription || '';
      videoTags = tags || config.defaultTags || '';
      videoPrivacy = privacy || config.privacy || 'public';
      categoryId = req.body.categoryId || '22';
      publishAt = null;
    }

    // Step 3: Upload to YouTube with optimized metadata
    const result = await youtubeService.uploadVideo({
      filepath: downloadResult.filepath,
      title: videoTitle,
      description: videoDesc,
      tags: videoTags,
      privacy: videoPrivacy,
      categoryId,
      publishAt
    });

    // Save to upload history with TikTok video ID for future duplicate detection
    const tiktokVideoId = extractTikTokVideoId(videoUrl);
    const allUploads = uploads.load();
    allUploads.push({
      filename: downloadResult.filename,
      filepath: downloadResult.filepath,
      youtube_id: result.videoId,
      youtube_url: result.youtubeUrl,
      uploaded_at: new Date().toISOString(),
      source: 'tiktok',
      source_url: videoUrl,
      tiktok_video_id: tiktokVideoId,
      deleted: true
    });
    uploads.save(allUploads);

    // Delete downloaded file after upload
    if (fs.existsSync(downloadResult.filepath)) {
      fs.unlinkSync(downloadResult.filepath);
    }

    // ★ emit ผ่าน EventBus — ทุกฟีเจอร์ได้รับผลกระทบ
    orchestrator.onTikTokDownloaded({ filename: downloadResult.filename, provider: downloadResult.provider });
    orchestrator.onUploadCompleted({
      filename: downloadResult.filename, source: 'tiktok',
      videoId: result.videoId, youtubeUrl: result.youtubeUrl
    });

    res.json({
      success: true,
      videoId: result.videoId,
      youtubeUrl: result.youtubeUrl,
      filename: downloadResult.filename,
      provider: downloadResult.provider
    });
  } catch (error) {
    logger.error('TikTok download-and-upload error', { error: error.message });
    orchestrator.onUploadFailed({ filename: filename || 'tiktok-video', error: error.message, source: 'tiktok' });
    res.status(500).json({ error: error.message });
  }
});

// Batch download and upload multiple TikTok videos
router.post('/batch-upload', async (req, res) => {
  const { videos, privacy, description, tags, force } = req.body;
  if (!videos || !Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกวิดีโออย่างน้อย 1 รายการ' });
  }

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
  }

  // Start batch processing in background
  res.json({ success: true, total: videos.length, message: 'เริ่มดาวน์โหลดและอัปโหลดในพื้นหลัง' });

  // Process in background
  processTikTokBatch(videos, { privacy, description, tags, force });
});

// TikTok batch progress (SSE)
router.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify(tiktokProgress)}\n\n`);
    if (tiktokProgress.status === 'done' || tiktokProgress.status === 'idle') {
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

async function processTikTokBatch(videos, options) {
  const config = settings.load();
  const privacy = options.privacy || config.privacy || 'public';
  const defaultDesc = options.description || config.defaultDescription || '';
  const defaultTags = options.tags || config.defaultTags || '';
  const seoMode = config.seoMode || 'auto';

  // ★ Sort by virality score (highest first) — process best content first
  // so if the batch fails mid-way, at least the viral clips made it through
  videos.sort((a, b) => (b.viralityScore || 0) - (a.viralityScore || 0));

  tiktokProgress = { current: 0, total: videos.length, currentFile: '', status: 'processing', phase: '', results: [] };

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    tiktokProgress.current = i + 1;
    tiktokProgress.currentFile = video.title || video.desc || `วิดีโอ ${i + 1}`;

    // Duplicate check before processing
    const videoId = extractTikTokVideoId(video.videoUrl);
    const dupCheck = isDuplicateTikTok(video.videoUrl, videoId);
    if (dupCheck.duplicate) {
      logger.info(`Skipping duplicate TikTok video`, { videoUrl: video.videoUrl, youtubeUrl: dupCheck.record.youtube_url });
      tiktokProgress.results.push({
        title: video.title || `วิดีโอ ${i + 1}`,
        success: false,
        skipped: true,
        error: `ซ้ำ — เคยอัปแล้ว: ${dupCheck.record.youtube_url}`
      });
      continue;
    }

    // ★ Monetization safety gate — skip clearly policy-violating content
    // instead of silently uploading it (unless the batch explicitly forces it).
    if (!options.force) {
      const preCheck = seoService.validateForMonetization(
        { desc: video.desc || video.title || '', duration: video.duration || 0 },
        video.title || ''
      );
      if (preCheck.status === 'blocked') {
        logger.warn('Skipping blocked TikTok video in batch', { videoUrl: video.videoUrl, issues: preCheck.issues });
        tiktokProgress.results.push({
          title: video.title || video.desc || `วิดีโอ ${i + 1}`,
          success: false,
          skipped: true,
          blocked: true,
          error: `บล็อกอัตโนมัติ: ${preCheck.issues.map(i => i.message).join('; ')}`
        });
        continue;
      }
    }

    try {
      // Phase 1: Download
      tiktokProgress.phase = 'downloading';
      logger.info(`Batch processing video ${i+1}/${videos.length}`, { 
        title: video.title?.substring(0,50), 
        viralityScore: video.viralityScore,
        url: video.videoUrl 
      });
      const downloadResult = await tiktokService.downloadNoWatermark(video.videoUrl, video.title);

      // Phase 2: Generate SEO metadata
      let videoTitle, videoDesc, videoTags, categoryId, publishAt;

      if (seoMode === 'auto' || seoMode === 'seo') {
        const tiktokData = {
          desc: video.title || video.desc || downloadResult.filename.replace('.mp4', ''),
          author: video.author || '',
          duration: video.duration || 0,
          videoUrl: video.videoUrl
        };
        const metadata = seoService.generateMetadata(tiktokData, { schedulePublish: false });
        videoTitle = (video.title || metadata.title).substring(0, 100);
        videoDesc = metadata.description;
        videoTags = metadata.tags;
        categoryId = metadata.categoryId;
      } else {
        videoTitle = (video.title || downloadResult.filename.replace('.mp4', '')).substring(0, 100);
        videoDesc = defaultDesc;
        videoTags = defaultTags;
        categoryId = '22';
      }

      // Phase 3: Upload to YouTube
      tiktokProgress.phase = 'uploading';

      const result = await youtubeService.uploadVideo({
        filepath: downloadResult.filepath,
        title: videoTitle,
        description: videoDesc,
        tags: videoTags,
        privacy,
        categoryId
      });

      // Save record with tiktok_video_id
      const tiktokVidId = extractTikTokVideoId(video.videoUrl);
      const allUploads = uploads.load();
      allUploads.push({
        filename: downloadResult.filename,
        filepath: downloadResult.filepath,
        youtube_id: result.videoId,
        youtube_url: result.youtubeUrl,
        uploaded_at: new Date().toISOString(),
        source: 'tiktok',
        source_url: video.videoUrl,
        tiktok_video_id: tiktokVidId,
        deleted: true
      });
      uploads.save(allUploads);

      // Clean up downloaded file
      if (fs.existsSync(downloadResult.filepath)) {
        fs.unlinkSync(downloadResult.filepath);
      }

      tiktokProgress.results.push({
        title: videoTitle,
        success: true,
        youtubeUrl: result.youtubeUrl
      });

      // ★ emit ผ่าน EventBus
      orchestrator.onTikTokDownloaded({ filename: downloadResult.filename });
      orchestrator.onUploadCompleted({
        filename: downloadResult.filename, source: 'tiktok',
        videoId: result.videoId, youtubeUrl: result.youtubeUrl
      });
    } catch (error) {
      logger.error(`Batch error for video ${i + 1}`, { error: error.message });
      tiktokProgress.results.push({
        title: video.title || `วิดีโอ ${i + 1}`,
        success: false,
        error: error.message
      });

      // ★ emit failure
      orchestrator.onUploadFailed({
        filename: video.title || `tiktok-batch-${i + 1}`,
        error: error.message, source: 'tiktok'
      });
    }

    // Delay between operations to avoid rate limiting
    if (i < videos.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  tiktokProgress.status = 'done';
  tiktokProgress.phase = '';
}

// Get downloaded TikTok files
router.get('/files', (req, res) => {
  const files = tiktokService.getDownloadedFiles();
  res.json({ files });
});

// Delete a downloaded TikTok file
router.delete('/files/:filename', (req, res) => {
  const success = tiktokService.deleteFile(req.params.filename);
  res.json({ success });
});

module.exports = router;
