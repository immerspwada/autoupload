// TikTok Routes - Search, Download (no watermark), and Upload to YouTube
const express = require('express');
const router = express.Router();
const fs = require('fs');
const tiktokService = require('../services/tiktok');
const youtubeService = require('../services/youtube');
const { settings, uploads } = require('../utils/store');
const logger = require('../utils/logger');

// ==================== TikTok Batch Progress (SSE) ====================
let tiktokProgress = { current: 0, total: 0, currentFile: '', status: 'idle', phase: '', results: [] };

// Search TikTok videos by keyword
router.post('/search', async (req, res) => {
  const { keyword, count } = req.body;
  if (!keyword) return res.status(400).json({ error: 'กรุณาระบุคีย์เวิร์ด' });

  try {
    const videos = await tiktokService.searchVideos(keyword, count || 12);
    res.json({ videos, keyword });
  } catch (error) {
    logger.error('TikTok search error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
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
  const { videoUrl, title, description, tags, privacy, filename } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'กรุณาระบุ URL ของวิดีโอ' });

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
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

    // Save to upload history
    const allUploads = uploads.load();
    allUploads.push({
      filename: downloadResult.filename,
      filepath: downloadResult.filepath,
      youtube_id: result.videoId,
      youtube_url: result.youtubeUrl,
      uploaded_at: new Date().toISOString(),
      source: 'tiktok',
      source_url: videoUrl,
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

      // Save record
      const allUploads = uploads.load();
      allUploads.push({
        filename: downloadResult.filename,
        filepath: downloadResult.filepath,
        youtube_id: result.videoId,
        youtube_url: result.youtubeUrl,
        uploaded_at: new Date().toISOString(),
        source: 'tiktok',
        source_url: video.videoUrl,
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
