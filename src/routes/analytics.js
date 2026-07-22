// ═══════════════════════════════════════════════════════════════════
// Analytics Routes — Historical Performance + Revenue Insights
//
// Endpoints:
//   GET  /api/analytics/summary      — Dashboard summary
//   GET  /api/analytics/insights     — Detailed performance insights
//   GET  /api/analytics/weights      — Recommended scoring weights (feedback loop)
//   POST /api/analytics/refresh      — Force refresh from YouTube API
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analytics');
const youtubeService = require('../services/youtube');
const logger = require('../utils/logger');

/**
 * GET /api/analytics/summary
 * Dashboard summary — compatible with uploads.js frontend expectations
 * Query params: days (default 30)
 */
router.get('/summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const authStatus = youtubeService.isAuthenticated();
    
    // Load upload history
    const { uploads } = require('../utils/store');
    const allUploads = uploads.load();
    
    // Filter by days
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recentUploads = allUploads.filter(u => {
      if (!u.uploaded_at) return false;
      return new Date(u.uploaded_at) >= cutoff;
    });
    
    // Try to fetch YouTube stats for recent videos (uses Data API — 1 unit per video)
    let videos = [];
    let analyticsAvailable = false;
    let totalViews = 0;
    let totalWatchMinutes = 0;
    let totalRevenue = 0;
    
    if (authStatus.authenticated && recentUploads.length > 0) {
      try {
        const client = youtubeService.getOAuth2Client(authStatus.accountId);
        if (client && client.credentials) {
          const { google } = require('googleapis');
          const youtube = google.youtube({ version: 'v3', auth: client });
          
          // Batch fetch video stats (up to 50 at a time)
          const videoIds = recentUploads
            .filter(u => u.youtube_id)
            .map(u => u.youtube_id)
            .slice(0, 50);
          
          if (videoIds.length > 0) {
            const response = await youtube.videos.list({
              part: 'statistics,snippet',
              id: videoIds.join(',')
            });
            
            const videoData = response?.data?.items || [];
            
            for (const item of videoData) {
              const stats = item.statistics || {};
              const views = parseInt(stats.viewCount) || 0;
              const likes = parseInt(stats.likeCount) || 0;
              
              // Find the matching upload record
              const uploadRecord = recentUploads.find(u => u.youtube_id === item.id);
              const predictedScore = uploadRecord?.viralityScore || null;
              
              // Simple "actual performance score" based on views relative to average
              const avgViews = totalViews > 0 && videos.length > 0 ? totalViews / videos.length : views;
              const actualScore = views > 0 ? Math.min(100, Math.round((views / Math.max(avgViews, 1)) * 50)) : 0;
              
              totalViews += views;
              
              videos.push({
                videoId: item.id,
                title: item.snippet?.title || '',
                thumbnail: item.snippet?.thumbnails?.default?.url || null,
                views,
                likes,
                watchMinutes: null, // Requires Analytics API
                estimatedRevenue: null, // Requires Analytics API
                predictedViralityScore: predictedScore,
                actualPerformanceScore: actualScore,
                scoreDelta: predictedScore != null ? actualScore - predictedScore : null
              });
            }
            
            analyticsAvailable = true;
          }
          
          // Try YouTube Analytics API for watch time and revenue
          try {
            const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: client });
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const analyticsResponse = await youtubeAnalytics.reports.query({
              ids: 'channel==MINE',
              startDate,
              endDate,
              metrics: 'estimatedMinutesWatched,estimatedRevenue',
              dimensions: 'video',
              sort: '-estimatedMinutesWatched',
              maxResults: 50
            });
            
            const rows = analyticsResponse?.data?.rows;
            if (rows && Array.isArray(rows)) {
              for (const row of rows) {
                const vId = row[0];
                const watchMin = row[1] || 0;
                const rev = row[2] || 0;
                totalWatchMinutes += watchMin;
                totalRevenue += rev;
                
                const existing = videos.find(v => v.videoId === vId);
                if (existing) {
                  existing.watchMinutes = watchMin;
                  existing.estimatedRevenue = rev;
                }
              }
            }
          } catch (analyticsErr) {
            // Analytics API not enabled — still return Data API results
            const msg = analyticsErr?.message || '';
            if (msg.includes('has not been used') || msg.includes('is disabled')) {
              analyticsAvailable = false; // Flag that Analytics API isn't available
            }
          }
        }
      } catch (apiErr) {
        logger.warn('Failed to fetch YouTube stats for summary', { error: apiErr.message?.substring(0, 80) });
      }
    }
    
    res.json({
      summary: {
        videos: recentUploads.length,
        views: totalViews,
        estimatedMinutesWatched: totalWatchMinutes,
        estimatedRevenue: totalRevenue > 0 ? +totalRevenue.toFixed(2) : null,
        analyticsAvailable,
        days
      },
      videos
    });
  } catch (err) {
    logger.error('Analytics summary error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/insights
 * Detailed performance insights by category, virality tier, etc.
 */
router.get('/insights', (req, res) => {
  try {
    const result = analyticsService.getInsights();
    res.json(result);
  } catch (err) {
    logger.error('Analytics insights error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/weights
 * Get recommended scoring weights based on historical performance
 * This is the feedback loop that improves virality/opportunity scoring
 */
router.get('/weights', (req, res) => {
  try {
    const weights = analyticsService.getRecommendedWeights();
    res.json(weights);
  } catch (err) {
    logger.error('Analytics weights error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/analytics/refresh
 * Force refresh analytics data from YouTube API
 * Rate-limited to prevent quota abuse
 */
router.post('/refresh', async (req, res) => {
  try {
    // Check if authenticated
    const authStatus = youtubeService.isAuthenticated();
    if (!authStatus.authenticated) {
      return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ YouTube' });
    }

    // Check quota (analytics calls use some quota)
    const quotaStatus = youtubeService.getQuotaStatus();
    if (quotaStatus.percentUsed >= 95) {
      return res.status(429).json({ 
        error: 'Quota ใกล้หมด — รอ refresh วันใหม่',
        quotaStatus 
      });
    }

    logger.info('Manual analytics refresh triggered');
    
    // Update performance data
    const updateResult = await analyticsService.updateUploadPerformance(authStatus.accountId);
    
    // Recalculate insights
    const insights = analyticsService.calculatePerformanceInsights();
    
    res.json({
      success: true,
      updated: updateResult.updated,
      total: updateResult.total,
      insights: insights.insights,
      message: updateResult.updated > 0 
        ? `อัปเดต performance แล้ว ${updateResult.updated}/${updateResult.total} videos`
        : 'ไม่มี video ใหม่ให้อัปเดต'
    });
  } catch (err) {
    logger.error('Analytics refresh error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/revenue-estimate
 * Estimate revenue for a potential video
 * Query params: categoryId, estimatedViews
 */
router.get('/revenue-estimate', (req, res) => {
  try {
    const { categoryId, estimatedViews } = req.query;
    const cat = parseInt(categoryId) || 22;
    const views = parseInt(estimatedViews) || 1000;
    
    // Use seoService to estimate
    const seoService = require('../services/seo');
    const estimate = seoService.estimateRevenue({ 
      playCount: views,
      likeCount: Math.round(views * 0.08), // Assume 8% like rate
      commentCount: Math.round(views * 0.005),
      shareCount: Math.round(views * 0.01)
    }, { categoryId: cat });
    
    res.json({
      categoryId: cat,
      estimatedViews: views,
      estimatedRpm: estimate.estimatedRpm,
      estimatedRevenue: +(estimate.estimatedRpm * (views / 1000)).toFixed(2),
      category: estimate.category,
      confidence: estimate.confidence
    });
  } catch (err) {
    logger.error('Revenue estimate error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/upload-history
 * Get upload history for frontend uploads page
 * Returns { items: [...], total } — frontend expects `items` not `videos`
 */
router.get('/upload-history', (req, res) => {
  try {
    const { uploads } = require('../utils/store');
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit) || 50));
    const source = req.query.source || '';
    
    const allUploads = uploads.load();
    
    // Filter by source and sort by date
    const filtered = allUploads
      .filter(u => !source || u.source === source)
      .sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0))
      .slice(0, limit);
    
    res.json({
      total: filtered.length,
      items: filtered
    });
  } catch (err) {
    logger.error('Upload history error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
