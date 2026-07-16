/**
 * Keyword Watchlist Service — Smart Auto-loop
 *
 * Features:
 * - Smart keyword ordering (successRate — keyword ที่ผ่านมากก่อน)
 * - Session seenIds (ป้องกันซ้ำข้ามรอบ)
 * - Download error backoff (ถ้า DL ล้มเหลวหลายครั้ง → พัก)
 * - Auto trending fallback (ถ้า watchlist ว่าง → ดึง TH trending แทน)
 * - Live SSE progress (step-by-step log)
 */
const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const { Store } = require('../utils/store');

const watchlistStore = new Store('watchlist.json', {
  keywords: [], lastRunAt: null, totalAutoUploaded: 0,
});

function makeId() { return Math.random().toString(36).slice(2, 10); }

// ── Lazy duplicate helpers (avoid circular require from tiktok route) ─
function extractId(url) {
  if (!url) return null;
  const m = url.match(/\/(video|photo)\/(\d+)/);
  if (m) return m[2];
  const s = url.match(/\/([A-Za-z0-9]+)\/?$/);
  return s ? s[1] : null;
}
function isDup(videoUrl, videoId, allUploads) {
  for (const r of allUploads) {
    if (r.source_url && r.source_url === videoUrl) return true;
    if (r.source_url && videoId && extractId(r.source_url) === videoId) return true;
    if (r.tiktok_video_id && r.tiktok_video_id === videoId) return true;
  }
  return false;
}

class WatchlistService extends EventEmitter {
  constructor() {
    super();
    this.runState = {
      running: false, startedAt: null, phase: 'idle',
      currentKeyword: null, keywordIndex: 0, keywordTotal: 0,
      steps: [], summary: null,
    };
    this._seenIds      = {};  // { keyword: Set<id> }
    this._kwRate       = {};  // { keyword: { passed, total } } — smart sort
    this._dlErrors     = 0;
    this._dlErrReset   = 0;
  }

  // ── Live log ────────────────────────────────────────────────────
  _step(type, msg, extra = {}) {
    const step = { type, message: msg, ts: Date.now(), ...extra };
    this.runState.steps.push(step);
    if (this.runState.steps.length > 100) this.runState.steps.shift();
    this.emit('progress', { ...this.runState, lastStep: step });
  }

  getRunState() { return { ...this.runState }; }

  // ── Smart keyword ordering ──────────────────────────────────────
  _sorted(keywords) {
    return [...keywords].sort((a, b) => {
      const ra = this._kwRate[a.keyword], rb = this._kwRate[b.keyword];
      const rA = ra && ra.total >= 3 ? ra.passed / ra.total : 0.5;
      const rB = rb && rb.total >= 3 ? rb.passed / rb.total : 0.5;
      return rB - rA;
    });
  }

  _trackRate(keyword, passed, total) {
    if (!this._kwRate[keyword]) this._kwRate[keyword] = { passed: 0, total: 0 };
    this._kwRate[keyword].passed += passed;
    this._kwRate[keyword].total  += total;
  }

  // ── DL error backoff ───────────────────────────────────────────
  _dlError() {
    if (Date.now() - this._dlErrReset > 10 * 60 * 1000) {
      this._dlErrors = 0; this._dlErrReset = Date.now();
    }
    this._dlErrors++;
  }

  async _dlBackoff() {
    if (this._dlErrors >= 5) {
      const ms = Math.min(this._dlErrors * 30000, 5 * 60 * 1000);
      this._step('warn', `⚠️ DL ล้มเหลว ${this._dlErrors} ครั้ง — รอ ${ms/1000}s`);
      await new Promise(r => setTimeout(r, ms));
      this._dlErrors = 0;
    }
  }

