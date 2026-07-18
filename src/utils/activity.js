/**
 * ★ Activity Logger — User-facing event tracking for Dashboard & Timeline
 *   - Atomic write (temp → rename) — ป้องกัน corrupt
 *   - In-memory buffer + serialized flush — ป้องกัน race condition
 */

const fs   = require('fs');
const path = require('path');
const { ACTIVITY } = require('../config/constants');

const ACTIVITY_FILE  = path.join(__dirname, '../../data/activity.json');
const MAX_ACTIVITIES = ACTIVITY.MAX_ENTRIES;

class ActivityLogger {
  constructor() {
    this.activities  = this._load();
    // ★ Serialized write queue
    this._writeQueue = Promise.resolve();
  }

  // ── Persistence ───────────────────────────────────────────────────

  _load() {
    if (!fs.existsSync(ACTIVITY_FILE)) return [];
    try {
      return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
    } catch (err) {
      console.error('[Activity] Load error:', err.message);
      return [];
    }
  }

  /**
   * ★ Atomic write — temp → rename
   * Trimming เกิน MAX_ACTIVITIES ก่อน save
   */
  _saveSync() {
    if (this.activities.length > MAX_ACTIVITIES) {
      this.activities = this.activities.slice(-MAX_ACTIVITIES);
    }
    try {
      const tmp = ACTIVITY_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.activities, null, 2), 'utf8');
      fs.renameSync(tmp, ACTIVITY_FILE);
    } catch (err) {
      console.error('[Activity] Save error:', err.message);
    }
  }

  /** Serialized async save — ป้องกัน concurrent write */
  _save() {
    this._writeQueue = this._writeQueue
      .then(() => this._saveSync())
      .catch(err => console.error('[Activity] Queue save error:', err.message));
    return this._writeQueue;
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Log an activity
   * @param {string} type   - e.g. 'upload:success'
   * @param {string} message - Human-readable
   * @param {object} data   - Additional data
   * @param {string} level  - 'success' | 'error' | 'warning' | 'info'
   * @returns {object} The activity entry
   */
  log(type, message, data = {}, level = 'info') {
    const activity = {
      id:        `${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      type,
      message,
      data,
      level,
      timestamp: new Date().toISOString(),
    };
    this.activities.push(activity);
    this._save();
    return activity;
  }

  /**
   * Get recent activities, newest first
   * @param {number} limit
   * @param {string|null} type - optional type prefix filter
   */
  getRecent(limit = 50, type = null) {
    let filtered = [...this.activities];
    if (type) {
      filtered = filtered.filter(a => a.type === type || a.type.startsWith(type + ':'));
    }
    return filtered.slice(-limit).reverse();
  }

  /** Activities for today (local date) */
  getToday() {
    const today = new Date().toISOString().split('T')[0];
    return this.activities.filter(a => a.timestamp.startsWith(today)).reverse();
  }

  /** Activities in date range (YYYY-MM-DD) */
  getByDateRange(from, to) {
    return this.activities
      .filter(a => { const d = a.timestamp.split('T')[0]; return d >= from && d <= to; })
      .reverse();
  }

  /** Summary stats */
  getStats() {
    const today           = new Date().toISOString().split('T')[0];
    const todayActivities = this.activities.filter(a => a.timestamp.startsWith(today));
    const stats = {
      total:   this.activities.length,
      today:   todayActivities.length,
      byType:  {},
      byLevel: { success: 0, error: 0, warning: 0, info: 0 },
    };
    this.activities.forEach(a => {
      const base = a.type.split(':')[0];
      stats.byType[base] = (stats.byType[base] || 0) + 1;
      if (stats.byLevel[a.level] !== undefined) stats.byLevel[a.level]++;
    });
    return stats;
  }

  /** Keep only latest N entries */
  cleanup(keep = MAX_ACTIVITIES) {
    if (this.activities.length > keep) {
      this.activities = this.activities.slice(-keep);
      this._save();
      return true;
    }
    return false;
  }

  clear() {
    this.activities = [];
    this._save();
  }
}

module.exports = new ActivityLogger();
