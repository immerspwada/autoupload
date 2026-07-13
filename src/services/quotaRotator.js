/**
 * QuotaRotator — Auto-rotate between multiple Google Cloud Projects
 * เมื่อ account ปัจจุบัน quota หมด → สลับไปใช้ account ถัดไปอัตโนมัติ
 *
 * วิธีใช้ Multi-Project:
 * 1. สร้าง Google Cloud Project ใหม่ที่ console.cloud.google.com
 * 2. Enable YouTube Data API v3
 * 3. สร้าง OAuth 2.0 Client ID ใหม่
 * 4. เพิ่ม account ใหม่ผ่าน /api/accounts (ใส่ clientId + clientSecret ใหม่)
 * 5. Login ด้วย account ใหม่ผ่าน /api/auth/login?accountId=...
 * 6. ระบบจะ rotate ให้อัตโนมัติเมื่อ quota หมด
 *
 * แต่ละ Google Cloud Project = 10,000 units/day = 6 uploads/day
 * 3 Projects = 18 uploads/day, 10 Projects = 60 uploads/day
 */

const accountManager = require('../utils/accounts');
const logger = require('../utils/logger');

const UPLOAD_COST = 1600; // units per upload
const ACTIVE_ACCOUNT_STICKINESS = 250; // avoid needless account switching on close ties

class QuotaRotator {
  constructor() {
    this.rotationLog = []; // ประวัติการ rotate
    this.maxLogEntries = 100;
  }

  /**
   * ★ หัวใจหลัก: หา account ที่ดีที่สุดสำหรับ upload
   * เรียงตาม: quota เหลือมากที่สุด + authenticated + ไม่ blocked
   *
   * @param {number} requiredUnits - จำนวน units ที่ต้องการ (default 1600)
   * @returns {{ account, remaining, totalRemaining, allStatus }}
   */
  getBestAccount(requiredUnits = UPLOAD_COST) {
    const allAccounts = accountManager.getAllAccounts();

    if (allAccounts.length === 0) {
      return { account: null, reason: 'ไม่มี account ในระบบ' };
    }

    const active = accountManager.getActiveAccount();

    // ดึงสถานะทุก account พร้อม decision score
    const statuses = allAccounts.map(acc => {
      const remaining = accountManager.getQuotaRemaining(acc.id);
      const isAuthenticated = !!(acc.token && (acc.token.refresh_token || acc.token.access_token));
      const hasEnough = remaining >= requiredUnits;
      const uploadsLeft = Math.floor(remaining / UPLOAD_COST);
      const unitsAfterUpload = hasEnough ? remaining - requiredUnits : remaining;
      const isActive = active?.id === acc.id;

      // Decision score:
      // 1) maximize actual upload slots first,
      // 2) prefer the active account when it is effectively tied,
      // 3) prefer more remaining units as a final tie-breaker.
      const decisionScore = (uploadsLeft * 10000)
        + (isActive ? ACTIVE_ACCOUNT_STICKINESS : 0)
        + Math.min(remaining, 9999);

      return {
        account: acc,
        remaining,
        isAuthenticated,
        hasEnough,
        uploadsLeft,
        unitsAfterUpload,
        isActive,
        decisionScore,
        percentUsed: Math.round(((acc.quotaUsed || 0) / (acc.quotaLimit || 10000)) * 100),
      };
    });

    // กรองเฉพาะ account ที่ใช้ได้
    const eligible = statuses.filter(s => s.isAuthenticated && s.hasEnough);

    // เรียงตาม score ที่คำนึงถึงจำนวน upload ที่เหลือ + ลดการ rotate ที่ไม่จำเป็น
    eligible.sort((a, b) => b.decisionScore - a.decisionScore);

    const totalRemaining = statuses.reduce((sum, s) => sum + (s.isAuthenticated ? s.remaining : 0), 0);
    const totalUploadsLeft = Math.floor(totalRemaining / UPLOAD_COST);

    if (eligible.length === 0) {
      // หา account ที่ quota หมดล่าสุด (เพื่อบอก reset time)
      const authenticated = statuses.filter(s => s.isAuthenticated);
      return {
        account: null,
        totalRemaining,
        totalUploadsLeft: 0,
        allStatus: statuses,
        reason: authenticated.length === 0
          ? 'ไม่มี account ที่ login แล้ว — กรุณา login อย่างน้อย 1 account'
          : `ทุก account quota หมดแล้ว (รวม ${authenticated.length} accounts) — รีเซ็ตเที่ยงคืน PST`,
      };
    }

    const best = eligible[0];

    return {
      account: best.account,
      remaining: best.remaining,
      uploadsLeft: best.uploadsLeft,
      totalRemaining,
      totalUploadsLeft,
      allStatus: statuses,
      eligibleCount: eligible.length,
      decision: {
        score: best.decisionScore,
        reason: best.isActive
          ? 'active account ยังมี quota พอและคะแนนดีที่สุด'
          : `account นี้มี quota ใช้งานได้มากที่สุด (${best.uploadsLeft} uploads left)`,
        unitsAfterUpload: best.unitsAfterUpload,
      },
    };
  }