  // ── Auto trending fallback ──────────────────────────────────────
  async _trendingFallback() {
    try {
      const tiktok = require('./tiktok');
      this._step('info', '🌟 Watchlist ว่าง — ดึง Trending TH แทน...');
      const vids = await tiktok.getTrending('TH', 20);
      if (!vids.length) return [];

      const keywords = vids
        .map(v => { const t = (v.desc||'').match(/#[\u0E00-\u0E7Fa-zA-Z0-9]+/g); return t?.[0]?.replace('#',''); })
        .filter(Boolean)
        .filter((k,i,a) => a.indexOf(k) === i)
        .slice(0, 5);

      this._step('info', `Trending keywords: ${keywords.join(', ')}`);
      return keywords.map(kw => ({
        id: `auto_${makeId()}`, keyword: kw, enabled: true,
        countPerRun: 6, minScore: 45, isAuto: true,
        totalUploaded: 0, totalFound: 0,
      }));
    } catch (e) {
      logger.warn('[Watchlist] Trending fallback failed', { error: e.message });
      return [];
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────
  getAll() { return watchlistStore.load().keywords || []; }

  get(id) { return this.getAll().find(k => k.id === id) || null; }

  add({ keyword, countPerRun = 8, minScore = 52, enabled = true }) {
    if (!keyword?.trim()) throw new Error('keyword จำเป็น');
    const data = watchlistStore.load();
    if (data.keywords.find(k => k.keyword.toLowerCase() === keyword.trim().toLowerCase()))
      throw new Error(`"${keyword}" มีอยู่แล้ว`);
    const entry = {
      id: makeId(), keyword: keyword.trim(), enabled: !!enabled,
      countPerRun: Math.max(1, Math.min(20, +countPerRun || 8)),
      minScore:    Math.max(0, Math.min(100, +minScore   || 52)),
      addedAt: new Date().toISOString(), lastRunAt: null,
      totalUploaded: 0, totalFound: 0,
    };
    data.keywords.push(entry);
    watchlistStore.save(data);
    logger.info('[Watchlist] Added', { keyword: entry.keyword });
    return entry;
  }

  update(id, changes) {
    const data = watchlistStore.load();
    const idx  = data.keywords.findIndex(k => k.id === id);
    if (idx === -1) throw new Error('ไม่พบ keyword');
    ['keyword','enabled','countPerRun','minScore'].forEach(f => {
      if (changes[f] !== undefined) data.keywords[idx][f] = changes[f];
    });
    watchlistStore.save(data);
    return data.keywords[idx];
  }

  remove(id) {
    const data = watchlistStore.load();
    data.keywords = data.keywords.filter(k => k.id !== id);
    watchlistStore.save(data);
  }

  getStats() {
    const d = watchlistStore.load();
    return {
      total: (d.keywords||[]).length,
      enabled: (d.keywords||[]).filter(k=>k.enabled).length,
      lastRunAt: d.lastRunAt,
      totalAutoUploaded: d.totalAutoUploaded || 0,
      smartRates: Object.entries(this._kwRate).map(([kw, r]) => ({
        keyword: kw,
        rate: r.total > 0 ? +(r.passed/r.total*100).toFixed(0) : null,
        total: r.total,
      })),
    };
  }

  // ── Main run ────────────────────────────────────────────────────
  async runAll(uploadCallback) {
    // ★ Guard ป้องกัน concurrent run — ถ้ากำลัง run อยู่แล้ว return ทันที
    if (this.runState.running) {
      logger.warn('[Watchlist] runAll called while already running — skipping duplicate run');
      this._step('warn', '⚠️ กำลังรันอยู่แล้ว — ข้าม duplicate run');
      return { queued: 0, skipped: 0, keywords: [], skippedReason: 'already_running' };
    }

    const data = watchlistStore.load();
    let enabled = (data.keywords || []).filter(k => k.enabled);

    // Trending fallback ถ้าไม่มี keyword
    if (enabled.length === 0) {
      enabled = await this._trendingFallback();
      if (enabled.length === 0) {
        this.runState = { ...this.runState, running: false, phase: 'done',
          summary: { totalQueued: 0, totalSkipped: 0, keywords: [] } };
        this._step('info', 'ไม่มี keyword และ trending ก็ดึงไม่ได้ — ข้าม');
        return { queued: 0, skipped: 0, keywords: [] };
      }
    }

    // Smart sort
    enabled = this._sorted(enabled);

    this.runState = {
      running: true, startedAt: new Date().toISOString(), phase: 'starting',
      currentKeyword: null, keywordIndex: 0, keywordTotal: enabled.length,
      steps: [], summary: null,
    };
    this.emit('progress', this.runState);
    this._step('start', `เริ่มต้น — ${enabled.length} keywords (เรียงตาม success rate)`);

    const tiktok  = require('./tiktok');
    const seo     = require('./seo');
    const { uploads, settings } = require('../utils/store');
    const channelStage = settings.load().channelStage || 'early_stage';

    let totalQueued = 0, totalSkipped = 0;
    const summary = [];

    try {
    for (let i = 0; i < enabled.length; i++) {
      const kw = enabled[i];
      this.runState.keywordIndex   = i + 1;
      this.runState.currentKeyword = kw.keyword;
      this.runState.phase          = 'searching';
      this._step('search', `🔍 ค้นหา "${kw.keyword}"...`);

      await this._dlBackoff();

      try {
        const videos = await tiktok.searchVideos(kw.keyword, kw.countPerRun);

        // Session dedup
        if (!this._seenIds[kw.keyword]) this._seenIds[kw.keyword] = new Set();
        const seen = this._seenIds[kw.keyword];
        const fresh = videos.filter(v => {
          const id = v.id || v.videoUrl;
          if (seen.has(id)) return false;
          seen.add(id);
          if (seen.size > 500) seen.delete(seen.values().next().value);
          return true;
        });

        this._step('found', `พบ ${fresh.length} คลิปใหม่ (ข้ามซ้ำ ${videos.length - fresh.length}) จาก "${kw.keyword}"`);

        this.runState.phase = 'filtering';
        let kwQ = 0, kwS = 0, kwP = 0;

        for (const v of fresh) {
          const vid = extractId(v.videoUrl);
          if (isDup(v.videoUrl, vid, uploads.load())) {
            kwS++; totalSkipped++;
            this._step('skip', `ข้าม (ซ้ำ DB): ${(v.desc||'').substring(0,40)}`);
            continue;
          }
          const virality   = seo.calculateViralityScore(v);
          const validation = seo.validateForMonetization(v, v.desc || '');
          if (validation.status === 'blocked') {
            kwS++; totalSkipped++;
            this._step('skip', `ข้าม (บล็อก): ${(v.desc||'').substring(0,40)}`);
            continue;
          }
          const opp   = seo.analyzeOpportunity({ ...v, virality, validation }, { alreadyUploaded: false, channelStage });
          const score = opp?.score ?? virality?.score ?? 0;
          if (score < kw.minScore) {
            kwS++; totalSkipped++;
            this._step('skip', `ข้าม (score ${score}<${kw.minScore}): ${(v.desc||'').substring(0,40)}`);
            continue;
          }

          kwP++;
          this.runState.phase = 'uploading';
          this._step('queue', `✓ คิว (score ${score}): ${(v.desc||'').substring(0,50)}`);
          await uploadCallback({ video: { ...v, virality, validation, opportunity: opp }, keyword: kw.keyword, watchId: kw.id });
          kwQ++; totalQueued++;
        }

        this._trackRate(kw.keyword, kwP, fresh.length);
        if (!kw.isAuto) this._updateStats(kw.id, { found: fresh.length, queued: kwQ });
        summary.push({ keyword: kw.keyword, found: fresh.length, queued: kwQ, skipped: kwS });
        this._step('done_kw', `เสร็จ "${kw.keyword}" — คิว ${kwQ}, ข้าม ${kwS}`);
      } catch (err) {
        this._step('error', `ข้อผิดพลาด "${kw.keyword}": ${err.message}`);
        summary.push({ keyword: kw.keyword, error: err.message, queued: 0 });
      }
    }
    } finally {
      // ★ รับประกัน running flag reset เสมอ — ป้องกัน deadlock กรณี exception หลุด for-loop
      this.runState.running = false;
    }

    if (!enabled.every(k => k.isAuto)) {
      const d = watchlistStore.load();
      d.lastRunAt = new Date().toISOString();
      d.totalAutoUploaded = (d.totalAutoUploaded || 0) + totalQueued;
      watchlistStore.save(d);
    }

    this.runState.running = false;
    this.runState.phase   = 'done';
    this.runState.summary = { totalQueued, totalSkipped, keywords: summary };
    this._step('complete', `✅ เสร็จ — คิว ${totalQueued}, ข้าม ${totalSkipped}`);
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

  // เรียกจาก scheduler เมื่อ download ล้มเหลว
  notifyDlError() { this._dlError(); }
}

module.exports = new WatchlistService();
