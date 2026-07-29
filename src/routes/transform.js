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
const C = require('../config/constants');
const { resolveSafe, resolveSafeMany, PathGuardError } = require('../utils/pathGuard');
const diskGuard = require('../utils/diskGuard');

/**
 * ★ ตอบ error ของ path guard ให้เป็นข้อความที่อ่านรู้เรื่อง
 * เดิม route รับ filepath อะไรก็ได้จาก body → ffprobe/ffmpeg ไฟล์ไหนก็ได้บนเครื่อง
 */
function handlePathError(res, err) {
  if (err instanceof PathGuardError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  return null;
}

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
router.post('/config', async (req, res) => {
  try {
    const newTransformConfig = req.body;

    // Validate basic structure
    if (!newTransformConfig || typeof newTransformConfig !== 'object' || Array.isArray(newTransformConfig)) {
      return res.status(400).json({ error: 'Config ต้องเป็น object' });
    }

    // ★ safeUpdate — เดิม load()+save() ทับ settings ที่หน้าอื่นเพิ่งบันทึก
    await settings.safeUpdate((current) => {
      current.videoTransform = {
        ...(current.videoTransform || {}),
        ...newTransformConfig,
      };
      return current;
    });

    logger.info('[Transform] Config updated', { keys: Object.keys(newTransformConfig) });

    // getConfig() clamp ค่าให้อยู่ในช่วงที่ ffmpeg รับได้ — ตอบค่าที่ใช้จริงกลับไป
    res.json({ success: true, config: videoTransform.getConfig() });
  } catch (error) {
    logger.error('[Transform Route] Config update failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /preview — Probe video + show what transform would do ──
router.post('/preview', async (req, res) => {
  let filepath;
  try {
    filepath = resolveSafe(req.body?.filepath);
  } catch (err) {
    return handlePathError(res, err) || res.status(400).json({ error: err.message });
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
  let filepath;
  try {
    filepath = resolveSafe(req.body?.filepath, { maxBytes: C.VIDEO_TRANSFORM.MAX_INPUT_SIZE_BYTES });
  } catch (err) {
    return handlePathError(res, err) || res.status(400).json({ error: err.message });
  }

  try {
    const health = await videoTransform.checkHealth();
    if (!health.available) {
      return res.status(503).json({ error: 'ffmpeg ไม่พร้อมใช้งาน', details: health.error });
    }

    const space = diskGuard.check(fs.statSync(filepath).size * diskGuard.TRANSFORM_MULTIPLIER, { label: 'transform' });
    if (!space.ok) {
      return res.status(507).json({ error: 'พื้นที่ดิสก์ไม่พอ', code: 'DISK_FULL', detail: space.reason });
    }

    const result = await videoTransform.transformSingle(filepath, req.body?.options || {});
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('[Transform Route] Single transform failed', { error: error.message });
    res.status(error.statusCode || 500).json({ error: error.message, code: error.code });
  }
});

// ─── POST /compile — Create compilation from multiple clips ──────
router.post('/compile', async (req, res) => {
  const { filepaths, options } = req.body || {};
  if (!Array.isArray(filepaths) || filepaths.length < 2) {
    return res.status(400).json({ error: 'ต้องมีอย่างน้อย 2 ไฟล์สำหรับ compilation' });
  }

  let safePaths;
  try {
    // ★ ทุก path ต้องอยู่ในโฟลเดอร์ของระบบ + จำกัดจำนวนไฟล์ (กัน payload ยิงงานหนัก)
    safePaths = resolveSafeMany(filepaths, {
      maxCount: 30,
      maxBytes: C.VIDEO_TRANSFORM.MAX_INPUT_SIZE_BYTES,
    });
  } catch (err) {
    return handlePathError(res, err) || res.status(400).json({ error: err.message });
  }

  try {
    const health = await videoTransform.checkHealth();
    if (!health.available) {
      return res.status(503).json({ error: 'ffmpeg ไม่พร้อมใช้งาน', details: health.error });
    }

    const result = await videoTransform.createCompilation(safePaths, options || {});
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('[Transform Route] Compilation failed', { error: error.message });
    res.status(error.statusCode || 500).json({ error: error.message, code: error.code });
  }
});

// ─── POST /kill — ยุติงาน ffmpeg ที่ค้าง ──────────────────────────
router.post('/kill', (req, res) => {
  const result = videoTransform.killAll('manual');
  logger.warn('[Transform] ผู้ใช้สั่งยุติงาน ffmpeg', result);
  res.json({ success: true, ...result });
});

// ─── GET /running — งาน ffmpeg ที่กำลังวิ่ง ────────────────────────
router.get('/running', (req, res) => {
  res.json({ running: videoTransform.getRunning(), stats: videoTransform.getStats() });
});

module.exports = router;
