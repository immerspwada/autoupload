/**
 * ★ Engine API Routes — ควบคุม Autonomous Upload Engine
 *
 * GET  /api/engine/status   → สถานะปัจจุบัน
 * POST /api/engine/start    → เริ่มทำงาน
 * POST /api/engine/stop     → หยุดทำงาน
 * POST /api/engine/pause    → หยุดชั่วคราว (desiredState ยังเป็น running)
 */
'use strict';

const express = require('express');
const router  = express.Router();
const engine  = require('../services/engine');
const logger  = require('../utils/logger');
const { requireAuthForDestructive } = require('../middleware/security');

// ─── GET /status ─────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json(engine.getStatus());
});

// ─── POST /start ─────────────────────────────────────────────────
router.post('/start', requireAuthForDestructive, async (req, res) => {
  try {
    await engine.start();
    logger.info('[Engine API] Start requested', { ip: req.ip });
    res.json({ success: true, phase: engine.phase, desiredState: engine.desiredState });
  } catch (err) {
    logger.error('[Engine API] Start error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /stop ──────────────────────────────────────────────────
router.post('/stop', requireAuthForDestructive, async (req, res) => {
  try {
    await engine.stop();
    logger.info('[Engine API] Stop requested', { ip: req.ip });
    res.json({ success: true, phase: engine.phase, desiredState: engine.desiredState });
  } catch (err) {
    logger.error('[Engine API] Stop error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /kick — สั่งเริ่มรอบใหม่ทันที (ข้าม backoff/degraded) ────
// ใช้เมื่อ Engine ติด degraded แล้วเราแก้ต้นเหตุเรียบร้อยแล้ว
// ไม่ต้องรอ backoff 30 นาที
router.post('/kick', requireAuthForDestructive, async (req, res) => {
  try {
    const status = await engine.kick();
    logger.info('[Engine API] Kick requested', { ip: req.ip });
    res.json({ success: true, status });
  } catch (err) {
    logger.error('[Engine API] Kick error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /pause ─────────────────────────────────────────────────
router.post('/pause', requireAuthForDestructive, async (req, res) => {
  try {
    await engine.pause();
    logger.info('[Engine API] Pause requested', { ip: req.ip });
    res.json({ success: true, phase: engine.phase, desiredState: engine.desiredState });
  } catch (err) {
    logger.error('[Engine API] Pause error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
