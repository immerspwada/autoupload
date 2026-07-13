// Activity Logger — User-facing event tracking for Dashboard & Timeline
// ★ สำหรับแสดงประวัติกิจกรรมที่ user สนใจ ไม่ใช่ system logs

const fs = require('fs');
const path = require('path');

const ACTIVITY_FILE = path.join(__dirname, '../../data/activity.json');
const MAX_ACTIVITIES = 500; // เก็บไว้ล่าสุด 500 รายการ

/**
 * Activity Types:
 * - upload:success
 * - upload:failed
 * - tiktok:downloaded
 * - tiktok:uploaded
 * - queue:completed
 * - queue:drain
 * - scheduler:scan
 * - auth:login
 * - auth:logout
 * - health:cleanup
 */

class ActivityLogger {
  constructor() {
    this.activities = this._load();
  }

  _load() {
    if (!fs.existsSync(ACTIVITY_FILE)) {
      return [];
    }
    try {
      return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
    } catch (err) {
      console.error('Activity load error:', err.message);
      return [];
    }
  }

  _save() {
    try {
      // Keep only last MAX_ACTIVITIES
      if (this.activities.length > MAX_ACTIVITIES) {
        this.activities = this.activities.slice(-MAX_ACTIVITIES);
      }
      fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(this.activities, null, 2));
    } catch (err) {
      console.error('Activity save error:', err.message);
    }
  }

  /**
   * Log an activity
   * @param {string} type - Activity type (e.g., 'upload:success')
   * @param {string} message - Human-readable message
   * @param {object} data - Additional data (filename, url, etc.)
   * @param {string} level - 'success' | 'error' | 'warning' | 'info'
   */
  log(type, message, data = {}, level = 'info') {
    const activity = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      type,
      message,
      data,
      level,
      timestamp: new Date().toISOString()
    };

    this.activities.push(activity);
    this._save();

    return activity;
  }

  /**
   * Get recent activities
   * @param {number} limit - Number of activities to return
   * @param {string} type - Filter by type (optional)
   * @returns {Array} Activities sorted by newest first
   */
  getRecent(limit = 50, type = null) {
    let filtered = [...this.activities];
    
    if (type) {
      filtered = filtered.filter(a => a.type === type || a.type.startsWith(type + ':'));
    }

    return filtered.slice(-limit).reverse();
  }

  /**
   * Get activities for today
   */
  getToday() {
    const today = new Date().toISOString().split('T')[0];
    return this.activities.filter(a => a.timestamp.startsWith(today)).reverse();
  }

  /**
   * Get activities by date range
   * @param {string} from - ISO date string
   * @param {string} to - ISO date string
   */
  getByDateRange(from, to) {
    return this.activities.filter(a => {
      const date = a.timestamp.split('T')[0];
      return date >= from && date <= to;
    }).reverse();
  }

  /**
   * Get activity statistics
   */
  getStats() {
    const today = new Date().toISOString().split('T')[0];
    const todayActivities = this.activities.filter(a => a.timestamp.startsWith(today));

    const stats = {
      total: this.activities.length,
      today: todayActivities.length,
      byType: {},
      byLevel: {
        success: 0,
        error: 0,
        warning: 0,
        info: 0
      }
    };

    this.activities.forEach(a => {
      // Count by type
      const baseType = a.type.split(':')[0];
      stats.byType[baseType] = (stats.byType[baseType] || 0) + 1;

      // Count by level
      if (stats.byLevel.hasOwnProperty(a.level)) {
        stats.byLevel[a.level]++;
      }
    });

    return stats;
  }

  /**
   * Clear old activities (keep last N)
   */
  cleanup(keep = MAX_ACTIVITIES) {
    if (this.activities.length > keep) {
      this.activities = this.activities.slice(-keep);
      this._save();
      return true;
    }
    return false;
  }

  /**
   * Clear all activities
   */
  clear() {
    this.activities = [];
    this._save();
  }
}

module.exports = new ActivityLogger();
