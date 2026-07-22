// ═══════════════════════════════════════════════════════════════════
// Video Transform Routes — API สำหรับแปลงวิดีโอก่อนอัปโหลด
//
// Endpoints:
//   GET  /api/transform/status     — สถานะ ffmpeg + config ปัจจุบัน
//   GET  /api/transform/config     — ดึง config
//   POST /api/transform/config     — อัปเดต config
//   POST /api/transform/preview    — preview what transform would do (probe only)
//   POST /api/transform/single     — Transform 1 file
//   POST /api/transform/compile    — สร้าง Compilation จากหลายคลิป
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const videoTransform = require('../services/videoTransform');
const { settings } = require('../utils/store');
const logger = require('../utils/logger');

// ─── GET /status — ffmpeg health + stats ─────────────────────────
router.get('/status', async (req, res) => {
  try {
    const health = await videoTransform.checkHealth();
    const stats = videoTransform.getStats();
    const config = videoTransform.getConfig();

    res.json({
      ffmpeg: health,
      stats,
      config: {
        enabled: config.enabled,
        mode: config.mode,
        intro: config.intro.enabled,
        outro: config.outro.enabled,
        overlay: config.overlay.enabled,
        watermark: config.watermark.enabled,
        visualTransform: config.visual.enabled,
        resolution: config.output.resolution,
      },
    });
  } catch (error) {
    logger.error('[Transform Route] Status check failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /config — full transform config ─────────────────────────
router.get('/config', (req, res) => {
  const config = videoTransform.getConfig();
  res.json(config);
});

// ─── POST /config — update transform settings ────────────────────
router.post('/config', (req, res) => {
  try {
    const currentSettings = settings.load();
    const newTransformConfig = req.body;

    // Validate basic structure
    if (typeof newTransformConfig !== 'object') {
      return res.status(400).json({ error: 'Config ต้องเป็น object' });
    }

    // Merge with existing
    currentSettings.videoTransform = {
      ...(currentSettings.videoTransform || {}),
      ...newTransformConfig,
    };

    settings.save(currentSettings);
    logger.info('[Transform] Config updated', { keys: Object.keys(newTransformConfig) });

    res.json({ success: true, config: videoTransform.getConfig() });
  } catch (error) {
    logger.error('[Transform Route] Config update failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /preview — Probe video + show what transform would do ──
router.post('/preview', async (req, res) => {
  const { filepath } = req.body;
  if (!filepath || !fs.existsSync(filepath)) {
    return res.status(400).json({ error: 'ไฟล์ไม่พบ — กรุณาระบุ filepath ที่ถูกต้อง' });
  }

  try {
    const health = await videoTransform.checkHealth();
    if (!health.available) {
      return res.status(503).json({ error: 'ffmpeg ไม่พร้อมใช้งาน', details: health.error });
    }

    const config = videoTransform.getConfig();
    const probe = await videoTransform._probeVideo(filepath);

    // Estimate output
    const outputRes = config.output.resolution;
    const estimatedDuration = probe.duration * (1 / (config.visual.speed || 1));
    
    res.json({
      input: {
        filename: path.basename(filepath),
        duration: probe.duration,
        resolution: `${probe.width}x${probe.height}`,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
        size: probe.size,
      },
      transform: {
        mode: config.mode,
        enabled: config.enabled,
        intro: config.intro.enabled ? `${config.intro.duration}s branded intro` : 'disabled',
        outro: config.outro.enabled ? `${config.outro.duration}s CTA outro` : 'disabled',
        overlay: config.overlay.enabled ? config.overlay.style : 'disabled',
        watermark: config.watermark.enabled ? config.watermark.text || '(channel name)' : 'disabled',
        visual: config.visual.enabled ? {
          zoom: config.visual.zoom,
          brightness: config.visual.brightness,
          contrast: config.visual.contrast,
          saturation: config.visual.saturation,
          speed: config.visual.speed,
          mirror: config.visual.mirror,
        } : 'disabled',
        outputResolution: outputRes,
      },
      estimate: {
        outputDuration: estimatedDuration,
        outputResolution: outputRes,
        processingTime: `~${Math.max(5, Math.round(probe.duration * 0.8))}s`,
      },
    });
  } catch (error) {
    logger.error('[Transform Route] Preview failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /single — Transform one video file ─────────────────────
router.post('/single', async (req, res) => {
  const { filepath, options } = req.body;
  if (!filepath || !fs.existsSync(filepath)) {
    return res.status(400).json({ error: 'ไฟล์ไม่พบ — กรุณาระบุ filepath ที่ถูกต้อง' });
  }

  try {
    const health = await videoTransform.checkHealth();
    if (!health.available) {
      return res.status(503).json({ error: 'ffmpeg ไม่พร้อมใช้งาน', details: health.error });
    }

    const result = await videoTransform.transformSingle(filepath, options || {});
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('[Transform Route] Single transform failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /compile — Create compilation from multiple clips ──────
router.post('/compile', async (req, res) => {
  const { filepaths, options } = req.body;
  if (!Array.isArray(filepaths) || filepaths.length < 2) {
    return res.status(400).json({ error: 'ต้องมีอย่างน้อย 2 ไฟล์สำหรับ compilation' });
  }

  // Validate all files exist
  const missing = filepaths.filter(f => !fs.existsSync(f));
  if (missing.length > 0) {
    return res.status(400).json({ error: 'ไฟล์บางส่วนไม่พบ', missing });
  }

  try {
    const health = await videoTransform.checkHealth();
    if (!health.available) {
      return res.status(503).json({ error: 'ffmpeg ไม่พร้อมใช้งาน', details: health.error });
    }

    const result = await videoTransform.createCompilation(filepaths, options || {});
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('[Transform Route] Compilation failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
