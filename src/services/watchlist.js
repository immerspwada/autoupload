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
const { EventEmitter } = require('events');
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
class WatchlistService extends EventEmitter {
  constructor() {
    super();
    // Live run state — SSE clients + frontend poll this
    this.runState = {
      running:        false,
      startedAt:      null,
      phase:          'idle',
      currentKeyword: null,
      keywordIndex:   0,
      keywordTotal:   0,
      steps:          [],
      summary:        null,
    };
  }

  // Push a step to live log and emit to SSE listeners
  _step(type, message, extra = {}) {
    const step = { type, message, ts: Date.now(), ...extra };
    this.runState.steps.push(step);
    if (this.runState.steps.length > 100) this.runState.steps.shift();
    this.emit('progress', { ...this.runState, lastStep: step });
  }

  getRunState() {
    return { ...this.runState };
  }

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
    const data    = watchlistStore.load();
    const enabled = (data.keywords || []).filter(k => k.enabled);

    // ── Reset run state ──────────────────────────────────────────
    this.runState = {
      running:        true,
      startedAt:      new Date().toISOString(),
      phase:          'starting',
      currentKeyword: null,
      keywordIndex:   0,
      keywordTotal:   enabled.length,
      steps:          [],
      summary:        null,
    };
    this.emit('progress', this.runState);

    if (enabled.length === 0) {
      this._step('info', 'ไม่มี keyword ที่เปิดใช้งาน — ข้าม');
      this.runState.running = false;
      this.runState.phase   = 'done';
      this.emit('progress', this.runState);
      return { queued: 0, skipped: 0, keywords: [] };
    }

    this._step('start', `เริ่มต้น — ${enabled.length} keywords`);

    const tiktokService  = require('./tiktok');
    const seoService     = require('./seo');
    const { uploads }    = require('../utils/store');
    const { extractTikTokVideoId, isDuplicateTikTok } = getHelpers();

    let totalQueued  = 0;
    let totalSkipped = 0;
    const summary    = [];

    for (let i = 0; i < enabled.length; i++) {
      const kw = enabled[i];
      this.runState.keywordIndex   = i + 1;
      this.runState.currentKeyword = kw.keyword;
      this.runState.phase          = 'searching';
      this._step('search', `🔍 กำลังค้นหา "${kw.keyword}"...`, { keyword: kw.keyword });

      try {
        const videos = await tiktokService.searchVideos(kw.keyword, kw.countPerRun);
        this._step('found', `พบ ${videos.length} คลิปจาก "${kw.keyword}"`, { count: videos.length });

        this.runState.phase = 'filtering';
        let kwQueued  = 0;
        let kwSkipped = 0;

        for (const video of videos) {
          // duplicate check
          const vidId = extractTikTokVideoId(video.videoUrl);
          const dup   = isDuplicateTikTok(video.videoUrl, vidId, uploads.load());
          if (dup.duplicate) {
            kwSkipped++;
            this._step('skip', `ข้าม (อัปแล้ว): ${(video.desc || '').substring(0, 40)}`, { reason: 'duplicate' });
            totalSkipped++;
            continue;
          }

          // virality / score check
          const virality   = seoService.calculateViralityScore(video);
          const validation = seoService.validateForMonetization(video, video.desc || '');
          if (validation.status === 'blocked') {
            kwSkipped++;
            this._step('skip', `ข้าม (บล็อก): ${(video.desc || '').substring(0, 40)}`, { reason: 'blocked' });
            totalSkipped++;
            continue;
          }

          const opportunity = seoService.analyzeOpportunity(
            { ...video, virality, validation }, { alreadyUploaded: false }
          );
          const score = opportunity?.score ?? virality?.score ?? 0;
          if (score < kw.minScore) {
            kwSkipped++;
            this._step('skip', `ข้าม (score ${score} < ${kw.minScore}): ${(video.desc || '').substring(0, 40)}`, { reason: 'low_score', score });
            totalSkipped++;
            continue;
          }

          // Queue
          this.runState.phase = 'uploading';
          this._step('queue', `✓ เพิ่มคิว (score ${score}): ${(video.desc || '').substring(0, 50)}`, { score });
          await uploadCallback({ video: { ...video, virality, validation, opportunity }, keyword: kw.keyword, watchId: kw.id });
          kwQueued++;
          totalQueued++;
        }

        this._updateStats(kw.id, { found: videos.length, queued: kwQueued });
        summary.push({ keyword: kw.keyword, found: videos.length, queued: kwQueued, skipped: kwSkipped });
        this._step('done_kw', `เสร็จ "${kw.keyword}" — คิว ${kwQueued}, ข้าม ${kwSkipped}`, { kwQueued, kwSkipped });
      } catch (err) {
        this._step('error', `ข้อผิดพลาด "${kw.keyword}": ${err.message}`, { error: err.message });
        summary.push({ keyword: kw.keyword, error: err.message, queued: 0 });
      }
    }

    // Finalize
    const d = watchlistStore.load();
    d.lastRunAt          = new Date().toISOString();
    d.totalAutoUploaded  = (d.totalAutoUploaded || 0) + totalQueued;
    watchlistStore.save(d);

    this.runState.running = false;
    this.runState.phase   = 'done';
    this.runState.summary = { totalQueued, totalSkipped, keywords: summary };
    this._step('complete', `✅ รันเสร็จ — เพิ่มคิว ${totalQueued} คลิป, ข้าม ${totalSkipped}`, { totalQueued, totalSkipped });
    this.emit('progress', this.runState);

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
