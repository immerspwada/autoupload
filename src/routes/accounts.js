/**
 * Accounts Management API Routes
 */

const express = require('express');
const router = express.Router();
const accountManager = require('../utils/accounts');
const logger = require('../utils/logger');

/**
 * GET /api/accounts
 * ดึงรายการ accounts ทั้งหมด
 */
router.get('/', (req, res) => {
  try {
    const accounts = accountManager.getAllAccounts();
    const activeId = accountManager.getActiveAccountId();

    // ซ่อน sensitive data
    const safeAccounts = accounts.map(acc => ({
      id: acc.id,
      name: acc.name,
      clientId: acc.clientId,
      // ไม่ส่ง clientSecret และ token
      channelInfo: acc.channelInfo,
      quotaUsed: acc.quotaUsed || 0,
      quotaLimit: acc.quotaLimit || 10000,
      quotaRemaining: accountManager.getQuotaRemaining(acc.id),
      createdAt: acc.createdAt,
      lastUsed: acc.lastUsed,
      isActive: acc.id === activeId,
      hasToken: !!acc.token,
    }));

    res.json({
      success: true,
      accounts: safeAccounts,
      activeAccountId: activeId,
      total: safeAccounts.length,
    });
  } catch (error) {
    logger.error('[Accounts] List error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/accounts
 * เพิ่ม account ใหม่
 */
router.post('/', (req, res) => {
  try {
    const { name, clientId, clientSecret, redirectUri } = req.body;

    if (!name || !clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, clientId, clientSecret',
      });
    }

    const account = accountManager.addAccount({
      name,
      clientId,
      clientSecret,
      redirectUri,
    });

    logger.info('[Accounts] Added new account:', { id: account.id, name: account.name });

    res.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        clientId: account.clientId,
        createdAt: account.createdAt,
      },
    });
  } catch (error) {
    logger.error('[Accounts] Add error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/accounts/:id
 * อัปเดต account
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, clientId, clientSecret, redirectUri } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (clientId) updates.clientId = clientId;
    if (clientSecret) updates.clientSecret = clientSecret;
    if (redirectUri) updates.redirectUri = redirectUri;

    const account = accountManager.updateAccount(id, updates);

    logger.info('[Accounts] Updated account:', { id, updates });

    res.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        clientId: account.clientId,
      },
    });
  } catch (error) {
    logger.error('[Accounts] Update error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/accounts/:id
 * ลบ account
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    accountManager.removeAccount(id);

    logger.info('[Accounts] Deleted account:', { id });

    res.json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    logger.error('[Accounts] Delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/accounts/:id/activate
 * ตั้งเป็น active account
 */
router.post('/:id/activate', (req, res) => {
  try {
    const { id } = req.params;

    const account = accountManager.setActiveAccount(id);

    logger.info('[Accounts] Activated account:', { id, name: account.name });

    res.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
      },
      message: `Switched to account: ${account.name}`,
    });
  } catch (error) {
    logger.error('[Accounts] Activate error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/accounts/:id/reset-quota
 * รีเซ็ต quota
 */
router.post('/:id/reset-quota', (req, res) => {
  try {
    const { id } = req.params;

    accountManager.resetQuota(id);

    logger.info('[Accounts] Reset quota:', { id });

    res.json({
      success: true,
      message: 'Quota reset successfully',
    });
  } catch (error) {
    logger.error('[Accounts] Reset quota error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/accounts/active
 * ดึงข้อมูล active account
 */
router.get('/active', (req, res) => {
  try {
    const account = accountManager.getActiveAccount();

    if (!account) {
      return res.json({
        success: true,
        account: null,
        message: 'No active account',
      });
    }

    res.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        clientId: account.clientId,
        channelInfo: account.channelInfo,
        quotaUsed: account.quotaUsed || 0,
        quotaLimit: account.quotaLimit || 10000,
        quotaRemaining: accountManager.getQuotaRemaining(account.id),
        hasToken: !!account.token,
      },
    });
  } catch (error) {
    logger.error('[Accounts] Get active error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
