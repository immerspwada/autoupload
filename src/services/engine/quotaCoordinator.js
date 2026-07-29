/**
 * ★ Quota Coordinator — จัดการ quota ทุก account + durable wait
 *
 * หน้าที่:
 *   1. เรียก quotaRotator.rotateIfNeeded() เลือก account ที่มี quota
 *   2. ถ้าทุก account หมด → คำนวณ Quota_Reset_Time (DST-safe)
 *   3. Handle 403 quota reconciliation
 *   4. Handle token revoked → reauth_required
 */
'use strict';

const logger = require('../../utils/logger');
const C      = require('../../config/constants');

class QuotaCoordinator {
  constructor() {
    this._reconcileCount = new Map(); // accountId → count per clip attempt
  }

  /**
   * เลือก account ที่มี quota เพียงพอสำหรับ 1 upload
   * @returns {{ accountId: string, rotated: boolean } | null} null = ทุก account หมด
   */
  selectAccount() {
    const quotaRotator = require('../quotaRotator');
    const rotation = quotaRotator.rotateIfNeeded(C.YOUTUBE.UPLOAD_COST);

    if (rotation.success) {
      return {
        accountId: rotation.accountId,
        rotated: rotation.wasRotated || false,
        uploadsLeft: rotation.uploadsLeft || 0,
      };
    }

    // ทุก account หมด quota
    return null;
  }

  /**
   * คำนวณ Quota_Reset_Time — เวลา reset ที่เร็วที่สุดของทุก account
   * DST-safe: ใช้ Intl.DateTimeFormat กับ timezone America/Los_Angeles
   * ไม่ใช้ค่า offset คงที่ (-8) เพราะ PDT = -7
   */
  computeEarliestReset() {
    const accountManager = require('../../utils/accounts');
    const accounts = accountManager.getAllAuthenticated ? accountManager.getAllAuthenticated() : [];

    if (accounts.length === 0) {
      // ไม่มี account เลย — fallback: เที่ยงคืน PST/PDT ถัดไป
      return this._nextMidnightLA();
    }

    let earliest = Infinity;

    for (const acc of accounts) {
      const resetDate = acc.quotaResetDate; // "YYYY-MM-DD" in PST/PDT
      const resetTime = this._nextMidnightAfter(resetDate);
      if (resetTime < earliest) earliest = resetTime;
    }

    if (earliest === Infinity) {
      earliest = this._nextMidnightLA();
    }

    // Add buffer
    const buffered = earliest + (C.YOUTUBE.QUOTA_RESET_BUFFER_MINUTES * 60_000);

    // Clamp: min 1 min, max 24h + buffer from now
    const now = Date.now();
    const maxMs = (24 * 60 + C.YOUTUBE.QUOTA_RESET_BUFFER_MINUTES) * 60_000;
    const clamped = Math.max(now + 60_000, Math.min(buffered, now + maxMs));

    if (clamped !== buffered) {
      logger.warn('[QuotaCoordinator] Reset time clamped', {
        computed: new Date(buffered).toISOString(),
        clamped: new Date(clamped).toISOString(),
      });
    }

    return clamped;
  }

  /**
   * Handle 403 quotaExceeded when ledger says quota is available
   * @returns {boolean} true if another account is available, false if all exhausted
   */
  reconcileQuotaError(accountId) {
    const accountManager = require('../../utils/accounts');
    const quotaRotator   = require('../quotaRotator');

    // Limit: max 1 reconcile per account per clip
    const key = accountId;
    const count = this._reconcileCount.get(key) || 0;
    if (count >= 1) {
      logger.warn('[QuotaCoordinator] Already reconciled this account for this clip', { accountId });
      return false;
    }
    this._reconcileCount.set(key, count + 1);

    // Mark account as exhausted for today
    const acc = accountManager.getAccount(accountId);
    if (acc) {
      accountManager.updateQuotaUsage(accountId, acc.quotaLimit - acc.quotaUsed); // fill to limit
      logger.info('[QuotaCoordinator] Account marked exhausted (403 reconcile)', { accountId });
    }

    // Try to rotate to another account
    const rotation = quotaRotator.rotateIfNeeded(C.YOUTUBE.UPLOAD_COST);
    return rotation.success;
  }

  /**
   * Reset per-clip reconcile counters (call at start of each clip)
   */
  resetReconcileCounters() {
    this._reconcileCount.clear();
  }

  /**
   * Get total uploads remaining across all authenticated accounts
   */
  getTotalUploadsLeft() {
    const quotaRotator = require('../quotaRotator');
    const status = quotaRotator.getFullStatus();
    return status.summary?.totalUploadsLeft ?? 0;
  }

