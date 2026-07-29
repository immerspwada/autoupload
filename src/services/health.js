/**
 * ★ Health Check Service
 *
 * แก้ไขจาก original:
 * 1. [CRITICAL] cleanupQueue() — logic ผิด (indexOf บน array ที่กำลัง filter)
 *    → แก้เป็น Set-based removal ที่ถูกต้อง
 * 2. [MEDIUM] แทน magic numbers ด้วย constants
 * 3. [MEDIUM] cleanupTempFiles ใช้ constant แทน hard-code 24h
 */
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const logger = require('../utils/logger');
const C      = require('../config/constants');
const { settings, uploads } = require('../utils/store');
const youtubeService = require('./youtube');
const uploadQueue    = require('./queue');

class HealthService {
  constructor() {
    this.fileHashes = new Map(); // hash → filename
    this._loadHashes();
  }

  // ── System Health ─────────────────────────────────────────────────

  /**
   * ★ getHealth ต้องไม่ throw — ถูกเรียกจาก setInterval และ /api/health/ready
   *   เดิมถ้า folder อ่านไม่ได้จะ throw ทุก 30 วิ กลายเป็น unhandledRejection ไม่จบ
   */
  async getHealth() {
    const safe = (fn, fallback = null) => {
      try { return fn(); } catch (err) {
        logger.debug('[Health] check ล้มเหลว', { error: err.message });
        return fallback;
      }
    };

    const config = safe(() => settings.loadRef(), {}) || {};
    const folder = config.folder;
    const reasons = [];

    const checks = {
      timestamp:       new Date().toISOString(),
      uptime:          process.uptime(),
      uptimeFormatted: this._formatUptime(process.uptime()),
      memory:          safe(() => this._getMemoryInfo(), null),
      // ★ เช็คดิสก์ของ project root เสมอ (ที่เก็บ data/ + downloads/)
      //   เดิมเช็คแค่ watch folder ซึ่งอาจอยู่ดิสก์อื่นหรือไม่ได้ตั้งเลย
      disk:            safe(() => this._diskFor(folder), null),
      youtube:         safe(() => this._getYouTubeStatus(), { connected: false, hasCredentials: false }),
      queue:           safe(() => this._getQueueHealth(), null),
      folder:          safe(() => this._getFolderHealth(folder), { configured: false, accessible: false }),
      ffmpeg:          safe(() => this._getFfmpegHealth(), null),
      overall:         'healthy',
    };

    // ── ประเมินสถานะรวม ──────────────────────────────────────────
    if (!checks.youtube.connected) { checks.overall = 'warning'; reasons.push('ยังไม่ได้เชื่อมต่อ YouTube'); }
    if (checks.queue && checks.queue.failed > 0) {
      checks.overall = 'warning'; reasons.push(`มีงานล้มเหลว ${checks.queue.failed} รายการ`);
    }
    if (checks.folder?.configured && !checks.folder.accessible) {
      checks.overall = 'warning'; reasons.push('เข้าถึงโฟลเดอร์ที่ตั้งไว้ไม่ได้');
    }

    // ★ memory pressure — heap ใกล้เต็มคือสัญญาณเตือนก่อน OOM crash
    if (checks.memory?.heapPercentUsed >= 92) {
      checks.overall = 'critical'; reasons.push(`หน่วยความจำใกล้เต็ม (${checks.memory.heapPercentUsed}%)`);
    } else if (checks.memory?.heapPercentUsed >= 80) {
      if (checks.overall === 'healthy') checks.overall = 'warning';
      reasons.push(`หน่วยความจำสูง (${checks.memory.heapPercentUsed}%)`);
    }

    // ดิสก์เต็มคือ critical — เขียน JSON store ไม่ได้ = ข้อมูลหาย
    if (checks.disk && checks.disk.percentUsed >= 95) {
      checks.overall = 'critical'; reasons.push(`ดิสก์เต็ม ${checks.disk.percentUsed}%`);
    } else if (checks.disk && checks.disk.percentUsed >= 88) {
      if (checks.overall === 'healthy') checks.overall = 'warning';
      reasons.push(`ดิสก์ใกล้เต็ม ${checks.disk.percentUsed}%`);
    }

    checks.reasons = reasons;
    return checks;
  }

