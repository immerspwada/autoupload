// ═══════════════════════════════════════════════════════════════════
// YouTube API Quota Manager — จัดการ quota limit 10,000 units/day
//
// YouTube API Costs (per operation):
//   - Video upload: 1,600 units (ตัวแรง)
//   - Video list: 1 unit
//   - Search: 100 units
//   - Channel info: 1 unit
//
// Default quota: 10,000 units/day (free tier)
//   = 6 uploads/day max (10,000 / 1,600 = 6.25)
//
// ⚠️ ถ้าเกิน → ต้อรอ 24 ชม. (reset เที่ยงคืน PST)
// 💡 Extended quota: ขอเพิ่มได้ถึง 1M+ units/day (ต้องสมัคร)
// ═══════════════════════════════════════════════════════════════════

const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');
const C      = require('../config/constants');

const QUOTA_FILE   = path.join(__dirname, '../../data/quota.json');
const DAILY_LIMIT  = C.YOUTUBE.DAILY_QUOTA_LIMIT;
const UPLOAD_COST  = C.YOUTUBE.UPLOAD_COST;
const RESET_HOUR_PST = 0; // Midnight PST

class QuotaManager {
  constructor() {
    this.data = this._load();
  }

  _load() {
    if (!fs.existsSync(QUOTA_FILE)) {
      return this._createDefault();
    }
    try {
      return JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
    } catch (error) {
      logger.error('Failed to load quota data', { error: error.message });
      return this._createDefault();
    }
  }

