/**
 * ★ Autonomous Upload Engine — service หลักที่เป็นเจ้าของลูป 24/7
 *
 * ทำหน้าที่:
 *   - Supervisor tick ทุก 60s เทียบ desiredState กับ phase แล้วตัดสินใจ
 *   - Durable state machine ที่ persist ทุก transition ลง engine_state.json
 *   - Cycle runner: discover → gate → transform → queue → wait → summarize
 *   - Quota coordination: rotate account ก่อน แล้วรอ reset แบบ durable
 *   - Pacing: กระจายอัปโหลด 8 slot/วัน เน้น 18–21 Bangkok
 *   - Safety gate: block reused content, duplicate, low score
 *   - Retention: ลบไฟล์ชั่วคราว + archive uploads.json > 5000
 *
 * กฎสำคัญ:
 *   - ห้าม import eventbus ตรง → ใช้ orchestrator methods เท่านั้น
 *   - ห้ามเรียก orchestrator.onUploadCompleted() → Path B (queue emits)
 *   - ทุก external call ห่อด้วย guarded()
 *   - ทุก state change ต้อง persist ก่อนทำ side effect
 */
'use strict';

const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const C      = require('../config/constants');
const { Store } = require('../utils/store');

// ══════════════════════════════════════════════════════════════════
//  Constants & Enums
// ══════════════════════════════════════════════════════════════════

const ENGINE_PHASES = Object.freeze([
  'stopped', 'idle', 'discovering', 'uploading',
  'waiting_quota', 'waiting_pacing',
  'paused_health', 'paused_manual', 'degraded',
]);

const DESIRED_STATES = Object.freeze(['running', 'stopped']);

/**
 * Allowed state transitions (from → Set of allowed to values)
 * Self-transitions are always rejected.
 */
const TRANSITION_TABLE = new Map([
  ['stopped',        new Set(['idle'])],
  ['idle',           new Set(['discovering', 'waiting_quota', 'waiting_pacing', 'paused_health', 'paused_manual', 'degraded', 'stopped'])],
  ['discovering',    new Set(['uploading', 'idle', 'waiting_quota', 'waiting_pacing', 'paused_health', 'paused_manual', 'degraded', 'stopped'])],
  ['uploading',      new Set(['idle', 'waiting_quota', 'waiting_pacing', 'paused_health', 'paused_manual', 'degraded', 'stopped'])],
  ['waiting_quota',  new Set(['idle', 'paused_health', 'paused_manual', 'stopped'])],
  ['waiting_pacing', new Set(['idle', 'waiting_quota', 'paused_health', 'paused_manual', 'stopped'])],
  ['paused_health',  new Set(['idle', 'paused_manual', 'stopped'])],
  ['paused_manual',  new Set(['idle', 'stopped'])],
  ['degraded',       new Set(['idle', 'discovering', 'waiting_quota', 'paused_health', 'paused_manual', 'stopped'])],
]);

const DEFAULT_ENGINE_STATE = Object.freeze({
  stateVersion: 1,
  phase: 'stopped',
  desiredState: 'stopped',
  cycleCount: 0,
  consecutiveErrors: 0,
  transitionSeq: 0,
  nextActionAt: null,
  lastTickAt: null,
  currentAccountId: null,
  lastError: null,
  pacingPlan: null,
  inFlight: [],
  updatedAt: null,
});

// Supervisor tick interval (configurable via env for testing)
const TICK_MS = Math.max(15_000, Math.min(300_000,
  parseInt(process.env.ENGINE_TICK_MS) || 60_000
));

// ══════════════════════════════════════════════════════════════════
//  Engine State Store
// ══════════════════════════════════════════════════════════════════

const engineStore = new Store('engine_state.json', { ...DEFAULT_ENGINE_STATE });

// ══════════════════════════════════════════════════════════════════
//  Engine Service
// ══════════════════════════════════════════════════════════════════

