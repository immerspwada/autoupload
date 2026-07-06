// Auto-upload Scheduler - watches folder and runs on interval
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { settings, uploads, scheduler: schedulerStore, stats } = require('../utils/store');
const youtubeService = require('./youtube');
const uploadQueue = require('./queue');

const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];

class Scheduler {
  constructor() {
    this.interval = null;
    this.watcher = null;
    this.watchedFolder = null;
  }

  start() {
    const config = schedulerStore.load();
    if (!config.enabled) {
      logger.info('Scheduler is disabled');
      return;
    }

    const intervalMs = (config.intervalMinutes || 30) * 60 * 1000;
    this.stop(); // Clear existing

    this.interval = setInterval(() => this.scan(), intervalMs);
    logger.info('Scheduler started', { intervalMinutes: config.intervalMinutes });

    // Initial scan
    this.scan();
    // Start folder watcher
    this.startWatcher();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.stopWatcher();
    logger.info('Scheduler stopped');
  }

  startWatcher() {
    const config = settings.load();
    const folder = config.folder;
    if (!folder || !fs.existsSync(folder)) return;

    this.stopWatcher();
    this.watchedFolder = folder;

    try {
      this.watcher = fs.watch(folder, (eventType, filename) => {
        if (eventType === 'rename' && filename) {
          const ext = path.extname(filename).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            const filepath = path.join(folder, filename);
            // Delay to let file finish writing
            setTimeout(() => {
              if (fs.existsSync(filepath)) {
                logger.info('New video detected by watcher', { filename });
                this._queueFile(filename, filepath);
              }
            }, 3000);
          }
        }
      });
      logger.info('Folder watcher started', { folder });
    } catch (err) {
      logger.error('Failed to start folder watcher', { error: err.message });
    }
  }

  stopWatcher() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.watchedFolder = null;
    }
  }

  scan() {
    const config = settings.load();
    const folder = config.folder;
    if (!folder || !fs.existsSync(folder)) {
      logger.debug('Scheduler scan skipped - no folder configured');
      return { scanned: 0, queued: 0 };
    }

    const existingUploads = uploads.load();
    const files = fs.readdirSync(folder).filter(f => {
      if (!VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())) return false;
      return !existingUploads.find(u => u.filename === f);
    });

    let queued = 0;
    files.forEach(filename => {
      const filepath = path.join(folder, filename);
      this._queueFile(filename, filepath);
      queued++;
    });

    schedulerStore.save({ ...schedulerStore.load(), lastRun: new Date().toISOString() });
    logger.info('Scheduler scan complete', { scanned: files.length, queued });

    return { scanned: files.length, queued };
  }

  _queueFile(filename, filepath) {
    const config = settings.load();

    // Check if already in queue
    const status = uploadQueue.getStatus();
    if (status.items.find(i => i.filename === filename && ['pending', 'processing'].includes(i.status))) {
      return;
    }

    // Check if already uploaded
    const existingUploads = uploads.load();
    if (existingUploads.find(u => u.filename === filename)) return;

    const authStatus = youtubeService.isAuthenticated();
    if (!authStatus.authenticated) {
      logger.warn('Cannot queue file - not authenticated', { filename });
      return;
    }

    uploadQueue.add(async () => {
      const result = await youtubeService.uploadVideo({
        filepath,
        title: path.basename(filename, path.extname(filename)),
        description: config.defaultDescription || '',
        tags: config.defaultTags || '',
        privacy: config.privacy || 'public'
      });

      // Record upload
      const allUploads = uploads.load();
      const record = {
        filename,
        filepath,
        youtube_id: result.videoId,
        youtube_url: result.youtubeUrl,
        uploaded_at: new Date().toISOString(),
        deleted: false
      };

      allUploads.push(record);

      // Delete if configured
      const shouldDelete = config.deleteAfterUpload === true || config.deleteAfterUpload === 'true';
      if (shouldDelete && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        record.deleted = true;
      }

      uploads.save(allUploads);

      // Update stats
      this._updateStats(filepath, true);

      return result;
    }, { filename });
  }

  _updateStats(filepath, success) {
    const allStats = stats.load();
    const today = new Date().toISOString().split('T')[0];
    const hour = new Date().getHours().toString();

    if (success) {
      allStats.totalUploads = (allStats.totalUploads || 0) + 1;
      try {
        if (fs.existsSync(filepath)) {
          allStats.totalSize = (allStats.totalSize || 0) + fs.statSync(filepath).size;
        }
      } catch (e) { /* file may be deleted */ }
    } else {
      allStats.failedUploads = (allStats.failedUploads || 0) + 1;
    }

    // Daily stats
    if (!allStats.dailyStats) allStats.dailyStats = {};
    if (!allStats.dailyStats[today]) allStats.dailyStats[today] = { uploads: 0, failures: 0 };
    if (success) allStats.dailyStats[today].uploads++;
    else allStats.dailyStats[today].failures++;

    // Hourly distribution
    if (!allStats.uploadsByHour) allStats.uploadsByHour = {};
    allStats.uploadsByHour[hour] = (allStats.uploadsByHour[hour] || 0) + 1;

    stats.save(allStats);
  }

  getConfig() {
    return schedulerStore.load();
  }

  updateConfig(newConfig) {
    const config = schedulerStore.load();
    const updated = { ...config, ...newConfig };
    schedulerStore.save(updated);

    // Restart if enabled changed or interval changed
    if (updated.enabled) {
      this.start();
    } else {
      this.stop();
    }

    return updated;
  }
}

module.exports = new Scheduler();
