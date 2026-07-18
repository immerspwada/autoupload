/**
 * ★ JSON-based data store with:
 *   - Atomic writes (write temp → rename) — ป้องกัน corrupt ถ้า process crash
 *   - mtime-based cache — ลด disk I/O สำหรับ load บ่อย
 *   - Serialized write queue — ป้องกัน race condition เมื่อหลาย async path save พร้อมกัน
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

class Store {
  constructor(filename, fallback = {}) {
    this.filepath = path.join(DATA_DIR, filename);
    this.fallback = fallback;
    this._cache      = null;
    this._lastRead   = 0;
    // ★ Serialized write queue — ป้องกัน concurrent save ทับกัน
    this._writeQueue = Promise.resolve();
  }

  // ── Synchronous load (ใช้ cache ถ้า mtime ไม่เปลี่ยน) ────────────
  load() {
    try {
      if (!fs.existsSync(this.filepath)) return this._cloneFallback();
      const stat = fs.statSync(this.filepath);
      if (this._cache !== null && stat.mtimeMs <= this._lastRead) {
        return this._cache;
      }
      const data = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
      this._cache    = data;
      this._lastRead = stat.mtimeMs;
      return data;
    } catch (_err) {
      return this._cloneFallback();
    }
  }

  // ── Synchronous save (atomic write) ──────────────────────────────
  save(data) {
    const tmp = this.filepath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filepath);
    this._cache    = data;
    this._lastRead = Date.now();
  }

  /**
   * ★ Async save — queues writes so concurrent callers never clobber each other.
   *   Caller: await store.saveAsync(data)
   *   ถ้าไม่ต้องการ await ก็ call ได้เลย — error จะถูก catch ภายใน
   */
  saveAsync(data) {
    this._writeQueue = this._writeQueue
      .then(() => this.save(data))
      .catch(err => {
        // log แต่ไม่โยน error ออกไปเพื่อไม่ให้ queue หยุด
        console.error(`[Store] saveAsync error (${path.basename(this.filepath)}):`, err.message);
      });
    return this._writeQueue;
  }

  /**
   * ★ Safe update — load → transform → saveAsync (serialized)
   * ป้องกัน lost-update จาก concurrent read-modify-write
   *
   * ตัวอย่าง:
   *   await uploads.safeUpdate(arr => { arr.push(record); return arr; });
   */
  safeUpdate(updater) {
    this._writeQueue = this._writeQueue.then(() => {
      const current = this.load();
      const updated = updater(current);
      this.save(updated !== undefined ? updated : current);
    }).catch(err => {
      console.error(`[Store] safeUpdate error (${path.basename(this.filepath)}):`, err.message);
    });
    return this._writeQueue;
  }

  // ── Legacy update (synchronous) ──────────────────────────────────
  update(updater) {
    const data    = this.load();
    const updated = updater(data);
    this.save(updated !== undefined ? updated : data);
    return this.load();
  }

  // ── Invalidate cache (force reload next load()) ───────────────────
  invalidate() {
    this._cache    = null;
    this._lastRead = 0;
  }

  _cloneFallback() {
    // Return a deep clone so callers can't mutate the fallback reference
    return JSON.parse(JSON.stringify(this.fallback));
  }
}

// ── Singleton Store instances ─────────────────────────────────────
const settings  = new Store('settings.json',  {});
const uploads   = new Store('uploads.json',   []);
const scheduler = new Store('scheduler.json', {
  enabled: false,
  intervalMinutes: 30,
  lastRun: null,
});
const stats = new Store('stats.json', {
  totalUploads: 0,
  totalSize: 0,
  failedUploads: 0,
  dailyStats: {},
  uploadsByHour: {},
});

module.exports = { Store, settings, uploads, scheduler, stats };
