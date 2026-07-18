// YouTube Analytics Route — ดึง performance data จาก YouTube Analytics API
// เชื่อมต่อกับ YouTube Data API v3 + Analytics API เพื่อดู views/watchTime/revenue
const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const youtubeService = require('../services/youtube');
const { uploads } = require('../utils/store');
const logger = require('../utils/logger');

/**
 * GET /api/analytics/summary
 * สรุปยอด views, watchTime, revenue ของวิดีโอที่อัปจากระบบ
 * query: ?days=30 (default 30)
 */
router.get('/summary', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);

  try {
    const client = youtubeService.getOAuth2Client();
    if (!client || !client.credentials?.access_token) {
      return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
    }

    // ดึง video IDs จาก upload history ของเรา
    const allUploads = uploads.load();
    const recentUploads = allUploads
      .filter(u => u.youtube_id && u.uploaded_at)
      .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
      .slice(0, 50); // เอาแค่ 50 อันล่าสุด

    if (recentUploads.length === 0) {
      return res.json({
        summary: { views: 0, estimatedMinutesWatched: 0, estimatedRevenue: null, videos: 0 },
        videos: [],
        days,
        message: 'ยังไม่มีวิดีโอที่อัปโหลด'
      });
    }

    const videoIds = recentUploads.map(u => u.youtube_id);

    // ─── YouTube Data API: ดึง snippet + statistics ─────────────────────
    const youtube = google.youtube({ version: 'v3', auth: client });
    let videoDetails = [];
    // Batch in groups of 50 (API limit)
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      try {
        const resp = await youtube.videos.list({
          part: 'snippet,statistics,contentDetails',
          id: batch.join(',')
        });
        videoDetails = videoDetails.concat(resp.data.items || []);
      } catch (err) {
        logger.warn('[Analytics] videos.list batch error', { error: err.message });
      }
    }

    // ─── YouTube Analytics API: ดึง views + watchTime + revenue ──────────
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

    let analyticsRows = [];
    try {
      const analyticsApi = google.youtubeAnalytics({ version: 'v2', auth: client });
      const analyticsResp = await analyticsApi.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,estimatedRevenue',
        dimensions: 'video',
        filters: `video==${videoIds.slice(0, 200).join(',')}`,
        maxResults: 200
      });
      analyticsRows = analyticsResp.data.rows || [];
    } catch (analyticsErr) {
      // Analytics API อาจไม่ได้ enable หรือ scope ไม่พอ — fallback gracefully
      logger.warn('[Analytics] Analytics API unavailable (may need yt-analytics scope)', {
        error: analyticsErr.message
      });
    }

    // Build analytics map by videoId
    const analyticsMap = {};
    for (const row of analyticsRows) {
      const [videoId, views, watchMinutes, revenue] = row;
      analyticsMap[videoId] = {
        analyticsViews: Math.round(views || 0),
        watchMinutes: Math.round(watchMinutes || 0),
        estimatedRevenue: revenue != null ? parseFloat(revenue.toFixed(4)) : null
      };
    }

    // Merge video details with analytics + upload history
    const uploadMap = {};
    for (const u of recentUploads) {
      uploadMap[u.youtube_id] = u;
    }

    const enriched = videoDetails.map(v => {
      const hist = uploadMap[v.id] || {};
      const analytics = analyticsMap[v.id] || {};
      const stats = v.statistics || {};

      const views = parseInt(stats.viewCount || 0);
      const likes = parseInt(stats.likeCount || 0);
      const comments = parseInt(stats.commentCount || 0);

      // Virality feedback score: compare predicted vs actual
      const predictedScore = hist.viralityScore || hist.virality?.score || null;
      const actualScore = views > 0 ? Math.min(100, Math.round(Math.log10(views + 1) * 30)) : null;

      return {
        videoId: v.id,
        title: v.snippet?.title || hist.title || '(ไม่มีชื่อ)',
        thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
        youtubeUrl: `https://www.youtube.com/watch?v=${v.id}`,
        publishedAt: v.snippet?.publishedAt || hist.uploaded_at,
        uploadedAt: hist.uploaded_at || null,
        source: hist.source || 'local',
        sourceUrl: hist.source_url || null,
        duration: v.contentDetails?.duration || null,
        // YouTube stats
        views,
        likes,
        comments,
        // Analytics API (if available)
        analyticsViews: analytics.analyticsViews ?? null,
        watchMinutes: analytics.watchMinutes ?? null,
        estimatedRevenue: analytics.estimatedRevenue ?? null,
        // Scoring feedback
        predictedViralityScore: predictedScore,
        actualPerformanceScore: actualScore,
        scoreDelta: predictedScore != null && actualScore != null ? actualScore - predictedScore : null
      };
    });

    // Sort by views desc
    enriched.sort((a, b) => b.views - a.views);

    // Summary totals
    const totalViews = enriched.reduce((s, v) => s + v.views, 0);
    const totalWatchMin = enriched.reduce((s, v) => s + (v.watchMinutes || 0), 0);
    const revenueVideos = enriched.filter(v => v.estimatedRevenue != null);
    const totalRevenue = revenueVideos.length > 0
      ? revenueVideos.reduce((s, v) => s + v.estimatedRevenue, 0)
      : null;

    res.json({
      summary: {
        videos: enriched.length,
        views: totalViews,
        estimatedMinutesWatched: totalWatchMin,
        estimatedRevenue: totalRevenue != null ? parseFloat(totalRevenue.toFixed(4)) : null,
        analyticsAvailable: analyticsRows.length > 0,
        dateRange: { startDate, endDate }
      },
      videos: enriched,
      days
    });
  } catch (err) {
    logger.error('[Analytics] summary error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/video/:videoId
 * ดึง analytics รายละเอียดของวิดีโอเดี่ยว
 */
router.get('/video/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const days = Math.min(parseInt(req.query.days) || 30, 90);

  try {
    const client = youtubeService.getOAuth2Client();
    if (!client || !client.credentials?.access_token) {
      return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
    }

    const youtube = google.youtube({ version: 'v3', auth: client });
    const resp = await youtube.videos.list({
      part: 'snippet,statistics,contentDetails',
      id: videoId
    });

    const video = resp.data.items?.[0];
    if (!video) return res.status(404).json({ error: 'ไม่พบวิดีโอ' });

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

    let dailyRows = [];
    try {
      const analyticsApi = google.youtubeAnalytics({ version: 'v2', auth: client });
      const analyticsResp = await analyticsApi.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,estimatedRevenue',
        dimensions: 'day',
        filters: `video==${videoId}`,
        sort: 'day'
      });
      dailyRows = analyticsResp.data.rows || [];
    } catch (analyticsErr) {
      logger.warn('[Analytics] video analytics unavailable', { error: analyticsErr.message });
    }

    const stats = video.statistics || {};
    res.json({
      videoId,
      title: video.snippet?.title,
      thumbnail: video.snippet?.thumbnails?.medium?.url,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: video.snippet?.publishedAt,
      duration: video.contentDetails?.duration,
      views: parseInt(stats.viewCount || 0),
      likes: parseInt(stats.likeCount || 0),
      comments: parseInt(stats.commentCount || 0),
      analyticsAvailable: dailyRows.length > 0,
      dailyData: dailyRows.map(([day, views, watchMin, revenue]) => ({
        day,
        views: Math.round(views || 0),
        watchMinutes: Math.round(watchMin || 0),
        estimatedRevenue: revenue != null ? parseFloat(revenue.toFixed(4)) : null
      })),
      days
    });
  } catch (err) {
    logger.error('[Analytics] video detail error', { error: err.message, videoId });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/upload-history
 * ดึง upload history พร้อม metadata — ใช้โดย frontend uploads page
 */
router.get('/upload-history', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const source = req.query.source || null; // 'tiktok' | 'local' | null

  let all = uploads.load();
  if (!Array.isArray(all)) all = [];

  // Filter by source
  if (source) all = all.filter(u => u.source === source);

  // Sort newest first
  all.sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0));

  const total = all.length;
  const items = all.slice((page - 1) * limit, page * limit);

  res.json({
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
});

module.exports = router;
