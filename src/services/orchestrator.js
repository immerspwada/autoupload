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
      uploadQueue.pause();
      logger.warn('[Orchestrator] Queue auto-paused', { reason: payload.reason });
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

    // Also broadcast queue progress
    eventBus.on('queue:progress', (status) => {
      if (this.broadcast) {
        this.broadcast('queue:progress', status);
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
      const allStats = stats.load();
      const today = new Date().toISOString().split('T')[0];
      const hour = new Date().getHours().toString();

      if (!allStats.dailyStats) allStats.dailyStats = {};
      if (!allStats.dailyStats[today]) allStats.dailyStats[today] = { uploads: 0, failures: 0, size: 0 };
      if (!allStats.uploadsByHour) allStats.uploadsByHour = {};

      if (payload.type === 'upload') {
        allStats.totalUploads = (allStats.totalUploads || 0) + 1;
        allStats.totalSize = (allStats.totalSize || 0) + (payload.size || 0);
        allStats.dailyStats[today].uploads++;
        allStats.dailyStats[today].size += (payload.size || 0);
      } else if (payload.type === 'failure') {
        allStats.failedUploads = (allStats.failedUploads || 0) + 1;
        allStats.dailyStats[today].failures++;
      }

      allStats.uploadsByHour[hour] = (allStats.uploadsByHour[hour] || 0) + 1;
      allStats.lastEvent = { type: payload.type, filename: payload.filename, at: new Date().toISOString() };

      stats.save(allStats);
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

  getEventHistory(limit) {
    return eventBus.getHistory(limit);
  }

  getRules() {
    return eventBus.getRules();
  }
}

module.exports = new Orchestrator();
