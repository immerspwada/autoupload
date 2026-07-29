/**
 * ★ Auto-upload Scheduler
 *
 * แก้ไขจาก original:
 * 1. [CRITICAL] ลบ orchestrator.onUploadCompleted() ออกจาก _queueFile() task
 *    — Queue emit 'completed' → orchestrator._wireQueue() จัดการให้แล้ว
 *    — เดิมทำให้นับ stats 2 ครั้งทุก folder-upload
 * 2. [HIGH] _updateStats() ใน runWatchlist ถูกลบออก → ใช้ EventBus แทน
 * 3. [MEDIUM] แทน magic numbers ด้วย constants
 * 4. [MEDIUM] uploads.save ใน _queueFile ใช้ safeUpdate เพื่อป้องกัน race condition
 * 5. [MEDIUM] cooldownMs ใน _startContinuousLoop อ่านจาก config
 */
const fs   = require('fs');
const path = require('path');
const logger    = require('../utils/logger');
const C         = require('../config/constants');
const { settings, uploads, scheduler: schedulerStore } = require('../utils/store');
const youtubeService = require('./youtube');
const uploadQueue    = require('./queue');

const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];

class Scheduler {
  constructor() {
    this.interval        = null;
    this.watcher         = null;
    this.watchedFolder   = null;
    this._quotaWaitTimer = null;
    this._quotaPaused    = false;
    this._loopRunning    = false;
  }

  // ── Quota reset timer ────────────────────────────────────────────

  /**
   * Milliseconds จนถึงเที่ยงคืน PST รอบถัดไป
   */
  _msUntilQuotaReset() {
    const now           = new Date();
    const PST_OFFSET_MS = C.YOUTUBE.PST_UTC_OFFSET_HOURS * 60 * 60 * 1000;
    const localOffsetMs = now.getTimezoneOffset() * 60 * 1000;
    const pstNow        = new Date(now.getTime() + localOffsetMs + PST_OFFSET_MS);

    const nextMidnightPST = new Date(pstNow);
    // +QUOTA_RESET_BUFFER_MINUTES หลัง reset เพื่อให้ Google flush quota จริง
    nextMidnightPST.setHours(24, C.YOUTUBE.QUOTA_RESET_BUFFER_MINUTES, 0, 0);

    const nextResetLocal = new Date(nextMidnightPST.getTime() - localOffsetMs - PST_OFFSET_MS);
    return Math.max(0, nextResetLocal.getTime() - now.getTime());
  }

  _waitForQuotaReset() {
    if (this._quotaWaitTimer) return;

    const msLeft  = this._msUntilQuotaReset();
    const resetAt = new Date(Date.now() + msLeft);
    this._quotaPaused = true;

    logger.info('⏸️  Quota หมดวันนี้ — หยุดรอจนถึง quota reset', {
      resetAt:   resetAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      waitHours: (msLeft / 3_600_000).toFixed(1),
    });

    this._quotaWaitTimer = setTimeout(() => {
      this._quotaWaitTimer = null;
      this._quotaPaused    = false;
      logger.info('✅ Quota reset แล้ว — เริ่ม scan อัตโนมัติ');
      this.scan();
    }, msLeft);
  }

