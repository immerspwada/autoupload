// JSON-based data store with atomic writes
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

class Store {
  constructor(filename, fallback = {}) {
    this.filepath = path.join(DATA_DIR, filename);
    this.fallback = fallback;
    this._cache = null;
    this._lastRead = 0;
  }

  load() {
    try {
      if (!fs.existsSync(this.filepath)) return this.fallback;
      const stat = fs.statSync(this.filepath);
      // Use cache if file hasn't changed
      if (this._cache && stat.mtimeMs <= this._lastRead) return this._cache;
      const data = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
      this._cache = data;
      this._lastRead = Date.now();
      return data;
    } catch (err) {
      return this.fallback;
    }
  }

  save(data) {
    // Atomic write: write to temp then rename
    const tmp = this.filepath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filepath);
    this._cache = data;
    this._lastRead = Date.now();
  }

  update(updater) {
    const data = this.load();
    const updated = updater(data);
    this.save(updated !== undefined ? updated : data);
    return this.load();
  }
}

// Store instances
const settings = new Store('settings.json', {});
const uploads = new Store('uploads.json', []);
const scheduler = new Store('scheduler.json', { enabled: false, intervalMinutes: 30, lastRun: null });
const stats = new Store('stats.json', {
  totalUploads: 0,
  totalSize: 0,
  failedUploads: 0,
  dailyStats: {},
  uploadsByHour: {}
});

module.exports = { Store, settings, uploads, scheduler, stats };
