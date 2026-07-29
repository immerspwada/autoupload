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

/** ★ คำอธิบายภาษาคนสำหรับ UI — ให้รู้ทันทีว่าระบบกำลังทำอะไร */
const PHASE_LABELS = Object.freeze({
  stopped:        'หยุดทำงาน',
  idle:           'ว่าง — รอเริ่มรอบใหม่',
  discovering:    'กำลังค้นหาคลิป',
  uploading:      'กำลังอัปโหลดขึ้น YouTube',
  waiting_quota:  'รอ quota รีเซ็ต',
  waiting_pacing: 'รอช่วงเวลาอัปโหลดถัดไป',
  paused_health:  'พักเพราะระบบไม่พร้อม (ดิสก์/หน่วยความจำ)',
  paused_manual:  'พักโดยผู้ใช้/ตัวกรองความปลอดภัย',
  degraded:       'ผิดพลาดต่อเนื่อง — กำลังลองใหม่',
});

const PHASE_ICONS = Object.freeze({
  stopped: '⏹️', idle: '💤', discovering: '🔍', uploading: '⬆️',
  waiting_quota: '⏳', waiting_pacing: '🕐', paused_health: '🩺',
  paused_manual: '⏸️', degraded: '⚠️',
});

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
  // ★ Observability — "ตอนนี้กำลังทำอะไร"
  phaseEnteredAt: null,   // เข้า phase นี้เมื่อไร (ไม่ถูกรีเซ็ตโดย heartbeat)
  lastProgressAt: null,   // ความคืบหน้าจริงครั้งล่าสุด (step ล่าสุด)
  currentStep: null,      // { type, message, at, ... }
  recentSteps: [],        // trail ล่าสุด (persist ไว้ให้รอดรีสตาร์ท)
  lastCycleSummary: null, // สรุปรอบล่าสุด (เดิมอยู่แต่ใน memory → หายทุกรีสตาร์ท)
  stallRecoveries: 0,     // จำนวนครั้งที่ watchdog ต้องเข้าไปปลดล็อก
});

// Supervisor tick interval (configurable via env for testing)
const TICK_MS = C.ENGINE.TICK_MS;
const E = C.ENGINE;

/** ★ Sub-managers — ต้องเป็น './engine/index' ไม่ใช่ './engine'
 *  ('./engine' จาก src/services/ resolve กลับมาที่ engine.js ตัวเอง → undefined ทั้งหมด) */
