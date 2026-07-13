/**
 * Multi-Account Management System
 * จัดการหลาย YouTube accounts พร้อม credentials แยกกัน
 */

const fs = require('fs');
const path = require('path');

const ACCOUNTS_FILE = path.join(process.cwd(), 'data', 'accounts.json');

class AccountManager {
  constructor() {
    this.accounts = this.load();
    this.activeAccountId = this.getActiveAccountId();
  }

  /**
   * โหลด accounts จากไฟล์
   */
  load() {
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('[Accounts] Load error:', error);
    }

    // Default structure
    return {
      accounts: [],
      activeAccountId: null,
    };
  }

  /**
   * บันทึก accounts
   */
  save() {
    try {
      const dir = path.dirname(ACCOUNTS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2));
    } catch (error) {
      console.error('[Accounts] Save error:', error);
      throw error;
    }
  }

  /**
   * เพิ่ม account ใหม่
   */
  addAccount(accountData) {
    const {
      name,
      clientId,
      clientSecret,
      redirectUri = 'http://localhost:3000/oauth2callback',
    } = accountData;

    if (!name || !clientId || !clientSecret) {
      throw new Error('Missing required fields: name, clientId, clientSecret');
    }

    const account = {
      id: `acc_${Date.now()}`,
      name,
      clientId,
      clientSecret,
      redirectUri,
      token: null,
      channelInfo: null,
      quotaUsed: 0,
      quotaLimit: 10000,
      createdAt: new Date().toISOString(),
      lastUsed: null,
    };

    this.accounts.accounts.push(account);
    
    // ถ้ายังไม่มี active account ให้ตั้งเป็น default
    if (!this.accounts.activeAccountId) {
      this.accounts.activeAccountId = account.id;
      this.activeAccountId = account.id;
    }

    this.save();
    return account;
  }

  /**
   * ลบ account
   */
  removeAccount(accountId) {
    const index = this.accounts.accounts.findIndex(a => a.id === accountId);
    if (index === -1) {
      throw new Error('Account not found');
    }

    this.accounts.accounts.splice(index, 1);

    // ถ้าลบ active account ให้เปลี่ยนไปอันแรก
    if (this.accounts.activeAccountId === accountId) {
      this.accounts.activeAccountId = this.accounts.accounts[0]?.id || null;
      this.activeAccountId = this.accounts.activeAccountId;
    }

    this.save();
  }

  /**
   * อัปเดต account
   */
  updateAccount(accountId, updates) {
    const account = this.accounts.accounts.find(a => a.id === accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    Object.assign(account, updates);
    this.save();
    return account;
  }

  /**
   * ตั้ง active account
   */
  setActiveAccount(accountId) {
    const account = this.accounts.accounts.find(a => a.id === accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    this.accounts.activeAccountId = accountId;
    this.activeAccountId = accountId;
    this.save();
    return account;
  }

  /**
   * ดึง active account
   */
  getActiveAccount() {
    if (!this.activeAccountId) {
      return null;
    }
    return this.accounts.accounts.find(a => a.id === this.activeAccountId);
  }

  /**
   * ดึง account ทั้งหมด
   */
  getAllAccounts() {
    return this.accounts.accounts;
  }

  /**
   * ดึง account ตาม ID
   */
  getAccount(accountId) {
    return this.accounts.accounts.find(a => a.id === accountId);
  }

  /**
   * บันทึก token สำหรับ account
   */
  saveToken(accountId, token) {
    const account = this.getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    account.token = token;
    account.lastUsed = new Date().toISOString();
    this.save();
  }

  /**
   * ดึง token ของ active account
   */
  getActiveToken() {
    const account = this.getActiveAccount();
    return account?.token || null;
  }

  /**
   * อัปเดต quota usage
   */
  updateQuotaUsage(accountId, unitsUsed) {
    const account = this.getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    // Check reset before adding usage
    this._checkQuotaReset(account);
    account.quotaUsed = (account.quotaUsed || 0) + unitsUsed;
    this.save();
  }

  /**
   * รีเซ็ต quota (ทุกวัน)
   */
  resetQuota(accountId) {
    const account = this.getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    account.quotaUsed = 0;
    this.save();
  }

  /**
   * ตรวจสอบ quota remaining
   * Auto-resets quotaUsed ถ้าวันเปลี่ยน (PST midnight)
   */
  getQuotaRemaining(accountId) {
    const account = this.getAccount(accountId);
    if (!account) {
      return 0;
    }

    // Auto-reset: check if quota date has changed (PST midnight reset)
    this._checkQuotaReset(account);

    return Math.max(0, (account.quotaLimit || 10000) - (account.quotaUsed || 0));
  }

  /**
   * คำนวณวันที่ปัจจุบัน (PST timezone) สำหรับ quota reset
   * YouTube reset quota ที่เที่ยงคืน PST (UTC-8)
   */
  _getPSTDate() {
    const now = new Date();
    const pstOffset = -8 * 60; // PST = UTC-8
    const pstTime = new Date(now.getTime() + (pstOffset + now.getTimezoneOffset()) * 60000);
    return pstTime.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * ตรวจสอบและ reset quota ถ้าวันเปลี่ยน (PST)
   * เรียกอัตโนมัติก่อนทุก quota check
   */
  _checkQuotaReset(account) {
    const todayPST = this._getPSTDate();
    const lastResetDate = account.quotaResetDate || null;

    if (lastResetDate !== todayPST) {
      // วันใหม่ → reset quota
      console.log(`[Accounts] Auto-resetting quota for "${account.name}" (${lastResetDate} → ${todayPST})`);
      account.quotaUsed = 0;
      account.quotaResetDate = todayPST;
      this.save();
    }
  }

  /**
   * ดึง active account ID
   */
  getActiveAccountId() {
    return this.accounts.activeAccountId || null;
  }

  /**
   * บันทึก channel info
   */
  saveChannelInfo(accountId, channelInfo) {
    const account = this.getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    account.channelInfo = channelInfo;
    this.save();
  }
}

module.exports = new AccountManager();
