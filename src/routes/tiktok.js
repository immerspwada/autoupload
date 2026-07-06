// TikTok Routes - Search, Download (no watermark), and Upload to YouTube
const express = require('express');
const router = express.Router();
const fs = require('fs');
const tiktokService = require('../services/tiktok');
const youtubeService = require('../services/youtube');
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

// Search TikTok videos by keyword
router.post('/search', async (req, res) => {
  const { keyword, count } = req.body;
  if (!keyword) return res.status(400).json({ error: 'กรุณาระบุคีย์เวิร์ด' });

  try {
    const videos = await tiktokService.searchVideos(keyword, count || 12);

    // Mark duplicates in search results
    const videosWithDuplicateInfo = videos.map(video => {
      const videoId = extractTikTokVideoId(video.videoUrl);
      const dupCheck = isDuplicateTikTok(video.videoUrl, videoId);
      return {
        ...video,
        alreadyUploaded: dupCheck.duplicate,
        youtubeUrl: dupCheck.duplicate ? dupCheck.record.youtube_url : null,
        uploadedAt: dupCheck.duplicate ? dupCheck.record.uploaded_at : null
      };
    });

    res.json({ videos: videosWithDuplicateInfo, keyword });
  } catch (error) {
    logger.error('TikTok search error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
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

  try {
    // Step 1: Download from TikTok (no watermark)
    const downloadResult = await tiktokService.downloadNoWatermark(videoUrl, filename);

    // Step 2: Upload to YouTube
    const config = settings.load();
    const videoTitle = title || downloadResult.filename.replace('.mp4', '');
    const videoPrivacy = privacy || config.privacy || 'public';
    const videoDesc = description || config.defaultDescription || '';
    const videoTags = tags || config.defaultTags || '';

    const result = await youtubeService.uploadVideo({
      filepath: downloadResult.filepath,
      title: videoTitle,
      description: videoDesc,
      tags: videoTags,
      privacy: videoPrivacy
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

    res.json({
      success: true,
      videoId: result.videoId,
      youtubeUrl: result.youtubeUrl,
      filename: downloadResult.filename,
      provider: downloadResult.provider
    });
  } catch (error) {
    logger.error('TikTok download-and-upload error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Batch download and upload multiple TikTok videos
router.post('/batch-upload', async (req, res) => {
  const { videos, privacy, description, tags } = req.body;
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
  processTikTokBatch(videos, { privacy, description, tags });
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

    try {
      // Phase 1: Download
      tiktokProgress.phase = 'downloading';
      const downloadResult = await tiktokService.downloadNoWatermark(video.videoUrl, video.title);

      // Phase 2: Upload to YouTube
      tiktokProgress.phase = 'uploading';
      const videoTitle = (video.title || downloadResult.filename.replace('.mp4', '')).substring(0, 100);

      const result = await youtubeService.uploadVideo({
        filepath: downloadResult.filepath,
        title: videoTitle,
        description: defaultDesc,
        tags: defaultTags,
        privacy
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
    } catch (error) {
      logger.error(`Batch error for video ${i + 1}`, { error: error.message });
      tiktokProgress.results.push({
        title: video.title || `วิดีโอ ${i + 1}`,
        success: false,
        error: error.message
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