function managers() {
  return require('./engine/index');
}

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

    // ★ Live activity trail — ring buffer ของ step ("กำลังทำอะไรอยู่")
    this._steps = [];
    this._stepSeq = 0;
    this._lastBroadcastAt = 0;
    this._lastStuckAlert = {};
    this._cycleStartedAt = null;
    this._cycleAbort = false;
  }

  // ════════════════════════════════════════════════════════════════
  //  ★ Activity Trail — "ตอนนี้กำลังทำอะไร"
  // ════════════════════════════════════════════════════════════════

  /**
   * บันทึกความคืบหน้า 1 ก้าว → ring buffer + currentStep + broadcast
   * ทุกก้าวอัปเดต lastProgressAt ซึ่งเป็นตัววัด "นิ่ง" ของ watchdog
   * ไม่เขียนดิสก์เอง — step จะติดไปกับ _persistState() ครั้งถัดไป (กัน I/O ถี่)
   */
  _step(type, message, extra = {}) {
    const step = {
      seq: ++this._stepSeq,
      type,
      message,
      at: new Date().toISOString(),
      phase: this._state.phase,
      cycle: this._state.cycleCount + (this._cycleRunning ? 1 : 0),
      ...extra,
    };

    this._steps.push(step);
    if (this._steps.length > E.STEP_HISTORY_MAX) {
      this._steps.splice(0, this._steps.length - E.STEP_HISTORY_MAX);
    }

    this._state.currentStep  = step;
    this._state.lastProgressAt = step.at;

    logger.debug('[Engine] ' + message, { type });

    this.emit('activity', step);
    if (this._broadcast) {
      try { this._broadcast('engine:activity', step); } catch (_) {}
    }
    this._broadcastStatus();

    return step;
  }

  /** trail ล่าสุด (ใหม่ → เก่า) */
  getActivity(limit = 100) {
    const n = Math.max(1, Math.min(parseInt(limit) || 100, E.STEP_HISTORY_MAX));
    return this._steps.slice(-n).reverse();
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

    // ★ กู้ trail เดิมกลับมา — เปิดหน้าเว็บใหม่/รีสตาร์ทแล้วยังเห็นว่าก่อนหน้าทำอะไรค้างไว้
    if (Array.isArray(this._state.recentSteps)) {
      this._steps = this._state.recentSteps.slice(-E.STEP_HISTORY_MAX);
      this._stepSeq = this._steps.length ? (this._steps[this._steps.length - 1].seq || 0) : 0;
    }
    this._step('boot', `🔌 Engine เริ่มทำงาน — phase=${this._state.phase}, ต้องการ=${this._state.desiredState}`, {
      instanceId: this._instanceId,
      cycleCount: this._state.cycleCount,
    });

    // ★ Task 4: Reconcile in-flight uploads from previous run
    if (this._state.inFlight && this._state.inFlight.length > 0) {
      this._step('reconcile', `🔍 ตรวจงานค้างจากรอบก่อน ${this._state.inFlight.length} รายการ`);
      // Run reconciliation in background (don't block init)
      this._reconcileInFlight().catch(err => {
        logger.error('[Engine] In-flight reconciliation error', { error: err.message });
        this._step('error', `ตรวจงานค้างล้มเหลว: ${err.message}`);
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

    // ★ Crash resilience — ถ้าครั้งก่อน operator สั่ง "running" ไว้ ต้องกลับมาวิ่งเอง
    //   ไม่ต้องรอให้เปิดเบราว์เซอร์หรือกดปุ่มใหม่ (นี่คือหัวใจของ "ทำงานได้เสมอ")
    const settings = require('../utils/store').settings.loadRef();
    const resumeAfterRestart = this._state.desiredState === 'running';
    const forceStartOnBoot   = settings.engine?.autoStartOnBoot === true;

    if (resumeAfterRestart || forceStartOnBoot) {
      const why = resumeAfterRestart ? 'desiredState=running (กู้จากรอบก่อน)' : 'autoStartOnBoot=true';
      logger.info('[Engine] Auto-start on boot', { reason: why });
      this._step('resume', `♻️ กลับมาทำงานอัตโนมัติ — ${why}`);
      this.start().catch(err => {
        logger.error('[Engine] Auto-start failed', { error: err.message });
        this._step('error', `เริ่มอัตโนมัติล้มเหลว: ${err.message}`);
      });
    } else {
      this._step('idle', '⏸️ Engine หยุดอยู่ — กด "เริ่มทำงาน" เพื่อให้ระบบวิ่งเอง 24/7');
    }
  }

  /**
   * ★ เรียกจาก orchestrator เมื่อ health เปลี่ยน — ปลด paused_health ให้อัตโนมัติ
   *   เดิม arm 'paused_health' ใน supervisor เป็น stub เปล่า → ค้างถาวรจนคนมากด
   */
  onHealthChanged(overall) {
    if (overall === 'critical') return;
    if (this._state.phase !== 'paused_health') return;
    if (this._state.desiredState !== 'running') return;

    this._step('recover', `💚 ระบบกลับมาปกติ (${overall}) — ปลด paused_health`);
    this._state.nextActionAt = null;
    this._transitionTo('idle', 'health_recovered').catch(err => {
      logger.error('[Engine] Health recovery transition failed', { error: err.message });
    });
  }

  /**
   * ★ สั่งให้เริ่มรอบใหม่ทันที (ข้าม backoff/คูลดาวน์) — ใช้จากปุ่ม "รันเดี๋ยวนี้"
   */
  async kick(reason = 'operator_kick') {
    if (this._state.desiredState !== 'running') await this.start();
    this._state.nextActionAt = null;
    this._state.consecutiveErrors = 0;
    await this._persistState(reason);
    this._step('kick', '⚡ สั่งเริ่มรอบใหม่ทันที');

    if (this._state.phase !== 'idle' && TRANSITION_TABLE.get(this._state.phase)?.has('idle')) {
      await this._transitionTo('idle', reason);
    }
    if (!this._cycleRunning && this._state.phase === 'idle') this._startCycle();
    return this.getStatus();
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
    this._step('start', '▶️ สั่งเริ่มทำงาน — ระบบจะวิ่งเองต่อเนื่องแม้ปิดเบราว์เซอร์');

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
    this._step('stop', this._cycleRunning
      ? '⏹️ สั่งหยุด — รอรอบปัจจุบันจบก่อน'
      : '⏹️ สั่งหยุดทำงาน');

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

    this._step('pause', '⏸️ พักชั่วคราว (กด "เริ่มทำงาน" เพื่อไปต่อ)');
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
    // ★ บันทึกร่องรอยสุดท้าย — รอบหน้าที่บูตจะรู้ว่าดับตอนกำลังทำอะไร
    this._step('shutdown', `🔻 ปิดระบบระหว่าง phase=${this._state.phase}` +
      (this._cycleRunning ? ' (รอบกำลังทำงาน — จะกู้ต่อเมื่อบูตใหม่)' : ''));
    this._cycleAbort = true;
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
      const prevPhaseEnteredAt = this._state.phaseEnteredAt;
      this._state.phase = to;
      this._state.transitionSeq++;
      this._state.updatedAt = new Date().toISOString();
      // ★ phaseEnteredAt แยกจาก updatedAt เพราะ updatedAt ถูกทับทุก heartbeat
      //   (เดิม _checkStuck() วัดจาก updatedAt → ไม่เคยตรวจจับอะไรได้เลย)
      this._state.phaseEnteredAt = this._state.updatedAt;

      // Persist BEFORE any side effects
      const persistOk = await this._persistState(`transition ${from}→${to}: ${reason}`);
      if (!persistOk) {
        // Rollback in-memory
        this._state.phase = from;
        this._state.transitionSeq--;
        this._state.phaseEnteredAt = prevPhaseEnteredAt;
        logger.error('[Engine] Transition rolled back (persist failed)', { from, to });
        return false;
      }

      this._step('phase', `${PHASE_ICONS[to] || '•'} ${PHASE_LABELS[to] || to}`, {
        from, to, reason, nextActionAt: this._state.nextActionAt,
      });

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
      if (!this._state.phaseEnteredAt) this._state.phaseEnteredAt = this._state.updatedAt;
      // ★ trail ติดไปกับ write ที่มีอยู่แล้ว — ไม่เพิ่ม I/O รอบพิเศษ
      this._state.recentSteps = this._steps.slice(-E.STEP_PERSIST_MAX);
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
      this._step('warn', `⏱️ ตรวจพบ runtime หยุดไป ${Math.round(gapMs / 60000)} นาที — กำลังไล่สถานะให้ทัน`, { gapMs });
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
        const { retentionManager } = managers();
        retentionManager.createDailyBackup();
        this._lastBackupAt = now;
        this._step('backup', '💾 สำรองข้อมูลรายวันเรียบร้อย');
      } catch (err) {
        logger.error('[Engine] Daily backup failed', { error: err.message });
        this._step('warn', `สำรองข้อมูลล้มเหลว: ${err.message}`);
      }
    }

    // Update heartbeat
    this._state.lastTickAt = now.toISOString();
    // Persist heartbeat periodically (not every tick to reduce I/O)
    // Every 60s is fine since tick IS 60s
    await this._persistState('tick');

    // ★ Broadcast ทุก tick แม้จะหยุดอยู่ — UI ต้องไม่เคยมืด
    //   (เดิม return ก่อนถึงบรรทัด broadcast → หน้าเว็บเงียบสนิทเวลา stopped)
    this._broadcastStatus({ force: true });

    // ★ Watchdog — ทำงานทุกสถานะ รวมถึงตอนที่ควรจะหยุด
    await this._watchdog(now);

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
        // ★ ปลดล็อกเองเมื่อดิสก์ว่างแล้ว (นอกจากนี้ orchestrator ยังเรียก onHealthChanged ให้)
        const nextAction = this._state.nextActionAt ? new Date(this._state.nextActionAt) : null;
        if (!nextAction || now >= nextAction) {
          if (this._probeDiskOk()) {
            this._step('recover', '💚 ดิสก์ว่างพอแล้ว — กลับมาทำงานต่อ');
            this._state.nextActionAt = null;
            await this._transitionTo('idle', 'disk_recovered');
          } else {
            this._state.nextActionAt = new Date(now.getTime() + E.HEALTH_RECHECK_MS).toISOString();
            await this._persistState('health_recheck_scheduled');
            this._step('wait', `🩺 ดิสก์ยังไม่ว่าง — เช็คใหม่ในอีก ${Math.round(E.HEALTH_RECHECK_MS / 60000)} นาที`);
          }
        }
        break;
      }

      case 'stopped':
      case 'paused_manual':
        // Do nothing, wait for operator
        break;

      case 'discovering':
      case 'uploading':
        // ทำงานอยู่ — stuck detection อยู่ใน _watchdog แล้ว (ครอบทุก phase)
        break;
    }

    // Broadcast status (throttled — WS clients get updates)
    this._broadcastStatus({ force: true });
  }

  // ════════════════════════════════════════════════════════════════
  //  ★ Watchdog — รับประกันว่าไม่มีสถานะไหน "นิ่งถาวร"
  // ════════════════════════════════════════════════════════════════

  async _watchdog(now = new Date()) {
    try {
      const st = this._state;

      // 1) ต้องการวิ่งแต่ค้างที่ stopped → ดันเข้า idle
      if (st.desiredState === 'running' && st.phase === 'stopped') {
        this._step('heal', '🔧 Watchdog: ต้องการทำงานแต่ค้างที่ stopped — เริ่มใหม่ให้');
        await this._transitionTo('idle', 'watchdog_desired_running');
        return;
      }

      // 2) สั่งหยุดแล้วรอบจบไปแล้ว → ปิดให้เรียบร้อย
      if (st.desiredState === 'stopped' && st.phase !== 'stopped' && !this._cycleRunning) {
        await this._transitionTo('stopped', 'watchdog_desired_stopped');
        return;
      }

      // 3) ★ รอบค้าง — ไม่มีความคืบหน้าเกินเพดาน → บังคับปลดล็อก
      //    นี่คือกรณี "กดรันแล้วเงียบ" ที่แก้ไม่ได้ด้วยตัวเองมาก่อน
      if (this._cycleRunning) {
        const lastProgress = st.lastProgressAt ? new Date(st.lastProgressAt).getTime()
                                               : (this._cycleStartedAt || now.getTime());
        const stalledMs = now.getTime() - lastProgress;
        if (stalledMs > E.CYCLE_STALL_MS) {
          await this._forceUnstick(stalledMs);
          return;
        }
      }

      // 4) idle แต่ไม่มีนัดหมาย และไม่มีรอบวิ่ง → เริ่มรอบเลย
      if (st.desiredState === 'running' && st.phase === 'idle' && !this._cycleRunning) {
        const nextAction = st.nextActionAt ? new Date(st.nextActionAt) : null;
        if (nextAction && (now - nextAction) > E.STUCK_BUDGET_MS.idle) {
          this._step('heal', '🔧 Watchdog: นัดหมายเลยกำหนดมานาน — เริ่มรอบใหม่ทันที');
          st.nextActionAt = null;
          this._startCycle();
          return;
        }
      }

      // 5) waiting_* ที่เลยเวลานัดหมายไปนานเกิน grace → ดันเข้า idle
      if ((st.phase === 'waiting_quota' || st.phase === 'waiting_pacing') && st.nextActionAt) {
        const overdueMs = now - new Date(st.nextActionAt);
        if (overdueMs > E.WAITING_GRACE_MS) {
          this._step('heal', `🔧 Watchdog: ${st.phase} เลยกำหนด ${Math.round(overdueMs / 60000)} นาที — ปลดเข้า idle`);
          await this._transitionTo('idle', 'watchdog_waiting_overdue');
          return;
        }
      }

      // 6) แจ้งเตือน stuck ตามงบเวลาแต่ละ phase
      this._checkStuck(now);

    } catch (err) {
      logger.error('[Engine] Watchdog error', { error: err.message });
    }
  }

  /**
   * บังคับปลดล็อกรอบที่ค้าง — ปล่อย flag, ตั้ง backoff, แจ้ง operator
   * รอบซอมบี้ (ถ้ายังวิ่งอยู่จริง) จะเห็น _cycleAbort และหยุดเองที่ checkpoint ถัดไป
   */
  async _forceUnstick(stalledMs) {
    const mins = Math.round(stalledMs / 60000);
    logger.error('[Engine] Cycle stalled — forcing recovery', { stalledMs, phase: this._state.phase });

    this._cycleAbort   = true;
    this._cycleRunning = false;
    this._state.stallRecoveries = (this._state.stallRecoveries || 0) + 1;
    this._state.lastError = {
      message: `Cycle stalled ${mins} นาทีใน phase ${this._state.phase} — watchdog รีเซ็ตให้`,
      at: new Date().toISOString(),
      phase: this._state.phase,
    };
    this._state.nextActionAt = new Date(Date.now() + 60_000).toISOString();

    this._step('heal', `🔧 Watchdog: รอบค้าง ${mins} นาที — รีเซ็ตและเริ่มใหม่ในอีก 1 นาที`, { stalledMs });

    const orchestrator = require('./orchestrator');
    orchestrator.onEngineStuck({
      phase: this._state.phase,
      stuckForSeconds: Math.round(stalledMs / 1000),
      lastActivityAt: this._state.lastProgressAt,
      recovered: true,
    });

    if (TRANSITION_TABLE.get(this._state.phase)?.has('idle')) {
      await this._transitionTo('idle', 'watchdog_force_unstick');
    } else {
      await this._persistState('watchdog_force_unstick');
    }
  }

  /** เช็คพื้นที่ดิสก์แบบเบา ๆ สำหรับปลด paused_health */
  _probeDiskOk() {
    try {
      const diskGuard = require('../utils/diskGuard');
      return diskGuard.check(C.TIKTOK.MAX_DOWNLOAD_BYTES, { label: 'engine health probe' }).ok;
    } catch (err) {
      logger.warn('[Engine] Disk probe failed', { error: err.message });
      return false;
    }
  }

  /** จุด checkpoint ให้รอบที่กำลังวิ่งยอมหยุดเมื่อถูกสั่งหยุด/ถูกปลดล็อก */
  _shouldAbortCycle() {
    return this._cycleAbort || this._state.desiredState !== 'running';
  }

  // ════════════════════════════════════════════════════════════════
  //  Cycle (full implementation — Task 9)
  // ════════════════════════════════════════════════════════════════

  _startCycle() {
    if (this._cycleRunning) return;
    this._cycleRunning = true;
    this._cycleAbort = false;
    this._cycleStartedAt = Date.now();

    const cycleNo = this._state.cycleCount + 1;
    this._step('cycle_start', `🚀 เริ่มรอบที่ ${cycleNo}`);
    require('./orchestrator').onEngineCycleStarted({
      cycle: cycleNo,
      startedAt: new Date(this._cycleStartedAt).toISOString(),
      phase: this._state.phase,
    });

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
    const { quotaCoordinator, pacingPlanner, safetyGate, retentionManager } = managers();
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
    this._step('preflight', '🧹 ตรวจก่อนเริ่ม — ล้างไฟล์เก่า + เช็คพื้นที่ดิสก์');
    retentionManager.run();

    // Disk guard with cleanup loop (max 2 rounds)
    for (let attempt = 0; attempt < 2; attempt++) {
      const space = diskGuard.check(C.TIKTOK.MAX_DOWNLOAD_BYTES, { label: 'engine cycle' });
      if (space.ok) break;
      if (attempt === 0) {
        logger.warn('[Engine] Disk low — running retention');
        this._step('warn', '💽 ดิสก์เหลือน้อย — ล้างไฟล์ชั่วคราวก่อน');
        retentionManager.run();
      } else {
        // Still full after cleanup
        this._step('blocked', '🩺 ดิสก์ยังไม่พอหลังล้างแล้ว — พักและเช็คใหม่ใน 15 นาที');
        this._state.nextActionAt = new Date(Date.now() + E.HEALTH_RECHECK_MS).toISOString();
        await this._transitionTo('paused_health', 'disk_full');
        return; // Cycle aborted — supervisor will resume when space recovers
      }
    }

    if (this._shouldAbortCycle()) {
      this._step('abort', '⏹️ ยกเลิกรอบ — มีคำสั่งหยุด');
      return;
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
        this._step('wait', `⏳ ครบโควตาวันนี้แล้ว — รอรีเซ็ต ${this._fmtTime(this._state.nextActionAt)}`);
        require('./orchestrator').onEngineQuotaWait({
          reason: 'daily_limit_reached', nextActionAt: this._state.nextActionAt,
        });
        await this._transitionTo('waiting_quota', 'daily_limit_reached');
      } else {
        // Wait for next slot
        this._state.nextActionAt = pacingCheck.nextSlotAt || new Date(Date.now() + C.SCHEDULER.LOOP_COOLDOWN_MS).toISOString();
        this._step('wait', `🕐 ยังไม่ถึงช่วงอัปโหลดถัดไป — รอถึง ${this._fmtTime(this._state.nextActionAt)}`);
        await this._transitionTo('waiting_pacing', 'slot_full');
      }
      return;
    }

    // ── 3. Quota pre-check ────────────────────────────────────────
    const account = quotaCoordinator.selectAccount();
    if (!account) {
      this._state.nextActionAt = new Date(quotaCoordinator.computeEarliestReset()).toISOString();
      this._step('wait', `⏳ ทุกบัญชี quota หมด — รอรีเซ็ต ${this._fmtTime(this._state.nextActionAt)}`);
      require('./orchestrator').onEngineQuotaWait({
        reason: 'all_accounts_exhausted', nextActionAt: this._state.nextActionAt,
      });
      await this._transitionTo('waiting_quota', 'all_accounts_exhausted');
      return;
    }
    this._state.currentAccountId = account.accountId;
    this._step('account', `👤 ใช้บัญชี ${account.name || account.accountId} (เหลือ ${account.uploadsLeft ?? '?'} คลิป)`, {
      accountId: account.accountId,
    });

    // ── 4. Discovery via watchlist ────────────────────────────────
    await this._transitionTo('discovering', 'cycle_discovery_start');
    safetyGate.resetCycleStats();

    let totalQueued = 0;
    let skipReasons = {};
    const SKIP = (reason) => { skipReasons[reason] = (skipReasons[reason] || 0) + 1; };

    // ★ สะท้อน step ของ watchlist เข้า trail ของ engine — user เห็นว่ากำลังค้นคำไหน
    const mirrorWatchlist = (state) => {
      const s = state?.lastStep;
      if (!s) return;
      if (!['search', 'found', 'complete', 'error', 'warn'].includes(s.type)) return;
      this._step(s.type === 'error' ? 'error' : 'discover', s.message, { via: 'watchlist' });
    };
    watchlist.on('progress', mirrorWatchlist);

    let cycleResult;
    try {
    cycleResult = await watchlist.runAll(async ({ video, keyword }) => {
      // ★ มีคำสั่งหยุด/watchdog ปลดล็อก → เลิกกลางคัน
      if (this._shouldAbortCycle()) {
        SKIP('aborted');
        return;
      }

      // ★ Safety Gate — monetization + duplicate + score
      const gate = safetyGate.check(video, { minScore, autonomousAllowWarned: allowWarned });
      if (!gate.pass) {
        SKIP(gate.reason);
        this._step('skip', `⏭️ ข้าม (${gate.reason}): ${this._clip(video.desc || keyword)}`);
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
        this._step('download', `⬇️ ดาวน์โหลด: ${this._clip(video.desc || keyword)}`, { score: gate.score });
        downloaded = await tiktokService.downloadNoWatermark(video.videoUrl, suggestedFilename);
      } catch (dlErr) {
        logger.warn('[Engine] Download failed — skipping clip', { error: dlErr.message });
        SKIP('download_failed');
        this._step('skip', `⏭️ ดาวน์โหลดล้มเหลว: ${dlErr.message}`);
        return;
      }

      // ── Transform (mandatory in autonomous mode) ────────────────
      let transformResult;
      try {
        this._step('transform', `🎬 แปลงวิดีโอ (กัน reused content): ${downloaded.filename}`);
        transformResult = await videoTransform.transformSingle(downloaded.filepath, {
          overlay: { text: video.desc?.substring(0, 50) || keyword },
          watermark: { text: config.channelName || '' },
        });
      } catch (tfErr) {
        logger.warn('[Engine] Transform error — skipping clip', { error: tfErr.message });
        SKIP('transform_failed');
        this._step('skip', `⏭️ แปลงวิดีโอล้มเหลว: ${tfErr.message}`);
        try { const fs = require('fs'); if (fs.existsSync(downloaded.filepath)) fs.unlinkSync(downloaded.filepath); } catch (_) {}
        return;
      }

      if (!transformResult.transformed) {
        SKIP('transform_failed');
        this._step('skip', '⏭️ แปลงวิดีโอไม่สำเร็จ — ข้ามคลิปนี้');
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
      this._step('queue', `📤 เข้าคิวอัปโหลด: ${this._clip(metadata.title, 60)}`, {
        score: gate.score, accountId: clipAccount.accountId,
      });

      uploadQueue.add(async () => {
        const youtubeService = require('./youtube');
        this._step('upload', `⬆️ กำลังอัปขึ้น YouTube: ${this._clip(metadata.title, 60)}`);

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
        this._step('uploaded', `✅ อัปโหลดสำเร็จ: ${result.youtubeUrl}`, { videoId: result.videoId });

        // Cleanup files
        const fs = require('fs');
        try { if (fs.existsSync(downloaded.filepath)) fs.unlinkSync(downloaded.filepath); } catch (_) {}
        try { if (uploadFilepath !== downloaded.filepath && fs.existsSync(uploadFilepath)) fs.unlinkSync(uploadFilepath); } catch (_) {}

        return result;
      }, { filename: suggestedFilename, source: 'tiktok_watchlist' });

      totalQueued++;
    });
    } finally {
      watchlist.off('progress', mirrorWatchlist);
    }

    // ── 5. Wait for queue to drain ────────────────────────────────
    if (totalQueued > 0) {
      await this._transitionTo('uploading', 'waiting_queue_drain');
      this._step('wait_queue', `⏳ รอคิวอัปโหลด ${totalQueued} คลิปให้เสร็จ`);
      const drained = await this._waitForQueueEmpty();
      if (!drained.ok) {
        // Queue stuck — cancel remaining and treat as cycle error
        this._step('error', `⛔ คิวไม่ขยับเกิน ${Math.round(drained.waitedMs / 60000)} นาที — ล้างคิวและเริ่มใหม่`);
        uploadQueue.clear();
        throw new Error(`Queue wait timeout after ${drained.waitedMs}ms`);
      }
    } else {
      this._step('info', 'ℹ️ รอบนี้ไม่มีคลิปที่ผ่านเกณฑ์');
    }

    // ── 6. Post-cycle summary ─────────────────────────────────────
    retentionManager.run();

    this._state.cycleCount++;
    this._state.consecutiveErrors = 0;
    this._state.lastError = null;
    const summary = {
      cycle: this._state.cycleCount,
      completedAt: new Date().toISOString(),
      durationSeconds: this._cycleStartedAt
        ? Math.round((Date.now() - this._cycleStartedAt) / 1000) : null,
      found: (cycleResult?.queued || 0) + (cycleResult?.skipped || 0),
      queued: totalQueued,
      skipped: cycleResult?.skipped || 0,
      skipReasons,
      accountUsed: this._state.currentAccountId,
    };
    this._state.lastCycleSummary = summary;
    this._lastCycleSummary = summary;

    this._step('cycle_done',
      `🏁 รอบที่ ${summary.cycle} เสร็จ — อัป ${summary.queued}, ข้าม ${summary.skipped} (${summary.durationSeconds}s)`,
      { summary });

    // ★ ให้ EventBus rule เขียน activity log (requirement: cycle summary ต้องลง log)
    require('./orchestrator').onEngineCycleCompleted({
      cycleCount: summary.cycle,
      queued: summary.queued,
      skipped: summary.skipped,
      skipReasons,
      durationSeconds: summary.durationSeconds,
      accountUsed: summary.accountUsed,
    });

    // ★ ถูกสั่งหยุดระหว่างรอบ → ปิดให้เรียบร้อยตรงนี้ (เดิมค้างรอ watchdog)
    if (this._state.desiredState !== 'running') {
      await this._transitionTo('stopped', 'cycle_completed_while_stopping');
      return;
    }

    // Set next action based on whether there's more capacity
    const nextPacing = pacingPlanner.canUploadNow(this._state.pacingPlan);
    if (!nextPacing.canUpload && nextPacing.nextSlotAt) {
      this._state.nextActionAt = nextPacing.nextSlotAt;
      await this._transitionTo('waiting_pacing', 'cycle_completed_slot_full');
    } else if (quotaCoordinator.getTotalUploadsLeft() <= 0) {
      this._state.nextActionAt = new Date(quotaCoordinator.computeEarliestReset()).toISOString();
      require('./orchestrator').onEngineQuotaWait({
        reason: 'cycle_completed_quota_exhausted', nextActionAt: this._state.nextActionAt,
      });
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
      this._step('blocked', '🛑 หยุดรอบ — สัดส่วนคลิปเสี่ยงสูงเกินไป (ป้องกัน demonetize)');
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

    this._step('error', `❌ รอบล้มเหลว (ครั้งที่ ${this._state.consecutiveErrors}): ${err.message}` +
      ` — ลองใหม่ในอีก ${Math.round(backoffSec / 60)} นาที`, { backoffSec });

    if (this._state.consecutiveErrors >= 5) {
      // ★ เดิมไม่มีใคร dispatch → rule engine:degraded เป็น dead code
      require('./orchestrator').onEngineDegraded({
        consecutiveErrors: this._state.consecutiveErrors,
        lastError: this._state.lastError,
        nextActionAt: this._state.nextActionAt,
      });
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
    const now = Date.now();
    const ageSec = (iso) => iso ? Math.round((now - new Date(iso).getTime()) / 1000) : null;
    const heartbeatAge = ageSec(this._state.lastTickAt);
    const stalledSeconds = ageSec(this._state.lastProgressAt);

    return {
      phase: this._state.phase,
      phaseLabel: PHASE_LABELS[this._state.phase] || this._state.phase,
      phaseIcon: PHASE_ICONS[this._state.phase] || '•',
      desiredState: this._state.desiredState,
      nextActionAt: this._state.nextActionAt,
      nextActionInSeconds: this._state.nextActionAt
        ? Math.round((new Date(this._state.nextActionAt).getTime() - now) / 1000)
        : null,
      cycleCount: this._state.cycleCount,
      cycleRunning: this._cycleRunning,
      consecutiveErrors: this._state.consecutiveErrors,

      // ★ "ตอนนี้กำลังทำอะไร"
      currentStep: this._state.currentStep || null,
      phaseEnteredAt: this._state.phaseEnteredAt,
      lastProgressAt: this._state.lastProgressAt,
      stalledSeconds,
      stallRecoveries: this._state.stallRecoveries || 0,

      // ★ สรุปรอบล่าสุด — อ่านจาก state ที่ persist แล้ว (รอดรีสตาร์ท)
      lastCycleSummary: this._state.lastCycleSummary || this._lastCycleSummary || null,

      // ★ liveness: alive = tick ยังเดิน, stalled = tick เดินแต่งานไม่คืบ
      liveness: {
        alive: heartbeatAge !== null && heartbeatAge <= E.HEARTBEAT_DEAD_SEC,
        heartbeatAgeSeconds: heartbeatAge,
        deadAfterSeconds: E.HEARTBEAT_DEAD_SEC,
        tickMs: TICK_MS,
        stalled: this._cycleRunning && stalledSeconds !== null && (stalledSeconds * 1000) > E.CYCLE_STALL_MS,
      },
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
      const { quotaCoordinator } = managers();
      return quotaCoordinator.getQuotaStatus();
    } catch (err) {
      logger.warn('[Engine] Quota status unavailable', { error: err.message });
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

  /**
   * ★ push สถานะไปหน้าเว็บ — throttle ป้องกัน WS spam ตอน step ถี่
   *   force = true สำหรับ tick/transition (ต้องถึงมือ client แน่ ๆ)
   */
  _broadcastStatus({ force = false } = {}) {
    if (!this._broadcast) return;
    const now = Date.now();
    if (!force && (now - this._lastBroadcastAt) < E.BROADCAST_MIN_MS) return;
    this._lastBroadcastAt = now;
    try {
      this._broadcast('engine:status', this.getStatus());
    } catch (err) {
      logger.warn('[Engine] Status broadcast failed', { error: err.message });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Task 29: Stuck Detection
  // ════════════════════════════════════════════════════════════════

  /**
   * ★ วัดจาก lastProgressAt / phaseEnteredAt (ไม่ใช่ updatedAt ที่ heartbeat ทับทุกนาที)
   *   ครอบทุก phase ที่ควรคืบหน้า — ยกเว้น stopped / paused_manual (เจตนาของคน)
   */
  _checkStuck(now = new Date()) {
    const phase = this._state.phase;
    if (phase === 'stopped' || phase === 'paused_manual') return;
    if (this._state.desiredState !== 'running') return;

    const budget = E.STUCK_BUDGET_MS[phase];
    let elapsed, reference;

    if (budget) {
      // ใช้ความคืบหน้าจริงเป็นตัววัด ถ้ามี ไม่งั้นใช้เวลาที่เข้า phase
      const progressAt = this._state.lastProgressAt || this._state.phaseEnteredAt;
      const phaseAt    = this._state.phaseEnteredAt || this._state.updatedAt;
      reference = (progressAt && phaseAt)
        ? new Date(Math.max(new Date(progressAt).getTime(), new Date(phaseAt).getTime()))
        : new Date(progressAt || phaseAt || now);
      elapsed = now - reference;
      if (elapsed <= budget) return;

    } else if ((phase === 'waiting_quota' || phase === 'waiting_pacing') && this._state.nextActionAt) {
      // phase ที่รอเวลา: stuck = เลย nextActionAt + grace
      reference = new Date(this._state.nextActionAt);
      elapsed = now - reference;
      if (elapsed <= E.WAITING_GRACE_MS) return;

    } else {
      return;
    }

    // ห้ามสแปม — 1 event ต่อ phase ต่อ cooldown
    const key = `stuck_${phase}`;
    if (this._lastStuckAlert[key] && (now - this._lastStuckAlert[key]) < E.STUCK_ALERT_COOLDOWN_MS) return;
    this._lastStuckAlert[key] = now.getTime();

    this._step('warn', `🔒 ค้างที่ "${PHASE_LABELS[phase] || phase}" มา ${Math.round(elapsed / 60000)} นาที`, {
      stuckPhase: phase, stuckForSeconds: Math.round(elapsed / 1000),
    });

    const orchestrator = require('./orchestrator');
    orchestrator.onEngineStuck({
      phase,
      stuckForSeconds: Math.round(elapsed / 1000),
      lastActivityAt: reference.toISOString(),
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Utilities
  // ════════════════════════════════════════════════════════════════

  get phase() { return this._state.phase; }
  get desiredState() { return this._state.desiredState; }
  get cycleCount() { return this._state.cycleCount; }

  /** ตัดข้อความยาวสำหรับ step message */
  _clip(text, max = 45) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : (s || '(ไม่มีชื่อ)');
  }

  /** เวลาแบบอ่านง่าย (Asia/Bangkok) */
  _fmtTime(iso) {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { return iso; }
  }

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