  /**
   * Auto-rotate: เลือก account ที่ดีที่สุดและตั้งเป็น active
   * เรียกก่อนทุก upload เพื่อให้แน่ใจว่าใช้ account ที่มี quota
   *
   * @param {number} requiredUnits
   * @returns {{ accountId, accountName, wasRotated, reason }}
   */
  rotateIfNeeded(requiredUnits = UPLOAD_COST) {
    const current = accountManager.getActiveAccount();
    const result = this.getBestAccount(requiredUnits);

    if (!result.account) {
      return {
        accountId: null,
        success: false,
        reason: result.reason,
        totalUploadsLeft: result.totalUploadsLeft || 0,
      };
    }

    const best = result.account;
    const wasRotated = !current || current.id !== best.id;

    // ถ้า best account ต่างจาก current → rotate
    if (wasRotated) {
      accountManager.setActiveAccount(best.id);

      const rotationEntry = {
        timestamp: new Date().toISOString(),
        fromAccount: current ? `${current.name} (${current.id})` : 'none',
        toAccount: `${best.name} (${best.id})`,
        reason: current
          ? `Quota หมด (${accountManager.getQuotaRemaining(current.id)} units เหลือ < ${requiredUnits})`
          : 'ตั้ง account เริ่มต้น',
        newRemaining: result.remaining,
      };

      this.rotationLog.unshift(rotationEntry);
      if (this.rotationLog.length > this.maxLogEntries) {
        this.rotationLog = this.rotationLog.slice(0, this.maxLogEntries);
      }

      logger.info(`[QuotaRotator] Rotated: ${rotationEntry.fromAccount} → ${rotationEntry.toAccount}`, {
        reason: rotationEntry.reason,
        newRemaining: result.remaining,
      });
    }

    return {
      accountId: best.id,
      accountName: best.name,
      wasRotated,
      remaining: result.remaining,
      uploadsLeft: result.uploadsLeft,
      totalUploadsLeft: result.totalUploadsLeft,
      eligibleCount: result.eligibleCount,
      decision: result.decision,
      success: true,
    };
  }

