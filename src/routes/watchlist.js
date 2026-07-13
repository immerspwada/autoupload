// Watchlist Routes — Keyword Watchlist CRUD + status
const express  = require('express');
const router   = express.Router();
const watchlist = require('../services/watchlist');
const logger   = require('../utils/logger');

// GET  /api/watchlist        — list all keywords
router.get('/', (req, res) => {
  try {
    const keywords = watchlist.getAll();
    const stats    = watchlist.getStats();
    res.json({ success: true, keywords, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/watchlist        — add keyword
router.post('/', (req, res) => {
  try {
    const { keyword, countPerRun, minScore, enabled } = req.body;
    const entry = watchlist.add({ keyword, countPerRun, minScore, enabled });
    res.json({ success: true, keyword: entry });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PATCH /api/watchlist/:id   — update keyword
router.patch('/:id', (req, res) => {
  try {
    const updated = watchlist.update(req.params.id, req.body);
    res.json({ success: true, keyword: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/watchlist/:id  — remove keyword
router.delete('/:id', (req, res) => {
  try {
    watchlist.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/watchlist/run    — trigger manual run now
router.post('/run', async (req, res) => {
  try {
    const scheduler = require('../services/scheduler');
    logger.info('[Watchlist] Manual run triggered via API');
    // Run in background — don't await in request handler
    scheduler.runWatchlist().catch(err =>
      logger.error('[Watchlist] Manual run error', { error: err.message })
    );
    res.json({ success: true, message: 'Watchlist run เริ่มแล้ว — ดูสถานะใน Activity log' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
