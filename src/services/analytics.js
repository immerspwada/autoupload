// ═══════════════════════════════════════════════════════════════════
// YouTube Analytics Service — Historical Performance + Feedback Loop
//
// หน้าที่:
//   1. เก็บ YouTube Analytics จริง (views, watch time, revenue)
//   2. สร้าง feedback loop → ปรับ virality/opportunity scoring weights
//   3. Track performance by category, intent, publish time
//   4. Provide historical insights สำหรับตัดสินใจเลือกคลิป
// ═══════════════════════════════════════════════════════════════════

const { google } = require('googleapis');
const logger = require('../utils/logger');
const { uploads } = require('../utils/store');
const youtubeService = require('./youtube');

// Path to store analytics cache
const ANALYTICS_CACHE_PATH = require('path').join(__dirname, '../../data/analytics_cache.json');

class AnalyticsService {
  constructor() {
    this.cache = this._loadCache();
  }

  /**
   * Fetch video performance from YouTube Analytics API
   * Returns { views, watchTimeMinutes, estimatedMinutesWatched, averageViewDuration, revenue }
   */
  async fetchVideoPerformance(videoId, accountId = null) {
    const client = youtubeService.getOAuth2Client(accountId);
    if (!client || !client.credentials) {
      return null;
    }

    try {
      const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: client });
      