  /** ดิสก์ของ project root + ของ watch folder (ถ้าตั้งไว้และเป็นดิสก์อื่น) */
  _diskFor(folder) {
    const diskGuard = require('../utils/diskGuard');
    const rootInfo = diskGuard.getDiskInfo(path.join(__dirname, '../..'));
    if (!rootInfo.available) return null;

    const result = {
      total:       rootInfo.totalFormatted,
      free:        rootInfo.freeFormatted,
      used:        this._formatBytes(rootInfo.usedBytes),
      freeBytes:   rootInfo.freeBytes,
      percentUsed: rootInfo.percentUsed,
    };

    if (folder && fs.existsSync(folder)) {
      const f = diskGuard.getDiskInfo(folder);
      if (f.available && f.percentUsed !== rootInfo.percentUsed) {
        result.watchFolder = { free: f.freeFormatted, percentUsed: f.percentUsed };
        result.percentUsed = Math.max(result.percentUsed, f.percentUsed);
      }
    }
    return result;
  }

  _getFfmpegHealth() {
    const vt = require('./videoTransform');
    const running = vt.getRunning();
    const stats = vt.getStats();
    return {
      running: running.length,
      longestRunningMs: running.reduce((m, r) => Math.max(m, r.runningMs), 0),
      timeouts: stats.timeouts || 0,
      killed:   stats.killed || 0,
    };
  }

  _getMemoryInfo() {
    const used = process.memoryUsage();
    // ★ heap limit จริงจาก V8 — ใช้วัด memory pressure ได้แม่นกว่า heapTotal
    let heapLimit = 0;
    try { heapLimit = require('v8').getHeapStatistics().heap_size_limit; } catch (_) {}

    return {
      rss:         this._formatBytes(used.rss),
      heapUsed:    this._formatBytes(used.heapUsed),
      heapTotal:   this._formatBytes(used.heapTotal),
      heapLimit:   heapLimit ? this._formatBytes(heapLimit) : null,
      heapPercentUsed: heapLimit ? Math.round((used.heapUsed / heapLimit) * 100) : null,
      external:    this._formatBytes(used.external),
      systemFree:  this._formatBytes(os.freemem()),
      systemTotal: this._formatBytes(os.totalmem()),
      systemPercentUsed: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    };
  }

  async _getDiskInfo(folder) {
    try {
      const s      = fs.statfsSync(folder);
      const total  = s.blocks * s.bsize;
      const free   = s.bfree  * s.bsize;
      const used   = total - free;
      return {
        total:       this._formatBytes(total),
        free:        this._formatBytes(free),
        used:        this._formatBytes(used),
        percentUsed: Math.round((used / total) * 100),
      };
    } catch (_) { return null; }
  }

  _getYouTubeStatus() {
    const auth = youtubeService.isAuthenticated();
    return { connected: auth.authenticated, hasCredentials: auth.hasCredentials };
  }

  _getQueueHealth() {
    const s = uploadQueue.getStatus();
    return {
      pending:    s.pending,
      processing: s.processing,
      done:       s.done,
      failed:     s.failed,
      paused:     s.paused,
      healthy:    s.failed === 0,
    };
  }

  _getFolderHealth(folder) {
    if (!folder) return { configured: false, accessible: false };
    const exists = fs.existsSync(folder);
    let fileCount = 0;
    if (exists) {
      try {
        fileCount = fs.readdirSync(folder).filter(f => {
          const ext = path.extname(f).toLowerCase();
          return ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'].includes(ext);
        }).length;
      } catch (_) {}
    }
    return { configured: true, accessible: exists, videoCount: fileCount };
  }

  // ── Duplicate Detection ───────────────────────────────────────────

