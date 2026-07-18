/**
 * ★ Multi-Account Management System
 *   - Atomic write (write-then-rename) — ป้องกัน corrupt ถ้า crash ระหว่างเขียน
 *   - Auto PST quota reset ต่อ account
 *   - Secrets (clientSecret, token) ไม่ถูกส่งออกผ่าน API (route จัดการแยก)
 */

const fs   = require('fs');
const path = require('path');

const ACCOUNTS_FILE = path.join(process.cwd(), 'data', 'accounts.json');

class AccountManager {
  constructor() {
    this.accounts        = this._load();
    this.activeAccountId = this.accounts.activeAccountId || null;
  }

  // ── Persistence ───────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      }
    } catch (err) {
      console.error('[Accounts] Load error:', err.message);
    }
    return { accounts: [], activeAccountId: null };
  }

  /**
   * ★ Atomic save — write to .tmp then rename (POSIX atomic)
   * ป้องกัน JSON corrupt ถ้า process crash ระหว่างเขียน
   */
  _save() {
    try {
      const dir = path.dirname(ACCOUNTS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = ACCOUNTS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.accounts, null, 2), 'utf8');
      fs.renameSync(tmp, ACCOUNTS_FILE);
    } catch (err) {
      console.error('[Accounts] Save error:', err.message);
      throw err;
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  addAccount({ name, clientId, clientSecret, redirectUri = 'http://localhost:3000/oauth2callback' }) {
    if (!name || !clientId || !clientSecret) {
      throw new Error('Missing required fields: name, clientId, clientSecret');
    }

    const account = {
      id:              `acc_${Date.now()}`,
      name,
      clientId,
      clientSecret,
      redirectUri,
      token:           null,
      channelInfo:     null,
      quotaUsed:       0,
      quotaLimit:      10000,
      quotaResetDate:  null,
      createdAt:       new Date().toISOString(),
      lastUsed:        null,
    };

    this.accounts.accounts.push(account);

    // ถ้ายังไม่มี active account ให้ตั้งเป็น default
    if (!this.accounts.activeAccountId) {
      this.accounts.activeAccountId = account.id;
      this.activeAccountId          = account.id;
    }

    this._save();
    return account;
  }

  removeAccount(accountId) {
    const idx = this.accounts.accounts.findIndex(a => a.id === accountId);
    if (idx === -1) throw new Error('Account not found');

    this.accounts.accounts.splice(idx, 1);

    // ถ้าลบ active account → เปลี่ยนไป account แรกที่เหลือ
    if (this.accounts.activeAccountId === accountId) {
      this.accounts.activeAccountId = this.accounts.accounts[0]?.id || null;
      this.activeAccountId          = this.accounts.activeAccountId;
    }

    this._save();
  }

  updateAccount(accountId, updates) {
    const account = this._findOrThrow(accountId);
    // อนุญาต update เฉพาะ fields ที่ safe
    const allowed = ['name', 'clientId', 'clientSecret', 'redirectUri'];
    allowed.forEach(f => {
      if (updates[f] !== undefined) account[f] = updates[f];
    });
    this._save();
    return account;
  }

  // ── Auth ──────────────────────────────────────────────────────────

  setActiveAccount(accountId) {
    const account = this._findOrThrow(accountId);
    this.accounts.activeAccountId = accountId;
    this.activeAccountId          = accountId;
    this._save();
    return account;
  }

  getActiveAccount() {
    if (!this.activeAccountId) return null;
    return this.accounts.accounts.find(a => a.id === this.activeAccountId) || null;
  }

  getActiveAccountId() {
    return this.accounts.activeAccountId || null;
  }

  getAllAccounts() {
    return this.accounts.accounts;
  }

  getAccount(accountId) {
    return this.accounts.accounts.find(a => a.id === accountId) || null;
  }

  // ── Token ─────────────────────────────────────────────────────────

  saveToken(accountId, token) {
    const account        = this._findOrThrow(accountId);
    account.token        = token;
    account.lastUsed     = new Date().toISOString();
    this._save();
  }

  getActiveToken() {
    return this.getActiveAccount()?.token || null;
  }

  // ── Quota ─────────────────────────────────────────────────────────

  updateQuotaUsage(accountId, unitsUsed) {
    const account = this._findOrThrow(accountId);
    this._checkQuotaReset(account);
    account.quotaUsed = (account.quotaUsed || 0) + unitsUsed;
    this._save();
  }

  resetQuota(accountId) {
    const account     = this._findOrThrow(accountId);
    account.quotaUsed = 0;
    this._save();
  }

  /**
   * ★ getQuotaRemaining — auto-resets quotaUsed ถ้าวัน PST เปลี่ยน
   */
  getQuotaRemaining(accountId) {
    const account = this.getAccount(accountId);
    if (!account) return 0;
    this._checkQuotaReset(account);
    return Math.max(0, (account.quotaLimit || 10000) - (account.quotaUsed || 0));
  }

  // ── Channel Info ──────────────────────────────────────────────────

  saveChannelInfo(accountId, channelInfo) {
    const account     = this._findOrThrow(accountId);
    account.channelInfo = channelInfo;
    this._save();
  }

  // ── Private Helpers ───────────────────────────────────────────────

  /**
   * PST (UTC-8) date string YYYY-MM-DD
   * YouTube quota resets at midnight PST
   */
  _getPSTDate() {
    const now       = new Date();
    const pstOffset = -8 * 60; // minutes
    const pstTime   = new Date(now.getTime() + (pstOffset + now.getTimezoneOffset()) * 60_000);
    return pstTime.toISOString().split('T')[0];
  }

  /**
   * ★ Auto-reset quota ถ้าวัน PST เปลี่ยน
   * เรียกก่อนทุก quota check/update
   */
  _checkQuotaReset(account) {
    const todayPST = this._getPSTDate();
    if (account.quotaResetDate !== todayPST) {
      account.quotaUsed      = 0;
      account.quotaResetDate = todayPST;
      this._save();
    }
  }

  _findOrThrow(accountId) {
    const account = this.getAccount(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    return account;
  }
}

module.exports = new AccountManager();
