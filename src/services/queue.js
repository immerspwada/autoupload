/**
 * ★ Advanced Upload Queue
 *
 * แก้ไขจาก original:
 * 1. [MEDIUM] แทน magic numbers ด้วย constants
 * 2. [LOW] ปรับ comment ให้ชัดเจนว่า emit 'completed' คือจุดเดียวที่ orchestrator จับ
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
  }

  // ── Enqueue ───────────────────────────────────────────────────────

  add(task, options = {}) {
    const item = {
      id:       ++this._idCounter,
      task,
      priority: options.priority || 0,
      retries:  0,
      status:   'pending',
      result:   null,
      error:    null,
      addedAt:  Date.now(),
      filename: options.filename || 'unknown',
    };

    this.queue.push(item);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.emit('added', item);
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

    while (this.active < this.concurrency) {
      const next = this.queue.find(q => q.status === 'pending');
      if (!next) break;

      this.active++;
      next.status = 'processing';
      this.emit('progress', this.getStatus());
      this._runTask(next); // intentionally not awaited — run in background
    }

    this.processing = false;
    this.emit('progress', this.getStatus());

    const pending = this.queue.filter(q => q.status === 'pending');
    if (pending.length === 0 && this.active === 0) {
      this.emit('drain', this.getStatus());
    }
  }

  async _runTask(item) {
    // ★ Per-task timeout — ป้องกัน upload ค้างไม่มีกำหนด
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Task timeout after ${C.QUEUE.TASK_TIMEOUT_MS / 60_000} minutes`)),
        C.QUEUE.TASK_TIMEOUT_MS
      );
    });

    try {
      const result = await Promise.race([item.task(), timeoutPromise]);
      clearTimeout(timeoutHandle);
      item.status = 'done';
      item.result = result;

      // ★ 'completed' คือ event เดียวที่ orchestrator._wireQueue() จับ
      //   → dispatch 'upload:completed' → stats / dashboard / notification
      //   ห้าม emit ซ้ำใน task function ของ Path-B (scheduler/_queueFile, runWatchlist)
      this.emit('completed', { id: item.id, result, filename: item.filename });
      logger.info('Queue item completed', { id: item.id, filename: item.filename });

    } catch (err) {
      clearTimeout(timeoutHandle);
      item.retries++;

      if (item.retries < this.maxRetries) {
        item.error = err.message;
        logger.warn('Queue item failed, will retry', {
          id:       item.id,
          filename: item.filename,
          attempt:  item.retries,
          error:    err.message,
        });
        this.emit('retry', { id: item.id, attempt: item.retries, error: err.message, filename: item.filename });

        // Exponential backoff — delay ภายนอก loop ป้องกัน block
        const delay = this.retryDelay * Math.pow(2, item.retries - 1);
        setTimeout(() => {
          item.status = 'pending';
          this.active--;
          this._process();
        }, delay);
        return; // ห้ามตก through ไป active--
      }

      item.status = 'failed';
      item.error  = err.message;
      this.emit('failed', { id: item.id, error: err.message, filename: item.filename });
      logger.error('Queue item failed permanently', {
        id:       item.id,
        filename: item.filename,
        error:    err.message,
      });
    }

    this.active--;

    if (this.queue.some(q => q.status === 'pending')) {
      await this._delay(this.delayBetween);
    }

    this._process();
  }

  // ── Control ───────────────────────────────────────────────────────

  _delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  pause() {
    this.paused = true;
    this.emit('paused');
    logger.info('Queue paused');
  }

  resume() {
    this.paused = false;
    this.emit('resumed');
    logger.info('Queue resumed');
    this._process();
  }

  cancel(id) {
    const item = this.queue.find(q => q.id === id);
    if (item && item.status === 'pending') {
      item.status = 'cancelled';
      this.emit('cancelled', { id });
      return true;
    }
    return false;
  }

  clear() {
    this.queue.forEach(item => {
      if (item.status === 'pending') item.status = 'cancelled';
    });
    this.emit('cleared');
  }

  reset() {
    this.queue      = [];
    this.active     = 0;
    this.processing = false;
    this._idCounter = 0;
  }

  // ── Status ────────────────────────────────────────────────────────

  getStatus() {
    const pending    = this.queue.filter(q => q.status === 'pending').length;
    const processing = this.queue.filter(q => q.status === 'processing').length;
    const done       = this.queue.filter(q => q.status === 'done').length;
    const failed     = this.queue.filter(q => q.status === 'failed').length;

    return {
      pending,
      processing,
      done,
      failed,
      total:  this.queue.length,
      paused: this.paused,
      items:  this.queue.map(q => ({
        id:       q.id,
        filename: q.filename,
        status:   q.status,
        retries:  q.retries,
        error:    q.error,
        addedAt:  q.addedAt,
      })),
    };
  }
}

module.exports = new UploadQueue();
