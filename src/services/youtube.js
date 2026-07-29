// YouTube Service - OAuth & Upload logic with token refresh + Multi-Account Support
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const logger = require('../utils/logger');
const quotaManager = require('./quota');
const accountManager = require('../utils/accounts');
const quotaRotator = require('./quotaRotator');
const C = require('../config/constants');
const { guarded } = require('../utils/resilience');

const TOKEN_PATH = path.join(__dirname, '../../token.json');
const CRED_PATH = path.join(__dirname, '../../client_secret.json');

class YouTubeService {
  constructor() {
    this.oauth2Client = null;
    this.credentials = null;
    this.oauth2Clients = new Map(); // Cache OAuth clients per account
  }

  /**
   * Get OAuth2 Client for specific account or active account
   * @param {string} accountId - Optional account ID, defaults to active account
   */
  getOAuth2Client(accountId = null) {
    // ถ้าระบุ accountId ให้ใช้ account นั้น
    if (accountId) {
      return this._getAccountOAuth2Client(accountId);
    }

    // ถ้าไม่ระบุ ลองใช้ active account ก่อน
    const activeAccount = accountManager.getActiveAccount();
    if (activeAccount) {
      return this._getAccountOAuth2Client(activeAccount.id);
    }

    // Fallback: ใช้ระบบเดิม (client_secret.json + token.json)
    return this._getLegacyOAuth2Client();
  }

  /**
   * Get OAuth2 client for specific account (from account manager)
   */
  _getAccountOAuth2Client(accountId) {
    const account = accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    // Use cached client if available
    if (this.oauth2Clients.has(accountId)) {
      const client = this.oauth2Clients.get(accountId);
      // Update credentials if token exists
      if (account.token) {
        client.setCredentials(account.token);
      }
      return client;
    }

    // Create new OAuth2 client for this account
    const appUrl = process.env.APP_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
    const redirectUri = appUrl
      ? `${appUrl}/oauth2callback`
      : account.redirectUri || 'http://localhost:3000/oauth2callback';
    const client = new google.auth.OAuth2(
      account.clientId,
      account.clientSecret,
      redirectUri
    );

    // Auto-refresh token handler
    client.on('tokens', (tokens) => {
      logger.info('Token refreshed automatically', { accountId });
      const existing = account.token || {};
      const updated = { ...existing, ...tokens };
      accountManager.saveToken(accountId, updated);
    });

    // Set credentials if token exists
    if (account.token) {
      client.setCredentials(account.token);
    }

    // Cache the client
    this.oauth2Clients.set(accountId, client);

    return client;
  }