      // Get last 30 days of data
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const response = await youtubeAnalytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,estimatedRevenue',
        filters: `video==${videoId}`,
        dimensions: 'day'
      });

      // ★ Defensive check — handle missing data gracefully
      const rows = response?.data?.rows;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return null;
      }

      // Aggregate data
      const totals = rows.reduce((acc, row) => {
        if (!Array.isArray(row)) return acc;
        acc.views += row[1] || 0;
        acc.watchTimeMinutes += row[2] || 0;
        acc.revenue += row[4] || 0;
        return acc;
      }, { views: 0, watchTimeMinutes: 0, revenue: 0 });

      const avgViewDuration = totals.views > 0 
        ? totals.watchTimeMinutes / totals.views 
        : 0;

      return {
        videoId,
        ...totals,
        averageViewDuration: +avgViewDuration.toFixed(2),
        period: { start: startDate, end: endDate },
        fetchedAt: new Date().toISOString()
      };
    } catch (err) {
      // ★ Handle Analytics API not enabled gracefully
      const errorMsg = err?.message || '';
      const isNotEnabled = errorMsg.includes('has not been used') || errorMsg.includes('is disabled');
      const isQuotaError = err?.response?.status === 403 || errorMsg.toLowerCase().includes('quota');
      
      if (isNotEnabled) {
        // Log once per session to avoid spam
        if (!this._warnedAnalyticsDisabled) {
          logger.info('YouTube Analytics API not enabled — revenue insights disabled. Enable at: https://console.developers.google.com/apis/api/youtubeanalytics.googleapis.com');
          this._warnedAnalyticsDisabled = true;
        }
        return null;
      }
      
      if (isQuotaError) {
        logger.debug('Analytics quota exceeded', { videoId });
      } else {
        logger.warn('Failed to fetch video analytics', { videoId, error: errorMsg.substring(0, 100) });
      }
      return null;
    }
  }

  /**
   * Update upload history with actual performance data
   * Call this periodically (e.g., daily) to build feedback loop
   */
  async updateUploadPerformance(accountId = null) {
    const allUploads = uploads.load();
    const tiktokUploads = allUploads.filter(u => u.source === 'tiktok' && u.youtube_id && !u.performanceFetchedAt);
    
    if (tiktokUploads.length === 0) {
      logger.info('No TikTok uploads to update performance for');
      return { updated: 0 };
    }

    let updated = 0;
    for (const record of tiktokUploads.slice(0, 20)) { // Limit to 20 per run
      const perf = await this.fetchVideoPerformance(record.youtube_id, accountId);
      if (perf) {
        record.performance = perf;
        record.performanceFetchedAt = new Date().toISOString();
        updated++;
      }
      // Rate limit: wait 1 second between API calls
      await new Promise(r => setTimeout(r, 1000));
    }

    uploads.save(allUploads);
    logger.info('Updated upload performance', { updated, total: tiktokUploads.length });
    
    return { updated, total: tiktokUploads.length };
  }

  /**
   * Calculate performance insights from historical data
   * Used to adjust scoring weights
   */
  calculatePerformanceInsights() {
    const allUploads = uploads.load();
    const withPerf = allUploads.filter(u => u.performance && u.source === 'tiktok');
    
    if (withPerf.length < 5) {
      return { 
        insights: null, 
        reason: `ยังมีข้อมูลไม่พอ (ต้อง ≥5 videos ที่มี performance data) — ปัจจุบันมี ${withPerf.length} videos`,
        hint: 'เปิด YouTube Analytics API และอัปโหลดเพิ่มเพื่อเก็บข้อมูล'
      };
    }

    // Group by category
    const byCategory = {};
    const byIntent = {};
    const byPublishHour = {};
    const byViralityTier = {};

    for (const record of withPerf) {
      const perf = record.performance || {};
      const views = perf.views || 0;
      const watchTime = perf.watchTimeMinutes || 0;
      const revenue = perf.revenue || 0;
      
      // Category breakdown
      const cat = record.categoryId || 22;
      if (!byCategory[cat]) byCategory[cat] = { views: 0, watchTime: 0, revenue: 0, count: 0 };
      byCategory[cat].views += views;
      byCategory[cat].watchTime += watchTime;
      byCategory[cat].revenue += revenue;
      byCategory[cat].count++;
      
      // Virality tier breakdown
      const viralityScore = record.viralityScore || 0;
      let tier = 'low';
      if (viralityScore >= 75) tier = 'viral';
      else if (viralityScore >= 55) tier = 'hot';
      else if (viralityScore >= 35) tier = 'decent';
      
      if (!byViralityTier[tier]) byViralityTier[tier] = { views: 0, watchTime: 0, revenue: 0, count: 0 };
      byViralityTier[tier].views += views;
      byViralityTier[tier].watchTime += watchTime;
      byViralityTier[tier].revenue += revenue;
      byViralityTier[tier].count++;
    }

    // Calculate averages (with safe divide)
    const categoryInsights = Object.entries(byCategory).map(([cat, data]) => ({
      categoryId: parseInt(cat),
      avgViews: data.count > 0 ? Math.round(data.views / data.count) : 0,
      avgWatchTime: data.count > 0 ? Math.round(data.watchTime / data.count) : 0,
      avgRevenue: data.count > 0 ? +(data.revenue / data.count).toFixed(2) : 0,
      count: data.count
    })).sort((a, b) => b.avgRevenue - a.avgRevenue);

    const viralityInsights = Object.entries(byViralityTier).map(([tier, data]) => ({
      tier,
      avgViews: data.count > 0 ? Math.round(data.views / data.count) : 0,
      avgWatchTime: data.count > 0 ? Math.round(data.watchTime / data.count) : 0,
      avgRevenue: data.count > 0 ? +(data.revenue / data.count).toFixed(2) : 0,
      count: data.count
    })).sort((a, b) => b.avgRevenue - a.avgRevenue);

    // Calculate correlation: virality score vs actual performance
    let correlationSum = 0;
    let correlationCount = 0;
    for (const record of withPerf) {
      if (record.viralityScore && record.performance?.views) {
        correlationSum += record.viralityScore * record.performance.views;
        correlationCount++;
      }
    }

    // Calculate totals
    const totalViews = withPerf.reduce((sum, u) => sum + (u.performance?.views || 0), 0);
    const totalRevenue = withPerf.reduce((sum, u) => sum + (u.performance?.revenue || 0), 0);

    const insights = {
      totalVideos: withPerf.length,
      totalViews,
      totalWatchTime: withPerf.reduce((sum, u) => sum + (u.performance?.watchTimeMinutes || 0), 0),
      totalRevenue: +totalRevenue.toFixed(2),
      byCategory: categoryInsights,
      byViralityTier: viralityInsights,
      bestPerformingCategory: categoryInsights[0]?.categoryId || 22,
      bestPerformingViralityTier: viralityInsights[0]?.tier || 'decent',
      averageRpm: 0 // Will be calculated
    };

    // Calculate average RPM (safe divide)
    insights.averageRpm = totalViews > 0 ? +(totalRevenue / (totalViews / 1000)).toFixed(2) : 0;

    // Cache insights
    this.cache.insights = insights;
    this.cache.lastUpdated = new Date().toISOString();
    this._saveCache();

    return { insights, reason: null };
  }

  /**
   * Get insights for UI display
   */
  getInsights() {
    if (this.cache.insights && this.cache.lastUpdated) {
      const lastUpdate = new Date(this.cache.lastUpdated);
      const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 24) {
        return { insights: this.cache.insights, cached: true };
      }
    }
    return this.calculatePerformanceInsights();
  }

  /**
   * Get recommended scoring weights based on historical performance
   * This is the feedback loop to optimize virality/opportunity scoring
   */
  getRecommendedWeights() {
    const { insights } = this.getInsights();
    
    if (!insights || insights.totalVideos < 10) {
      // Not enough data — use default weights
      return {
        virality: { likeRate: 40, commentRate: 15, shareRate: 30, recency: 10, views: 5 },
        opportunity: { revenue: 0.36, follower: 0.32, watchTime: 0.32 },
        confidence: 'low',
        reason: 'ข้อมูลยังไม่พอ (ต้อง ≥10 videos) — ใช้ default weights'
      };
    }

    // Analyze which virality tiers perform best
    const tierPerformance = insights.byViralityTier;
    const viralTier = tierPerformance.find(t => t.tier === 'viral');
    const hotTier = tierPerformance.find(t => t.tier === 'hot');
    const decentTier = tierPerformance.find(t => t.tier === 'decent');
    const lowTier = tierPerformance.find(t => t.tier === 'low');

    // Adjust weights based on correlation
    const weights = {
      virality: { likeRate: 40, commentRate: 15, shareRate: 30, recency: 10, views: 5 },
      opportunity: { revenue: 0.36, follower: 0.32, watchTime: 0.32 },
      confidence: insights.totalVideos >= 30 ? 'high' : 'medium',
      reason: `อิงจาก ${insights.totalVideos} videos — RPM เฉลี่ย $${insights.averageRpm}`
    };

    // If viral tier significantly outperforms others, increase share rate weight
    if (viralTier && hotTier && viralTier.avgViews > hotTier.avgViews * 1.5) {
      weights.virality.shareRate = 35;
      weights.virality.likeRate = 35;
      weights.reason += ' — พบว่า share rate สำคัญมาก';
    }

    // If certain categories perform better, note it
    const bestCat = insights.bestPerformingCategory;
    if (bestCat !== 22) {
      weights.recommendedCategories = [bestCat];
      weights.reason += ` — หมวด ${bestCat} ทำได้ดีที่สุด`;
    }

    return weights;
  }

  /**
   * Get performance summary for dashboard
   */
  getDashboardSummary() {
    const { insights } = this.getInsights();
    
    if (!insights || !insights.totalVideos) {
      return {
        totalVideos: 0,
        totalViews: 0,
        totalRevenue: 0,
        totalWatchTime: 0,
        averageRpm: 0,
        bestCategory: null,
        bestViralityTier: null,
        recommendation: 'เริ่มอัปโหลดเพื่อเก็บข้อมูล performance — ระบบจะเรียนรู้และปรับ scoring อัตโนมัติ',
        analyticsEnabled: false,
        analyticsHint: 'เปิด YouTube Analytics API ที่ Google Cloud Console เพื่อเก็บ revenue data จริง'
      };
    }

    return {
      totalVideos: insights.totalVideos,
      totalViews: insights.totalViews,
      totalRevenue: insights.totalRevenue,
      totalWatchTime: insights.totalWatchTime,
      averageRpm: insights.averageRpm,
      bestCategory: insights.bestPerformingCategory,
      bestViralityTier: insights.bestPerformingViralityTier,
      recommendation: insights.totalVideos >= 10
        ? `RPM เฉลี่ย $${insights.averageRpm} — ${insights.byViralityTier[0]?.tier} tier ทำได้ดีที่สุด`
        : 'เก็บข้อมูลเพิ่มอีกนิดเพื่อให้ insights แม่นยำขึ้น',
      analyticsEnabled: true
    };
  }

  // ==================== Private Helpers ====================

  _loadCache() {
    try {
      const fs = require('fs');
      if (fs.existsSync(ANALYTICS_CACHE_PATH)) {
        return JSON.parse(fs.readFileSync(ANALYTICS_CACHE_PATH, 'utf8'));
      }
    } catch (err) {
      logger.warn('Failed to load analytics cache', { error: err.message });
    }
    return {};
  }

  _saveCache() {
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(ANALYTICS_CACHE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(ANALYTICS_CACHE_PATH, JSON.stringify(this.cache, null, 2));
    } catch (err) {
      logger.warn('Failed to save analytics cache', { error: err.message });
    }
  }
}

module.exports = new AnalyticsService();
