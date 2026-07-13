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
    this._quotaWaitTimer = null;   // timer รอ quota reset
    this._quotaPaused = false;     // สถานะหยุดชั่วคราวเพราะ quota หมด
  }

  /**
   * คำนวณ milliseconds จนถึงเที่ยงคืน PST (UTC-8) รอบถัดไป
   * YouTube quota reset ตอนนี้ทุกวัน
   */
  _msUntilQuotaReset() {
    const now = new Date();
    // PST = UTC-8
    const PST_OFFSET_MS = -8 * 60 * 60 * 1000;
    const localOffsetMs = now.getTimezoneOffset() * 60 * 1000;

    // เวลาปัจจุบันใน PST
    const pstNow = new Date(now.getTime() + localOffsetMs + PST_OFFSET_MS);

    // เที่ยงคืน PST วันถัดไป
    const nextMidnightPST = new Date(pstNow);
    nextMidnightPST.setHours(24, 2, 0, 0); // +2 นาที buffer หลัง reset

    // แปลงกลับเป็น local time และหา diff
    const nextResetLocal = new Date(nextMidnightPST.getTime() - localOffsetMs - PST_OFFSET_MS);
    return Math.max(0, nextResetLocal.getTime() - now.getTime());
  }

  /**
   * หยุดรอ quota reset แล้วเริ่ม scan อัตโนมัติหลัง reset
   */
  _waitForQuotaReset() {
    if (this._quotaWaitTimer) return; // กำลังรอแล้ว

    const msLeft = this._msUntilQuotaReset();
    const resetAt = new Date(Date.now() + msLeft);
    this._quotaPaused = true;

    logger.info('⏸️  Quota หมดวันนี้ — หยุดรอจนถึง quota reset', {
      resetAt: resetAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      waitHours: (msLeft / 3600000).toFixed(1)
    });

    this._quotaWaitTimer = setTimeout(() => {
      this._quotaWaitTimer = null;
      this._quotaPaused = false;
      logger.info('✅ Quota reset แล้ว — เริ่ม scan อัตโนมัติ');
      this.scan();
    }, msLeft);
  }

  /**
   * เช็ค quota ก่อน scan — ถ้าหมดให้รอ reset
   * @returns {boolean} true = มี quota เพียงพอ
   */
  _checkQuotaBeforeScan() {
    try {
      const quotaManager = require('./quota');
      const status = quotaManager.getStatus();
      if (status.uploadsRemaining <= 0) {
        this._waitForQuotaReset();
        return false;
      }
      // ถ้าหลุดจาก pause แล้ว quota กลับมาแล้ว clear flag
      if (this._quotaPaused) {
        this._quotaPaused = false;
        if (this._quotaWaitTimer) {
          clearTimeout(this._quotaWaitTimer);
          this._quotaWaitTimer = null;
        }
      }
      return true;
    } catch (err) {
      // ถ้าโหลด quotaManager ไม่ได้ ให้ทำต่อ (ไม่บล็อก)
      return true;
    }
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
    // ยกเลิก quota-wait timer ถ้ากำลังรออยู่
    if (this._quotaWaitTimer) {
      clearTimeout(this._quotaWaitTimer);
      this._quotaWaitTimer = null;
    }
    this._quotaPaused = false;
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
    // ถ้า quota หมด → รอ reset แล้วกลับมาใหม่เอง
    if (!this._checkQuotaBeforeScan()) {
      return { scanned: 0, queued: 0, reason: 'quota_exhausted' };
    }

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

    // ★ Run keyword watchlist after folder scan
    this.runWatchlist().catch(err =>
      logger.error('Watchlist run error', { error: err.message })
    );

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
    const config = schedulerStore.load();
    return {
      ...config,
      quotaPaused: this._quotaPaused,
      quotaResumeAt: this._quotaWaitTimer
        ? new Date(Date.now() + this._msUntilQuotaReset()).toISOString()
        : null
    };
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

  /**
   * Run Keyword Watchlist — ค้นหา TikTok ตาม keywords ที่บันทึกไว้
   * แล้วอัปโหลด YouTube อัตโนมัติ (เรียกโดย scan() และ API)
   */
  async runWatchlist() {
    if (!this._checkQuotaBeforeScan()) {
      logger.info('[Watchlist] Quota หมด — ข้าม watchlist run');
      return { queued: 0, skipped: 0, reason: 'quota_exhausted' };
    }

    const authStatus = youtubeService.isAuthenticated();
    if (!authStatus.authenticated) {
      logger.warn('[Watchlist] ยังไม่ได้ login YouTube — ข้าม watchlist run');
      return { queued: 0, skipped: 0, reason: 'not_authenticated' };
    }

    const watchlistService = require('./watchlist');
    const seoService       = require('./seo');
    const config           = settings.load();

    return watchlistService.runAll(async ({ video, keyword, watchId }) => {
      // Generate SEO metadata
      const metadata = seoService.generateMetadata(video, {
        source:   'tiktok',
        keyword,
        privacy:  config.privacy || 'public',
        schedule: config.autoSchedule,
      });

      // Download + upload via queue
      const tiktokService = require('./tiktok');

      uploadQueue.add(async () => {
        // Download no-watermark
        const downloaded = await tiktokService.downloadNoWatermark(
          video.videoUrl,
          (video.desc || keyword).substring(0, 60)
        );

        // Upload to YouTube
        const result = await youtubeService.uploadVideo({
          filepath:    downloaded.filepath,
          title:       metadata.title,
          description: metadata.description,
          tags:        Array.isArray(metadata.tags) ? metadata.tags.join(',') : metadata.tags,
          privacy:     metadata.privacy || config.privacy || 'public',
          publishAt:   metadata.publishAt,
          categoryId:  metadata.categoryId,
        });

        // Record upload
        const allUploads = uploads.load();
        allUploads.push({
          filename:         downloaded.filename,
          filepath:         downloaded.filepath,
          youtube_id:       result.videoId,
          youtube_url:      result.youtubeUrl,
          uploaded_at:      new Date().toISOString(),
          source:           'tiktok_watchlist',
          source_url:       video.videoUrl,
          tiktok_video_id:  video.id,
          watch_keyword:    keyword,
          deleted:          false,
        });
        uploads.save(allUploads);

        // Cleanup downloaded file
        try {
          if (fs.existsSync(downloaded.filepath)) fs.unlinkSync(downloaded.filepath);
        } catch (_) {}

        this._updateStats(downloaded.filepath, true);
        logger.info('[Watchlist] Upload complete', { keyword, title: metadata.title, youtubeUrl: result.youtubeUrl });
        return result;
      }, { filename: downloaded?.filename || keyword });
    });
  }
}

module.exports = new Scheduler();