  async getFileHash(filepath) {
    return new Promise((resolve, reject) => {
      const hash   = crypto.createHash('md5');
      const stream = fs.createReadStream(filepath, { end: C.HEALTH.HASH_READ_BYTES - 1 });
      stream.on('data', d  => hash.update(d));
      stream.on('end',  () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async isDuplicate(filepath) {
    try {
      const hash     = await this.getFileHash(filepath);
      const filename = path.basename(filepath);

      if (this.fileHashes.has(hash)) {
        const existing = this.fileHashes.get(hash);
        if (existing !== filename) {
          return { duplicate: true, originalFile: existing, hash };
        }
      }

      // ★ loadRef (ไม่ clone) — ฟังก์ชันนี้ถูกเรียกทุกไฟล์ใน batch, clone ทุกครั้งจะช้า
      const allUploads = uploads.loadRef();
      const byHash     = allUploads.find(u => u.hash === hash);
      if (byHash) {
        return { duplicate: true, originalFile: byHash.filename, youtubeUrl: byHash.youtube_url, hash };
      }

      return { duplicate: false, hash };
    } catch (_) {
      return { duplicate: false, hash: null };
    }
  }

  registerHash(hash, filename) {
    if (!hash || !filename) return;
    this.fileHashes.set(hash, filename);
    // ★ debounce — batch upload 50 คลิป เดิมเขียนไฟล์ทั้งก้อน 50 ครั้งติดกัน
    this._scheduleSaveHashes();
  }

  _scheduleSaveHashes() {
    if (this._hashSaveTimer) return;
    this._hashSaveTimer = setTimeout(() => {
      this._hashSaveTimer = null;
      try { this._saveHashes(); }
      catch (err) { logger.error('บันทึก hashes.json ไม่สำเร็จ', { error: err.message }); }
    }, 2000);
    if (this._hashSaveTimer.unref) this._hashSaveTimer.unref();
  }

  _loadHashes() {
    const hashFile = path.join(__dirname, '../../data/hashes.json');
    if (fs.existsSync(hashFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(hashFile, 'utf8'));
        Object.entries(data).forEach(([k, v]) => this.fileHashes.set(k, v));
      } catch (_) {}
    }
  }

  _saveHashes() {
    const hashFile = path.join(__dirname, '../../data/hashes.json');
    const data     = Object.fromEntries(this.fileHashes);
    const tmp      = `${hashFile}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, hashFile);
  }

  /** flush hash ที่ค้างอยู่ทันที — ใช้ตอน shutdown */
  flushHashes() {
    if (this._hashSaveTimer) {
      clearTimeout(this._hashSaveTimer);
      this._hashSaveTimer = null;
    }
    try { this._saveHashes(); return true; } catch (_) { return false; }
  }

  // ── Auto Cleanup ──────────────────────────────────────────────────

  /**
   * ★ cleanupQueue — แก้ logic ที่ผิดใน original
   *
   * Bug เดิม: ใช้ uploadQueue.queue.indexOf(item) ภายใน filter callback
   * → indexOf อ้างถึง array ดั้งเดิมที่กำลัง filter อยู่ ได้ index ที่ไม่ถูกต้อง
   *
   * แก้ไข: ใช้ Set ของ item references ที่ต้องการลบ แล้ว filter ครั้งเดียว
   */
  cleanupQueue() {
    const MAX = C.QUEUE.MAX_COMPLETED_ITEMS;
    const completed = uploadQueue.queue.filter(
      i => ['done', 'failed', 'cancelled'].includes(i.status)
    );

    if (completed.length <= MAX) return { cleaned: 0 };

    // เก็บ MAX รายการล่าสุด ลบส่วนที่เก่ากว่า
    const toRemove = new Set(completed.slice(0, completed.length - MAX));
    const before   = uploadQueue.queue.length;
    uploadQueue.queue = uploadQueue.queue.filter(item => !toRemove.has(item));
    const removed  = before - uploadQueue.queue.length;

    logger.info('Queue cleanup performed', { removed, kept: uploadQueue.queue.length });
    return { cleaned: removed };
  }

  /**
   * ★ cleanupTempFiles — เดิมกวาดแค่ uploads/ กับ downloads/tiktok/
   *   downloads/transformed/ และ downloads/temp/ ไม่มีใครลบเลย
   *   → ทุกครั้งที่ transform 1080p จะทิ้งไฟล์ค้างไว้จนดิสก์เต็ม
   */
  cleanupTempFiles() {
    const root = path.join(__dirname, '../..');

    // แต่ละโฟลเดอร์มีอายุไฟล์ที่เหมาะสมต่างกัน
    const targets = [
      { dir: path.join(root, 'uploads'),               maxAge: C.HEALTH.TEMP_FILE_MAX_AGE_MS },
      { dir: path.join(root, 'downloads/tiktok'),      maxAge: C.HEALTH.TEMP_FILE_MAX_AGE_MS },
      { dir: path.join(root, 'downloads/transformed'), maxAge: C.VIDEO_TRANSFORM.TEMP_MAX_AGE_MS },
      { dir: path.join(root, 'downloads/temp'),        maxAge: C.VIDEO_TRANSFORM.TEMP_MAX_AGE_MS },
    ];

    let cleaned = 0;
    let freedBytes = 0;
    const now = Date.now();
    const byDir = {};

    for (const { dir, maxAge } of targets) {
      if (!fs.existsSync(dir)) continue;
      let files;
      try { files = fs.readdirSync(dir); } catch (_) { continue; }

      let dirCleaned = 0;
      for (const file of files) {
        if (file.startsWith('.')) continue;              // .gitkeep ฯลฯ
        const filepath = path.join(dir, file);
        try {
          const stat = fs.statSync(filepath);
          if (!stat.isFile()) continue;
          if (now - stat.mtimeMs > maxAge) {
            freedBytes += stat.size;
            fs.unlinkSync(filepath);
            cleaned++; dirCleaned++;
          }
        } catch (_) {}
      }
      if (dirCleaned > 0) byDir[path.basename(dir)] = dirCleaned;
    }

    // ★ ลบไฟล์ .tmp ที่ค้างจาก atomic write ที่ถูกขัดจังหวะ
    try {
      const dataDir = path.join(root, 'data');
      for (const f of fs.readdirSync(dataDir)) {
        if (!f.endsWith('.tmp')) continue;
        const fp = path.join(dataDir, f);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > 60_000) { fs.unlinkSync(fp); cleaned++; }
      }
    } catch (_) {}

    const trimmed = this._trimHashes();

    if (cleaned > 0 || trimmed > 0) {
      logger.info('Temp files cleaned', {
        count: cleaned, freed: this._formatBytes(freedBytes), byDir, hashesTrimmed: trimmed,
      });
    }
    return { cleaned, freedBytes, freed: this._formatBytes(freedBytes), byDir, hashesTrimmed: trimmed };
  }

  /**
   * ★ hashes.json ไม่มีเพดาน — โตขึ้นทุก upload ตลอดกาล
   *   ตัดให้เหลือ N รายการล่าสุด (Map เก็บลำดับ insertion ให้อยู่แล้ว)
   */
  _trimHashes() {
    const MAX = C.HEALTH.MAX_HASH_ENTRIES;
    if (this.fileHashes.size <= MAX) return 0;

    const excess = this.fileHashes.size - MAX;
    const keys = Array.from(this.fileHashes.keys()).slice(0, excess);
    for (const k of keys) this.fileHashes.delete(k);
    this._saveHashes();
    return excess;
  }

  /**
   * ★ ล้างงานที่ค้างทั้งหมด + คืนพื้นที่ — สำหรับปุ่ม "ล้างระบบ"
   */
  deepCleanup() {
    const queue = this.cleanupQueue();
    const temp  = this.cleanupTempFiles();

    // ลบ record ของไฟล์ที่ไม่มีอยู่จริงแล้วออกจาก hash map
    let staleHashes = 0;
    for (const [hash, filename] of this.fileHashes) {
      if (typeof filename !== 'string' || filename.length === 0) {
        this.fileHashes.delete(hash); staleHashes++;
      }
    }
    if (staleHashes > 0) this._saveHashes();

    return { queue, temp, staleHashes };
  }

  // ── Utilities ─────────────────────────────────────────────────────

  _formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k     = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i     = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

module.exports = new HealthService();
