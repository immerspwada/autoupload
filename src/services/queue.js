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
    if (this.paused || this.processing) return;
    this.processing = true;

    while (this.active < this.concurrency) {
      const next = this.queue.find(q => q.status === 'pending');
      if (!next) break;

      this.active++;
      next.status = 'processing';
      this.emit('progress', this.getStatus());

      try {
        const result = await next.task();
        next.status = 'done';
        next.result = result;
        this.emit('completed', { id: next.id, result, filename: next.filename });
        logger.info('Queue item completed', { id: next.id, filename: next.filename });
      } catch (err) {
        next.retries++;
        if (next.retries < this.maxRetries) {
          next.status = 'pending';
          next.error = err.message;
          logger.warn('Queue item failed, will retry', {
            id: next.id,
            filename: next.filename,
            attempt: next.retries,
            error: err.message
          });
          this.emit('retry', { id: next.id, attempt: next.retries, error: err.message });
          // Exponential backoff
          await this._delay(this.retryDelay * Math.pow(2, next.retries - 1));
        } else {
          next.status = 'failed';
          next.error = err.message;
          this.emit('failed', { id: next.id, error: err.message, filename: next.filename });
          logger.error('Queue item failed permanently', {
            id: next.id,
            filename: next.filename,
            error: err.message
          });
        }
      }

      this.active--;

      // Delay between uploads
      if (this.queue.some(q => q.status === 'pending')) {
        await this._delay(this.delayBetween);
      }
    }

    this.processing = false;
    this.emit('progress', this.getStatus());

    // Check if all done
    const pending = this.queue.filter(q => q.status === 'pending');
    if (pending.length === 0 && this.active === 0) {
      this.emit('drain', this.getStatus());
    }
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
