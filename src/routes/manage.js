/**
 * ★ Video Management Routes — ลบคลิปที่โดนบล็อกออกจากช่อง YouTube
 *
 * ฟีเจอร์:
 * 1. POST /scan-blocked   — สแกน uploads ทั้งหมด เช็คว่าตัวไหนโดน block แล้วลบออกจาก YouTube
 * 2. DELETE /:videoId      — ลบวิดีโอเดี่ยวออกจาก YouTube
 * 3. GET /blocked         — ดู list วิดีโอที่โดน block (ยังอยู่บน YouTube)
 */
const express = require('express');
const { requireAuthForDestructive } = require('../middleware/security');
const router = express.Router();

const youtubeService = require('../services/youtube');
const seoService = require('../services/seo');
const orchestrator = require('../services/orchestrator');
const { uploads } = require('../utils/store');
const logger = require('../utils/logger');

/**
 * GET /api/manage/blocked
 * ดูรายชื่อวิดีโอที่อัปไปแล้วแต่ตอนนี้ถูก validate ว่า blocked
 * (เนื้อหาผิดนโยบาย — ควรลบออกจากช่อง)
 */
router.get('/blocked', (req, res) => {
  const allUploads = uploads.load();
  const blockedVideos = [];

  for (const record of allUploads) {
    // Skip records without YouTube ID or already marked as deleted from YT
    if (!record.youtube_id || record.deletedFromYouTube) continue;

    // Re-validate using current monetization rules
    const title = record.title || record.filename || '';
    const desc = record.description || record.tiktok_desc || '';
    const validation = seoService.validateForMonetization(
      { desc, duration: record.duration || 0 },
      title
    );

    if (validation.status === 'blocked') {
      blockedVideos.push({
        youtube_id: record.youtube_id,
        youtube_url: record.youtube_url,
        title: title,
        filename: record.filename,
        uploaded_at: record.uploaded_at,
        source: record.source,
        validation
      });
    }
  }

  res.json({
    total: blockedVideos.length,
    videos: blockedVideos,
    message: blockedVideos.length > 0
      ? `พบ ${blockedVideos.length} วิดีโอที่ผิดนโยบาย — ควรลบออกจากช่อง`
      : 'ไม่พบวิดีโอที่ผิดนโยบาย ✓'
  });
});

/**
 * POST /api/manage/scan-blocked
 * สแกนทุกวิดีโอที่เคยอัป → เช็ค monetization policy → ลบตัวที่ blocked ออกจาก YouTube ทันที
 */
router.post('/scan-blocked', requireAuthForDestructive, async (req, res) => {
  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
  }

  const allUploads = uploads.load();
  const results = { deleted: [], failed: [], skipped: [] };

  for (const record of allUploads) {
    // Skip records without YouTube ID or already deleted
    if (!record.youtube_id || record.deletedFromYouTube) {
      continue;
    }

    // Re-validate using current monetization rules
    const title = record.title || record.filename || '';
    const desc = record.description || record.tiktok_desc || '';
    const validation = seoService.validateForMonetization(
      { desc, duration: record.duration || 0 },
      title
    );

    if (validation.status !== 'blocked') {
      continue; // Safe content — skip
    }

    // ★ Content is blocked — DELETE from YouTube
    try {
      const deleteResult = await youtubeService.deleteVideo(record.youtube_id);

      results.deleted.push({
        youtube_id: record.youtube_id,
        title,
        reason: validation.issues.find(i => i.level === 'error')?.message || 'ผิดนโยบาย'
      });

      // Emit event for stats/notification
      orchestrator.onVideoDeleted({
        videoId: record.youtube_id,
        title,
        filename: record.filename,
        reason: validation.issues.find(i => i.level === 'error')?.message || 'blocked_content'
      });

      logger.info('[Manage] Deleted blocked video from YouTube', {
        videoId: record.youtube_id, title
      });
    } catch (err) {
      results.failed.push({
        youtube_id: record.youtube_id,
        title,
        error: err.message
      });
      logger.error('[Manage] Failed to delete blocked video', {
        videoId: record.youtube_id, error: err.message
      });
    }
  }

  // ★ Mark deleted records in uploads.json so they don't get re-scanned
  if (results.deleted.length > 0) {
    const deletedIds = new Set(results.deleted.map(d => d.youtube_id));
    await uploads.safeUpdate(arr => {
      for (const record of arr) {
        if (deletedIds.has(record.youtube_id)) {
          record.deletedFromYouTube = true;
          record.deletedAt = new Date().toISOString();
          record.deleteReason = 'blocked_content_auto_scan';
        }
      }
      return arr;
    });
  }

  res.json({
    success: true,
    summary: {
      scanned: allUploads.filter(r => r.youtube_id && !r.deletedFromYouTube).length,
      deleted: results.deleted.length,
      failed: results.failed.length
    },
    results
  });
});

/**
 * DELETE /api/manage/:videoId
 * ลบวิดีโอเดี่ยวออกจาก YouTube (manual)
 */
router.delete('/:videoId', requireAuthForDestructive, async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
  }

  try {
    const result = await youtubeService.deleteVideo(videoId);

    // Mark in uploads.json
    await uploads.safeUpdate(arr => {
      const record = arr.find(r => r.youtube_id === videoId);
      if (record) {
        record.deletedFromYouTube = true;
        record.deletedAt = new Date().toISOString();
        record.deleteReason = 'manual_delete';
      }
      return arr;
    });

    // Find title from uploads for notification
    const allUploads = uploads.load();
    const record = allUploads.find(r => r.youtube_id === videoId);

    orchestrator.onVideoDeleted({
      videoId,
      title: record?.title || record?.filename || videoId,
      filename: record?.filename,
      reason: 'manual_delete'
    });

    res.json({ success: true, videoId, alreadyDeleted: result.alreadyDeleted || false });
  } catch (err) {
    logger.error('[Manage] Delete video error', { videoId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
