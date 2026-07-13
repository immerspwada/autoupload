// Advanced Upload Queue with retry, priority, and concurrency control
const EventEmitter = require('events');
const logger = require('../utils/logger');

class UploadQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = options.concurrency || 1; // Sequential by default (YouTube rate limits)
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000; // 5 seconds
    this.delayBetween = options.delayBetween || 2000; // 2 seconds between uploads

    this.queue = [];       // { id, task, priority, retries, status, result, error, addedAt }
    this.active = 0;
    this.processing = false;
    this.paused = false;
    this._idCounter = 0;
  }

  add(task, options = {}) {
    const item = {
      id: ++this._idCounter,
      task,
      priority: options.priority || 0, // Higher = processed first
      retries: 0,
      status: 'pending',
      result: null,
      error: null,
      addedAt: Date.now(),
      filename: options.filename || 'unknown'
    };

    this.queue.push(item);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.emit('added', item);
    this._process();
    return item.id;
  }

  async _process() {
    if (this.paused || this.processing) {
      // ถ้า processing อยู่ — schedule อีกรอบหลัง tick เพื่อไม่ให้ items ที่ add ระหว่าง processing หลุด
      if (this.processing) {
        setImmediate(() => this._process());
      }
      return;
    }
    this.processing = true;

    while (this.active < this.concurrency) {
      const next = this.queue.find(q => q.status === 'pending');
      if (!next) break;

      this.active++;
      next.status = 'processing';
      this.emit('progress', this.getStatus());

      // Run task in background — ไม่ await ใน while loop เพื่อป้องกัน retry delay block
      this._runTask(next);
    }

    this.processing = false;
    this.emit('progress', this.getStatus());

    // Check if all done
    const pending = this.queue.filter(q => q.status === 'pending');
    if (pending.length === 0 && this.active === 0) {
      this.emit('drain', this.getStatus());
    }
  }

  async _runTask(item) {
    try {
      const result = await item.task();
      item.status = 'done';
      item.result = result;
      this.emit('completed', { id: item.id, result, filename: item.filename });
      logger.info('Queue item completed', { id: item.id, filename: item.filename });
    } catch (err) {
      item.retries++;
      if (item.retries < this.maxRetries) {
        item.error = err.message;
        logger.warn('Queue item failed, will retry', {
          id: item.id, filename: item.filename,
          attempt: item.retries, error: err.message
        });
        this.emit('retry', { id: item.id, attempt: item.retries, error: err.message });

        // Retry with exponential backoff — delay OUTSIDE the main loop
        const delay = this.retryDelay * Math.pow(2, item.retries - 1);
        setTimeout(() => {
          item.status = 'pending'; // re-queue
          this.active--;
          this._process(); // re-trigger processing
        }, delay);
        return; // don't fall through to active--
      } else {
        item.status = 'failed';
        item.error = err.message;
        this.emit('failed', { id: item.id, error: err.message, filename: item.filename });
        logger.error('Queue item failed permanently', {
          id: item.id, filename: item.filename, error: err.message
        });
      }
    }

    this.active--;

    // Delay between uploads, then trigger next item
    if (this.queue.some(q => q.status === 'pending')) {
      await this._delay(this.delayBetween);
    }

    // Trigger next item in queue
    this._process();
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  getStatus() {
    const pending = this.queue.filter(q => q.status === 'pending').length;
    const processing = this.queue.filter(q => q.status === 'processing').length;
    const done = this.queue.filter(q => q.status === 'done').length;
    const failed = this.queue.filter(q => q.status === 'failed').length;
    const total = this.queue.length;

    return {
      pending,
      processing,
      done,
      failed,
      total,
      paused: this.paused,
      items: this.queue.map(q => ({
        id: q.id,
        filename: q.filename,
        status: q.status,
        retries: q.retries,
        error: q.error,
        addedAt: q.addedAt
      }))
    };
  }

  reset() {
    this.queue = [];
    this.active = 0;
    this.processing = false;
    this._idCounter = 0;
  }
}

module.exports = new UploadQueue();