  /**
   * ดูสถานะ quota ทุก account รวมกัน (สำหรับ dashboard)
   */
  getFullStatus() {
    const allAccounts = accountManager.getAllAccounts();
    const active = accountManager.getActiveAccount();

    const accounts = allAccounts.map(acc => {
      const remaining = accountManager.getQuotaRemaining(acc.id);
      const used = acc.quotaUsed || 0;
      const limit = acc.quotaLimit || 10000;
      const isAuthenticated = !!(acc.token && (acc.token.refresh_token || acc.token.access_token));

      return {
        id: acc.id,
        name: acc.name,
        isActive: active?.id === acc.id,
        isAuthenticated,
        channelTitle: acc.channelInfo?.title || null,
        channelSubscribers: acc.channelInfo?.subscribers || null,
        quotaUsed: used,
        quotaLimit: limit,
        quotaRemaining: remaining,
        uploadsLeft: Math.floor(remaining / UPLOAD_COST),
        percentUsed: Math.round((used / limit) * 100),
        status: this._getStatusLevel(used, limit),
        nextUploadAllowed: isAuthenticated && remaining >= UPLOAD_COST,
        lastUsed: acc.lastUsed,
        quotaResetDate: acc.quotaResetDate,
      };
    });

    const totalRemaining = accounts
      .filter(a => a.isAuthenticated)
      .reduce((sum, a) => sum + a.quotaRemaining, 0);

    const totalUploadsLeft = Math.floor(totalRemaining / UPLOAD_COST);
    const authenticatedCount = accounts.filter(a => a.isAuthenticated).length;

    return {
      accounts,
      summary: {
        totalAccounts: accounts.length,
        authenticatedAccounts: authenticatedCount,
        totalQuotaRemaining: totalRemaining,
        totalUploadsLeft,
        activeAccountId: active?.id || null,
        activeAccountName: active?.name || null,
        recommendation: this._buildRecommendation(accounts),
      },
      recentRotations: this.rotationLog.slice(0, 10),
    };
  }

  _buildRecommendation(accounts) {
    const authenticated = accounts.filter(a => a.isAuthenticated);
    if (authenticated.length === 0) {
      return 'ยังไม่มี account ที่ login แล้ว — login อย่างน้อย 1 account ก่อนอัปโหลด';
    }

    const ready = authenticated.filter(a => a.nextUploadAllowed);
    if (ready.length === 0) {
      const totalRemaining = authenticated.reduce((sum, a) => sum + a.quotaRemaining, 0);
      return `quota รวมเหลือ ${totalRemaining} units แต่ไม่พอสำหรับ upload 1 คลิป (${UPLOAD_COST} units)`;
    }

    const best = [...ready].sort((a, b) => b.uploadsLeft - a.uploadsLeft || b.quotaRemaining - a.quotaRemaining)[0];
    return `แนะนำใช้ "${best.name}" สำหรับ upload ถัดไป (${best.uploadsLeft} clips left)`;
  }

  /**
   * สถานะ quota level
   */
  _getStatusLevel(used, limit) {
    const pct = (used / limit) * 100;
    if (pct >= 95) return 'critical';
    if (pct >= 80) return 'warning';
    if (pct >= 50) return 'caution';
    return 'ok';
  }

  /**
   * คำนวณว่า upload ครั้งนี้จะใช้ account ไหน (ไม่เปลี่ยน active account)
   * ใช้สำหรับ preview ใน UI
   */
  preview(count = 1) {
    const allAccounts = accountManager.getAllAccounts();
    const plan = [];
    let remaining = count;

    // เรียง accounts ตาม quota เหลือ
    const sorted = allAccounts
      .filter(acc => !!(acc.token && (acc.token.refresh_token || acc.token.access_token)))
      .map(acc => ({
        ...acc,
        remaining: accountManager.getQuotaRemaining(acc.id),
        uploadsLeft: Math.floor(accountManager.getQuotaRemaining(acc.id) / UPLOAD_COST),
      }))
      .sort((a, b) => b.remaining - a.remaining);

    for (const acc of sorted) {
      if (remaining <= 0) break;
      const willUse = Math.min(acc.uploadsLeft, remaining);
      if (willUse > 0) {
        plan.push({ accountId: acc.id, accountName: acc.name, uploads: willUse });
        remaining -= willUse;
      }
    }

    return {
      plan,
      canUpload: count - remaining,
      cannotUpload: remaining,
      feasible: remaining === 0,
    };
  }
}

module.exports = new QuotaRotator();
