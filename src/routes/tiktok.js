// TikTok Routes - Search, Download (no watermark), and Upload to YouTube
// ★ ทุกเหตุการณ์ emit ผ่าน Orchestrator → EventBus
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const tiktokService = require('../services/tiktok');
const youtubeService = require('../services/youtube');
const seoService = require('../services/seo');
const videoTransform = require('../services/videoTransform');
const orchestrator = require('../services/orchestrator');
const { settings, uploads } = require('../utils/store');
const logger = require('../utils/logger');
const C = require('../config/constants');

// ★ Route timeout middleware — ป้องกัน request ค้างไม่มีกำหนด
function withTimeout(ms) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Route timeout', { path: req.path, ms });
        res.status(504).json({ error: 'Request timeout — tikwm API ใช้เวลานานเกินไป ลองใหม่อีกครั้ง' });
      }
    }, ms);
    if (timer.unref) timer.unref();
    res.on('finish', () => clearTimeout(timer));
    res.on('close',  () => clearTimeout(timer));
    next();
  };
}

// ★ เพดานจำนวนวิดีโอต่อ 1 batch request
const MAX_BATCH_VIDEOS = parseInt(process.env.MAX_BATCH_VIDEOS) || 100;
// ★ เพดานจำนวน result ที่เก็บใน memory ต่อ 1 batch
const MAX_PROGRESS_RESULTS = 200;

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
/**
 * ★ Duplicate index — สร้าง Map ครั้งเดียวแล้ว lookup O(1)
 *
 * เดิม: isDuplicateTikTok() โหลด uploads.json + วน linear ทุกครั้งที่เช็ค 1 คลิป
 *       batch 50 คลิป × history 3,000 record = 150,000 รอบ + regex ต่อรอบ
 *       ทำงานแบบ synchronous → event loop ค้าง หน้าเว็บหมุนทั้งหมด
 * ตอนนี้: index ถูก cache และ rebuild เฉพาะเมื่อ uploads.json เปลี่ยน
 */
let _dupIndex = null;
let _dupIndexSize = -1;

function buildDuplicateIndex() {
  const allUploads = uploads.loadRef();

  // rebuild เฉพาะเมื่อจำนวน record เปลี่ยน (append-only store)
  if (_dupIndex && _dupIndexSize === allUploads.length) return _dupIndex;

  const byUrl = new Map();
  const byId  = new Map();

  for (const record of allUploads) {
    if (record.source_url) {
      if (!byUrl.has(record.source_url)) byUrl.set(record.source_url, record);
      const existingId = extractTikTokVideoId(record.source_url);
      if (existingId && !byId.has(existingId)) byId.set(existingId, record);
    }
    if (record.tiktok_video_id && !byId.has(record.tiktok_video_id)) {
      byId.set(record.tiktok_video_id, record);
    }
  }

  _dupIndex = { byUrl, byId };
  _dupIndexSize = allUploads.length;
  return _dupIndex;
}

/** บังคับสร้าง index ใหม่ — เรียกหลังอัปโหลดสำเร็จ */
function invalidateDuplicateIndex() {
  _dupIndex = null;
  _dupIndexSize = -1;
}

/**
 * ★ บันทึก record การอัปโหลด + ล้าง duplicate index ในคำสั่งเดียว
 * ป้องกันกรณีลืมล้าง index → คลิปเดิมถูกอัปซ้ำเพราะ index ยังเป็นของเก่า
 */
async function recordUpload(updater) {
  await uploads.safeUpdate(updater);
  invalidateDuplicateIndex();
}

function isDuplicateTikTok(videoUrl, videoId) {
  const { byUrl, byId } = buildDuplicateIndex();

  const byUrlHit = videoUrl ? byUrl.get(videoUrl) : null;
  if (byUrlHit) return { duplicate: true, reason: 'exact_url', record: byUrlHit };

  const byIdHit = videoId ? byId.get(videoId) : null;
  if (byIdHit) return { duplicate: true, reason: 'video_id', record: byIdHit };

  return { duplicate: false };
}

// ==================== TikTok Batch Progress (SSE) ====================
let tiktokProgress = { current: 0, total: 0, currentFile: '', status: 'idle', phase: '', results: [] };

function enrichTikTokVideo(video) {
  const videoId = extractTikTokVideoId(video.videoUrl);
  const dupCheck = isDuplicateTikTok(video.videoUrl, videoId);
  const virality = seoService.calculateViralityScore(video);
  const validation = seoService.validateForMonetization(video, video.desc || '');
  // ★ loadRef — ไม่ clone settings ทุกคลิป (ถูกเรียกทุกรายการในผลค้นหา)
  const config = settings.loadRef();
  const channelStage = config.channelStage || 'early_stage'; // ★ default = early stage
  
  // ★ Revenue estimation
  const revenueEstimate = seoService.estimateRevenue(video, { channelStage });
  
  const opportunity = seoService.analyzeOpportunity(
    { ...video, virality, validation },
    { alreadyUploaded: dupCheck.duplicate, channelStage }
  );
  
  // ★ Actionable recommendations
  const recommendations = seoService.generateActionableRecommendations(
    { ...video, virality, validation, opportunity },
    { channelStage }
  );

  return {
    ...video,
    alreadyUploaded: dupCheck.duplicate,
    youtubeUrl: dupCheck.duplicate ? dupCheck.record.youtube_url : null,
    uploadedAt: dupCheck.duplicate ? dupCheck.record.uploaded_at : null,
    virality,
    monetizationStatus: validation.status, // 'ok' | 'warning' | 'blocked'
    opportunity,
    // ★ Revenue fields
    estimatedRpm: revenueEstimate.estimatedRpm,
    estimatedRevenue10K: revenueEstimate.estimatedRevenue10K,
    rpmCategory: revenueEstimate.category,
    rpmQuickEstimate: revenueEstimate.quickEstimate,
    // ★ Recommendations
    recommendations
  };
}