  _checkQuotaBeforeScan() {
    try {
      const quotaStatus = youtubeService.getQuotaStatus();
      if (quotaStatus.uploadsRemaining <= 0) {
        this._waitForQuotaReset();
        return false;
      }
      // Quota กลับมาแล้ว — ยกเลิก pause state
      if (this._quotaPaused) {
        this._quotaPaused = false;
        if (this._quotaWaitTimer) {
          clearTimeout(this._quotaWaitTimer);
          this._quotaWaitTimer = null;
        }
      }
      return true;
    } catch (_err) {
      // ถ้า quota check ล้มเหลว → อนุญาตไปก่อน (fail-open)
      return true;
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  start() {
    const config = schedulerStore.load();
    if (!config.enabled) {
      logger.info('Scheduler is disabled');
      return;
    }

    const intervalMs = (config.intervalMinutes || C.SCHEDULER.DEFAULT_INTERVAL_MINUTES) * 60_000;
    this.stop();
    // ★ ล้าง flag หลัง stop() — ไม่งั้นลูปที่เพิ่งถูกสั่งหยุดจะหยุดทันทีที่เริ่มใหม่
    this._loopStopRequested = false;

    // ★ scan() ต้องไม่โยน error ออกมาใน timer callback
    this.interval = setInterval(() => {
      try { this.scan(); }
      catch (err) { logger.error('Scheduler scan error', { error: err.message }); }
    }, intervalMs);
    logger.info('Scheduler started', { intervalMinutes: config.intervalMinutes || C.SCHEDULER.DEFAULT_INTERVAL_MINUTES });

    try { this.scan(); }
    catch (err) { logger.error('Scheduler initial scan error', { error: err.message }); }
    this.startWatcher();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this._quotaWaitTimer) {
      clearTimeout(this._quotaWaitTimer);
      this._quotaWaitTimer = null;
    }
    this._quotaPaused = false;
    // ★ สั่งลูปต่อเนื่องให้หยุดด้วย — เดิม stop() ไม่แตะลูป ทำให้ยังวิ่งต่อหลังปิด scheduler
    this.requestLoopStop();
    this.stopWatcher();
    logger.info('Scheduler stopped');
  }

  // ── Folder Watcher ────────────────────────────────────────────────

  startWatcher() {
    const config = settings.load();
    const folder = config.folder;
    if (!folder || !fs.existsSync(folder)) return;

    this.stopWatcher();
    this.watchedFolder = folder;

    try {
      this.watcher = fs.watch(folder, (eventType, filename) => {
        if (eventType !== 'rename' || !filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (!VIDEO_EXTENSIONS.includes(ext)) return;
        const filepath = path.join(folder, filename);
        // Debounce: รอให้ file write เสร็จก่อน queue
        setTimeout(() => {
          if (fs.existsSync(filepath)) {
            logger.info('New video detected by watcher', { filename });
            this._queueFile(filename, filepath);
          }
        }, C.SCHEDULER.WATCHER_DEBOUNCE_MS);
      });
      logger.info('Folder watcher started', { folder });
    } catch (err) {
      logger.error('Failed to start folder watcher', { error: err.message });
    }
  }

  stopWatcher() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher        = null;
      this.watchedFolder  = null;
    }
  }

  // ── Scan ──────────────────────────────────────────────────────────

  scan() {
    if (!this._checkQuotaBeforeScan()) {
      return { scanned: 0, queued: 0, reason: 'quota_exhausted' };
    }

    const config = settings.load();
    const folder = config.folder;
    if (!folder || !fs.existsSync(folder)) {
      logger.debug('Scheduler scan skipped - no folder configured');
      return { scanned: 0, queued: 0 };
    }

    const existingUploads = uploads.loadRef();
    // Build a Set for O(1) duplicate lookup
    const uploadedSet = new Set(existingUploads.map(u => u.filename));

    // ★ readdirSync throw ได้ (EACCES/ENOENT) และ scan() ถูกเรียกจาก setInterval
    //   → uncaught exception ในtimer callback = scheduler ตายเงียบ
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(folder);
    } catch (err) {
      logger.error('อ่านโฟลเดอร์ที่ตั้งไว้ไม่ได้ — ข้ามรอบนี้', { folder, error: err.message });
      return { scanned: 0, queued: 0, error: err.message };
    }

