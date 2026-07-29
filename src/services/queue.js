/**
 * ★ Advanced Upload Queue
 *
 * แก้ไขรอบล่าสุด (stability hardening):
 * 1. [CRITICAL] active counter ติดลบได้ถ้า reset()/clear() ชนกับ retry timer
 *               → over-admit task พร้อมกันเกิน concurrency
 * 2. [CRITICAL] drain ยิงซ้ำทุกครั้งที่ _process() จบตอนคิวว่าง (รวม resume() คิวว่าง)
 *               → notification/cleanup ซ้ำ
 * 3. [HIGH]     timeout ไม่ยกเลิกงานจริง → งานเดิมวิ่งต่อพร้อมงานใหม่ = quota เสียซ้ำ
 * 4. [HIGH]     getStatus() serialize คิวทั้งก้อนทุก progress event → CPU ไหม้ตอนคิวยาว
 * 5. [MED]      ไม่มี item.startedAt/finishedAt สำหรับวัด throughput
 */
const EventEmitter = require('events');
const logger = require('../utils/logger');
const C      = require('../config/constants');

class UploadQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency  = options.concurrency  || C.QUEUE.CONCURRENCY;
    this.maxRetries   = options.maxRetries   || C.QUEUE.MAX_RETRIES;
    this.retryDelay   = options.retryDelay   || C.QUEUE.RETRY_DELAY_MS;
    this.delayBetween = options.delayBetween || C.QUEUE.DELAY_BETWEEN_MS;

    this.queue      = [];
    this.active     = 0;
    this.processing = false;
    this.paused     = false;
    this._idCounter = 0;

    // ★ generation — เพิ่มค่าเมื่อ reset()/clear() เพื่อให้ timer เก่าที่ค้างอยู่รู้ว่าตัวเอง stale
    this._generation = 0;
    // ★ retry timer ที่ค้างอยู่ — ต้อง clear ตอน reset ไม่งั้น active ติดลบ
    this._retryTimers = new Set();
    // ★ กัน drain ยิงซ้ำ — ยิงเฉพาะตอนที่ "เคยมีงาน" แล้วงานหมด
    this._hadWork = false;

    this.metrics = {
      totalAdded: 0, totalCompleted: 0, totalFailed: 0, totalRetries: 0,
      totalTimeouts: 0, totalCancelled: 0, totalDurationMs: 0,
    };
  }

  // ── Enqueue ───────────────────────────────────────────────────────

  add(task, options = {}) {
    if (typeof task !== 'function') {
      throw new TypeError('queue.add ต้องรับ function');
    }

    const item = {
      id:       ++this._idCounter,
      task,
      priority: options.priority || 0,
      retries:  0,
      status:   'pending',
      result:   null,
      error:    null,
      addedAt:  Date.now(),
      startedAt: null,
      finishedAt: null,
      filename: options.filename || 'unknown',
      // ★ onCancel — ให้ task ปล่อยทรัพยากรได้เมื่อถูก timeout/ยกเลิก
      onCancel: typeof options.onCancel === 'function' ? options.onCancel : null,
      timeoutMs: options.timeoutMs || C.QUEUE.TASK_TIMEOUT_MS,
      meta: options.meta || null,
    };

    // Insert in sorted position (descending priority) to avoid full sort
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority < item.priority) {
        this.queue.splice(i, 0, item);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.queue.push(item);

    this.metrics.totalAdded++;
    this._hadWork = true;
    this.emit('added', this._itemView(item));
    this._process();
    return item.id;
  }

  // ── Process loop ──────────────────────────────────────────────────

  async _process() {
    if (this.paused || this.processing) {
      if (this.processing) setImmediate(() => this._process());
      return;
    }
    this.processing = true;

    try {
      while (this.active < this.concurrency) {
        const next = this.queue.find(q => q.status === 'pending');
        if (!next) break;

        this.active++;
        next.status    = 'processing';
        next.startedAt = Date.now();
        this._emitProgress();
        this._runTask(next); // intentionally not awaited — run in background
      }
    } finally {
      this.processing = false;
    }

    this._emitProgress();

    // ★ drain เฉพาะตอนที่เคยมีงานแล้วงานหมดจริง — กันยิงซ้ำตอน resume() คิวว่าง
    const hasPending = this.queue.some(q => q.status === 'pending');
    if (!hasPending && this.active === 0 && this._hadWork) {
      this._hadWork = false;
      this.emit('drain', this.getStatus());
    }
  }

  async _runTask(item) {
    const generation = this._generation;

    // ★ Per-task timeout — พร้อมยกเลิกงานจริงผ่าน onCancel
    let timeoutHandle;
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.metrics.totalTimeouts++;
        // ★ สำคัญ: บอก task ให้ยกเลิกตัวเอง ไม่ใช่ปล่อยวิ่งต่อแล้วกิน quota ซ้ำ
        if (item.onCancel) {
          try { item.onCancel(new Error('timeout')); }
          catch (err) { logger.warn('Queue onCancel error', { id: item.id, error: err.message }); }
        }
        reject(new Error(`งานใช้เวลาเกิน ${Math.round(item.timeoutMs / 60_000)} นาที — ยกเลิก`));
      }, item.timeoutMs);
      if (timeoutHandle.unref) timeoutHandle.unref();
    });

    try {
      const result = await Promise.race([
        Promise.resolve().then(() => item.task()),
        timeoutPromise,
      ]);
      clearTimeout(timeoutHandle);

      // task ถูก cancel/reset ไปแล้วระหว่างรัน → ไม่ต้อง emit อะไร
      if (generation !== this._generation) return this._settle(item, generation);

      item.status     = 'done';
      item.result     = result;
      item.finishedAt = Date.now();
      this.metrics.totalCompleted++;
      this.metrics.totalDurationMs += (item.finishedAt - (item.startedAt || item.finishedAt));

      // ★ 'completed' คือ event เดียวที่ orchestrator._wireQueue() จับ
      //   → dispatch 'upload:completed' → stats / dashboard / notification
      //   ห้าม emit ซ้ำใน task function ของ Path-B (scheduler/_queueFile, runWatchlist)
      this.emit('completed', { id: item.id, result, filename: item.filename, durationMs: item.finishedAt - item.startedAt });
      logger.info('Queue item completed', { id: item.id, filename: item.filename });

    } catch (err) {
      clearTimeout(timeoutHandle);

      if (generation !== this._generation) return this._settle(item, generation);
      if (item.status === 'cancelled') return this._settle(item, generation);

      item.retries++;

      // ★ ไม่ retry error ที่ retry ไปก็ไม่ช่วย (quota เกิน / circuit เปิด / ไฟล์หาย)
      const permanent = this._isPermanentError(err);

      if (item.retries < this.maxRetries && !permanent) {
        item.error = err.message;
        this.metrics.totalRetries++;
        logger.warn('Queue item failed, will retry', {
          id: item.id, filename: item.filename, attempt: item.retries, error: err.message,
        });
        this.emit('retry', { id: item.id, attempt: item.retries, error: err.message, filename: item.filename });

        // Exponential backoff + jitter — delay ภายนอก loop ป้องกัน block
        const expo  = this.retryDelay * Math.pow(2, item.retries - 1);
        const delay = Math.round(expo / 2 + Math.random() * (expo / 2));

        const timer = setTimeout(() => {
          this._retryTimers.delete(timer);
          // ★ generation guard — ถ้า reset()/clear() เกิดขึ้นตอนรอ backoff
          //   ห้ามแตะ active (เดิมทำให้ active ติดลบ → over-admit)
          if (generation !== this._generation) return;
          item.status = 'pending';
          this.active = Math.max(0, this.active - 1);
          this._process();
        }, delay);
        if (timer.unref) timer.unref();
        this._retryTimers.add(timer);
        return; // ห้ามตก through ไป active--
      }

      item.status     = 'failed';
      item.error      = err.message;
      item.finishedAt = Date.now();
      item.timedOut   = timedOut;
      this.metrics.totalFailed++;
      this.emit('failed', {
        id: item.id, error: err.message, filename: item.filename,
        permanent, timedOut, attempts: item.retries,
      });
      logger.error('Queue item failed permanently', {
        id: item.id, filename: item.filename, error: err.message, permanent,
      });
    }

    return this._settle(item, generation);
  }

  async _settle(item, generation) {
    if (generation !== this._generation) return;   // reset แล้ว — active ถูกตั้งใหม่ไปแล้ว

    this.active = Math.max(0, this.active - 1);

    if (this.queue.some(q => q.status === 'pending')) {
      await this._delay(this.delayBetween);
    }
    this._process();
  }

  /** error ที่ retry ไปก็ไม่ช่วย — หยุดเลยจะดีกว่าเสียเวลา/quota */
  _isPermanentError(err) {
    const code = err?.code;
    const msg  = String(err?.message || '').toLowerCase();
    if (code === 'ECIRCUITOPEN') return true;
    if (code === 'ENOSPC_GUARD' || code === 'ENOSPC') return true;
    if (code === 'ENOENT') return true;
    if (/quota|exceeded.*limit|dailylimitexceeded|uploadlimitexceeded/i.test(msg)) return true;
    if (/invalid_grant|unauthorized|ไม่ได้เชื่อมต่อ/i.test(msg)) return true;
    if (/ซ้ำ|duplicate/i.test(msg)) return true;
    return false;
  }

  // ── Control ───────────────────────────────────────────────────────

  _delay(ms) {
    return new Promise(resolve => {
      const t = setTimeout(resolve, ms);
      if (t.unref) t.unref();
    });
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit('paused');
    logger.info('Queue paused');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.emit('resumed');
    logger.info('Queue resumed');
    this._process();
  }

  cancel(id) {
    const item = this.queue.find(q => q.id === id);
    if (!item) return false;

    if (item.status === 'pending') {
      item.status = 'cancelled';
      item.finishedAt = Date.now();
      this.metrics.totalCancelled++;
      this.emit('cancelled', { id });
      this._process();
      return true;
    }

    // ★ ยกเลิกงานที่กำลังรันได้ด้วย (เดิมทำไม่ได้ ต้องรอ timeout 15 นาที)
    if (item.status === 'processing' && item.onCancel) {
      item.status = 'cancelled';
      this.metrics.totalCancelled++;
      try { item.onCancel(new Error('cancelled by user')); } catch (_) {}
      this.emit('cancelled', { id, wasRunning: true });
      return true;
    }

    return false;
  }

  clear() {
    let cancelled = 0;
    this.queue.forEach(item => {
      if (item.status === 'pending') { item.status = 'cancelled'; cancelled++; }
    });
    this.metrics.totalCancelled += cancelled;
    this.emit('cleared', { cancelled });
    return cancelled;
  }

  reset() {
    // ★ ยกเลิก retry timer ที่ค้าง + bump generation ก่อนล้าง state
    //   เดิมไม่ทำ → timer เก่ายิง active-- ทำให้ active ติดลบ
    this._generation++;
    for (const t of this._retryTimers) clearTimeout(t);
    this._retryTimers.clear();

    for (const item of this.queue) {
      if (item.status === 'processing' && item.onCancel) {
        try { item.onCancel(new Error('queue reset')); } catch (_) {}
      }
    }

    this.queue      = [];
    this.active     = 0;
    this.processing = false;
    this._idCounter = 0;
    this._hadWork   = false;
    logger.info('Queue reset');
  }

  // ── Status ────────────────────────────────────────────────────────

  _itemView(q) {
    return {
      id: q.id, filename: q.filename, status: q.status, retries: q.retries,
      error: q.error, addedAt: q.addedAt, startedAt: q.startedAt, finishedAt: q.finishedAt,
    };
  }

  /**
   * ★ Progress emit แบบ throttle + counts-only
   * เดิม emit getStatus() (serialize คิวทั้งก้อน) ทุกครั้งที่ item เปลี่ยน status
   * คิว 200 ชิ้น = serialize 200 object หลายสิบครั้ง/วินาที
   */
  _emitProgress() {
    const now = Date.now();
    if (this._lastProgressAt && now - this._lastProgressAt < 100) {
      if (!this._progressPending) {
        this._progressPending = setTimeout(() => {
          this._progressPending = null;
          this._lastProgressAt = Date.now();
          this.emit('progress', this.getStatus());
        }, 100);
        if (this._progressPending.unref) this._progressPending.unref();
      }
      return;
    }
    this._lastProgressAt = now;
    this.emit('progress', this.getStatus());
  }

  getCounts() {
    let pending = 0, processing = 0, done = 0, failed = 0, cancelled = 0;
    for (const q of this.queue) {
      switch (q.status) {
        case 'pending':    pending++; break;
        case 'processing': processing++; break;
        case 'done':       done++; break;
        case 'failed':     failed++; break;
        case 'cancelled':  cancelled++; break;
      }
    }
    return { pending, processing, done, failed, cancelled, total: this.queue.length };
  }

  getStatus(opts = {}) {
    const maxItems = opts.maxItems ?? C.QUEUE.MAX_STATUS_ITEMS ?? 100;
    const counts = this.getCounts();

    // ส่งเฉพาะ N ชิ้นล่าสุด — คิวยาวๆ ไม่ต้อง serialize ทั้งก้อน
    const slice = this.queue.length > maxItems ? this.queue.slice(-maxItems) : this.queue;
    const items = slice.map(q => this._itemView(q));

    const avgDurationMs = this.metrics.totalCompleted > 0
      ? Math.round(this.metrics.totalDurationMs / this.metrics.totalCompleted)
      : 0;

    return {
      ...counts,
      paused:  this.paused,
      active:  this.active,
      concurrency: this.concurrency,
      truncated: this.queue.length > maxItems,
      items,
      metrics: { ...this.metrics, avgDurationMs },
    };
  }
}

module.exports = new UploadQueue();
