// ═══════════════════════════════════════════════════════════════════
// Orchestrator — เชื่อม EventBus กับทุก Service
//
// หน้าที่: 
//   1. Wire queue events → EventBus
//   2. Wire scheduler events → EventBus
//   3. Wire health reactions → actual actions
//   4. Wire notifications → WebSocket broadcast
//   5. Wire stats updates → store
//
// กฎสำคัญ: ทุกเหตุการณ์ต้องผ่าน EventBus → Orchestrator dispatch
// ═══════════════════════════════════════════════════════════════════

const eventBus = require('./eventbus');
const uploadQueue = require('./queue');
const scheduler = require('./scheduler');
const healthService = require('./health');
const { stats, uploads } = require('../utils/store');
const logger = require('../utils/logger');

class Orchestrator {
  constructor() {
    this.broadcast = null; // will be set by server.js
    this._wired = false;
    // Debounce queue progress broadcasts
    this._queueProgressDebounce = null;
    this._pendingQueueProgress = null;
    // ★ true = คิวถูก pause โดยระบบ (health critical) ไม่ใช่โดยผู้ใช้
    this._autoPaused = false;
  }

  // เรียกครั้งเดียวจาก server.js หลัง WebSocket พร้อม
  init(broadcastFn) {
    if (this._wired) return;
    this._wired = true;
    this.broadcast = broadcastFn;

    this._wireQueue();
    this._wireScheduler();
    this._wireHealthReactions();
    this._wireNotifications();
    this._wireStats();
    this._wireDashboard();
    this._wireWatchlistProgress();
    this._wireVideoTransform();

    logger.info('[Orchestrator] All services wired to EventBus');
  }

  // ==================== WIRE: Queue → EventBus ====================
  _wireQueue() {
    uploadQueue.on('completed', (data) => {
      eventBus.dispatch('upload:completed', data);
    });

    uploadQueue.on('failed', (data) => {
      eventBus.dispatch('upload:failed', data);
    });

    uploadQueue.on('retry', (data) => {
      eventBus.dispatch('upload:retry', data);
    });

    uploadQueue.on('drain', (status) => {
      eventBus.dispatch('queue:drain', status);
    });

    uploadQueue.on('progress', (status) => {
      eventBus.dispatch('queue:progress', status);
    });

    // Listen for auto-pause command from rules
    eventBus.on('queue:auto_pause', (payload) => {
      // ★ จำว่าเป็นการ pause อัตโนมัติ — เพื่อไม่ resume ทับการ pause ที่ user สั่งเอง
      if (!uploadQueue.paused) this._autoPaused = true;
      uploadQueue.pause();
      logger.warn('[Orchestrator] Queue auto-paused', { reason: payload.reason });
    });

    eventBus.on('queue:auto_resume', (payload) => {
      if (!this._autoPaused) {
        logger.info('[Orchestrator] ไม่ resume — คิวถูก pause โดยผู้ใช้');
        return;
      }
      this._autoPaused = false;
      uploadQueue.resume();
      logger.info('[Orchestrator] Queue auto-resumed', { reason: payload.reason });
      eventBus.dispatch('notification:send', {
        level: 'success',
        title: 'ระบบกลับมาปกติ',
        message: 'คิวอัปโหลดทำงานต่ออัตโนมัติ',
        source: 'health',
      });
    });
  }

  // ==================== WIRE: Scheduler → EventBus ====================
  _wireScheduler() {
    // Override scheduler.scan to emit through EventBus
    const origScan = scheduler.scan.bind(scheduler);
    scheduler.scan = function() {
      const result = origScan();
      if (result.queued > 0) {
        eventBus.dispatch('scheduler:files_found', { count: result.queued, scanned: result.scanned });
      }
      return result;
    };

    // Listen for scheduler commands from rules
    eventBus.on('scheduler:check_start', () => {
      const config = scheduler.getConfig();
      if (config.enabled) {
        scheduler.start();
      }
    });

    eventBus.on('scheduler:pause', (payload) => {
      scheduler.stop();
      logger.info('[Orchestrator] Scheduler paused', { reason: payload.reason });
    });

    eventBus.on('scheduler:restart_watcher', (payload) => {
      scheduler.stopWatcher();
      if (payload.folder) {
        scheduler.startWatcher();
      }
    });
  }

  // ==================== WIRE: Health → Actions ====================
  _wireHealthReactions() {
    eventBus.on('health:cleanup', () => {
      healthService.cleanupQueue();
      healthService.cleanupTempFiles();
    });

    eventBus.on('health:register_hash', (payload) => {
      if (payload.hash && payload.filename) {
        healthService.registerHash(payload.hash, payload.filename);
      }
    });
  }

