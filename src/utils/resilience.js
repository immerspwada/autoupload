/**
 * ★ Resilience toolkit — retry, circuit breaker, timeout, semaphore
 *
 * ใช้ห่อทุก call ที่ออกไปข้างนอก (YouTube API, tikwm, ffmpeg) เพื่อให้:
 *   - ล้มเหลวชั่วคราว → retry แบบ exponential + jitter
 *   - ล้มเหลวต่อเนื่อง → เปิด circuit ตัดทิ้งทันที ไม่เสียเวลา/quota
 *   - ค้าง → timeout พร้อม abort hook (ไม่ปล่อยงานลอย)
 *
 * ทุกตัวมี metrics ให้ /api/health/metrics อ่านได้
 */
const logger = require('./logger');

// ══════════════════════════════════════════════════════════════════
//  Errors
// ══════════════════════════════════════════════════════════════════
class TimeoutError extends Error {
  constructor(ms, label) {
    super(`หมดเวลา ${Math.round(ms / 1000)}s${label ? ` (${label})` : ''}`);
    this.name = 'TimeoutError';
    this.code = 'ETIMEDOUT_GUARD';
    this.timeoutMs = ms;
  }
}

class CircuitOpenError extends Error {
  constructor(name, retryInMs) {
    super(`บริการ "${name}" ถูกตัดชั่วคราว (ล้มเหลวต่อเนื่อง) — ลองใหม่ในอีก ${Math.ceil(retryInMs / 1000)}s`);
    this.name = 'CircuitOpenError';
    this.code = 'ECIRCUITOPEN';
    this.retryInMs = retryInMs;
  }
}

// ══════════════════════════════════════════════════════════════════
//  withTimeout — race + onTimeout hook สำหรับ abort งานจริง
// ══════════════════════════════════════════════════════════════════
/**
 * @param {Promise|Function} work  promise หรือ factory (abortSignal) => promise
 * @param {number} ms
 * @param {object} opts { label, onTimeout }
 */
