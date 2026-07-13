// Quota Management Routes — จัดการ YouTube API quota
const express = require('express');
const router = express.Router();
const quotaManager = require('../services/quota');
const youtubeService = require('../services/youtube');
const logger = require('../utils/logger');

// Get current quota status — uses account-based quota (with PST auto-reset)
router.get('/status', (req, res) => {
  const status = youtubeService.getQuotaStatus();
  res.json(status);
});

// Get quota history (last 30 days)
router.get('/history', (req, res) => {
  const history = quotaManager.getHistory();
  res.json({ history });
});

// Estimate batch upload capacity
router.post('/estimate', (req, res) => {
  const { count } = req.body;
  if (!count || count < 1) {
    return res.status(400).json({ error: 'กรุณาระบุจำนวนวิดีโอ' });
  }

  const estimate = quotaManager.estimateBatch(count);
  res.json(estimate);
});

// Set extended quota (admin only)
router.post('/extend', (req, res) => {
  const { newLimit, confirm } = req.body;
  
  if (!confirm) {
    return res.status(400).json({ error: 'ต้องยืนยันการเปลี่ยนแปลง quota' });
  }

  if (!newLimit || newLimit < 10000) {
    return res.status(400).json({ error: 'quota ใหม่ต้อง >= 10,000' });
  }

  quotaManager.setExtendedQuota(newLimit);
  logger.info('Extended quota activated', { newLimit });
  
  res.json({ 
    success: true, 
    newLimit,
    message: `Extended quota activated: ${newLimit.toLocaleString()} units/day`
  });
});

// Force reset quota (emergency use only)
router.post('/reset', (req, res) => {
  const { confirm } = req.body;
  
  if (!confirm) {
    return res.status(400).json({ error: 'ต้องยืนยันการ reset quota' });
  }

  quotaManager.forceReset();
  logger.warn('Quota force reset by user');
  
  res.json({ 
    success: true,
    message: 'Quota has been reset to 0'
  });
});

// ★ NEW: Filter videos by quota availability (smart selection)
router.post('/filter', (req, res) => {
  try {
    const { videos } = req.body;
    if (!Array.isArray(videos)) {
      return res.status(400).json({ error: 'Videos must be an array' });
    }
    const result = quotaManager.filterByQuota(videos);
    res.json(result);
  } catch (error) {
    logger.error('Failed to filter by quota', { error: error.message });
    res.status(500).json({ error: 'Failed to filter by quota' });
  }
});

// ★ NEW: Get extended quota guide
router.get('/extended-guide', (req, res) => {
  try {
    const guide = quotaManager.getExtendedQuotaGuide();
    res.json(guide);
  } catch (error) {
    logger.error('Failed to get extended quota guide', { error: error.message });
    res.status(500).json({ error: 'Failed to get extended quota guide' });
  }
});

module.exports = router;