class Engine extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(30);

    this._broadcast = null;
    this._initialized = false;
    this._supervisorTimer = null;
    this._cycleRunning = false;
    this._instanceId = `eng_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this._instanceStartedAt = new Date().toISOString();

    // ★ In-memory mirror of persisted state (loaded on init, updated on every transition)
    this._state = { ...DEFAULT_ENGINE_STATE };

    // ★ Transition lock — only 1 transition at a time
    this._transitioning = false;
    this._transitionQueue = [];
  }

  // ════════════════════════════════════════════════════════════════
  //  Lifecycle
  // ════════════════════════════════════════════════════════════════

  /**
   * Called once from server.js after orchestrator.init()
   * Reads persisted state, reconciles inFlight, starts supervisor
   */
  init(broadcastFn) {
    if (this._initialized) return;
    this._initialized = true;
    this._broadcast = broadcastFn;

    // Load persisted state
    this._loadState();

    // ★ Task 4: Reconcile in-flight uploads from previous run
    if (this._state.inFlight && this._state.inFlight.length > 0) {
      // Run reconciliation in background (don't block init)
      this._reconcileInFlight().catch(err => {
        logger.error('[Engine] In-flight reconciliation error', { error: err.message });
      });
    }

    logger.info('[Engine] Initialized', {
      phase: this._state.phase,
      desiredState: this._state.desiredState,
      cycleCount: this._state.cycleCount,
      instanceId: this._instanceId,
    });

    // Start supervisor tick
    this._supervisorTimer = setInterval(() => {
      this._supervisorTick().catch(err => {
        logger.error('[Engine] Supervisor tick error', { error: err.message });
      });
    }, TICK_MS);

    // Auto-start if configured
    const settings = require('../utils/store').settings.loadRef();
    if (settings.engine?.autoStartOnBoot === true && this._state.desiredState !== 'stopped') {
      logger.info('[Engine] Auto-starting on boot (engine.autoStartOnBoot = true)');
      this.start().catch(err => {
        logger.error('[Engine] Auto-start failed', { error: err.message });
      });
    }
  }

  /**
   * Operator: set desiredState = running
   */
  async start() {
    if (this._state.desiredState === 'running' && this._state.phase !== 'stopped') {
      logger.info('[Engine] Already running');
      return;
    }

    this._state.desiredState = 'running';
    await this._persistState('start requested by operator');

    if (this._state.phase === 'stopped') {
      await this._transitionTo('idle', 'operator_start');
    } else if (this._state.phase === 'paused_manual') {
      await this._transitionTo('idle', 'operator_resume');
    }
  }

  /**
   * Operator: set desiredState = stopped, wait for in-flight to finish
   */
  async stop() {
    this._state.desiredState = 'stopped';
    await this._persistState('stop requested by operator');

    if (this._state.phase !== 'stopped') {
      // If cycle is running, it will check desiredState and stop gracefully
      if (!this._cycleRunning) {
        await this._transitionTo('stopped', 'operator_stop');
      }
      // If cycle IS running, supervisor tick will transition to stopped after it finishes
    }
  }

  /**
   * Operator: pause (keep desiredState = running for resume behavior on restart)
   */
  async pause() {
    if (this._state.phase === 'paused_manual') return;
    if (this._state.phase === 'stopped') return;

    await this._transitionTo('paused_manual', 'operator_pause');
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown() {
    if (this._supervisorTimer) {
      clearInterval(this._supervisorTimer);
      this._supervisorTimer = null;
    }
    // Persist final state
    this._state.lastTickAt = new Date().toISOString();
    await this._persistState('shutdown');
  }

  // ════════════════════════════════════════════════════════════════
  //  State Machine
  // ════════════════════════════════════════════════════════════════

  /**
   * ★ Gated transition — validates against table, persists, then dispatches event
   * Returns true if transition succeeded, false if rejected
   */
  async _transitionTo(to, reason = '') {
    const from = this._state.phase;

    // Self-transition check
    if (from === to) {
      logger.debug('[Engine] Self-transition ignored', { phase: from });
      return false;
    }

    // Validate against transition table
    const allowed = TRANSITION_TABLE.get(from);
    if (!allowed || !allowed.has(to)) {
      logger.warn('[Engine] Transition rejected', { from, to, reason });
      return false;
    }

    // Serialize transitions
    if (this._transitioning) {
      return new Promise((resolve) => {
        this._transitionQueue.push({ to, reason, resolve });
      });
    }
    this._transitioning = true;

    try {
      // Update in-memory state
      this._state.phase = to;
      this._state.transitionSeq++;
      this._state.updatedAt = new Date().toISOString();

      // Persist BEFORE any side effects
      const persistOk = await this._persistState(`transition ${from}→${to}: ${reason}`);
      if (!persistOk) {
        // Rollback in-memory
        this._state.phase = from;
        this._state.transitionSeq--;
        logger.error('[Engine] Transition rolled back (persist failed)', { from, to });
        return false;
      }

      // Dispatch event AFTER successful persist
      this._dispatchStateChanged(from, to, reason);

      logger.info('[Engine] Phase changed', { from, to, reason, seq: this._state.transitionSeq });
      return true;

    } finally {
      this._transitioning = false;
      // Process queued transitions
      if (this._transitionQueue.length > 0) {
        const next = this._transitionQueue.shift();
        // Re-validate from current (may have changed)
        const result = await this._transitionTo(next.to, next.reason);
        next.resolve(result);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Persistence
  // ════════════════════════════════════════════════════════════════

  _loadState() {
    try {
      const persisted = engineStore.load();

      // Validate schema
      if (!persisted || typeof persisted !== 'object') {
        throw new Error('Engine state is not an object');
      }
      if (!ENGINE_PHASES.includes(persisted.phase)) {
        throw new Error(`Invalid phase: ${persisted.phase}`);
      }
      if (!DESIRED_STATES.includes(persisted.desiredState)) {
        throw new Error(`Invalid desiredState: ${persisted.desiredState}`);
      }

      // Map non-resumable phases to idle
      if (persisted.phase === 'discovering' || persisted.phase === 'uploading') {
        logger.warn('[Engine] Non-resumable phase on boot, mapping to idle', { phase: persisted.phase });
        persisted.phase = 'idle';
      }

      // Handle waiting_quota with past nextActionAt
      if (persisted.phase === 'waiting_quota' && persisted.nextActionAt) {
        if (new Date(persisted.nextActionAt) <= new Date()) {
          logger.info('[Engine] Quota wait expired during downtime, transitioning to idle');
          persisted.phase = 'idle';
          persisted.nextActionAt = null;
        }
      }

      this._state = {
        ...DEFAULT_ENGINE_STATE,
        ...persisted,
        stateVersion: 1,
      };

    } catch (err) {
      logger.error('[Engine] Failed to load state — using defaults (stopped)', {
        error: err.message,
      });
      this._state = { ...DEFAULT_ENGINE_STATE };
    }
  }

  /**
   * Persist current in-memory state to disk
   * Returns true on success, false on failure
   */
  async _persistState(reason = '') {
    try {
      this._state.updatedAt = new Date().toISOString();
      await engineStore.safeUpdate(() => ({ ...this._state }));
      return true;
    } catch (err) {
      logger.error('[Engine] State persist failed', { error: err.message, reason });
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Supervisor Tick
  // ════════════════════════════════════════════════════════════════

  async _supervisorTick() {
    const now = new Date();
    const lastTick = this._state.lastTickAt ? new Date(this._state.lastTickAt) : null;

    // ★ Task 25: Detect runtime suspension (Fly.io freeze)
    if (lastTick && (now - lastTick) > TICK_MS * 5) {
      const gapMs = now - lastTick;
      logger.error('[Engine] Runtime suspension detected', {
        gapMs, expectedMs: TICK_MS, multiplier: Math.round(gapMs / TICK_MS),
      });
      const orchestrator = require('./orchestrator');
      orchestrator.onEngineBlocked({
        reason: 'runtime_suspended',
        gapMs,
        lastTickAt: this._state.lastTickAt,
      });
    }

    // ★ Task 24: Daily backup (every 24h)
    if (!this._lastBackupAt || (now - this._lastBackupAt) >= 24 * 60 * 60_000) {
      try {
        const { retentionManager } = require('./engine');
        retentionManager.createDailyBackup();
        this._lastBackupAt = now;
      } catch (err) {
        logger.error('[Engine] Daily backup failed', { error: err.message });
      }
    }

    // Update heartbeat
    this._state.lastTickAt = now.toISOString();
    // Persist heartbeat periodically (not every tick to reduce I/O)
    // Every 60s is fine since tick IS 60s
    await this._persistState('tick');

    // Main decision logic
    if (this._state.desiredState !== 'running') return;

    const phase = this._state.phase;

    switch (phase) {
      case 'idle': {
        const nextAction = this._state.nextActionAt ? new Date(this._state.nextActionAt) : null;
        if (!nextAction || now >= nextAction) {
          // Time to start a new cycle
          if (!this._cycleRunning) {
            this._startCycle();
          }
        }
        break;
      }

      case 'waiting_quota': {
        const nextAction = this._state.nextActionAt ? new Date(this._state.nextActionAt) : null;
        if (nextAction && now >= nextAction) {
          await this._transitionTo('idle', 'quota_reset_time_reached');
        }
        break;
      }

      case 'waiting_pacing': {
        const nextAction = this._state.nextActionAt ? new Date(this._state.nextActionAt) : null;
        if (nextAction && now >= nextAction) {
          await this._transitionTo('idle', 'pacing_slot_reached');
        }
        break;
      }

      case 'degraded': {
        const nextAction = this._state.nextActionAt ? new Date(this._state.nextActionAt) : null;
        if (nextAction && now >= nextAction) {
          if (!this._cycleRunning) {
            this._startCycle();
          }
        }
        break;
      }

      case 'paused_health': {
        // Check if health recovered (will be wired in task 14)
        // For now, just log
        break;
      }

      case 'stopped':
      case 'paused_manual':
        // Do nothing, wait for operator
        break;

      case 'discovering':
      case 'uploading':
        // ★ Task 29: Stuck detection — phase-specific timeouts
        this._checkStuck();
        break;
    }

    // Broadcast status (throttled — WS clients get updates)
    this._broadcastStatus();
  }

  // ════════════════════════════════════════════════════════════════
  //  Cycle (full implementation — Task 9)
  // ════════════════════════════════════════════════════════════════

  _startCycle() {
    if (this._cycleRunning) return;
    this._cycleRunning = true;

    this._runCycle()
      .then(() => {
        this._cycleRunning = false;
      })
      .catch(err => {
        this._cycleRunning = false;
        this._handleCycleError(err);
      });
  }

  async _runCycle() {
    const { quotaCoordinator, pacingPlanner, safetyGate, retentionManager } = require('./engine');
    const diskGuard      = require('../utils/diskGuard');
    const uploadQueue    = require('./queue');
    const watchlist      = require('./watchlist');
    const videoTransform = require('./videoTransform');
    const tiktokService  = require('./tiktok');
    const seoService     = require('./seo');
    const { settings, uploads } = require('../utils/store');

    const config       = settings.loadRef();
    const channelStage = config.channelStage || 'early_stage';
    const minScore     = config.watchlist?.minScore ?? 35;
    const allowWarned  = config.safety?.autonomousAllowWarned !== false;

    // ── 1. Pre-flight: retention + disk guard ─────────────────────
    retentionManager.run();

    // Disk guard with cleanup loop (max 2 rounds)
    for (let attempt = 0; attempt < 2; attempt++) {
      const space = diskGuard.check(C.TIKTOK.MAX_DOWNLOAD_BYTES, { label: 'engine cycle' });
      if (space.ok) break;
      if (attempt === 0) {
        logger.warn('[Engine] Disk low — running retention');
        retentionManager.run();
      } else {
        // Still full after cleanup
        this._state.nextActionAt = new Date(Date.now() + 15 * 60_000).toISOString();
        await this._transitionTo('paused_health', 'disk_full');
        return; // Cycle aborted — supervisor will resume when space recovers
      }
    }

    // ── 2. Pacing check ───────────────────────────────────────────
    // Ensure we have a plan for today
    if (pacingPlanner.isDayChanged(this._state.pacingPlan)) {
      const totalLeft = quotaCoordinator.getTotalUploadsLeft();
      const dailyAllowance = pacingPlanner.computeDailyAllowance(
        totalLeft, config.pacing?.maxUploadsPerDay
      );
      this._state.pacingPlan = pacingPlanner.generatePlan(
        dailyAllowance, config.pacing?.mode || 'paced'
      );
      await this._persistState('new_pacing_plan');
    }

    const pacingCheck = pacingPlanner.canUploadNow(this._state.pacingPlan);
    if (!pacingCheck.canUpload) {
      if (pacingCheck.reason === 'daily_limit_reached') {
        // Wait until quota reset
        this._state.nextActionAt = new Date(quotaCoordinator.computeEarliestReset()).toISOString();
        await this._transitionTo('waiting_quota', 'daily_limit_reached');
      } else {
        // Wait for next slot
        this._state.nextActionAt = pacingCheck.nextSlotAt || new Date(Date.now() + C.SCHEDULER.LOOP_COOLDOWN_MS).toISOString();
        await this._transitionTo('waiting_pacing', 'slot_full');
      }
      return;
    }

    // ── 3. Quota pre-check ────────────────────────────────────────
    const account = quotaCoordinator.selectAccount();
    if (!account) {
      this._state.nextActionAt = new Date(quotaCoordinator.computeEarliestReset()).toISOString();
      await this._transitionTo('waiting_quota', 'all_accounts_exhausted');
      return;
    }
    this._state.currentAccountId = account.accountId;

    // ── 4. Discovery via watchlist ────────────────────────────────
    await this._transitionTo('discovering', 'cycle_discovery_start');
    safetyGate.resetCycleStats();

    let totalQueued = 0;
    let skipReasons = {};
    const SKIP = (reason) => { skipReasons[reason] = (skipReasons[reason] || 0) + 1; };

    const cycleResult = await watchlist.runAll(async ({ video, keyword }) => {
      // ★ Safety Gate — monetization + duplicate + score
      const gate = safetyGate.check(video, { minScore, autonomousAllowWarned: allowWarned });
      if (!gate.pass) {
        SKIP(gate.reason);
        return;
      }

      // ★ Circuit breaker — too many blocked → stop cycle
      if (safetyGate.shouldPauseCycle()) {
        this._state.nextActionAt = null;
        await this._transitionTo('paused_manual', 'content_safety_ratio');
        throw new Error('CYCLE_PAUSED_SAFETY'); // Abort remaining clips
      }

      // ★ Pacing check per clip (may have filled slot during this cycle)
      const canStill = pacingPlanner.canUploadNow(this._state.pacingPlan);
      if (!canStill.canUpload) {
        SKIP('quota_exhausted');
        return; // Skip remaining — next cycle will handle
      }

      // ★ Quota check per clip (account may have run out during batch)
      quotaCoordinator.resetReconcileCounters();
      const clipAccount = quotaCoordinator.selectAccount();
      if (!clipAccount) {
        SKIP('quota_exhausted');
        return;
      }

      // ── Download ────────────────────────────────────────────────
      const suggestedFilename = (video.desc || keyword)
        .substring(0, 60)
        .replace(/[^\w\s\-ก-๙]/g, '')
        .trim() || `tiktok_${video.id || Date.now()}`;

      let downloaded;
      try {
        downloaded = await tiktokService.downloadNoWatermark(video.videoUrl, suggestedFilename);
      } catch (dlErr) {
        logger.warn('[Engine] Download failed — skipping clip', { error: dlErr.message });
        SKIP('download_failed');
        return;
      }

      // ── Transform (mandatory in autonomous mode) ────────────────
      let transformResult;
      try {
        transformResult = await videoTransform.transformSingle(downloaded.filepath, {
          overlay: { text: video.desc?.substring(0, 50) || keyword },
          watermark: { text: config.channelName || '' },
        });
      } catch (tfErr) {
        logger.warn('[Engine] Transform error — skipping clip', { error: tfErr.message });
        SKIP('transform_failed');
        try { const fs = require('fs'); if (fs.existsSync(downloaded.filepath)) fs.unlinkSync(downloaded.filepath); } catch (_) {}
        return;
      }

      if (!transformResult.transformed) {
        SKIP('transform_failed');
        try { const fs = require('fs'); if (fs.existsSync(downloaded.filepath)) fs.unlinkSync(downloaded.filepath); } catch (_) {}
        return;
      }

      // ── SEO metadata ────────────────────────────────────────────
      const metadata = seoService.generateMetadata(video, {
        source: 'tiktok',
        keyword,
        privacy: config.privacy || 'public',
        schedule: config.autoSchedule,
        channelStage,
      });

      // ── Queue upload (Path B — reserve → upload → record) ───────
      const uploadIntentId = `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const uploadFilepath = transformResult.filepath;

      // ★ Task 10: Reserve inFlight BEFORE upload starts
      const inFlightEntry = {
        uploadIntentId,
        tiktok_video_id: video.id,
        source_url: video.videoUrl,
        accountId: clipAccount.accountId,
        title: metadata.title,
        filepath: uploadFilepath,
        videoId: null,
        startedAt: new Date().toISOString(),
        reconcileAttempts: 0,
      };
      this._state.inFlight.push(inFlightEntry);
      await this._persistState('inflight_reserved');

      uploadQueue.add(async () => {
        const youtubeService = require('./youtube');

        const result = await youtubeService.uploadVideo({
          filepath: uploadFilepath,
          title: metadata.title,
          description: metadata.description,
          tags: Array.isArray(metadata.tags) ? metadata.tags.join(',') : metadata.tags,
          privacy: metadata.privacy || config.privacy || 'public',
          publishAt: metadata.publishAt,
          categoryId: metadata.categoryId,
          accountId: clipAccount.accountId,
        });

        // ★ Record videoId in inFlight
        const entry = this._state.inFlight.find(e => e.uploadIntentId === uploadIntentId);
        if (entry) entry.videoId = result.videoId;
        await this._persistState('inflight_videoId_recorded');

        // ★ Record in uploads.json
        await uploads.safeUpdate(arr => {
          arr.push({
            filename: downloaded.filename,
            filepath: uploadFilepath,
            youtube_id: result.videoId,
            youtube_url: result.youtubeUrl,
            uploaded_at: new Date().toISOString(),
            source: 'tiktok_watchlist',
            source_url: video.videoUrl,
            tiktok_video_id: video.id,
            watch_keyword: keyword,
            title: metadata.title,
            viralityScore: gate.score,
            deleted: false,
          });
          return arr;
        });

        // ★ Remove from inFlight
        this._state.inFlight = this._state.inFlight.filter(e => e.uploadIntentId !== uploadIntentId);
        await this._persistState('inflight_completed');

        // Record pacing
        pacingPlanner.recordUpload(this._state.pacingPlan);
        await this._persistState('pacing_recorded');

        // Cleanup files
        const fs = require('fs');
        try { if (fs.existsSync(downloaded.filepath)) fs.unlinkSync(downloaded.filepath); } catch (_) {}
        try { if (uploadFilepath !== downloaded.filepath && fs.existsSync(uploadFilepath)) fs.unlinkSync(uploadFilepath); } catch (_) {}

        return result;
      }, { filename: suggestedFilename, source: 'tiktok_watchlist' });

      totalQueued++;
    });

    // ── 5. Wait for queue to drain ────────────────────────────────
    if (totalQueued > 0) {
      await this._transitionTo('uploading', 'waiting_queue_drain');
      const drained = await this._waitForQueueEmpty();
      if (!drained.ok) {
        // Queue stuck — cancel remaining and treat as cycle error
        uploadQueue.clear();
        throw new Error(`Queue wait timeout after ${drained.waitedMs}ms`);
      }
    }

    // ── 6. Post-cycle summary ─────────────────────────────────────
    retentionManager.run();

    this._state.cycleCount++;
    this._state.consecutiveErrors = 0;
    this._state.lastError = null;
    this._lastCycleSummary = {
      completedAt: new Date().toISOString(),
      found: cycleResult?.queued + cycleResult?.skipped || 0,
      queued: totalQueued,
      skipped: cycleResult?.skipped || 0,
      skipReasons,
      accountUsed: this._state.currentAccountId,
    };

    // Set next action based on whether there's more capacity
    const nextPacing = pacingPlanner.canUploadNow(this._state.pacingPlan);
    if (!nextPacing.canUpload && nextPacing.nextSlotAt) {
      this._state.nextActionAt = nextPacing.nextSlotAt;
      await this._transitionTo('waiting_pacing', 'cycle_completed_slot_full');
    } else if (quotaCoordinator.getTotalUploadsLeft() <= 0) {
      this._state.nextActionAt = new Date(quotaCoordinator.computeEarliestReset()).toISOString();
      await this._transitionTo('waiting_quota', 'cycle_completed_quota_exhausted');
    } else {
      // Short cooldown before next cycle (prevent rapid-fire)
      this._state.nextActionAt = new Date(Date.now() + 5000).toISOString();
      await this._transitionTo('idle', 'cycle_completed');
    }
  }

  /**
   * Wait for uploadQueue to have 0 pending + 0 processing
   */
  _waitForQueueEmpty() {
    const uploadQueue = require('./queue');
    const maxWaitMs = C.SCHEDULER.QUEUE_WAIT_MAX_MS;
    const startedAt = Date.now();

    return new Promise(resolve => {
      const check = () => {
        const s = uploadQueue.getCounts();
        if ((s.pending || 0) + (s.processing || 0) === 0) {
          return resolve({ ok: true, waitedMs: Date.now() - startedAt });
        }
        if (Date.now() - startedAt > maxWaitMs) {
          return resolve({ ok: false, waitedMs: Date.now() - startedAt });
        }
        const t = setTimeout(check, C.SCHEDULER.QUEUE_POLL_MS);
        if (t.unref) t.unref();
      };
      check();
    });
  }

  async _handleCycleError(err) {
    // ★ Special case: cycle was paused by safety gate — not a real error
    if (err.message === 'CYCLE_PAUSED_SAFETY') {
      logger.warn('[Engine] Cycle paused by content safety gate');
      return;
    }

    this._state.consecutiveErrors++;
    this._state.lastError = {
      message: err.message?.slice(0, 500),
      at: new Date().toISOString(),
      phase: this._state.phase,
    };

    // Exponential backoff: min(60 × 2^(n-1), 1800) seconds
    const backoffSec = Math.min(60 * Math.pow(2, this._state.consecutiveErrors - 1), 1800);
    this._state.nextActionAt = new Date(Date.now() + backoffSec * 1000).toISOString();

    logger.error('[Engine] Cycle error', {
      error: err.message,
      consecutiveErrors: this._state.consecutiveErrors,
      backoffSec,
      nextActionAt: this._state.nextActionAt,
    });

    if (this._state.consecutiveErrors >= 5) {
      await this._transitionTo('degraded', 'consecutive_errors_threshold');
    } else {
      // Ensure we're in idle with backoff set
      if (this._state.phase !== 'idle') {
        await this._transitionTo('idle', 'cycle_error_backoff');
      } else {
        await this._persistState('cycle_error_backoff');
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Task 4: In-Flight Reconciliation on Boot
  // ════════════════════════════════════════════════════════════════

  async _reconcileInFlight() {
    if (!this._state.inFlight || this._state.inFlight.length === 0) return;

    const youtubeService = require('./youtube');
    const { uploads } = require('../utils/store');
    const { guarded } = require('../utils/resilience');

    logger.info('[Engine] Reconciling in-flight uploads from previous run', {
      count: this._state.inFlight.length,
    });

    const resolved = [];
    const unresolved = [];

    for (const entry of this._state.inFlight) {
      if (entry.reconcileAttempts >= 3) {
        // Move to manual review
        logger.warn('[Engine] In-flight entry exceeded reconcile attempts — moving to manual', entry);
        unresolved.push(entry);
        continue;
      }

      try {
        let found = false;

        if (entry.videoId) {
          // Case A: We have the videoId — verify directly (1 unit)
          const youtube = require('googleapis').google.youtube({
            version: 'v3',
            auth: youtubeService.getOAuth2Client(entry.accountId),
          });
          const resp = await guarded('youtube:channels', () =>
            youtube.videos.list({ part: 'id', id: entry.videoId }),
            { attempts: 2, timeoutMs: 15_000 }
          );
          found = resp?.data?.items?.length > 0;
        } else {
          // Case B: No videoId — check recent uploads by title match (2 units)
          const youtube = require('googleapis').google.youtube({
            version: 'v3',
            auth: youtubeService.getOAuth2Client(entry.accountId),
          });

          // Get uploads playlist
          const chResp = await guarded('youtube:channels', () =>
            youtube.channels.list({ part: 'contentDetails', mine: true }),
            { attempts: 2, timeoutMs: 15_000 }
          );
          const uploadsPlaylistId = chResp?.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

          if (uploadsPlaylistId) {
            const plResp = await guarded('youtube:channels', () =>
              youtube.playlistItems.list({
                part: 'snippet',
                playlistId: uploadsPlaylistId,
                maxResults: 50,
              }),
              { attempts: 2, timeoutMs: 15_000 }
            );

            const items = plResp?.data?.items || [];
            const startedAt = new Date(entry.startedAt);
            const match = items.find(item => {
              const title = item.snippet?.title;
              const publishedAt = new Date(item.snippet?.publishedAt || 0);
              return title === entry.title && publishedAt >= startedAt;
            });

            if (match) {
              entry.videoId = match.snippet?.resourceId?.videoId;
              found = true;
            }
          }
        }

        if (found) {
          // Record success
          await uploads.safeUpdate(arr => {
            // Check not already in uploads (invariant: max 1 per tiktok_video_id)
            if (arr.some(r => r.tiktok_video_id === entry.tiktok_video_id)) {
              return arr; // Already recorded (race condition protection)
            }
            arr.push({
              filename: require('path').basename(entry.filepath || ''),
              filepath: entry.filepath,
              youtube_id: entry.videoId,
              youtube_url: `https://www.youtube.com/watch?v=${entry.videoId}`,
              uploaded_at: entry.startedAt,
              source: 'tiktok_watchlist',
              source_url: entry.source_url,
              tiktok_video_id: entry.tiktok_video_id,
              title: entry.title,
              deleted: false,
              reconciled: true,
            });
            return arr;
          });
          resolved.push(entry);
          logger.info('[Engine] In-flight reconciled — upload confirmed on YouTube', {
            videoId: entry.videoId, title: entry.title,
          });
        } else {
          // Not found — increment attempts, will retry next boot or give up
          entry.reconcileAttempts++;
          if (entry.reconcileAttempts >= 3) {
            unresolved.push(entry);
          }
        }

      } catch (err) {
        logger.warn('[Engine] Reconcile check failed for entry', {
          uploadIntentId: entry.uploadIntentId, error: err.message,
        });
        entry.reconcileAttempts++;
        if (entry.reconcileAttempts >= 3) {
          unresolved.push(entry);
        }
      }
    }

    // Update inFlight: remove resolved + moved-to-manual entries
    const resolvedIds = new Set(resolved.map(e => e.uploadIntentId));
    const unresolvedIds = new Set(unresolved.map(e => e.uploadIntentId));
    this._state.inFlight = this._state.inFlight.filter(
      e => !resolvedIds.has(e.uploadIntentId) && !unresolvedIds.has(e.uploadIntentId)
    );

    // Store unresolved in a separate field for operator review
    if (unresolved.length > 0) {
      if (!this._state.manualReview) this._state.manualReview = [];
      this._state.manualReview.push(...unresolved);
      logger.warn('[Engine] Moved unresolvable in-flight entries to manual review', {
        count: unresolved.length,
      });
    }

    await this._persistState('inflight_reconciliation_complete');
    logger.info('[Engine] In-flight reconciliation done', {
      resolved: resolved.length,
      unresolved: unresolved.length,
      remaining: this._state.inFlight.length,
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Status & Events
  // ════════════════════════════════════════════════════════════════

  getStatus() {
    return {
      phase: this._state.phase,
      desiredState: this._state.desiredState,
      nextActionAt: this._state.nextActionAt,
      cycleCount: this._state.cycleCount,
      consecutiveErrors: this._state.consecutiveErrors,
      lastCycleSummary: this._lastCycleSummary || null,
      quota: this._getQuotaForStatus(),
      pacing: this._state.pacingPlan ? {
        day: this._state.pacingPlan.day,
        mode: this._state.pacingPlan.mode,
        dailyAllowance: this._state.pacingPlan.dailyAllowance,
        slotsUsed: this._state.pacingPlan.slots?.reduce((s, sl) => s + sl.usedUploads, 0) || 0,
      } : null,
      lastError: this._state.lastError,
      uptimeSeconds: Math.round(process.uptime()),
      instanceId: this._instanceId,
      instanceStartedAt: this._instanceStartedAt,
      lastHeartbeatAt: this._state.lastTickAt,
      heartbeatAgeSeconds: this._state.lastTickAt
        ? Math.round((Date.now() - new Date(this._state.lastTickAt).getTime()) / 1000)
        : null,
      inFlightCount: this._state.inFlight?.length || 0,
    };
  }

  _getQuotaForStatus() {
    try {
      const { quotaCoordinator } = require('./engine');
      return quotaCoordinator.getQuotaStatus();
    } catch (_) {
      return null;
    }
  }

  _dispatchStateChanged(from, to, reason) {
    const orchestrator = require('./orchestrator');
    const payload = {
      from, to, reason,
      nextActionAt: this._state.nextActionAt,
      transitionSeq: this._state.transitionSeq,
    };
    orchestrator.onEngineStateChanged(payload);
    this.emit('state_changed', payload);
  }

  _broadcastStatus() {
    if (this._broadcast) {
      this._broadcast('engine:status', this.getStatus());
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Task 29: Stuck Detection
  // ════════════════════════════════════════════════════════════════

  _checkStuck() {
    const BUDGETS = {
      discovering: 600_000,   // 10 min
      uploading:   3600_000,  // 60 min
      idle:        300_000,   // 5 min
      degraded:    2100_000,  // 35 min
      paused_health: 21600_000, // 6 hours
    };

    const phase = this._state.phase;
    const budget = BUDGETS[phase];
    if (!budget) return;

    const lastChange = this._state.updatedAt ? new Date(this._state.updatedAt).getTime() : Date.now();
    const elapsed = Date.now() - lastChange;

    if (elapsed > budget) {
      // Don't spam — max 1 stuck event per 1800s per phase
      const stuckKey = `stuck_${phase}`;
      if (this._lastStuckAlert && this._lastStuckAlert[stuckKey] && 
          (Date.now() - this._lastStuckAlert[stuckKey]) < 1800_000) {
        return;
      }
      if (!this._lastStuckAlert) this._lastStuckAlert = {};
      this._lastStuckAlert[stuckKey] = Date.now();

      const orchestrator = require('./orchestrator');
      orchestrator.onEngineStuck({
        phase,
        stuckForSeconds: Math.round(elapsed / 1000),
        lastActivityAt: this._state.updatedAt,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Utilities
  // ════════════════════════════════════════════════════════════════

  get phase() { return this._state.phase; }
  get desiredState() { return this._state.desiredState; }
  get cycleCount() { return this._state.cycleCount; }

  /** For compatibility with scheduler.getLoopState() */
  getLoopState() {
    return {
      running: this._cycleRunning,
      iteration: this._state.cycleCount,
      startedAt: this._instanceStartedAt,
      runningMinutes: Math.round((Date.now() - new Date(this._instanceStartedAt).getTime()) / 60_000),
      stopRequested: this._state.desiredState === 'stopped',
    };
  }
}

// ══════════════════════════════════════════════════════════════════
//  Exports
// ══════════════════════════════════════════════════════════════════

module.exports = new Engine();
module.exports.ENGINE_PHASES = ENGINE_PHASES;
module.exports.TRANSITION_TABLE = TRANSITION_TABLE;
module.exports.DEFAULT_ENGINE_STATE = DEFAULT_ENGINE_STATE;
module.exports.TICK_MS = TICK_MS;