  // ==================== WIRE: Notifications → WebSocket ====================
  _wireNotifications() {
    eventBus.on('notification:send', (payload) => {
      if (this.broadcast) {
        this.broadcast('notification', {
          level: payload.level,
          title: payload.title,
          message: payload.message,
          source: payload.source,
          timestamp: Date.now()
        });
      }
    });

    // Also broadcast queue progress (debounced)
    eventBus.on('queue:progress', (status) => {
      if (this.broadcast) {
        this._pendingQueueProgress = status;
        if (this._queueProgressDebounce) {
          clearTimeout(this._queueProgressDebounce);
        }
        this._queueProgressDebounce = setTimeout(() => {
          if (this._pendingQueueProgress && this.broadcast) {
            this.broadcast('queue:progress', this._pendingQueueProgress);
            this._pendingQueueProgress = null;
          }
        }, 200); // 200ms debounce
      }
    });

    // Broadcast upload completed
    eventBus.on('upload:completed', (data) => {
      if (this.broadcast) {
        this.broadcast('queue:completed', data);
      }
    });

    eventBus.on('upload:failed', (data) => {
      if (this.broadcast) {
        this.broadcast('queue:failed', data);
      }
    });

    eventBus.on('upload:retry', (data) => {
      if (this.broadcast) {
        this.broadcast('queue:retry', data);
      }
    });

    eventBus.on('queue:drain', (status) => {
      if (this.broadcast) {
        this.broadcast('queue:done', status);
      }
    });
  }

  // ==================== WIRE: Stats → Store ====================
  _wireStats() {
    eventBus.on('stats:increment', (payload) => {
      // ★ safeUpdate — serialized read-modify-write กัน lost update
      //   เดิมใช้ load()+save() ตรง ทำให้ upload ที่เกิดพร้อมกันนับหาย
      stats.safeUpdate((allStats) => {
        const today = new Date().toISOString().split('T')[0];
        const hour  = new Date().getHours().toString();

        if (!allStats.dailyStats) allStats.dailyStats = {};
        if (!allStats.dailyStats[today]) allStats.dailyStats[today] = { uploads: 0, failures: 0, size: 0, tiktok: 0 };
        if (!allStats.uploadsByHour) allStats.uploadsByHour = {};
        if (!allStats.sourceStats) allStats.sourceStats = { tiktok: 0, folder: 0, drop: 0, tiktok_watchlist: 0 };
        if (!allStats.transformStats) allStats.transformStats = { total: 0, failed: 0 };

        if (payload.type === 'upload') {
          allStats.totalUploads = (allStats.totalUploads || 0) + 1;
          allStats.totalSize = (allStats.totalSize || 0) + (payload.size || 0);
          allStats.dailyStats[today].uploads++;
          allStats.dailyStats[today].size += (payload.size || 0);
          if (payload.source && allStats.sourceStats[payload.source] !== undefined) {
            allStats.sourceStats[payload.source]++;
          }
          if (payload.source === 'tiktok' || payload.source === 'tiktok_watchlist') {
            allStats.dailyStats[today].tiktok = (allStats.dailyStats[today].tiktok || 0) + 1;
          }
          // ★ uploadsByHour นับเฉพาะ upload จริง — เดิมนับทุก event รวม transform
          //   ทำให้กราฟ "ช่วงเวลาที่อัปโหลด" บนหน้า dashboard เพี้ยน
          allStats.uploadsByHour[hour] = (allStats.uploadsByHour[hour] || 0) + 1;

        } else if (payload.type === 'failure') {
          allStats.failedUploads = (allStats.failedUploads || 0) + 1;
          allStats.dailyStats[today].failures++;

        } else if (payload.type === 'transform') {
          allStats.transformStats.total++;

        } else if (payload.type === 'transform_failed') {
          allStats.transformStats.failed++;
        }

        // lastEvent เฉพาะ event ที่เกี่ยวกับ upload — ไม่ให้ transform กลบ
        if (payload.type === 'upload' || payload.type === 'failure') {
          allStats.lastEvent = { type: payload.type, filename: payload.filename, at: new Date().toISOString() };
        }

        return allStats;
      });
    });
  }

  // ==================== WIRE: Dashboard → Broadcast ====================
  _wireDashboard() {
    eventBus.on('dashboard:refresh', (payload) => {
      if (this.broadcast) {
        this.broadcast('dashboard:refresh', { reason: payload.reason });
      }
    });
  }