  _save() {
    try {
      const dir = path.dirname(QUOTA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(QUOTA_FILE, JSON.stringify(this.data, null, 2));
    } catch (error) {
      logger.error('Failed to save quota data', { error: error.message });
    }
  }

  _createDefault() {
    return {
      dailyLimit: DAILY_LIMIT,
      used: 0,
      date: this._getQuotaDate(),
      history: [],
      extendedQuota: false, // ถ้าขอ extended quota สำเร็จ ตั้งเป็น true
      lastReset: new Date().toISOString()
    };
  }

  /**
   * YouTube quota resets at midnight PST (UTC-8)
   * Return date string in format YYYY-MM-DD for PST timezone
   */
  _getQuotaDate() {
    const now = new Date();
    // Convert to PST (UTC-8)
    const pstOffset = -8 * 60; // minutes
    const pstTime = new Date(now.getTime() + (pstOffset + now.getTimezoneOffset()) * 60000);
    return pstTime.toISOString().split('T')[0];
  }

  /**
   * Check if quota has reset (new day in PST)
   */
  _checkReset() {
    const currentDate = this._getQuotaDate();
    if (this.data.date !== currentDate) {
      logger.info('Quota reset detected', { oldDate: this.data.date, newDate: currentDate });
      
      // Archive old day stats
      this.data.history.push({
        date: this.data.date,
        used: this.data.used,
        limit: this.data.dailyLimit,
        percentage: ((this.data.used / this.data.dailyLimit) * 100).toFixed(1)
      });

      // Keep only last 30 days
      if (this.data.history.length > 30) {
        this.data.history = this.data.history.slice(-30);
      }

      // Reset for new day
      this.data.used = 0;
      this.data.date = currentDate;
      this.data.lastReset = new Date().toISOString();
      this._save();
    }
  }

  /**
   * Check if there's enough quota for an operation
   * @param {number} cost - Units required (default: 1600 for upload)
   * @returns {object} { allowed, remaining, used, limit, message }
   */
  check(cost = UPLOAD_COST) {
    this._checkReset();
    
    const remaining = this.data.dailyLimit - this.data.used;
    const allowed = remaining >= cost;
    const percentUsed = ((this.data.used / this.data.dailyLimit) * 100).toFixed(1);

    return {
      allowed,
      remaining,
      used: this.data.used,
      limit: this.data.dailyLimit,
      percentUsed: parseFloat(percentUsed),
      cost,
      message: allowed 
        ? `Quota OK: ${remaining} units remaining (${100 - percentUsed}%)`
        : `❌ Quota exceeded: ${this.data.used}/${this.data.dailyLimit} units used. Resets at midnight PST.`
    };
  }

  /**
   * Consume quota units for an operation
   * @param {number} cost - Units to consume
   * @param {string} operation - Operation name for logging
   * @returns {boolean} Success
   */
  consume(cost = UPLOAD_COST, operation = 'upload') {
    this._checkReset();

    const check = this.check(cost);
    if (!check.allowed) {
      logger.warn('Quota exceeded', { 
        operation, 
        cost, 
        used: this.data.used, 
        limit: this.data.dailyLimit 
      });
      return false;
    }

    this.data.used += cost;
    this._save();

    logger.info('Quota consumed', { 
      operation, 
      cost, 
      used: this.data.used, 
      remaining: this.data.dailyLimit - this.data.used,
      percentUsed: check.percentUsed 
    });

    return true;
  }

  /**
   * Calculate how many uploads can still be done today
   */
  getUploadsRemaining() {
    this._checkReset();
    const remaining = this.data.dailyLimit - this.data.used;
    return Math.floor(remaining / UPLOAD_COST);
  }

  /**
   * Get current quota status
   */
  getStatus() {
    this._checkReset();
    const remaining = this.data.dailyLimit - this.data.used;
    const percentUsed = ((this.data.used / this.data.dailyLimit) * 100).toFixed(1);
    const uploadsRemaining = Math.floor(remaining / UPLOAD_COST);
    const nextReset = this._getNextResetTime();

    return {
      date: this.data.date,
      used: this.data.used,
      limit: this.data.dailyLimit,
      remaining,
      percentUsed: parseFloat(percentUsed),
      uploadsRemaining,
      nextReset,
      extendedQuota: this.data.extendedQuota,
      status: percentUsed < 80 ? 'ok' : percentUsed < 95 ? 'warning' : 'critical'
    };
  }

  /**
   * Calculate next reset time (midnight PST)
   */
  _getNextResetTime() {
    const now = new Date();
    const pstOffset = -8 * 60 * 60 * 1000; // PST is UTC-8
    const localOffset = now.getTimezoneOffset() * 60 * 1000;
    
    // Current time in PST
    const pstNow = new Date(now.getTime() + localOffset + pstOffset);
    
    // Next midnight PST
    const nextMidnight = new Date(pstNow);
    nextMidnight.setHours(24, 0, 0, 0);
    
    // Convert back to local time
    const nextResetLocal = new Date(nextMidnight.getTime() - localOffset - pstOffset);
    
    return nextResetLocal.toISOString();
  }

  /**
   * Get quota history (last 30 days)
   */
  getHistory() {
    return this.data.history || [];
  }

  /**
   * Set extended quota (after approval from Google)
   * @param {number} newLimit - New daily limit (e.g., 1000000)
   */
  setExtendedQuota(newLimit) {
    this.data.dailyLimit = newLimit;
    this.data.extendedQuota = true;
    this._save();
    logger.info('Extended quota activated', { newLimit });
  }

  /**
   * Manually reset quota (for testing or emergency)
   */
  forceReset() {
    const oldUsed = this.data.used;
    this.data.used = 0;
    this.data.lastReset = new Date().toISOString();
    this._save();
    logger.warn('Quota force reset', { oldUsed });
  }

  /**
   * Estimate upload capacity for a batch
   * @param {number} count - Number of videos
   * @returns {object} Analysis with recommendations
   */
  estimateBatch(count) {
    this._checkReset();
    const totalCost = count * UPLOAD_COST;
    const remaining = this.data.dailyLimit - this.data.used;
    const canUpload = Math.floor(remaining / UPLOAD_COST);

    return {
      requested: count,
      canUpload,
      totalCost,
      remaining,
      willExceed: totalCost > remaining,
      recommendation: totalCost > remaining
        ? `⚠️ สามารถอัปโหลดได้เพียง ${canUpload}/${count} วิดีโอวันนี้ (quota เหลือ ${remaining}/${this.data.dailyLimit})`
        : `✓ สามารถอัปโหลดได้ครบ ${count} วิดีโอ (quota เหลือ ${remaining - totalCost}/${this.data.dailyLimit} หลังอัป)`
    };
  }

  /**
   * Smart filtering: เลือกวิดีโอที่ควรอัปโหลดตาม quota ที่เหลือ
   * เมื่อ quota น้อย → อัปแค่คลิป high-virality
   * @param {Array} videos - Array of video objects with virality scores
   * @returns {object} { allowed, rejected, reason }
   */
  filterByQuota(videos) {
    this._checkReset();
    const status = this.getStatus();
    const uploadsRemaining = status.uploadsRemaining;

    // ถ้า quota เหลือเยอะ (>50%) → อนุญาตทั้งหมด
    if (status.percentUsed < 50) {
      return {
        allowed: videos,
        rejected: [],
        reason: `Quota เพียงพอ (${uploadsRemaining} slots remaining)`
      };
    }

    // ถ้า quota น้อย → เลือกแค่คลิปดีที่สุด
    const sorted = [...videos].sort((a, b) => {
      const scoreA = a.virality?.score || 0;
      const scoreB = b.virality?.score || 0;
      return scoreB - scoreA; // descending
    });

    // กำหนดเกณฑ์ตาม quota ที่เหลือ
    let minScore = 0;
    if (status.percentUsed >= 95) {
      minScore = 75; // Critical: only viral (🔥)
    } else if (status.percentUsed >= 80) {
      minScore = 55; // Warning: only hot+ (📈)
    } else if (status.percentUsed >= 50) {
      minScore = 35; // Caution: skip low-tier (📉)
    }

    const allowed = sorted
      .filter(v => (v.virality?.score || 0) >= minScore)
      .slice(0, uploadsRemaining);

    const rejected = sorted.filter(v => !allowed.includes(v));

    let reason = '';
    if (status.percentUsed >= 95) {
      reason = `🚨 Quota วิกฤต (${status.percentUsed}%) - อัปเฉพาะคลิป viral (score ≥75) เท่านั้น`;
    } else if (status.percentUsed >= 80) {
      reason = `⚠️ Quota ใกล้หมด (${status.percentUsed}%) - อัปเฉพาะคลิปดี (score ≥55)`;
    } else if (status.percentUsed >= 50) {
      reason = `💡 Quota เหลือน้อย (${status.percentUsed}%) - ข้ามคลิป low-virality (score <35)`;
    }

    return { allowed, rejected, reason, minScore };
  }

  /**
   * คำแนะนำสำหรับขอ Extended Quota
   */
  getExtendedQuotaGuide() {
    return {
      currentLimit: this.data.dailyLimit,
      isExtended: this.data.extendedQuota,
      guide: {
        step1: 'ไปที่ https://console.cloud.google.com',
        step2: 'เลือก Project ที่ใช้ YouTube Data API v3',
        step3: 'ไปที่ APIs & Services → YouTube Data API v3 → Quotas',
        step4: 'คลิก "Edit Quotas" หรือ "Request Quota Increase"',
        step5: 'ขอเพิ่มเป็น 1,000,000 units/day (หรือมากกว่า)',
        step6: 'เหตุผล: "Building automated content curation system for YouTube monetization. Need to upload 50-100 videos/day from curated TikTok content with SEO optimization."',
        step7: 'รอ Google อนุมัติ (1-3 วัน)',
        step8: 'หลังอนุมัติ: เรียก /api/quota/set-extended?limit=1000000'
      },
      benefits: {
        current: `${Math.floor(this.data.dailyLimit / UPLOAD_COST)} uploads/day`,
        after: '600+ uploads/day (with 1M quota)'
      }
    };
  }
}

module.exports = new QuotaManager();
