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

  async getHealth() {
    const config = settings.load();
    const folder = config.folder;

    const checks = {
      timestamp:       new Date().toISOString(),
      uptime:          process.uptime(),
      uptimeFormatted: this._formatUptime(process.uptime()),
      memory:          this._getMemoryInfo(),
      disk:            folder ? await this._getDiskInfo(folder) : null,
      youtube:         this._getYouTubeStatus(),
      queue:           this._getQueueHealth(),
      folder:          this._getFolderHealth(folder),
      overall:         'healthy',
    };

    if (!checks.youtube.connected)                              checks.overall = 'warning';
    if (checks.queue.failed > 0)                               checks.overall = 'warning';
    if (checks.disk && checks.disk.percentUsed > 90)           checks.overall = 'critical';
    if (checks.folder && checks.folder.configured && !checks.folder.accessible) checks.overall = 'warning';

    return checks;
  }

  _getMemoryInfo() {
    const used = process.memoryUsage();
    return {
      rss:         this._formatBytes(used.rss),
      heapUsed:    this._formatBytes(used.heapUsed),
      heapTotal:   this._formatBytes(used.heapTotal),
      systemFree:  this._formatBytes(os.freemem()),
      systemTotal: this._formatBytes(os.totalmem()),
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

      const allUploads = uploads.load();
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
    this.fileHashes.set(hash, filename);
    this._saveHashes();
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
    const tmp      = hashFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, hashFile);
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

  cleanupTempFiles() {
    const uploadDir = path.join(__dirname, '../../uploads');
    const tiktokDir = path.join(__dirname, '../../downloads/tiktok');
    let cleaned = 0;

    for (const dir of [uploadDir, tiktokDir]) {
      if (!fs.existsSync(dir)) continue;
      const now = Date.now();
      let files;
      try { files = fs.readdirSync(dir); } catch (_) { continue; }
      for (const file of files) {
        const filepath = path.join(dir, file);
        try {
          const stat = fs.statSync(filepath);
          if (now - stat.mtimeMs > C.HEALTH.TEMP_FILE_MAX_AGE_MS) {
            fs.unlinkSync(filepath);
            cleaned++;
          }
        } catch (_) {}
      }
    }

    if (cleaned > 0) logger.info('Temp files cleaned', { count: cleaned });
    return { cleaned };
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
