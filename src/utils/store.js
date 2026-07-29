/**
 * ★ JSON-based data store with:
 *   - Atomic writes (write temp → fsync → rename) — ป้องกัน corrupt ถ้า process crash
 *   - mtime-based cache — ลด disk I/O สำหรับ load บ่อย
 *   - Serialized write queue — ป้องกัน race condition เมื่อหลาย async path save พร้อมกัน
 *   - Clone-on-load — caller mutate ได้ไม่กระทบ cache ที่คนอื่นถืออยู่
 *   - Corrupt-file quarantine — ไฟล์เสียถูกย้ายไป .corrupt แล้วเริ่มจาก fallback
 *
 * ── กฎการใช้งาน ────────────────────────────────────────────────────
 *   load()        → deep clone (ปลอดภัย, mutate ได้)          ← default
 *   loadRef()     → cached reference (เร็ว, READ-ONLY ห้าม mutate)
 *   safeUpdate()  → read-modify-write แบบ serialized           ← ใช้ตัวนี้เสมอเมื่อแก้ข้อมูล
 *   save()        → เขียนทับทั้งก้อน (ระวัง lost-update)
 *   flush()       → await write ที่ค้างอยู่ทั้งหมด (ใช้ตอน shutdown)
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ★ Registry ของทุก store instance — ใช้ flushAll() ตอน graceful shutdown
const _registry = new Set();

const deepClone = (v) => (typeof structuredClone === 'function'
  ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

class Store {
  constructor(filename, fallback = {}) {
    this.filepath = path.join(DATA_DIR, filename);
    this.name     = filename;
    this.fallback = fallback;
    this._cache      = null;
    this._lastRead   = 0;
    // ★ Serialized write queue — ป้องกัน concurrent save ทับกัน
    this._writeQueue = Promise.resolve();
    this._pending    = 0;   // จำนวน write ที่ค้างอยู่ใน queue
    this._writes     = 0;   // ตัวนับสำหรับ metrics
    this._corrupt    = 0;
    _registry.add(this);
  }

  // ── Cached reference — READ-ONLY (เร็วสุด, ห้าม mutate) ───────────
  loadRef() {
    try {
      if (!fs.existsSync(this.filepath)) {
        if (this._cache === null) this._cache = deepClone(this.fallback);
        return this._cache;
      }
      const stat = fs.statSync(this.filepath);
      if (this._cache !== null && stat.mtimeMs <= this._lastRead) {
        return this._cache;
      }
      const raw = fs.readFileSync(this.filepath, 'utf8');
      const data = raw.trim() === '' ? deepClone(this.fallback) : JSON.parse(raw);
      this._cache    = data;
      this._lastRead = stat.mtimeMs;
      return data;
    } catch (err) {
      // ไฟล์เสีย → quarantine ไว้ debug แล้วเริ่มใหม่จาก fallback (ไม่ให้ทั้งระบบพัง)
      this._quarantine(err);
      this._cache    = deepClone(this.fallback);
      this._lastRead = Date.now();
      return this._cache;
    }
  }

  // ── Safe load — deep clone, caller mutate ได้ตามใจ ────────────────
  load() {
    return deepClone(this.loadRef());
  }

  // ── Synchronous save (atomic write + fsync) ──────────────────────
  save(data) {
    const tmp = this.filepath + '.tmp';
    const fd  = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
      fs.fsyncSync(fd);          // ★ บังคับลง disk ก่อน rename — กัน empty file หลังไฟดับ
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.filepath);

    this._cache  = data;
    this._writes++;
    try {
      this._lastRead = fs.statSync(this.filepath).mtimeMs;
    } catch (_) {
      this._lastRead = Date.now();
    }
  }

  /**
   * ★ Async save — queues writes so concurrent callers never clobber each other.
   */
  saveAsync(data) {
    this._pending++;
    this._writeQueue = this._writeQueue
      .then(() => this.save(data))
      .catch(err => {
        console.error(`[Store] saveAsync error (${this.name}):`, err.message);
      })
      .finally(() => { this._pending--; });
    return this._writeQueue;
  }

  /**
   * ★ Safe update — load → transform → save (serialized)
   * ป้องกัน lost-update จาก concurrent read-modify-write
   *
   *   await uploads.safeUpdate(arr => { arr.push(record); return arr; });
   *
   * updater รับ "fresh copy" ที่อ่านตอนถึงคิวจริง (ไม่ใช่ตอนเรียก) จึงไม่มีข้อมูลค้าง
   */
  safeUpdate(updater) {
    this._pending++;
    this._writeQueue = this._writeQueue
      .then(() => {
        const current = this.load();              // fresh clone ตอนถึงคิว
        const updated = updater(current);
        this.save(updated !== undefined ? updated : current);
      })
      .catch(err => {
        console.error(`[Store] safeUpdate error (${this.name}):`, err.message);
      })
      .finally(() => { this._pending--; });
    return this._writeQueue;
  }

  // ── Legacy update (synchronous) ──────────────────────────────────
  update(updater) {
    const data    = this.load();
    const updated = updater(data);
    this.save(updated !== undefined ? updated : data);
    return this.load();
  }

  // ── await write ที่ค้างอยู่ทั้งหมด ────────────────────────────────
  async flush() {
    // loop เพราะ updater อาจ queue งานใหม่ระหว่างรอ
    let guard = 0;
    while (this._pending > 0 && guard++ < 50) {
      await this._writeQueue.catch(() => {});
    }
    return { store: this.name, writes: this._writes };
  }

  // ── Invalidate cache (force reload next load()) ───────────────────
  invalidate() {
    this._cache    = null;
    this._lastRead = 0;
  }

  getMetrics() {
    return {
      store:    this.name,
      writes:   this._writes,
      pending:  this._pending,
      corrupt:  this._corrupt,
      cached:   this._cache !== null,
      sizeBytes: (() => { try { return fs.statSync(this.filepath).size; } catch (_) { return 0; } })(),
    };
  }

  _quarantine(err) {
    this._corrupt++;
    try {
      if (!fs.existsSync(this.filepath)) return;
      const dest = `${this.filepath}.corrupt`;
      fs.copyFileSync(this.filepath, dest);
      console.error(`[Store] ${this.name} เสียหาย (${err.message}) — สำรองไว้ที่ ${path.basename(dest)} แล้วเริ่มจากค่าเริ่มต้น`);
    } catch (_) { /* best effort */ }
  }
}

// ── Flush ทุก store (ใช้ตอน graceful shutdown) ────────────────────
async function flushAll() {
  const results = [];
  for (const s of _registry) {
    try { results.push(await s.flush()); } catch (_) {}
  }
  return results;
}

function allMetrics() {
  return Array.from(_registry).map(s => s.getMetrics());
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

module.exports = { Store, settings, uploads, scheduler, stats, flushAll, allMetrics };
