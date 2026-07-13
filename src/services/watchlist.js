/**
 * Keyword Watchlist Service
 *
 * เก็บ keywords ที่ต้องการให้ Scheduler ค้นหา TikTok แล้วอัปโหลด YouTube
 * อัตโนมัติทุกรอบ โดยไม่ต้องกดค้นหาเอง
 *
 * Flow:
 *   Scheduler.scan() → watchlist.runAll() → tiktokService.search()
 *     → filter virality → filter duplicate → YouTube upload queue
 */
const path = require('path');
const logger = require('../utils/logger');
const { Store } = require('../utils/store');

// ── Persistent store ────────────────────────────────────────────
const watchlistStore = new Store('watchlist.json', {
  keywords: [],          // array of WatchKeyword objects
  lastRunAt: null,       // ISO string
  totalAutoUploaded: 0,  // lifetime counter
});

/**
 * WatchKeyword shape:
 * {
 *   id:           string,      // uuid-lite
 *   keyword:      string,
 *   enabled:      boolean,
 *   countPerRun:  number,      // how many videos to fetch per scheduler run
 *   minScore:     number,      // minimum opportunity score to upload (0–100)
 *   region:       string,      // 'TH' | 'US' | ... (for trending mode)
 *   addedAt:      ISO string,
 *   lastRunAt:    ISO string | null,
 *   totalUploaded: number,
 *   totalFound:   number,
 * }
 */

// ── Helpers ─────────────────────────────────────────────────────
function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Public API ───────────────────────────────────────────────────
class WatchlistService {
  // ── CRUD ───────────────────────────────────────────────────────

  getAll() {
    return watchlistStore.load().keywords || [];
  }

  get(id) {
    return this.getAll().find(k => k.id === id) || null;
  }

  add({ keyword, countPerRun = 8, minScore = 52, enabled = true }) {
    if (!keyword || !keyword.trim()) throw new Error('keyword จำเป็น');
    const data = watchlistStore.load();
    // ป้องกัน keyword ซ้ำ
    if (data.keywords.find(k => k.keyword.toLowerCase() === keyword.trim().toLowerCase())) {
      throw new Error(`"${keyword}" มีอยู่แล้ว`);
    }
    const entry = {
      id:           makeId(),
      keyword:      keyword.trim(),
      enabled:      !!enabled,
      countPerRun:  Math.max(1, Math.min(20, parseInt(countPerRun) || 8)),
      minScore:     Math.max(0, Math.min(100, parseInt(minScore) || 52)),
      addedAt:      new Date().toISOString(),
      lastRunAt:    null,
      totalUploaded: 0,
      totalFound:   0,
    };
    data.keywords.push(entry);
    watchlistStore.save(data);
    logger.info('[Watchlist] Added keyword', { keyword: entry.keyword });
    return entry;
  }

  update(id, changes) {
    const data = watchlistStore.load();
    const idx = data.keywords.findIndex(k => k.id === id);
    if (idx === -1) throw new Error('ไม่พบ keyword');
    const allowed = ['keyword', 'enabled', 'countPerRun', 'minScore'];
    allowed.forEach(f => { if (changes[f] !== undefined) data.keywords[idx][f] = changes[f]; });
    watchlistStore.save(data);
    return data.keywords[idx];
  }

  remove(id) {
    const data = watchlistStore.load();
    data.keywords = data.keywords.filter(k => k.id !== id);
    watchlistStore.save(data);
    logger.info('[Watchlist] Removed keyword', { id });
  }

  // ── Auto-run (called by Scheduler) ────────────────────────────

