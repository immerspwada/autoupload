// Stats & Dashboard Routes
const express = require('express');
const router = express.Router();
const { stats, uploads, settings } = require('../utils/store');
const logger = require('../utils/logger');
const uploadQueue = require('../services/queue');
const scheduler = require('../services/scheduler');

// Dashboard overview
router.get('/dashboard', (req, res) => {
  const allStats = stats.load();
  const allUploads = uploads.load();
  const config = settings.load();
  const queueStatus = uploadQueue.getStatus();
  const schedulerConfig = scheduler.getConfig();

  // Calculate recent activity (last 7 days)
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split('T')[0];
    last7Days.push({
      date: key,
      uploads: allStats.dailyStats?.[key]?.uploads || 0,
      failures: allStats.dailyStats?.[key]?.failures || 0,
      size: allStats.dailyStats?.[key]?.size || 0
    });
  }

  // Today's stats
  const today = new Date().toISOString().split('T')[0];
  const todayStats = allStats.dailyStats?.[today] || { uploads: 0, failures: 0, size: 0 };

  res.json({
    overview: {
      totalUploads: allStats.totalUploads || 0,
      totalSize: allStats.totalSize || 0,
      totalSizeFormatted: formatBytes(allStats.totalSize || 0),
      failedUploads: allStats.failedUploads || 0,
      successRate: allStats.totalUploads > 0
        ? Math.round(((allStats.totalUploads) / (allStats.totalUploads + (allStats.failedUploads || 0))) * 100)
        : 0
    },
    today: todayStats,
    last7Days,
    uploadsByHour: allStats.uploadsByHour || {},
    queue: queueStatus,
    scheduler: schedulerConfig,
    recentUploads: allUploads.slice(-5).reverse()
  });
});

// Scheduler config
router.get('/scheduler', (req, res) => {
  res.json(scheduler.getConfig());
});

router.post('/scheduler', (req, res) => {
  const config = scheduler.updateConfig(req.body);
  res.json({ success: true, config });
});

router.post('/scheduler/scan', (req, res) => {
  const result = scheduler.scan();
  res.json({ success: true, ...result });
});

// Recent logs
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = logger.getRecentLogs(limit);
  res.json(logs);
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;