  /**
   * Legacy OAuth2 client (client_secret.json + token.json)
   * ★ Cloud fallback: ถ้าไม่มีไฟล์ ให้อ่านจาก GOOGLE_CLIENT_ID/SECRET env var
   */
  _getLegacyOAuth2Client() {
    if (!this.credentials) {
      // Priority 1: env var GOOGLE_CREDENTIALS_JSON (cloud deploy — สูงสุด)
      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        this.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      // Priority 2: individual env vars
      } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        this.credentials = {
          web: {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uris: ['http://localhost:3000/oauth2callback'],
          }
        };
      // Priority 3: ไฟล์ client_secret.json (local dev fallback)
      } else if (fs.existsSync(CRED_PATH)) {
        this.credentials = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
      } else {
        return null;
      }
    }

    if (!this.oauth2Client) {
      const cred = this.credentials.installed || this.credentials.web;
      // Resolve redirect URI: APP_URL > RAILWAY_PUBLIC_DOMAIN > client_secret URIs > localhost
      const appUrl = process.env.APP_URL ||
        (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
      const redirectUri = appUrl
        ? `${appUrl}/oauth2callback`
        : (cred.redirect_uris && cred.redirect_uris[0]) || 'http://localhost:3000/oauth2callback';

      this.oauth2Client = new google.auth.OAuth2(cred.client_id, cred.client_secret, redirectUri);

      // Auto-refresh token handler
      this.oauth2Client.on('tokens', (tokens) => {
        logger.info('Token refreshed automatically (legacy)');
        const existing = this._loadToken() || {};
        const updated = { ...existing, ...tokens };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
      });
    }

    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      this.oauth2Client.setCredentials(token);
    }

    return this.oauth2Client;
  }

  _loadToken() {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  }

  /**
   * Check authentication status
   * Returns info about active account or legacy credentials
   */
  isAuthenticated() {
    // Check active account first
    const activeAccount = accountManager.getActiveAccount();
    if (activeAccount) {
      return {
        hasCredentials: true,
        authenticated: !!activeAccount.token,
        accountName: activeAccount.name,
        accountId: activeAccount.id,
        multiAccount: true,
      };
    }

    // Fallback to legacy
    const client = this._getLegacyOAuth2Client();
    if (!client) return { hasCredentials: false, authenticated: false, multiAccount: false };
    const hasToken = fs.existsSync(TOKEN_PATH);
    return { hasCredentials: true, authenticated: hasToken, multiAccount: false };
  }

  /**
   * Generate auth URL for specific account
   * @param {string} accountId - Optional account ID
   */
  getAuthUrl(accountId = null) {
    const client = this.getOAuth2Client(accountId);
    if (!client) throw new Error('Missing credentials');

    // Store accountId in state parameter for callback
    const state = accountId ? JSON.stringify({ accountId }) : undefined;

    return client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly'
      ],
      prompt: 'consent',
      state,
    });
  }

  /**
   * Handle OAuth callback
   * @param {string} code - Authorization code
   * @param {string} state - State parameter (contains accountId if multi-account)
   */
  async handleCallback(code, state = null) {
    let accountId = null;

    // Parse state to get accountId if multi-account flow
    if (state) {
      try {
        const stateData = JSON.parse(state);
        accountId = stateData.accountId;
      } catch (e) {
        // Ignore parse errors
      }
    }

    const client = this.getOAuth2Client(accountId);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Save token to appropriate location
    if (accountId) {
      // Multi-account: save to account manager
      accountManager.saveToken(accountId, tokens);
      logger.info('OAuth authentication successful (multi-account)', { accountId });
    } else {
      // Legacy: save to token.json
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      logger.info('OAuth authentication successful (legacy)');
    }

    return tokens;
  }

  /**
   * Logout (remove token)
   * @param {string} accountId - Optional account ID
   */
  logout(accountId = null) {
    if (accountId) {
      // Multi-account: remove token from account
      accountManager.saveToken(accountId, null);
      this.oauth2Clients.delete(accountId);
      logger.info('Logged out (multi-account)', { accountId });
    } else {
      // Legacy: remove token.json
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
      this.oauth2Client = null;
      logger.info('Logged out (legacy)');
    }
  }

  /**
   * Upload video — รองรับ auto-rotation เมื่อ quota หมด
   * @param {object} options - Upload options
   * @param {string} options.accountId - Optional: บังคับใช้ account นี้ (ถ้าไม่ระบุ = auto-rotate)
   */
  async uploadVideo({ filepath, title, description, tags, privacy, categoryId, publishAt, madeForKids, onProgress, accountId = null }) {
    let targetAccountId = accountId;

    // ★ Auto-Rotate: ถ้าไม่ระบุ accountId ให้หา account ที่มี quota เหลือ
    if (!targetAccountId) {
      const rotation = quotaRotator.rotateIfNeeded(1600);

      if (!rotation.success) {
        // ทุก account quota หมดหมดแล้ว
        const error = new Error(
          rotation.reason || 'ทุก account quota หมดแล้ว — รอ reset เที่ยงคืน PST หรือเพิ่ม account ใหม่'
        );
        error.code = 'QUOTA_EXCEEDED_ALL_ACCOUNTS';
        error.totalUploadsLeft = 0;
        error.rotationInfo = rotation;
        logger.error('All accounts quota exhausted', rotation);
        throw error;
      }

      targetAccountId = rotation.accountId;

      if (rotation.wasRotated) {
        logger.info(`[YouTube] Auto-rotated to account: ${rotation.accountName} (${rotation.uploadsLeft} uploads left)`);
      }
    }

    // ★ Check quota สำหรับ account ที่เลือก
    let quotaCheck;
    if (targetAccountId) {
      const remaining = accountManager.getQuotaRemaining(targetAccountId);
      const acc = accountManager.getAccount(targetAccountId);
      quotaCheck = {
        allowed: remaining >= 1600,
        remaining,
        used: acc?.quotaUsed || 0,
        limit: acc?.quotaLimit || 10000,
      };
    } else {
      quotaCheck = quotaManager.check(1600);
    }

    if (!quotaCheck.allowed) {
      const error = new Error('YouTube API quota exceeded. Uploads will reset at midnight PST.');
      error.code = 'QUOTA_EXCEEDED';
      error.quotaInfo = quotaCheck;
      logger.error('Upload blocked by quota limit', quotaCheck);
      throw error;
    }

    const client = this.getOAuth2Client(targetAccountId);
    if (!client || !client.credentials || !client.credentials.access_token) {
      throw new Error('Not authenticated with YouTube');
    }

    const youtube = google.youtube({ version: 'v3', auth: client });
    const fileSize = fs.statSync(filepath).size;

    logger.info('Starting upload', { 
      title, 
      filepath, 
      size: fileSize, 
      categoryId, 
      publishAt,
      accountId: targetAccountId,
      quotaUsed: quotaCheck.used,
      quotaRemaining: quotaCheck.remaining 
    });

    // Build request body
    const requestBody = {
      snippet: {
        title,
        description: description || '',
        tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [],
        categoryId: categoryId ? String(categoryId) : '22', // Default: People & Blogs
        defaultLanguage: 'th',
        defaultAudioLanguage: 'th'
      },
      status: {
        privacyStatus: publishAt ? 'private' : (privacy || 'public'),
        selfDeclaredMadeForKids: madeForKids || false,
        embeddable: true,
        publicStatsViewable: true
      }
    };

    // If scheduled publish, set publishAt (video must be private first)
    if (publishAt) {
      requestBody.status.privacyStatus = 'private';
      requestBody.status.publishAt = publishAt;
    }

    // ★ Retry + timeout + circuit breaker
    //   เดิม: retry เอง 3 ครั้งแต่ "ไม่มี timeout" → TCP ค้าง = request ค้างตลอดกาล
    //   ตอนนี้: timeout จริงพร้อม destroy stream (ไม่ปล่อย socket ลอย)
    //   ยังคงไม่ retry quota error (403) เพราะต้องรอ reset
    let activeStream = null;

    const isRetryable = (err) => {
      const statusCode = err?.response?.status || err?.code;
      const msg = String(err?.message || '').toLowerCase();
      if (statusCode === 403 && msg.includes('quota')) return false;  // hard quota — ห้าม retry
      if (err?.code === 'ETIMEDOUT_GUARD') return true;
      return [429, 500, 502, 503, 504].includes(Number(statusCode))
          || ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND'].includes(statusCode);
    };

    const response = await guarded('youtube:upload', () => {
      // ★ stream ใหม่ทุกครั้งที่ retry — stream เดิมถูกอ่านไปแล้วใช้ซ้ำไม่ได้
      activeStream = fs.createReadStream(filepath);
      return youtube.videos.insert({
        part: 'snippet,status',
        requestBody,
        media: { body: activeStream },
      }, {
        onUploadProgress: (evt) => {
          if (onProgress) {
            const progress = Math.round((evt.bytesRead / fileSize) * 100);
            onProgress(progress, evt.bytesRead, fileSize);
          }
        },
      });
    }, {
      attempts:    C.YOUTUBE.MAX_UPLOAD_RETRIES,
      baseDelayMs: C.YOUTUBE.RETRY_BASE_DELAY_MS,
      timeoutMs:   C.YOUTUBE.UPLOAD_TIMEOUT_MS,
      isRetryable,
      // ★ ปิด stream ตอน timeout — ไม่ปล่อย fd + socket ค้าง
      onTimeout: () => { try { activeStream?.destroy(); } catch (_) {} },
      onRetry: (attempt, err, delay) => {
        logger.warn(`[YouTube] Upload attempt ${attempt} ล้มเหลว — ลองใหม่ในอีก ${delay}ms`, {
          title, error: err.message,
        });
        try { activeStream?.destroy(); } catch (_) {}
      },
      breakerOpts: { failureThreshold: 5, openMs: 3 * 60_000 },
    });

    if (!response?.data?.id) {
      throw new Error('YouTube ตอบกลับไม่มี video ID — อัปโหลดอาจไม่สมบูรณ์');
    }

    const videoId = response.data.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // ★ Consume quota AFTER successful upload
    if (targetAccountId) {
      accountManager.updateQuotaUsage(targetAccountId, 1600);
    } else {
      quotaManager.consume(1600, 'video_upload');
    }

    logger.info('Upload successful', { videoId, title, categoryId, scheduled: !!publishAt, accountId: targetAccountId });

    return { videoId, youtubeUrl, title: response.data.snippet?.title, scheduled: !!publishAt };
  }

  /**
   * Delete video from YouTube — ลบคลิปที่โดนบล็อกออกจากช่อง
   * @param {string} videoId - YouTube video ID
   * @param {string} accountId - Optional account ID
   * @returns {object} { success, videoId }
   * 
   * Quota cost: 50 units per delete
   */
  async deleteVideo(videoId, accountId = null) {
    if (!videoId) throw new Error('videoId is required');

    const client = this.getOAuth2Client(accountId);
    if (!client || !client.credentials || !client.credentials.access_token) {
      throw new Error('Not authenticated with YouTube');
    }

    const youtube = google.youtube({ version: 'v3', auth: client });

    try {
      // ★ เดิมไม่มี timeout/retry — delete ค้างได้ไม่จำกัด
      await guarded('youtube:delete', () => youtube.videos.delete({ id: videoId }), {
        attempts: 3, timeoutMs: 30_000,
      });

      // Consume 50 units for delete operation
      if (accountId) {
        accountManager.updateQuotaUsage(accountId, 50);
      } else {
        quotaManager.consume(50, 'video_delete');
      }

      logger.info('[YouTube] Video deleted successfully', { videoId, accountId });
      return { success: true, videoId };
    } catch (err) {
      const statusCode = err?.response?.status || err?.code;
      if (statusCode === 404) {
        // Video already deleted or not found — treat as success
        logger.warn('[YouTube] Video not found (already deleted?)', { videoId });
        return { success: true, videoId, alreadyDeleted: true };
      }
      logger.error('[YouTube] Failed to delete video', { videoId, error: err.message, statusCode });
      throw err;
    }
  }

  /**
   * Get channel info
   * @param {string} accountId - Optional account ID
   */
  async getChannelInfo(accountId = null) {
    const client = this.getOAuth2Client(accountId);
    if (!client || !client.credentials) return null;

    try {
      const youtube = google.youtube({ version: 'v3', auth: client });
      // ★ timeout + retry — เดิมไม่มี ทำให้หน้า dashboard ค้างรอถ้า API ช้า
      const response = await guarded('youtube:channels', () => youtube.channels.list({
        part: 'snippet,statistics',
        mine: true,
      }), { attempts: 2, timeoutMs: 15_000 });

      if (response.data.items && response.data.items.length > 0) {
        const channel = response.data.items[0];
        const channelInfo = {
          id: channel.id,
          title: channel.snippet.title,
          thumbnail: channel.snippet.thumbnails?.default?.url,
          subscribers: channel.statistics.subscriberCount,
          videoCount: channel.statistics.videoCount
        };

        // Save to account if multi-account
        const targetAccountId = accountId || accountManager.getActiveAccountId();
        if (targetAccountId) {
          accountManager.saveChannelInfo(targetAccountId, channelInfo);
        }

        return channelInfo;
      }
    } catch (err) {
      logger.warn('Failed to get channel info', { error: err.message, accountId });
    }
    return null;
  }

  /**
   * Get current quota status (for dashboard)
   * รวม quota ทุก account + rotation status
   */
  getQuotaStatus() {
    const rotatorStatus = quotaRotator.getFullStatus();
    const activeAccount = accountManager.getActiveAccount();

    // ถ้ามีหลาย account → แสดง combined status
    if (rotatorStatus.accounts.length > 1) {
      const { summary } = rotatorStatus;
      const totalUsed = rotatorStatus.accounts
        .filter(a => a.isAuthenticated)
        .reduce((sum, a) => sum + a.quotaUsed, 0);
      const totalLimit = rotatorStatus.accounts
        .filter(a => a.isAuthenticated)
        .reduce((sum, a) => sum + a.quotaLimit, 0);
      const percentUsed = totalLimit > 0 ? parseFloat(((totalUsed / totalLimit) * 100).toFixed(1)) : 0;

      return {
        // Combined stats
        used: totalUsed,
        limit: totalLimit,
        remaining: summary.totalQuotaRemaining,
        uploadsRemaining: summary.totalUploadsLeft,
        percentUsed,
        status: percentUsed >= 95 ? 'critical' : percentUsed >= 80 ? 'warning' : 'ok',
        // Per-account breakdown
        multiAccount: true,
        accounts: rotatorStatus.accounts,
        summary: rotatorStatus.summary,
        recentRotations: rotatorStatus.recentRotations,
        // Active account detail
        accountName: activeAccount?.name,
        accountId: activeAccount?.id,
        activeAccountRemaining: activeAccount ? accountManager.getQuotaRemaining(activeAccount.id) : 0,
        nextReset: this._getNextPSTReset(),
      };
    }

    // Single account — ใช้ logic เดิม
    if (activeAccount) {
      const remaining = accountManager.getQuotaRemaining(activeAccount.id);
      const used = activeAccount.quotaUsed || 0;
      const limit = activeAccount.quotaLimit || 10000;
      const percentUsed = parseFloat(((used / limit) * 100).toFixed(1));

      return {
        used,
        limit,
        remaining,
        uploadsRemaining: Math.floor(remaining / 1600),
        percentUsed,
        status: percentUsed >= 95 ? 'critical' : percentUsed >= 80 ? 'warning' : 'ok',
        multiAccount: false,
        accounts: rotatorStatus.accounts,
        accountName: activeAccount.name,
        accountId: activeAccount.id,
        nextReset: this._getNextPSTReset(),
      };
    }

    return quotaManager.getStatus();
  }

  _getNextPSTReset() {
    const now = new Date();
    const pstOffset = -8 * 60 * 60 * 1000;
    const localOffset = now.getTimezoneOffset() * 60 * 1000;
    const pstNow = new Date(now.getTime() + localOffset + pstOffset);
    const nextMidnight = new Date(pstNow);
    nextMidnight.setHours(24, 0, 0, 0);
    return new Date(nextMidnight.getTime() - localOffset - pstOffset).toISOString();
  }

  /**
   * Estimate how many uploads can still be done (รวมทุก account)
   */
  getUploadsRemaining() {
    const status = quotaRotator.getFullStatus();
    return status.summary.totalUploadsLeft;
  }

  /**
   * ดูสถานะ rotation และ account ทั้งหมด
   */
  getRotatorStatus() {
    return quotaRotator.getFullStatus();
  }

  /**
   * Preview plan ว่าจะใช้ account ไหนสำหรับ N uploads
   */
  previewRotation(count) {
    return quotaRotator.preview(count);
  }
}

module.exports = new YouTubeService();
