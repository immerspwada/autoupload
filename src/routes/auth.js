// Auth Routes
const express = require('express');
const router = express.Router();
const youtubeService = require('../services/youtube');
const orchestrator = require('../services/orchestrator');
const logger = require('../utils/logger');

// Auth status
router.get('/status', (req, res) => {
  const status = youtubeService.isAuthenticated();
  res.json(status);
});

// Start OAuth flow
router.get('/login', (req, res) => {
  try {
    const url = youtubeService.getAuthUrl();
    res.json({ url });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  youtubeService.logout();
  orchestrator.onAuthLogout();
  res.json({ success: true });
});

// Channel info
router.get('/channel', async (req, res) => {
  try {
    const info = await youtubeService.getChannelInfo();
    res.json(info || { error: 'No channel info available' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