function withTimeout(work, ms, opts = {}) {
  const { label = '', onTimeout = null } = opts;
  if (!ms || ms <= 0) return Promise.resolve(typeof work === 'function' ? work() : work);

  const controller = new AbortController();
  const promise = typeof work === 'function' ? work(controller.signal) : work;

  let timer;
  const timeout = new Promise((_, reject) => {
    // ★ ไม่ unref() timer นี้ — ถ้า unref แล้วงานที่ค้างอยู่ไม่มี handle อื่น
    //   event loop จะว่างและ process ออกก่อน timeout ยิง = timeout ไม่ทำงานเลย
    //   ปลอดภัยเพราะ clearTimeout ถูกเรียกใน finally ทุกกรณี
    timer = setTimeout(() => {
      controller.abort();
      // ★ สำคัญ: abort งานจริง ไม่ใช่แค่ reject แล้วปล่อยงานวิ่งต่อ
      if (typeof onTimeout === 'function') {
        try { onTimeout(); } catch (err) {
          logger.warn('[Resilience] onTimeout hook error', { label, error: err.message });
        }
      }
      reject(new TimeoutError(ms, label));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ══════════════════════════════════════════════════════════════════
//  retry — exponential backoff + full jitter
// ══════════════════════════════════════════════════════════════════
const DEFAULT_RETRYABLE = (err) => {
  const status = err?.code || err?.status || err?.response?.status;
  const msg = String(err?.message || '').toLowerCase();

  // ห้าม retry: quota เกิน / auth ผิด / input ไม่ถูกต้อง
  if (status === 403 && /quota|exceeded|limit/i.test(msg)) return false;
  if (status === 401 || status === 400 || status === 404) return false;
  if (err?.code === 'ECIRCUITOPEN') return false;

  // retry ได้: network + 5xx + rate limit
  if ([429, 500, 502, 503, 504].includes(Number(status))) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'ESOCKETTIMEDOUT'].includes(status)) return true;
  if (err instanceof TimeoutError) return true;
  if (/socket hang up|network|timeout|temporarily/i.test(msg)) return true;

  return false;
};

async function retry(fn, opts = {}) {
  const {
    attempts    = 3,
    baseDelayMs = 1000,
    maxDelayMs  = 30_000,
    label       = 'task',
    isRetryable = DEFAULT_RETRYABLE,
    onRetry     = null,
    signal      = null,
  } = opts;

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw new Error('ยกเลิกแล้ว');
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const canRetry = attempt < attempts && isRetryable(err);
      if (!canRetry) break;

      // exponential + full jitter — กัน thundering herd เมื่อหลาย task ล้มพร้อมกัน
      const expo  = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = Math.round(expo / 2 + Math.random() * (expo / 2));

      logger.warn(`[Retry] ${label} ล้มเหลว ครั้งที่ ${attempt}/${attempts} — ลองใหม่ในอีก ${delay}ms`, {
        error: err.message,
      });
      if (typeof onRetry === 'function') {
        try { onRetry(attempt, err, delay); } catch (_) {}
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ══════════════════════════════════════════════════════════════════
//  CircuitBreaker — closed → open → half-open
// ══════════════════════════════════════════════════════════════════
class CircuitBreaker {
  /**
   * @param {string} name
   * @param {object} opts
   *   failureThreshold  ล้มติดกันกี่ครั้งถึงเปิด circuit
   *   openMs            เปิดนานเท่าไรก่อนลอง half-open
   *   halfOpenMax       จำนวน request ที่ปล่อยผ่านตอน half-open
   */
  constructor(name, opts = {}) {
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.openMs           = opts.openMs ?? 60_000;
    this.halfOpenMax      = opts.halfOpenMax ?? 1;

    this.state         = 'closed';
    this.failures      = 0;
    this.consecutiveOk = 0;
    this.openedAt      = 0;
    this.halfOpenInFlight = 0;

    this.stats = { calls: 0, ok: 0, failed: 0, rejected: 0, opens: 0, lastError: null, lastErrorAt: null };
  }

  _shouldAttempt() {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.openMs) {
        this.state = 'half-open';
        this.halfOpenInFlight = 0;
        logger.info(`[Circuit] ${this.name} → half-open (ลองใหม่)`);
        return true;
      }
      return false;
    }

    // half-open — ปล่อยผ่านทีละน้อย
    return this.halfOpenInFlight < this.halfOpenMax;
  }

  async exec(fn) {
    this.stats.calls++;

    if (!this._shouldAttempt()) {
      this.stats.rejected++;
      throw new CircuitOpenError(this.name, this.openMs - (Date.now() - this.openedAt));
    }

    if (this.state === 'half-open') this.halfOpenInFlight++;

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    } finally {
      if (this.state === 'half-open' && this.halfOpenInFlight > 0) this.halfOpenInFlight--;
    }
  }

  _onSuccess() {
    this.stats.ok++;
    this.consecutiveOk++;
    this.failures = 0;
    if (this.state !== 'closed') {
      this.state = 'closed';
      logger.info(`[Circuit] ${this.name} → closed (กลับมาปกติ)`);
    }
  }

  _onFailure(err) {
    // circuit ไม่ควรนับ error ที่เป็นความผิดของ input เอง
    if (err?.code === 'ECIRCUITOPEN') return;

    this.stats.failed++;
    this.stats.lastError   = err?.message || String(err);
    this.stats.lastErrorAt = new Date().toISOString();
    this.consecutiveOk = 0;
    this.failures++;

    if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
      if (this.state !== 'open') {
        this.state    = 'open';
        this.openedAt = Date.now();
        this.stats.opens++;
        logger.error(`[Circuit] ${this.name} → OPEN (ล้มเหลว ${this.failures} ครั้งติด) — ตัดชั่วคราว ${this.openMs / 1000}s`, {
          lastError: this.stats.lastError,
        });
      } else {
        this.openedAt = Date.now();
      }
    }
  }

  reset() {
    this.state = 'closed';
    this.failures = 0;
    this.halfOpenInFlight = 0;
    logger.info(`[Circuit] ${this.name} → reset by operator`);
  }

  getState() {
    const retryInMs = this.state === 'open'
      ? Math.max(0, this.openMs - (Date.now() - this.openedAt))
      : 0;
    return {
      name: this.name,
      state: this.state,
      healthy: this.state === 'closed',
      failures: this.failures,
      retryInMs,
      ...this.stats,
    };
  }
}

// ── Registry ของ breaker ทั้งระบบ ─────────────────────────────────
const _breakers = new Map();

function breaker(name, opts) {
  if (!_breakers.has(name)) _breakers.set(name, new CircuitBreaker(name, opts));
  return _breakers.get(name);
}

function allBreakers() {
  return Array.from(_breakers.values()).map(b => b.getState());
}

function resetAllBreakers() {
  for (const b of _breakers.values()) b.reset();
  return _breakers.size;
}

// ══════════════════════════════════════════════════════════════════
//  guarded — retry + circuit breaker + timeout ในคำสั่งเดียว
// ══════════════════════════════════════════════════════════════════
/**
 *   await guarded('youtube:upload', () => api.upload(), {
 *     attempts: 3, timeoutMs: 900000, onTimeout: () => stream.destroy()
 *   })
 */
function guarded(name, fn, opts = {}) {
  const {
    attempts = 3, baseDelayMs = 1000, maxDelayMs = 30_000,
    timeoutMs = 0, onTimeout = null, isRetryable = DEFAULT_RETRYABLE,
    breakerOpts = {}, onRetry = null,
  } = opts;

  const cb = breaker(name, breakerOpts);

  return retry(
    () => cb.exec(() => (timeoutMs > 0
      ? withTimeout(fn, timeoutMs, { label: name, onTimeout })
      : Promise.resolve(fn()))),
    { attempts, baseDelayMs, maxDelayMs, label: name, isRetryable, onRetry }
  );
}

// ══════════════════════════════════════════════════════════════════
//  Semaphore — จำกัดงานหนักที่ทำพร้อมกัน (เช่น ffmpeg)
// ══════════════════════════════════════════════════════════════════
class Semaphore {
  constructor(max = 1, name = 'sem') {
    this.max = Math.max(1, max);
    this.name = name;
    this.active = 0;
    this._waiters = [];
    this.stats = { acquired: 0, maxWaited: 0 };
  }

  async acquire() {
    if (this.active < this.max) {
      this.active++;
      this.stats.acquired++;
      return () => this._release();
    }
    return new Promise(resolve => {
      this._waiters.push(resolve);
      this.stats.maxWaited = Math.max(this.stats.maxWaited, this._waiters.length);
    }).then(() => {
      this.stats.acquired++;
      return () => this._release();
    });
  }

  _release() {
    const next = this._waiters.shift();
    if (next) { next(); return; }
    this.active = Math.max(0, this.active - 1);
  }

  async run(fn) {
    const release = await this.acquire();
    try { return await fn(); } finally { release(); }
  }

  getState() {
    return { name: this.name, active: this.active, max: this.max, waiting: this._waiters.length, ...this.stats };
  }
}

module.exports = {
  withTimeout, retry, guarded,
  CircuitBreaker, breaker, allBreakers, resetAllBreakers,
  Semaphore,
  TimeoutError, CircuitOpenError,
  DEFAULT_RETRYABLE,
};
