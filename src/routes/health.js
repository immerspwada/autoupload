// Health & System Routes
const express = require('express');
const router = express.Router();
const healthService = require('../services/health');
const logger = require('../utils/logger');

// System health check
router.get('/', async (req, res) => {
  try {
    const health = await healthService.getHealth();
    const statusCode = health.overall === 'error' ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (err) {
    res.status(500).json({ overall: 'error', error: err.message });
  }
});

// Check if file is duplicate (by hash)
router.post('/duplicate-check', async (req, res) => {
  const { filepath } = req.body;
  if (!filepath) return res.status(400).json({ error: 'filepath required' });

  try {
    const result = await healthService.isDuplicate(filepath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual cleanup
router.post('/cleanup', (req, res) => {
  const queueResult = healthService.cleanupQueue();
  const tempResult = healthService.cleanupTempFiles();
  logger.info('Manual cleanup performed');
  res.json({
    success: true,
    queue: queueResult,
    tempFiles: tempResult
  });
});

// Recent logs
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = logger.getRecentLogs(limit);
  res.json({ logs });
});

module.exports = router;