  /**
   * Run all enabled keywords:
   *   1. Search TikTok for each keyword
   *   2. Filter by minScore + duplicate check
   *   3. Push qualifying videos into upload queue
   *
   * Returns summary { queued, skipped, keywords }
   */
  async runAll(uploadCallback) {
    const data = watchlistStore.load();
    const enabled = (data.keywords || []).filter(k => k.enabled);

    if (enabled.length === 0) {
      logger.debug('[Watchlist] No enabled keywords — skipping');
      return { queued: 0, skipped: 0, keywords: [] };
    }

    logger.info('[Watchlist] Starting auto-run', { keywords: enabled.map(k => k.keyword) });

    const tiktokService  = require('./tiktok');
    const seoService     = require('./seo');
    const { uploads }    = require('../utils/store');
    const { extractTikTokVideoId, isDuplicateTikTok } = getHelpers();

    let totalQueued  = 0;
    let totalSkipped = 0;
    const summary    = [];

    for (const kw of enabled) {
      try {
        const videos = await tiktokService.searchVideos(kw.keyword, kw.countPerRun);
        let kwQueued = 0;

        for (const video of videos) {
          // 1. Duplicate check
          const vidId = extractTikTokVideoId(video.videoUrl);
          const dup   = isDuplicateTikTok(video.videoUrl, vidId, uploads.load());
          if (dup.duplicate) { totalSkipped++; continue; }

          // 2. Virality / opportunity score check
          const virality   = seoService.calculateViralityScore(video);
          const validation = seoService.validateForMonetization(video, video.desc || '');
          if (validation.status === 'blocked') { totalSkipped++; continue; }

          const opportunity = seoService.analyzeOpportunity(
            { ...video, virality, validation },
            { alreadyUploaded: false }
          );
          const score = opportunity?.score ?? virality?.score ?? 0;
          if (score < kw.minScore) { totalSkipped++; continue; }

          // 3. Queue for upload
          await uploadCallback({
            video:    { ...video, virality, validation, opportunity },
            keyword:  kw.keyword,
            watchId:  kw.id,
          });
          kwQueued++;
          totalQueued++;
        }

        // Update keyword stats
        this._updateStats(kw.id, { found: videos.length, queued: kwQueued });
        summary.push({ keyword: kw.keyword, found: videos.length, queued: kwQueued });
        logger.info('[Watchlist] Keyword done', { keyword: kw.keyword, found: videos.length, queued: kwQueued });
      } catch (err) {
        logger.error('[Watchlist] Keyword error', { keyword: kw.keyword, error: err.message });
        summary.push({ keyword: kw.keyword, error: err.message, queued: 0 });
      }
    }

    // Update global stats
    const d = watchlistStore.load();
    d.lastRunAt = new Date().toISOString();
    d.totalAutoUploaded = (d.totalAutoUploaded || 0) + totalQueued;
    watchlistStore.save(d);

    logger.info('[Watchlist] Auto-run complete', { totalQueued, totalSkipped });
    return { queued: totalQueued, skipped: totalSkipped, keywords: summary };
  }

  _updateStats(id, { found, queued }) {
    const data = watchlistStore.load();
    const kw   = data.keywords.find(k => k.id === id);
    if (!kw) return;
    kw.lastRunAt     = new Date().toISOString();
    kw.totalFound    = (kw.totalFound    || 0) + found;
    kw.totalUploaded = (kw.totalUploaded || 0) + queued;
    watchlistStore.save(data);
  }

  getStats() {
    const data = watchlistStore.load();
    return {
      total:            (data.keywords || []).length,
      enabled:          (data.keywords || []).filter(k => k.enabled).length,
      lastRunAt:        data.lastRunAt,
      totalAutoUploaded: data.totalAutoUploaded || 0,
    };
  }
}

// ── Lazy-load helpers to avoid circular require ─────────────────
function getHelpers() {
  // extractTikTokVideoId + isDuplicateTikTok duplicated here to avoid
  // importing the entire tiktok route (which has side effects)
  function extractTikTokVideoId(url) {
    if (!url) return null;
    const m = url.match(/\/(video|photo)\/(\d+)/);
    if (m) return m[2];
    const s = url.match(/\/([A-Za-z0-9]+)\/?$/);
    return s ? s[1] : null;
  }

  function isDuplicateTikTok(videoUrl, videoId, allUploads) {
    for (const r of allUploads) {
      if (r.source_url && r.source_url === videoUrl) return { duplicate: true, record: r };
      if (r.source_url && videoId) {
        const eid = extractTikTokVideoId(r.source_url);
        if (eid && eid === videoId) return { duplicate: true, record: r };
      }
      if (r.tiktok_video_id && r.tiktok_video_id === videoId) return { duplicate: true, record: r };
    }
    return { duplicate: false };
  }

  return { extractTikTokVideoId, isDuplicateTikTok };
}

module.exports = new WatchlistService();
