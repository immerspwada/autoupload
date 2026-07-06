// Health Check Service - System status monitoring
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { settings, uploads, stats } = require('../utils/store');
const youtubeService = require('./youtube');
const uploadQueue = require('./queue');

class HealthService {
  constructor() {
    this.fileHashes = new Map(); // filename -> hash for duplicate detection
    this._loadHashes();
  }

  // ==================== SYSTEM HEALTH ====================
  async getHealth() {
    const config = settings.load();
    const folder = config.folder;

    const checks = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      uptimeFormatted: this._formatUptime(process.uptime()),
      memory: this._getMemoryInfo(),
      disk: folder ? await this._getDiskInfo(folder) : null,
      youtube: this._getYouTubeStatus(),
      queue: this._getQueueHealth(),
      folder: this._getFolderHealth(folder),
      overall: 'healthy' // will be downgraded
    };

    // Determine overall health
    if (!checks.youtube.connected) checks.overall = 'warning';
    if (checks.queue.failed > 0) checks.overall = 'warning';
    if (checks.disk && checks.disk.percentUsed > 90) checks.overall = 'critical';
    if (checks.folder && !checks.folder.accessible) checks.overall = 'error';

    return checks;
  }

  _getMemoryInfo() {
    const used = process.memoryUsage();
    return {
      rss: this._formatBytes(used.rss),
      heapUsed: this._formatBytes(used.heapUsed),
      heapTotal: this._formatBytes(used.heapTotal),
      systemFree: this._formatBytes(os.freemem()),
      systemTotal: this._formatBytes(os.totalmem())
    };
  }

  async _getDiskInfo(folder) {
    try {
      const stats = fs.statfsSync(folder);
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;
      return {
        total: this._formatBytes(total),
        free: this._formatBytes(free),
        used: this._formatBytes(used),
        percentUsed: Math.round((used / total) * 100)
      };
    } catch (e) {
      return null;
    }
  }

  _getYouTubeStatus() {
    const auth = youtubeService.isAuthenticated();
    return {
      connected: auth.authenticated,
      hasCredentials: auth.hasCredentials
    };
  }

  _getQueueHealth() {
    const status = uploadQueue.getStatus();
    return {
      pending: status.pending,
      processing: status.processing,
      done: status.done,
      failed: status.failed,
      paused: status.paused,
      healthy: status.failed === 0
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
          return ['.mp4','.avi','.mov','.mkv','.wmv','.flv','.webm','.m4v'].includes(ext);
        }).length;
      } catch (e) { /* */ }
    }
    return { configured: true, accessible: exists, videoCount: fileCount };
  }

  // ==================== DUPLICATE DETECTION ====================
  async getFileHash(filepath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filepath, { end: 1024 * 1024 }); // First 1MB only for speed
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async isDuplicate(filepath) {
    try {
      const hash = await this.getFileHash(filepath);
      const filename = path.basename(filepath);

      // Check hash map
      if (this.fileHashes.has(hash)) {
        const existing = this.fileHashes.get(hash);
        if (existing !== filename) {
          return { duplicate: true, originalFile: existing, hash };
        }
      }

      // Check upload history
      const allUploads = uploads.load();
      const byHash = allUploads.find(u => u.hash === hash);
      if (byHash) {
        return { duplicate: true, originalFile: byHash.filename, youtubeUrl: byHash.youtube_url, hash };
      }

      return { duplicate: false, hash };
    } catch (e) {
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
      } catch (e) { /* */ }
    }
  }

  _saveHashes() {
    const hashFile = path.join(__dirname, '../../data/hashes.json');
    const data = Object.fromEntries(this.fileHashes);
    fs.writeFileSync(hashFile, JSON.stringify(data, null, 2));
  }

  // ==================== AUTO CLEANUP ====================
  cleanupQueue() {
    const status = uploadQueue.getStatus();
    const completed = status.items.filter(i => ['done', 'failed', 'cancelled'].includes(i.status));
    if (completed.length > 50) {
      // Keep only last 50 completed items
      uploadQueue.queue = uploadQueue.queue.filter(item => {
        if (['done', 'failed', 'cancelled'].includes(item.status)) {
          return uploadQueue.queue.indexOf(item) >= uploadQueue.queue.length - 50;
        }
        return true;
      });
      logger.info('Queue cleanup performed', { removed: completed.length - 50 });
    }
    return { cleaned: Math.max(0, completed.length - 50) };
  }

  cleanupTempFiles() {
    const uploadDir = path.join(__dirname, '../../uploads');
    const tiktokDir = path.join(__dirname, '../../downloads/tiktok');
    let cleaned = 0;

    [uploadDir, tiktokDir].forEach(dir => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      const now = Date.now();
      files.forEach(file => {
        const filepath = path.join(dir, file);
        try {
          const stat = fs.statSync(filepath);
          // Delete files older than 24 hours
          if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
            fs.unlinkSync(filepath);
            cleaned++;
          }
        } catch (e) { /* */ }
      });
    });

    if (cleaned > 0) logger.info('Temp files cleaned', { count: cleaned });
    return { cleaned };
  }

  // ==================== UTILITIES ====================
  _formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

module.exports = new HealthService();
