// Setup Wizard & Config Export/Import Routes
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { settings, scheduler } = require('../utils/store');

const CRED_PATH = path.join(__dirname, '../../client_secret.json');
const DATA_DIR  = path.join(__dirname, '../../data');

// ── GET /api/setup/status ─────────────────────────────────────────
// ตรวจว่า setup เสร็จแล้วหรือยัง
router.get('/status', (req, res) => {
  const hasCredentials = fs.existsSync(CRED_PATH);
  const s = settings.load();
  res.json({
    ready: hasCredentials,
    hasCredentials,
    hasFolder: !!s.folder,
    steps: {
      credentials: hasCredentials,
      folder: !!s.folder,
      scheduler: !!(require('../utils/store').scheduler.load().enabled),
    }
  });
});

// ── POST /api/setup/credentials ───────────────────────────────────
// รับ clientId + clientSecret แทนการวาง JSON file
router.post('/credentials', (req, res) => {
  try {
    const { clientId, clientSecret, redirectUri } = req.body;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'clientId และ clientSecret จำเป็น' });
    }

    // สร้าง client_secret.json format ที่ Google ใช้
    const appUrl = process.env.APP_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
    const callbackUrl = redirectUri || (appUrl ? `${appUrl}/oauth2callback` : 'http://localhost:3000/oauth2callback');

    const credJson = {
      web: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [callbackUrl],
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
      }
    };

    fs.writeFileSync(CRED_PATH, JSON.stringify(credJson, null, 2));
    // Reset cached client so youtube.js picks up new credentials
    try { require('../services/youtube').resetCredentials(); } catch(e) {}

    logger.info('Credentials saved via setup wizard', { clientId });
    res.json({ success: true, callbackUrl });
  } catch (err) {
    logger.error('Setup credentials error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/setup/export ─────────────────────────────────────────
// Export config (ไม่รวม secrets / tokens)
router.get('/export', (req, res) => {
  try {
    const s = settings.load();
    const sc = require('../utils/store').scheduler.load();

    // Sanitize — ลบ path ที่ specific กับ machine นี้
    const exported = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      settings: {
        privacy: s.privacy || 'public',
        deleteAfterUpload: s.deleteAfterUpload || false,
        defaultDescription: s.defaultDescription || '',
        defaultTags: s.defaultTags || '',
        // ไม่ export folder path (ต่างกันต่าง machine)
      },
      scheduler: {
        enabled: sc.enabled || false,
        intervalMinutes: sc.intervalMinutes || 30,
      },
      // export keywords ถ้ามี
      tiktokKeywords: s.tiktokKeywords || [],
    };

    res.setHeader('Content-Disposition', 'attachment; filename="autoupload-config.json"');
    res.setHeader('Content-Type', 'application/json');
    res.json(exported);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/setup/import ────────────────────────────────────────
// Import config จาก exported JSON
router.post('/import', (req, res) => {
  try {
    const config = req.body;
    if (!config || config.version !== '2.0') {
      return res.status(400).json({ error: 'ไฟล์ config ไม่ถูกต้อง (ต้อง export จาก version 2.0)' });
    }

    // Import settings (ไม่ทับ folder)
    if (config.settings) {
      const current = settings.load();
      settings.save({ ...current, ...config.settings });
    }

    // Import scheduler
    if (config.scheduler) {
      const sc = require('../utils/store').scheduler;
      const current = sc.load();
      sc.save({ ...current, ...config.scheduler });
    }

    logger.info('Config imported successfully');
    res.json({ success: true, message: 'Import สำเร็จ — กรุณา Login YouTube อีกครั้ง' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