// Search TikTok videos by keyword (single or multiple)
// Accepts either { keyword: "cat" } or { keywords: ["cat", "dog", "..."] }
// Multiple keywords can also be sent as one comma/newline-separated string in `keyword`.
router.post('/search', withTimeout(C.API.TIKTOK_SEARCH_TIMEOUT_MS), async (req, res) => {
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
  // ★ กรอง keyword ที่ยาวผิดปกติออก (กัน URL ยาวๆ ถูกส่งมาเป็น keyword)
  keywordList = keywordList
    .map(k => (typeof k === 'string' ? k.trim() : ''))
    .filter(k => k.length > 0 && k.length <= 100);

  if (keywordList.length === 0) {
    return res.status(400).json({ error: 'กรุณาระบุคีย์เวิร์ดอย่างน้อย 1 คำ (ยาวไม่เกิน 100 ตัวอักษร)' });
  }

  // Cap to avoid abuse / excessive upstream load
  if (keywordList.length > C.API.MAX_KEYWORDS_PER_SEARCH) {
    keywordList = keywordList.slice(0, C.API.MAX_KEYWORDS_PER_SEARCH);
  }

  // ★ clamp count — เดิมรับค่าอะไรก็ได้แล้วยัดลง URL ของ tikwm ตรงๆ
  //   count=100000 ทำให้ upstream ตอบก้อนใหญ่มากแล้ว enrich ทุกรายการ = event loop ตาย
  const parsedCount = parseInt(count, 10);
  const countPerKeyword = Number.isFinite(parsedCount)
    ? Math.min(Math.max(parsedCount, 1), 50)
    : 12;

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
    const videosWithDuplicateInfo = videos.map(enrichTikTokVideo);

    // Best content first: sort by virality score (duplicates/blocked pushed down)
    videosWithDuplicateInfo.sort((a, b) => {
      if (a.alreadyUploaded !== b.alreadyUploaded) return a.alreadyUploaded ? 1 : -1;
      return (b.opportunity?.score || b.virality?.score || 0) - (a.opportunity?.score || a.virality?.score || 0);
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
router.get('/trending', withTimeout(C.API.TIKTOK_TRENDING_TIMEOUT_MS), async (req, res) => {
  const region = req.query.region || 'TH';
  const count = parseInt(req.query.count) || 12;

  try {
    const videos = await tiktokService.getTrending(region, count);
    const enriched = videos
      .map(enrichTikTokVideo)
      .sort((a, b) => (b.opportunity?.score || b.virality?.score || 0) - (a.opportunity?.score || a.virality?.score || 0));

    res.json({ videos: enriched, region, totalFound: enriched.length });
  } catch (error) {
    logger.error('TikTok trending error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Fetch latest videos from a specific creator (@username) — track creators
// whose content performs well and grab their newest clips.
router.get('/creator/:username', withTimeout(C.API.TIKTOK_CREATOR_TIMEOUT_MS), async (req, res) => {
  const { username } = req.params;
  const count = parseInt(req.query.count) || 12;

  try {
    const videos = await tiktokService.getCreatorVideos(username, count);
    const enriched = videos
      .map(enrichTikTokVideo)
      .sort((a, b) => (b.opportunity?.score || b.virality?.score || 0) - (a.opportunity?.score || a.virality?.score || 0));

    // ตรวจว่าใช้ fallback หรือเปล่า — ดูจาก author ว่าตรงกับ username ไหม
    const handle = username.replace(/^@/, '').toLowerCase();
    const directMatch = enriched.filter(v => (v.author || '').toLowerCase() === handle);
    const strategy = directMatch.length < enriched.length && enriched.length > 0
      ? 'search_fallback'
      : 'user_posts';

    res.json({ videos: enriched, username, totalFound: enriched.length, strategy });
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
router.post('/download-and-upload', withTimeout(C.API.TIKTOK_DL_UP_TIMEOUT_MS), async (req, res) => {
  const { videoUrl, title, description, tags, privacy, filename, force } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'กรุณาระบุ URL ของวิดีโอ' });

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
  }

  // ★ Check quota before proceeding (uses account-based quota with PST auto-reset)
  const quotaStatus = youtubeService.getQuotaStatus();
  if (quotaStatus.uploadsRemaining <= 0 && !force) {
    return res.status(429).json({
      error: `YouTube API Quota หมดแล้ว (${quotaStatus.used}/${quotaStatus.limit} units) — รอ reset เที่ยงคืน PST`,
      quotaStatus,
      recommendation: 'รอ quota reset หรือขอ Extended Quota (1M+ units/day) จาก Google Cloud Console'
    });
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

  let downloadResult = null;
  try {
    // Step 1: Download from TikTok (no watermark)
    downloadResult = await tiktokService.downloadNoWatermark(videoUrl, filename);

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

    // Step 2.5: ★ Video Transform — add value เพื่อหลีกเลี่ยง "Reused Content"
    // แปลงวิดีโอก่อนอัป: เพิ่ม intro/outro, overlay, watermark, visual tweaks
    let uploadFilepath = downloadResult.filepath;
    let transformResult = null;
    const transformConfig = config.videoTransform || {};
    
    if (transformConfig.enabled !== false) {
      try {
        // Override overlay text with video title for this clip
        const transformOptions = {
          overlay: { text: videoTitle },
          watermark: { text: transformConfig.watermark?.text || config.channelName || '' },
        };
        transformResult = await videoTransform.transformSingle(downloadResult.filepath, transformOptions);
        if (transformResult.transformed) {
          uploadFilepath = transformResult.filepath;
          logger.info('Video transformed successfully', {
            mode: transformResult.mode,
            processingTime: `${(transformResult.processingTime / 1000).toFixed(1)}s`,
          });
        }
      } catch (transformErr) {
        // Transform failure is non-fatal — upload original
        logger.warn('Video transform failed, uploading original', { error: transformErr.message });
      }
    }

    // Step 3: Upload to YouTube with optimized metadata
    const result = await youtubeService.uploadVideo({
      filepath: uploadFilepath,
      title: videoTitle,
      description: videoDesc,
      tags: videoTags,
      privacy: videoPrivacy,
      categoryId,
      publishAt
    });

    // ★ Atomic / race-safe record write — safeUpdate serializes concurrent saves
    const tiktokVideoId      = extractTikTokVideoId(videoUrl);
    const viralityForHistory = req.body.viralityScore ?? req.body.virality?.score ?? null;
    await recordUpload(arr => {
      arr.push({
        filename:        downloadResult.filename,
        filepath:        downloadResult.filepath,
        youtube_id:      result.videoId,
        youtube_url:     result.youtubeUrl,
        uploaded_at:     new Date().toISOString(),
        source:          'tiktok',
        source_url:      videoUrl,
        tiktok_video_id: tiktokVideoId,
        title:           videoTitle,
        viralityScore:   viralityForHistory,
        deleted:         true,
      });
      return arr;
    });

    // Delete downloaded file only after history is saved successfully
    try {
      if (fs.existsSync(downloadResult.filepath)) {
        fs.unlinkSync(downloadResult.filepath);
      }
      // Also delete transformed file if different from original
      if (transformResult?.transformed && uploadFilepath !== downloadResult.filepath && fs.existsSync(uploadFilepath)) {
        fs.unlinkSync(uploadFilepath);
      }
    } catch (unlinkErr) {
      logger.warn('Could not delete temp file after upload', { filepath: downloadResult.filepath, error: unlinkErr.message });
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
      provider: downloadResult.provider,
      transformed: transformResult?.transformed || false,
      transformMode: transformResult?.mode || null,
      quotaRemaining: youtubeService.getUploadsRemaining()
    });
  } catch (error) {
    logger.error('TikTok download-and-upload error', { error: error.message });
    // ★ Clean up downloaded file if it exists (ป้องกัน disk leak)
    if (downloadResult?.filepath) {
      try { if (fs.existsSync(downloadResult.filepath)) fs.unlinkSync(downloadResult.filepath); } catch (_) {}
    }
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
  // ★ เพดานจำนวน — เดิมไม่จำกัด scoring ทุกรายการเป็น synchronous = event loop ค้าง
  if (videos.length > MAX_BATCH_VIDEOS) {
    return res.status(400).json({
      error: `เลือกได้สูงสุด ${MAX_BATCH_VIDEOS} คลิปต่อครั้ง (ส่งมา ${videos.length})`,
      code: 'BATCH_TOO_LARGE',
    });
  }

  // ★ กันยิง batch ซ้อนกัน — tiktokProgress เป็น global ตัวเดียว สองงานพร้อมกันจะทับกัน
  if (tiktokProgress.status === 'processing') {
    return res.status(409).json({
      error: 'มี batch upload กำลังทำงานอยู่ — รอให้เสร็จก่อน',
      code: 'BATCH_IN_PROGRESS',
      progress: { current: tiktokProgress.current, total: tiktokProgress.total },
    });
  }

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
  }

  // ★ Quota-aware smart filtering
  const quotaStatus = youtubeService.getQuotaStatus();

  if (quotaStatus.uploadsRemaining <= 0 && !force) {
    return res.status(429).json({
      error: `Quota ไม่พอสำหรับอัปโหลด 1 วิดีโอ (${quotaStatus.remaining || 0}/${quotaStatus.limit || 0} units เหลือ)`,
      quotaStatus,
      recommendation: quotaStatus.summary?.recommendation || 'รอ quota reset เที่ยงคืน Pacific Time หรือเพิ่ม account ใหม่'
    });
  }

  // ★ Smart quota-aware filtering — rank content and fit it into available upload slots.
  const filterResult = _filterByQuotaStatus(videos, quotaStatus, { force });
  
  if (filterResult.rejected.length > 0 && !force) {
    logger.info('Quota-aware filtering applied', {
      requested: videos.length,
      allowed: filterResult.allowed.length,
      rejected: filterResult.rejected.length,
      reason: filterResult.reason
    });
    
    return res.json({
      success: true,
      smartFiltered: true,
      total: filterResult.allowed.length,
      rejected: filterResult.rejected.length,
      reason: filterResult.reason,
      quotaStatus,
      decision: filterResult.decision,
      message: `🎯 Smart Upload: เลือกอัป ${filterResult.allowed.length}/${videos.length} คลิปตาม quota (${filterResult.reason})`,
      videos: {
        allowed: filterResult.allowed.map(v => ({
          id: v._smartId,
          title: v.title,
          viralityScore: _getViralityScore(v),
          smartScore: v._smartScore,
          reasons: v._smartReasons
        })),
        rejected: filterResult.rejected.map(v => ({
          id: v._smartId,
          title: v.title,
          viralityScore: _getViralityScore(v),
          smartScore: v._smartScore,
          reason: v._rejectReason,
          reasons: v._smartReasons
        }))
      }
    });
  }

  // Start batch processing in background
  res.json({ 
    success: true, 
    total: filterResult.allowed.length, 
    message: 'เริ่มดาวน์โหลดและอัปโหลดในพื้นหลัง' 
  });

  // Process in background — attach .catch() to prevent unhandled rejection crash
  processTikTokBatch(filterResult.allowed, { privacy, description, tags, force })
    .catch(err => {
      logger.error('processTikTokBatch unhandled error', { error: err.message });
      tiktokProgress.status = 'done';
      tiktokProgress.phase = '';
    });
});

// Preview smart batch selection without downloading or uploading.
router.post('/batch-preview', (req, res) => {
  const { videos } = req.body;
  if (Array.isArray(videos) && videos.length > MAX_BATCH_VIDEOS) {
    return res.status(400).json({ error: `ดูตัวอย่างได้สูงสุด ${MAX_BATCH_VIDEOS} คลิป`, code: 'BATCH_TOO_LARGE' });
  }
  if (!videos || !Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกวิดีโออย่างน้อย 1 รายการ' });
  }

  const quotaStatus = youtubeService.getQuotaStatus();
  const filterResult = _filterByQuotaStatus(videos, quotaStatus);

  res.json({
    success: true,
    total: filterResult.allowed.length,
    rejected: filterResult.rejected.length,
    reason: filterResult.reason,
    quotaStatus,
    decision: filterResult.decision,
    videos: {
      allowed: filterResult.allowed.map(v => ({
        id: v._smartId,
        title: v.title,
        smartScore: v._smartScore,
        viralityScore: _getViralityScore(v),
        reasons: v._smartReasons
      })),
      rejected: filterResult.rejected.map(v => ({
        id: v._smartId,
        title: v.title,
        smartScore: v._smartScore,
        viralityScore: _getViralityScore(v),
        reason: v._rejectReason,
        reasons: v._smartReasons
      }))
    }
  });
});

/**
 * Smart quota-aware filtering using account-based quota status.
 * เมื่อ quota น้อย → เลือกเฉพาะคลิป high-virality เพื่อใช้ quota ได้คุ้มที่สุด
 */
function _filterByQuotaStatus(videos, quotaStatus, options = {}) {
  const uploadsRemaining = quotaStatus.uploadsRemaining || 0;
  const percentUsed = quotaStatus.percentUsed || 0;
  const availableSlots = Math.max(0, uploadsRemaining);
  const policy = _getQuotaPolicy(percentUsed, availableSlots, videos.length);

  const ranked = videos.map((video, index) => {
    const scored = _scoreBatchCandidate(video, quotaStatus);
    return {
      ...video,
      _smartId: video.videoUrl || `${video.title || video.desc || 'video'}-${index}`,
      _smartScore: scored.score,
      _smartReasons: scored.reasons,
      _smartFlags: scored.flags,
      _smartIndex: index,
    };
  }).sort((a, b) => {
    if (b._smartScore !== a._smartScore) return b._smartScore - a._smartScore;
    return a._smartIndex - b._smartIndex;
  });

  if (availableSlots <= 0) {
    return {
      allowed: [],
      rejected: ranked.map(v => ({ ...v, _rejectReason: 'quota ไม่พอสำหรับ upload' })),
      reason: 'Quota ไม่พอสำหรับ upload',
      decision: { availableSlots, minScore: null, rankedBy: 'smart_score' }
    };
  }

  const minScore = options.force ? 0 : policy.minScore;

  const qualified = ranked.map(video => {
    if (video._smartScore < minScore) {
      return { ...video, _rejectReason: `score ต่ำกว่าเกณฑ์ (${video._smartScore} < ${minScore})` };
    }
    if (!options.force && video._smartFlags.blocked) {
      return { ...video, _rejectReason: 'ความเสี่ยง monetization สูง' };
    }
    if (!options.force && video._smartFlags.duplicate) {
      return { ...video, _rejectReason: 'เคยอัปโหลดแล้ว' };
    }
    return video;
  });

  const allowed = _selectDiverseCandidates(
    qualified.filter(v => !v._rejectReason),
    availableSlots,
    policy
  );

  const allowedIds = new Set(allowed.map(v => v._smartId));
  const rejected = qualified
    .filter(v => !allowedIds.has(v._smartId))
    .map(v => v._rejectReason ? v : { ...v, _rejectReason: `เกิน quota ที่เหลือ (${availableSlots} slots)` });

  if (rejected.length === 0) {
    return {
      allowed,
      rejected: [],
      reason: `Quota เพียงพอ (${availableSlots} slots remaining)`,
      decision: { availableSlots, minScore, rankedBy: 'smart_score', policy }
    };
  }

  const reason = policy.reason;

  return {
    allowed,
    rejected,
    reason,
    minScore,
    decision: {
      availableSlots,
      requested: videos.length,
      selected: allowed.length,
      rejected: rejected.length,
      rankedBy: 'smart_score',
      policy
    }
  };
}

/**
 * ★ Adaptive Quota Policy — Percentile-based instead of fixed thresholds
 * ปรับ minScore ตาม percentile ของ candidates ที่มี ไม่ใช่ fixed number
 * 
 * Logic:
 *   - ถ้า quota >= 50% → อัปทั้งหมด
 *   - ถ้า quota 20-50% → เลือก top 70th percentile
 *   - ถ้า quota 5-20% → เลือก top 85th percentile  
 *   - ถ้า quota < 5% → เลือก top 95th percentile เท่านั้น
 */
function _getQuotaPolicy(percentUsed, availableSlots, requestedCount) {
  // Critical quota — เลือกเฉพาะคลิปที่คุ้มที่สุด
  if (percentUsed >= 95 || availableSlots <= Math.max(1, Math.ceil(requestedCount * 0.15))) {
    return {
      level: 'critical',
      minScore: 78, // ~95th percentile
      percentile: 95,
      maxPerAuthor: 1,
      reason: `Quota วิกฤต (${percentUsed.toFixed(0)}%) — เลือกเฉพาะ top 5% คลิปที่คุ้มที่สุด`
    };
  }
  
  // Tight quota — เลือก top 15%
  if (percentUsed >= 80 || availableSlots < requestedCount) {
    return {
      level: 'tight',
      minScore: 62, // ~85th percentile
      percentile: 85,
      maxPerAuthor: 2,
      reason: `Quota จำกัด (${availableSlots}/${requestedCount} slots) — เลือก top 15% คลิปคุณภาพสูง`
    };
  }
  
  // Caution — เลือก top 30%
  if (percentUsed >= 50) {
    return {
      level: 'caution',
      minScore: 45, // ~70th percentile
      percentile: 70,
      maxPerAuthor: 3,
      reason: `Quota เริ่มน้อย (${percentUsed.toFixed(0)}%) — เลือก top 30% คลิป`
    };
  }
  
  // Normal — อัปทั้งหมดแต่เรียงลำดับคุณภาพ
  return {
    level: 'normal',
    minScore: 0, // All candidates
    percentile: 0,
    maxPerAuthor: Infinity,
    reason: `Quota เพียงพอ (${availableSlots} slots) — เรียงตามคุณภาพ`
  };
}

function _scoreBatchCandidate(video, quotaStatus) {
  const reasons = [];
  const flags = {};
  const virality = _getViralityScore(video);
  let score = virality * 0.58;

  // ★ Channel stage — ปรับ bonus/penalty ตามระยะช่อง
  const channelStage = settings.load().channelStage || 'early_stage';
  const duration = Number(video.duration || 0);

  if (channelStage === 'early_stage') {
    // เน้น: tutorial/howto, engagement rate สูง (สัญญาณว่าคนดูจนจบ → subscribe)
    if (duration >= 45) { score += 10; reasons.push('คลิปยาว เหมาะกับ watch time'); }
    if (video.opportunity?.follower >= 70) { score += 8; reasons.push('โอกาสผู้ติดตามสูง'); }
    if (video.opportunity?.watchTime >= 65) { score += 10; reasons.push('Watch Time potential ดี'); }
  } else if (channelStage === 'pre_ypp') {
    // เน้น: คลิปยาว ≥60s สะสม watch hours
    if (duration >= 60) { score += 15; reasons.push('≥60s สะสม watch hours'); }
    else if (duration < 20 && duration > 0) { score -= 12; reasons.push('หักคะแนน: สั้นไป ไม่ช่วย watch hours'); }
    if (video.opportunity?.watchTime >= 60) { score += 8; reasons.push('Watch Time potential ดี'); }
  }
  // monetized = ใช้ virality เป็นหลัก (default เดิม)

  const views = Number(video.playCount || video.views || 0);
  const likes = Number(video.likeCount || 0);
  const comments = Number(video.commentCount || 0);
  const shares = Number(video.shareCount || 0);

  const validation = seoService.validateForMonetization(
    { desc: video.desc || video.title || '', duration: video.duration || 0 },
    video.title || ''
  );
  if (validation.status === 'blocked' || video.monetizationStatus === 'blocked') {
    score -= 100;
    flags.blocked = true;
    reasons.push('ตัดออก: เสี่ยงนโยบายสูง');
  } else if (validation.status === 'warning' || video.monetizationStatus === 'warning') {
    score -= 18;
    reasons.push('หักคะแนน: มีความเสี่ยง monetization');
  } else {
    score += 8;
    reasons.push('ปลอดภัยต่อ monetization');
  }

  const videoId = extractTikTokVideoId(video.videoUrl);
  const dupCheck = isDuplicateTikTok(video.videoUrl, videoId);
  if (dupCheck.duplicate) {
    score -= 120;
    flags.duplicate = true;
    reasons.push('ตัดออก: เคยอัปโหลดแล้ว');
  }

  if (views >= 10000) {
    score += 10;
    reasons.push('มี sample size น่าเชื่อถือ');
  } else if (views > 0 && views < 1000) {
    score -= 8;
    reasons.push('หักคะแนน: ยอดดูยังน้อย');
  }

  if (views > 0) {
    const likeRate = likes / views;
    const shareRate = shares / views;
    const commentRate = comments / views;
    if (likeRate >= 0.08) {
      score += 9;
      reasons.push('like rate สูง');
    }
    if (shareRate >= 0.01) {
      score += 12;
      reasons.push('share rate ดี');
    }
    if (commentRate >= 0.003) {
      score += 5;
      reasons.push('มี engagement เชิงสนทนา');
    }
  }

  if (video.createTime) {
    const ageDays = (Date.now() / 1000 - Number(video.createTime)) / 86400;
    if (ageDays <= 7) {
      score += 8;
      reasons.push('คลิปใหม่ ยังมี momentum');
    } else if (ageDays > 90) {
      score -= 5;
      reasons.push('หักคะแนน: คลิปเก่า');
    }
  }

  if ((quotaStatus.percentUsed || 0) >= 90 && virality >= 75) {
    score += 8;
    reasons.push('คุ้ม quota ในช่วง quota ตึง');
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: reasons.slice(0, 5),
    flags
  };
}

function _selectDiverseCandidates(candidates, availableSlots, policy) {
  if (!Number.isFinite(policy.maxPerAuthor)) {
    return candidates.slice(0, availableSlots);
  }

  const picked = [];
  const byAuthor = new Map();
  for (const candidate of candidates) {
    if (picked.length >= availableSlots) break;
    const author = (candidate.author || 'unknown').toLowerCase();
    const count = byAuthor.get(author) || 0;
    if (count >= policy.maxPerAuthor) continue;
    picked.push(candidate);
    byAuthor.set(author, count + 1);
  }

  if (picked.length < availableSlots) {
    const pickedIds = new Set(picked.map(v => v._smartId));
    for (const candidate of candidates) {
      if (picked.length >= availableSlots) break;
      if (!pickedIds.has(candidate._smartId)) picked.push(candidate);
    }
  }

  return picked;
}

function _getViralityScore(video) {
  if (typeof video.viralityScore === 'number') return video.viralityScore;
  if (typeof video.virality?.score === 'number') return video.virality.score;
  return seoService.calculateViralityScore(video).score || 0;
}

/**
 * ★ เก็บผลลัพธ์ของ batch แบบมีเพดาน
 * เดิม results เป็น array ที่โตได้ไม่จำกัดและถูก serialize ส่งผ่าน SSE ทุกวินาที
 */
function _pushResult(entry) {
  tiktokProgress.results.push(entry);
  if (tiktokProgress.results.length > MAX_PROGRESS_RESULTS) {
    tiktokProgress.results.splice(0, tiktokProgress.results.length - MAX_PROGRESS_RESULTS);
  }
}

// TikTok batch progress (SSE)
// ★ เพดานอายุ stream — เดิมถ้า status ค้างที่ 'processing' (เช่น process ถูก kill กลางทาง)
//   interval จะวิ่งทุกวินาทีตลอดกาลต่อ client 1 คน
const SSE_MAX_LIFETIME_MS = 30 * 60 * 1000;

router.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // กัน nginx buffer SSE

  let closed = false;
  const startedAt = Date.now();

  const stop = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    try { res.end(); } catch (_) {}
  };

  req.on('close', stop);
  req.on('error', stop);

  const interval = setInterval(() => {
    if (closed) return;

    if (Date.now() - startedAt > SSE_MAX_LIFETIME_MS) {
      logger.debug('[TikTok SSE] ปิด stream ที่เปิดนานเกินกำหนด');
      return stop();
    }

    try {
      // ★ ส่งแค่ที่จำเป็น — results อาจยาวมากในงาน batch ใหญ่
      res.write(`data: ${JSON.stringify({
        current:     tiktokProgress.current,
        total:       tiktokProgress.total,
        currentFile: tiktokProgress.currentFile,
        status:      tiktokProgress.status,
        phase:       tiktokProgress.phase,
        results:     tiktokProgress.results.slice(-30),
      })}\n\n`);

      if (tiktokProgress.status === 'done' || tiktokProgress.status === 'idle') stop();
    } catch (_) {
      stop();   // Client disconnected before close event fired
    }
  }, 1000);
  if (interval.unref) interval.unref();
});

async function processTikTokBatch(videos, options) {
  const config      = settings.loadRef();
  const privacy     = options.privacy     || config.privacy            || 'public';
  const defaultDesc = options.description || config.defaultDescription || '';
  const defaultTags = options.tags        || config.defaultTags        || '';
  const seoMode     = config.seoMode      || 'auto';

  videos.sort((a, b) => (b._smartScore ?? _getViralityScore(b)) - (a._smartScore ?? _getViralityScore(a)));

  tiktokProgress = {
    current: 0, total: videos.length, currentFile: '',
    status: 'processing', phase: '', results: [],
    startedAt: Date.now(),
  };

  // ★ try/finally รับประกัน status='done' แม้ process crash กลางทาง
  try {

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    tiktokProgress.current = i + 1;
    tiktokProgress.currentFile = video.title || video.desc || `วิดีโอ ${i + 1}`;

    // ★ Check quota before each upload (use account-based quota)
    const quotaStatus = youtubeService.getQuotaStatus();
    if (quotaStatus.uploadsRemaining <= 0) {
      logger.warn('Quota exhausted mid-batch', { videoIndex: i, total: videos.length });
      _pushResult({
        title: video.title || `วิดีโอ ${i + 1}`,
        success: false,
        skipped: true,
        error: `Quota หมด (${quotaStatus.used}/${quotaStatus.limit}) — หยุดอัปโหลด`
      });
      // Stop processing remaining videos
      break;
    }

    // Duplicate check before processing
    const videoId = extractTikTokVideoId(video.videoUrl);
    const dupCheck = isDuplicateTikTok(video.videoUrl, videoId);
    if (dupCheck.duplicate) {
      logger.info(`Skipping duplicate TikTok video`, { videoUrl: video.videoUrl, youtubeUrl: dupCheck.record.youtube_url });
      _pushResult({
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
        _pushResult({
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
        viralityScore: _getViralityScore(video),
        smartScore: video._smartScore,
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

      // ★ Video Transform — add value ก่อนอัป
      let uploadFilepath = downloadResult.filepath;
      let batchTransformed = false;
      const transformConfig = config.videoTransform || {};
      if (transformConfig.enabled !== false) {
        try {
          tiktokProgress.phase = 'transforming';
          const tResult = await videoTransform.transformSingle(downloadResult.filepath, {
            overlay: { text: videoTitle },
            watermark: { text: transformConfig.watermark?.text || config.channelName || '' },
          });
          if (tResult.transformed) {
            uploadFilepath = tResult.filepath;
            batchTransformed = true;
          }
        } catch (tErr) {
          logger.warn('Batch transform failed, using original', { error: tErr.message });
        }
      }

      tiktokProgress.phase = 'uploading';
      const result = await youtubeService.uploadVideo({
        filepath: uploadFilepath,
        title: videoTitle,
        description: videoDesc,
        tags: videoTags,
        privacy,
        categoryId
      });

      // ★ Atomic / race-safe record write
      const tiktokVidId = extractTikTokVideoId(video.videoUrl);
      await recordUpload(arr => {
        arr.push({
          filename:        downloadResult.filename,
          filepath:        downloadResult.filepath,
          youtube_id:      result.videoId,
          youtube_url:     result.youtubeUrl,
          uploaded_at:     new Date().toISOString(),
          source:          'tiktok',
          source_url:      video.videoUrl,
          tiktok_video_id: tiktokVidId,
          title:           videoTitle,
          viralityScore:   _getViralityScore(video),
          deleted:         true,
        });
        return arr;
      });

      // Clean up downloaded file
      try {
        if (fs.existsSync(downloadResult.filepath)) {
          fs.unlinkSync(downloadResult.filepath);
        }
        // Also clean up transformed file if different
        if (batchTransformed && uploadFilepath !== downloadResult.filepath && fs.existsSync(uploadFilepath)) {
          fs.unlinkSync(uploadFilepath);
        }
      } catch (unlinkErr) {
        logger.warn('Could not delete batch temp file', { filepath: downloadResult.filepath, error: unlinkErr.message });
      }

      _pushResult({
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
      _pushResult({
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
      await new Promise(resolve => setTimeout(resolve, C.TIKTOK.BATCH_UPLOAD_DELAY_MS));
    }
  }

  } finally {
    // ★ รับประกัน status reset เสมอ — ป้องกัน SSE progress ค้างถ้า crash กลางทาง
    tiktokProgress.status = 'done';
    tiktokProgress.phase  = '';
  }
  
  const finalQuota = youtubeService.getQuotaStatus();
  logger.info('Batch upload completed', {
    total:      videos.length,
    successful: tiktokProgress.results.filter(r => r.success).length,
    failed:     tiktokProgress.results.filter(r => !r.success && !r.skipped).length,
    skipped:    tiktokProgress.results.filter(r => r.skipped).length,
    quotaUsed:  `${finalQuota.used}/${finalQuota.limit}`,
    quotaRemaining: finalQuota.uploadsRemaining,
  });
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

// ==================== Download to Browser (Save to Computer) ====================

/**
 * Download TikTok video → save to server → stream back to browser for user to save.
 * POST body: { videoUrl, filename? }
 * Response: video/mp4 stream with Content-Disposition: attachment
 * 
 * Flow: TikTok → server downloads (no watermark) → browser download dialog
 */
router.post('/download-to-browser', withTimeout(C.API.TIKTOK_DL_BROWSER_TIMEOUT_MS), async (req, res) => {
  const { videoUrl, filename } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'กรุณาระบุ URL ของวิดีโอ' });

  try {
    logger.info('Browser download requested', { videoUrl });

    // Step 1: Download to server's downloads/tiktok folder (no watermark)
    const result = await tiktokService.downloadNoWatermark(videoUrl, filename);

    if (!fs.existsSync(result.filepath)) {
      return res.status(500).json({ error: 'ดาวน์โหลดไฟล์ล้มเหลว — ไม่พบไฟล์หลังดาวน์โหลด' });
    }

    // Step 2: Stream file back to browser with download headers
    // filename= must be ASCII only; use filename*= for UTF-8 names
    const asciiFilename = result.filename.replace(/[^\x20-\x7E]/g, '_'); // strip non-ASCII
    const utf8Filename  = encodeURIComponent(result.filename);            // percent-encode Thai
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`);
    res.setHeader('Content-Length', result.size);
    res.setHeader('X-Provider', result.provider || 'unknown');

    const stream = fs.createReadStream(result.filepath);
    stream.pipe(res);

    // Step 3: Delete server copy after streaming (keep disk clean)
    stream.on('end', () => {
      fs.unlink(result.filepath, (err) => {
        if (err) logger.warn('Failed to delete temp file after browser download', { filepath: result.filepath });
        else logger.info('Temp file cleaned after browser download', { filename: result.filename });
      });
    });

    stream.on('error', (err) => {
      logger.error('Stream error during browser download', { error: err.message });
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
    });

    logger.info('Streaming file to browser', { filename: result.filename, size: result.size, provider: result.provider });

  } catch (error) {
    logger.error('Browser download error', { error: error.message });
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

/**
 * Serve an already-downloaded file from server's downloads/tiktok folder to browser.
 * GET /api/tiktok/serve/:filename
 * Used when user wants to save a file that was previously downloaded (still on server).
 */
router.get('/serve/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filepath = path.join(tiktokService.downloadDir, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'ไม่พบไฟล์ — อาจถูกลบหลังอัปโหลดไป YouTube แล้ว' });
  }

  const stats = fs.statSync(filepath);
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_');
  const utf8Filename  = encodeURIComponent(filename);

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`);
  res.setHeader('Content-Length', stats.size);

  const stream = fs.createReadStream(filepath);
  stream.pipe(res);

  stream.on('error', (err) => {
    logger.error('Serve file stream error', { error: err.message, filename });
    if (!res.headersSent) res.status(500).end();
  });

  logger.info('Serving file to browser', { filename, size: stats.size });
});

// ★ Create compilation video from multiple TikTok downloads
router.post('/compile', withTimeout(C.API.TIKTOK_COMPILE_TIMEOUT_MS), async (req, res) => {
  const { videoUrls, title, description, tags, privacy, uploadAfter } = req.body;
  if (!Array.isArray(videoUrls) || videoUrls.length < 2) {
    return res.status(400).json({ error: 'ต้องมีอย่างน้อย 2 URL สำหรับ compilation' });
  }

  if (videoUrls.length > 10) {
    return res.status(400).json({ error: 'สูงสุด 10 คลิปต่อ 1 compilation' });
  }

  try {
    // Step 1: Download all videos
    const downloadResults = [];
    for (let i = 0; i < videoUrls.length; i++) {
      try {
        const dl = await tiktokService.downloadNoWatermark(videoUrls[i]);
        downloadResults.push(dl);
      } catch (err) {
        logger.warn(`Compilation: failed to download clip ${i+1}`, { error: err.message });
      }
    }

    if (downloadResults.length < 2) {
      // Cleanup
      downloadResults.forEach(dl => { try { fs.unlinkSync(dl.filepath); } catch {} });
      return res.status(400).json({ error: 'ดาวน์โหลดได้ไม่พอ 2 คลิป — ลองใหม่' });
    }

    // Step 2: Create compilation
    const filepaths = downloadResults.map(dl => dl.filepath);
    const compilationResult = await videoTransform.createCompilation(filepaths, {});

    // Step 3: Cleanup original downloads
    downloadResults.forEach(dl => { try { fs.unlinkSync(dl.filepath); } catch {} });

    // Step 4: Upload if requested
    if (uploadAfter) {
      const authStatus = youtubeService.isAuthenticated();
      if (!authStatus.authenticated) {
        return res.json({
          success: true,
          compiled: true,
          filepath: compilationResult.filepath,
          clips: compilationResult.clips,
          duration: compilationResult.videoDuration,
          uploaded: false,
          reason: 'ยังไม่ได้เชื่อมต่อ YouTube — compilation บันทึกไว้แล้ว'
        });
      }

      const config = settings.load();
      const compTitle = title || `Compilation ${new Date().toLocaleDateString('th-TH')}`;
      const metadata = seoService.generateMetadata({ desc: compTitle, duration: compilationResult.videoDuration }, {});
      
      const result = await youtubeService.uploadVideo({
        filepath: compilationResult.filepath,
        title: compTitle,
        description: description || metadata.description,
        tags: tags || metadata.tags,
        privacy: privacy || config.privacy || 'public',
        categoryId: metadata.categoryId,
      });

      // Cleanup
      try { fs.unlinkSync(compilationResult.filepath); } catch {}

      // Record
      await recordUpload(arr => {
        arr.push({
          filename: path.basename(compilationResult.filepath),
          youtube_id: result.videoId,
          youtube_url: result.youtubeUrl,
          uploaded_at: new Date().toISOString(),
          source: 'tiktok_compilation',
          title: compTitle,
          clips: compilationResult.clips,
          duration: compilationResult.videoDuration,
          deleted: true,
        });
        return arr;
      });

      orchestrator.onUploadCompleted({
        filename: path.basename(compilationResult.filepath),
        source: 'tiktok_compilation',
        videoId: result.videoId,
        youtubeUrl: result.youtubeUrl
      });

      return res.json({
        success: true,
        compiled: true,
        uploaded: true,
        videoId: result.videoId,
        youtubeUrl: result.youtubeUrl,
        clips: compilationResult.clips,
        duration: compilationResult.videoDuration,
      });
    }

    res.json({
      success: true,
      compiled: true,
      uploaded: false,
      filepath: compilationResult.filepath,
      clips: compilationResult.clips,
      duration: compilationResult.videoDuration,
      size: compilationResult.outputSize,
    });
  } catch (error) {
    logger.error('Compilation error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