  /**
   * Get status for Engine_Status reporting
   */
  getQuotaStatus() {
    const accountManager = require('../../utils/accounts');
    const quotaRotator   = require('../quotaRotator');
    const status = quotaRotator.getFullStatus();

    return {
      totalUploadsLeft: status.summary?.totalUploadsLeft ?? 0,
      activeAccountId: accountManager.getActiveAccountId?.() ?? null,
      accountsAuthenticated: status.accounts?.filter(a => a.isAuthenticated).length ?? 0,
      accountsNeedingReauth: status.accounts?.filter(a => a.needsReauth).length ?? 0,
      nextResetAt: new Date(this.computeEarliestReset()).toISOString(),
    };
  }

  // ── Private: DST-safe time calculation ──────────────────────────

  /**
   * Next midnight in America/Los_Angeles after the given date string
   * @param {string} dateStr "YYYY-MM-DD" representing the last reset date in LA time
   */
  _nextMidnightAfter(dateStr) {
    if (!dateStr) return this._nextMidnightLA();

    try {
      // Parse the date in LA timezone
      // The next midnight after `dateStr` in LA time
      const parts = dateStr.split('-').map(Number);
      if (parts.length !== 3) return this._nextMidnightLA();

      // Get current LA date/time to decide if we're already past this midnight
      const now = new Date();
      const laDate = this._getLADate(now);

      // If the reset date is today or in the future, next reset is tomorrow midnight LA
      // If the reset date is in the past, next reset is today midnight LA (already passed)
      const resetDateStr = dateStr;
      const todayLA = `${laDate.year}-${String(laDate.month).padStart(2, '0')}-${String(laDate.day).padStart(2, '0')}`;

      if (resetDateStr >= todayLA) {
        // Reset date is today or future — next midnight is tomorrow
        return this._midnightLAForDate(laDate.year, laDate.month, laDate.day + 1);
      } else {
        // Reset date is in the past — next midnight is today (may have already passed)
        const todayMidnight = this._midnightLAForDate(laDate.year, laDate.month, laDate.day);
        if (todayMidnight > now.getTime()) return todayMidnight;
        // Already past today's midnight → tomorrow
        return this._midnightLAForDate(laDate.year, laDate.month, laDate.day + 1);
      }
    } catch (_) {
      return this._nextMidnightLA();
    }
  }

  _nextMidnightLA() {
    const now = new Date();
    const la = this._getLADate(now);
    // Try today's midnight first
    const todayMidnight = this._midnightLAForDate(la.year, la.month, la.day);
    if (todayMidnight > now.getTime()) return todayMidnight;
    // Tomorrow
    return this._midnightLAForDate(la.year, la.month, la.day + 1);
  }

  /**
   * Get midnight (00:00:00) in America/Los_Angeles for a given date
   * Returns epoch milliseconds in UTC
   */
  _midnightLAForDate(year, month, day) {
    // Use a known technique: create a date string and parse with LA timezone
    // JavaScript Date doesn't support arbitrary timezone construction, but we can iterate
    const target = new Date(year, month - 1, day, 12, 0, 0); // start at noon to avoid DST boundary issues
    
    // Binary search for the exact midnight in LA time
    // Alternative: use the formatter to find the offset
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });

    // Find the UTC time when LA shows midnight for this date
    // Approach: guess UTC = date midnight + 8h (PST) then adjust
    let guess = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T08:00:00Z`).getTime();

    // Verify and adjust (handles DST correctly)
    for (let i = 0; i < 3; i++) {
      const parts = formatter.formatToParts(new Date(guess));
      const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
      const diffMin = h * 60 + m; // how far we are from midnight
      if (diffMin === 0) break;
      // Adjust guess
      if (diffMin <= 720) {
        guess -= diffMin * 60_000; // we're past midnight, go back
      } else {
        guess += (1440 - diffMin) * 60_000; // we're before midnight, go forward
      }
    }

    return guess;
  }

  /**
   * Get current date components in America/Los_Angeles
   */
  _getLADate(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: 'numeric', day: 'numeric',
    });
    const parts = formatter.formatToParts(date);
    return {
      year:  parseInt(parts.find(p => p.type === 'year')?.value || '2026'),
      month: parseInt(parts.find(p => p.type === 'month')?.value || '1'),
      day:   parseInt(parts.find(p => p.type === 'day')?.value || '1'),
    };
  }
}

module.exports = new QuotaCoordinator();
