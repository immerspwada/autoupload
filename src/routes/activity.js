// Activity Log Routes — User-facing timeline & activity tracking
const express = require('express');
const router = express.Router();
const activityLogger = require('../utils/activity');

// Get recent activities
router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const type = req.query.type || null;
  
  const activities = activityLogger.getRecent(limit, type);
  const stats = activityLogger.getStats();
  
  res.json({
    activities,
    stats,
    total: activities.length
  });
});

// Get today's activities
router.get('/today', (req, res) => {
  const activities = activityLogger.getToday();
  res.json({ activities, total: activities.length });
});

// Get activities by date range
router.get('/range', (req, res) => {
  const { from, to } = req.query;
  
  if (!from || !to) {
    return res.status(400).json({ error: 'กรุณาระบุ from และ to (YYYY-MM-DD)' });
  }
  
  const activities = activityLogger.getByDateRange(from, to);
  res.json({ activities, from, to, total: activities.length });
});

// Get activity statistics
router.get('/stats', (req, res) => {
  const stats = activityLogger.getStats();
  res.json(stats);
});

// Clear activities
router.post('/clear', (req, res) => {
  activityLogger.clear();
  res.json({ success: true, message: 'ล้างประวัติเรียบร้อย' });
});

// Cleanup old activities
router.post('/cleanup', (req, res) => {
  const keep = parseInt(req.body.keep) || 500;
  const cleaned = activityLogger.cleanup(keep);
  res.json({ 
    success: true, 
    cleaned, 
    message: cleaned ? 'ล้างกิจกรรมเก่าแล้ว' : 'ไม่มีอะไรต้องล้าง' 
  });
});

module.exports = router;