    const files = dirEntries.filter(f => {
      if (!VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())) return false;
      return !uploadedSet.has(f);
    });

    let queued = 0;
    files.forEach(filename => {
      const filepath = path.join(folder, filename);
      this._queueFile(filename, filepath);
      queued++;
    });

    // ★ safeUpdate — เดิม load()+save() ทับค่า enabled/interval ที่ route เพิ่งบันทึก
    schedulerStore.safeUpdate((s) => { s.lastRun = new Date().toISOString(); return s; });
    logger.info('Scheduler scan complete', { scanned: files.length, queued });

    // ★ ENGINE TAKEOVER: watchlist loop ถูกย้ายไป Engine แล้ว (Task 11)
    //   scan() ทำเฉพาะ folder scan + watcher (source='folder') เท่านั้น
    //   ห้ามเรียก runWatchlist() หรือ _startContinuousLoop() ต่อท้ายอีก

    return { scanned: files.length, queued };
  }

  // ── Queue File ────────────────────────────────────────────────────

  /**
   * ★ PATH B — Queue Upload
   *    Queue จะ emit 'completed' event → orchestrator._wireQueue() จัดการ
   *    ห้ามเรียก orchestrator.onUploadCompleted() ที่นี่เด็ดขาด (double-emit = stats 2x)
   */
  _queueFile(filename, filepath) {
    const config = settings.load();

    // Skip if already in queue (pending/processing)
    const status = uploadQueue.getStatus();
    if (status.items.find(i => i.filename === filename && ['pending', 'processing'].includes(i.status))) {
      return;
    }

    // Skip if already uploaded
    const existingUploads = uploads.load();
    if (existingUploads.find(u => u.filename === filename)) return;

    const authStatus = youtubeService.isAuthenticated();
    if (!authStatus.authenticated) {
      logger.warn('Cannot queue file - not authenticated', { filename });
      return;
    }

    uploadQueue.add(async () => {
      const seoService = require('./seo');
      const tiktokData = {
        desc:     path.basename(filename, path.extname(filename)),
        author:   '',
        duration: 0,
        videoUrl: filepath,
      };

      // ★ Monetization gate
      const validation = seoService.validateForMonetization(tiktokData, tiktokData.desc);
      if (validation.status === 'blocked') {
        logger.warn('[Scheduler] Skipping blocked content', {
          filename,
          issues: validation.issues.map(i => i.message),
        });
        throw new Error(`บล็อกอัตโนมัติ: ${validation.issues[0]?.message || 'ผิดนโยบาย'}`);
      }

      // ★ SEO metadata
      const metadata = seoService.generateMetadata(tiktokData, {
        schedulePublish: config.autoSchedule || false,
      });

      const result = await youtubeService.uploadVideo({
        filepath,
        title:       metadata.title || path.basename(filename, path.extname(filename)),
        description: metadata.description || config.defaultDescription || '',
        tags:        Array.isArray(metadata.tags) ? metadata.tags.join(',') : (metadata.tags || config.defaultTags || ''),
        privacy:     metadata.privacy || config.privacy || 'public',
        categoryId:  metadata.categoryId,
        publishAt:   metadata.publishAt || null,
      });

      // ★ Atomic / race-safe record write — safeUpdate serializes concurrent saves
      await uploads.safeUpdate(arr => {
        const record = {
          filename,
          filepath,
          youtube_id:  result.videoId,
          youtube_url: result.youtubeUrl,
          uploaded_at: new Date().toISOString(),
          source:      'folder',
          deleted:     false,
        };
        const shouldDelete = config.deleteAfterUpload === true || config.deleteAfterUpload === 'true';
        if (shouldDelete && fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          record.deleted = true;
        }
        arr.push(record);
        return arr;
      });

      // ★ ห้ามเรียก orchestrator.onUploadCompleted() ที่นี่
      //   Queue.emit('completed') → orchestrator._wireQueue() → eventBus.dispatch('upload:completed')
      //   จัดการครบถ้วนแล้ว ถ้าเรียกซ้ำ stats จะนับ 2 ครั้ง

      return result;
    }, { filename });
  }

  // ── Config ────────────────────────────────────────────────────────

  getConfig() {
    const config = schedulerStore.load();
    return {
      ...config,
      quotaPaused:   this._quotaPaused,
      quotaResumeAt: this._quotaWaitTimer
        ? new Date(Date.now() + this._msUntilQuotaReset()).toISOString()
        : null,
    };
  }

  updateConfig(newConfig) {
    const config  = schedulerStore.load();
    const updated = { ...config, ...newConfig };
    schedulerStore.save(updated);
    if (updated.enabled) {
      this.start();
    } else {
      this.stop();
    }
    return updated;
  }

  // ── Continuous Loop ───────────────────────────────────────────────

  async _startContinuousLoop() {
    if (this._loopRunning) return;
    if (!schedulerStore.loadRef().enabled) return;

    this._loopRunning = true;
    this._loopStartedAt = Date.now();
    this._loopIteration = 0;
    this._loopStopRequested = false;
    logger.info('[Loop] Continuous loop started');

    try {
      // ★ เดิมเป็น while(true) — ถ้ามีอะไรผิดปกติจะวนตลอดกาลโดยไม่มีใครรู้
      //   ตอนนี้มีเพดานรอบ + ตรวจ error ติดกัน + ปล่อย _loopRunning ทุกกรณี
      let consecutiveErrors = 0;

      while (!this._loopStopRequested) {
        this._loopIteration++;

        if (this._loopIteration > C.SCHEDULER.LOOP_MAX_ITERATIONS) {
          logger.warn('[Loop] ถึงเพดานจำนวนรอบ — รีสตาร์ทลูปใหม่เพื่อล้าง state');
          break;
        }

        if (!schedulerStore.loadRef().enabled) {
          logger.info('[Loop] Scheduler disabled — stopping loop');
          break;
        }

        if (!this._checkQuotaBeforeScan()) {
          logger.info('[Loop] Quota หมด — หยุดรอ reset แล้วกลับมาใหม่');
          break;
        }

        // ★ รอคิวว่างแบบมีเพดานเวลา — เดิมรอไม่จำกัด งานติดค้าง 1 ชิ้น = ลูปตายถาวร
        const waited = await this._waitForQueueEmpty();
        if (!waited.ok) {
          logger.error('[Loop] คิวไม่ว่างในเวลาที่กำหนด — หยุดลูปเพื่อไม่ให้ค้าง', waited);
          break;
        }

        // ★ Double-check quota AFTER queue empties
        if (!this._checkQuotaBeforeScan()) {
          logger.info('[Loop] Quota หมดหลัง queue ว่าง — หยุดรอ reset');
          break;
        }

        logger.info('[Loop] Running next watchlist cycle...', { iteration: this._loopIteration });

        let result;
        try {
          result = await this.runWatchlist();
          consecutiveErrors = 0;
        } catch (err) {
          consecutiveErrors++;
          logger.error('[Loop] watchlist cycle ล้มเหลว', {
            error: err.message, consecutiveErrors,
          });
          if (consecutiveErrors >= C.SCHEDULER.LOOP_MAX_CONSECUTIVE_ERRORS) {
            logger.error('[Loop] ล้มเหลวติดกันหลายรอบ — หยุดลูป');
            break;
          }
          // backoff แล้วลองใหม่
          await this._delay(Math.min(consecutiveErrors * 60_000, C.SCHEDULER.LOOP_COOLDOWN_MS));
          continue;
        }

        if ((result?.queued || 0) === 0) {
          const cooldownMs = C.SCHEDULER.LOOP_COOLDOWN_MS;
          logger.info(`[Loop] ไม่มีคลิปใหม่ — รอ ${cooldownMs / 60_000} นาทีแล้วลองใหม่`);
          await this._delay(cooldownMs);
        } else {
          // ★ Small delay between cycles ป้องกัน rapid fire ถ้า watchlist ผลลัพธ์เร็วมาก
          await this._delay(5000);
        }
      }
    } catch (err) {
      logger.error('[Loop] ลูปหยุดเพราะ error ที่ไม่คาดคิด', { error: err.message, stack: err.stack });
    } finally {
      // ★ ต้องปล่อย flag ทุกกรณี — ถ้าค้างเป็น true จะไม่มีลูปใหม่เกิดขึ้นอีกเลย
      this._loopRunning = false;
      const ranMs = Date.now() - (this._loopStartedAt || Date.now());
      logger.info('[Loop] Continuous loop ended', {
        iterations: this._loopIteration, ranMinutes: Math.round(ranMs / 60_000),
      });
    }
  }

  /** สั่งให้ลูปหยุดที่รอบถัดไป (ใช้ตอน stop()/shutdown) */
  requestLoopStop() {
    this._loopStopRequested = true;
  }

  getLoopState() {
    return {
      running:   this._loopRunning,
      iteration: this._loopIteration || 0,
      startedAt: this._loopStartedAt ? new Date(this._loopStartedAt).toISOString() : null,
      runningMinutes: this._loopStartedAt ? Math.round((Date.now() - this._loopStartedAt) / 60_000) : 0,
      stopRequested: !!this._loopStopRequested,
    };
  }

  /**
   * ★ รอคิวว่าง — มีเพดานเวลา (เดิมรอตลอดกาล)
   * @returns {{ok:boolean, waitedMs:number, reason?:string}}
   */
  _waitForQueueEmpty() {
    const maxWaitMs = C.SCHEDULER.QUEUE_WAIT_MAX_MS;
    const startedAt = Date.now();

    return new Promise(resolve => {
      const check = () => {
        if (this._loopStopRequested) {
          return resolve({ ok: false, waitedMs: Date.now() - startedAt, reason: 'stop_requested' });
        }

        const s = uploadQueue.getCounts();
        const outstanding = (s.pending || 0) + (s.processing || 0);

        if (outstanding === 0) {
          return resolve({ ok: true, waitedMs: Date.now() - startedAt });
        }

        if (Date.now() - startedAt > maxWaitMs) {
          return resolve({
            ok: false,
            waitedMs: Date.now() - startedAt,
            reason: 'timeout',
            pending: s.pending, processing: s.processing,
          });
        }

        logger.debug(`[Loop] Queue ยังมีงาน — pending:${s.pending} processing:${s.processing} — รออีก ${C.SCHEDULER.QUEUE_POLL_MS / 1000}s`);
        const t = setTimeout(check, C.SCHEDULER.QUEUE_POLL_MS);
        if (t.unref) t.unref();
      };
      check();
    });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Watchlist Runner ──────────────────────────────────────────────

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
    const channelStage     = config.channelStage || 'early_stage';

    return watchlistService.runAll(async ({ video, keyword }) => {
      const metadata = seoService.generateMetadata(video, {
        source:       'tiktok',
        keyword,
        privacy:      config.privacy || 'public',
        schedule:     config.autoSchedule,
        channelStage,
      });

      const tiktokService    = require('./tiktok');
      const suggestedFilename = (video.desc || keyword)
        .substring(0, 60)
        .replace(/[^\w\s\-ก-๙]/g, '')
        .trim() || `tiktok_${video.id || Date.now()}`;

      // ★ PATH B — ห้ามเรียก orchestrator ที่นี่
      //   Queue.emit('completed') → orchestrator จัดการให้
      uploadQueue.add(async () => {
        let downloaded = null;
        try {
          downloaded = await tiktokService.downloadNoWatermark(video.videoUrl, suggestedFilename);
        } catch (dlErr) {
          watchlistService.notifyDlError();
          logger.error('[Watchlist] Download failed', {
            keyword,
            error:    dlErr.message,
            videoUrl: video.videoUrl,
          });
          throw dlErr;
        }

        const result = await youtubeService.uploadVideo({
          filepath:    downloaded.filepath,
          title:       metadata.title,
          description: metadata.description,
          tags:        Array.isArray(metadata.tags) ? metadata.tags.join(',') : metadata.tags,
          privacy:     metadata.privacy || config.privacy || 'public',
          publishAt:   metadata.publishAt,
          categoryId:  metadata.categoryId,
        });

        // ★ Atomic record write — ป้องกัน race condition กับ batch-upload path
        await uploads.safeUpdate(arr => {
          arr.push({
            filename:        downloaded.filename,
            filepath:        downloaded.filepath,
            youtube_id:      result.videoId,
            youtube_url:     result.youtubeUrl,
            uploaded_at:     new Date().toISOString(),
            source:          'tiktok_watchlist',
            source_url:      video.videoUrl,
            tiktok_video_id: video.id,
            watch_keyword:   keyword,
            deleted:         false,
          });
          return arr;
        });

        // Cleanup downloaded file
        try {
          if (fs.existsSync(downloaded.filepath)) fs.unlinkSync(downloaded.filepath);
        } catch (_) {}

        // ★ ไม่เรียก _updateStats() ตรง — ใช้ EventBus rule ผ่าน Queue.emit('completed')
        logger.info('[Watchlist] Upload complete', {
          keyword,
          title:      metadata.title,
          youtubeUrl: result.youtubeUrl,
        });
        return result;
      }, { filename: suggestedFilename });
    });
  }
}

module.exports = new Scheduler();