  // ==================== WIRE: Watchlist Progress → WebSocket ====================
  // ★ ส่ง progress ของ watchlist run ผ่าน WebSocket ไปให้ frontend
  //   ทำให้ user เห็น progress แม้ Scheduler จะเป็นคนเรียก (ไม่ใช่แค่ manual run)
  _wireWatchlistProgress() {
    const watchlistService = require('./watchlist');
    watchlistService.on('progress', (state) => {
      if (this.broadcast) {
        this.broadcast('watchlist:progress', state);
      }
    });
  }

  // ==================== WIRE: Video Transform → WebSocket ====================
  _wireVideoTransform() {
    const videoTransform = require('./videoTransform');
    
    videoTransform.on('transform:start', (data) => {
      if (this.broadcast) {
        this.broadcast('transform:start', data);
      }
    });

    videoTransform.on('transform:progress', (data) => {
      if (this.broadcast) {
        this.broadcast('transform:progress', data);
      }
    });

    videoTransform.on('transform:complete', (data) => {
      if (this.broadcast) {
        this.broadcast('transform:complete', data);
      }
      eventBus.dispatch('stats:increment', { type: 'transform', filename: data.input });
    });

    videoTransform.on('transform:failed', (data) => {
      if (this.broadcast) {
        this.broadcast('transform:failed', data);
      }
      eventBus.dispatch('stats:increment', { type: 'transform_failed', filename: data.input });
    });

    videoTransform.on('compilation:start', (data) => {
      if (this.broadcast) {
        this.broadcast('compilation:start', data);
      }
    });

    videoTransform.on('compilation:complete', (data) => {
      if (this.broadcast) {
        this.broadcast('compilation:complete', data);
      }
    });
  }

  // ==================== PUBLIC API ====================
  // ให้ routes ใช้เพื่อ emit events อย่างถูกต้อง
  onUploadCompleted(data) {
    eventBus.dispatch('upload:completed', data);
  }

  onUploadFailed(data) {
    eventBus.dispatch('upload:failed', data);
  }

  onAuthLogin() {
    eventBus.dispatch('auth:login', {});
  }

  onAuthLogout() {
    eventBus.dispatch('auth:logout', {});
  }

  onSettingsUpdated(settings) {
    eventBus.dispatch('settings:updated', settings);
  }

  onTikTokDownloaded(data) {
    eventBus.dispatch('tiktok:downloaded', data);
  }

  onDuplicateDetected(data) {
    eventBus.dispatch('upload:duplicate_detected', data);
  }

  onVideoDeleted(data) {
    eventBus.dispatch('upload:video_deleted', data);
  }

  // ════════════════════════ ENGINE EVENTS ════════════════════════

  onEngineStateChanged(data) {
    eventBus.dispatch('engine:state_changed', data);
  }

  onEngineCycleStarted(data) {
    eventBus.dispatch('engine:cycle_started', data);
  }

  onEngineCycleCompleted(data) {
    eventBus.dispatch('engine:cycle_completed', data);
  }

  onEngineDegraded(data) {
    eventBus.dispatch('engine:degraded', data);
  }

  onEngineStuck(data) {
    eventBus.dispatch('engine:stuck', data);
  }

  onEngineBlocked(data) {
    eventBus.dispatch('engine:blocked', data);
  }

  onEngineQuotaWait(data) {
    eventBus.dispatch('engine:quota_wait', data);
  }

  /**
   * ★ Health status เปลี่ยน → EventBus Rule 9 (critical → auto-pause queue)
   * เดิม rule นี้เป็น dead code เพราะไม่มีใคร dispatch event นี้เลย
   * ตอนนี้ server.js watchdog เรียกทุก 60 วิเมื่อสถานะเปลี่ยน
   */
  onHealthStatusChanged(overall, previous, health) {
    logger.info('[Orchestrator] สถานะระบบเปลี่ยน', { from: previous, to: overall });
    eventBus.dispatch('health:status_changed', {
      overall,
      previous,
      memory: health?.memory,
      disk:   health?.disk,
      queue:  health?.queue,
      checks: health?.checks,
    });

    // ★ กลับมาปกติ → resume queue ที่ถูก auto-pause ไว้
    if (overall !== 'critical' && previous === 'critical') {
      eventBus.dispatch('queue:auto_resume', { reason: 'health_recovered' });
    }
  }

  getEventHistory(limit) {
    return eventBus.getHistory(limit);
  }

  getRules() {
    return eventBus.getRules();
  }
}

module.exports = new Orchestrator();
