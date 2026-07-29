/**
 * ★ Health & System Routes
 *
 * แก้ไขจาก original:
 * 1. [CRITICAL] /duplicate-check — ไม่มี input validation บน filepath
 *    → เพิ่ม sanitize: อนุญาตเฉพาะ path ที่ขึ้นต้นด้วย allowed directories
 * 2. [LOW] เพิ่ม /live และ /ready endpoints สำหรับ container health check
 */
const express      = require('express');
const router       = express.Router();
const path         = require('path');
const healthService = require('../services/health');
const logger       = require('../utils/logger');

// Allowed base directories for duplicate-check filepath
// ป้องกัน user ส่ง filepath ของไฟล์อื่นนอก workspace เช่น /etc/passwd
const ALLOWED_BASE_DIRS = [
  path.resolve(process.cwd(), 'uploads'),
  path.resolve(process.cwd(), 'downloads'),
  path.resolve(process.cwd(), 'data'),
];

function isAllowedFilepath(filePath) {
  const resolved = path.resolve(filePath);
  return ALLOWED_BASE_DIRS.some(base => {
    const rel = path.relative(base, resolved);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

// ── Health Endpoints ──────────────────────────────────────────────

// GET /api/health — full system health (dashboard)
router.get('/', async (req, res) => {
  try {
    const health     = await healthService.getHealth();
    const statusCode = health.overall === 'error' ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (err) {
    res.status(500).json({ overall: 'error', error: err.message });
  }
});

// GET /api/health/live — Liveness probe (container/K8s/Railway)
// Returns 200 as long as Node process is alive
router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// GET /api/health/ready — Readiness probe
// Returns 200 when system is ready to accept uploads
router.get('/ready', async (_req, res) => {
  try {
    const health = await healthService.getHealth();
    const ready  = health.overall !== 'critical';

    // ★ Engine persistence evidence for deploy verification
    const engine = require('../services/engine');
    const store  = require('../utils/store');
    const fs     = require('fs');
    const dataDir = require('path').join(__dirname, '../../data');

    let dataWritable = false;
    try { fs.accessSync(dataDir, fs.constants.W_OK); dataWritable = true; } catch (_) {}

    const accountsCount = (() => {
      try {
        const am = require('../utils/accounts');
        return am.getAll ? am.getAll().length : 0;
      } catch (_) { return 0; }
    })();

    const uploadsCount = store.uploads.loadRef().length;
    const lastWrite = (() => {
      try { return fs.statSync(require('path').join(dataDir, 'engine_state.json')).mtime.toISOString(); }
      catch (_) { return null; }
    })();

    res.status(ready ? 200 : 503).json({
      status:  ready ? 'ready' : 'not_ready',
      overall: health.overall,
      engine:  engine.getStatus().phase,
      persistence: {
        dataWritable,
        accountsWithToken: accountsCount,
        uploadsCount,
        lastDataWrite: lastWrite,
      },
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ── Duplicate Check ───────────────────────────────────────────────

/**
 * POST /api/health/duplicate-check
 *
 * ★ Security: filepath ต้องอยู่ใน allowed directories เท่านั้น
 *   ป้องกัน user ส่ง { filepath: "/etc/passwd" } เพื่ออ่านไฟล์ระบบ
 */
router.post('/duplicate-check', async (req, res) => {
  const { filepath } = req.body;
  if (!filepath || typeof filepath !== 'string') {
    return res.status(400).json({ error: 'filepath required (string)' });
  }

  // ★ Input validation — path traversal guard
  if (!isAllowedFilepath(filepath)) {
    logger.warn('[Health] Rejected duplicate-check outside allowed dirs', { filepath });
    return res.status(400).json({ error: 'filepath must be within uploads/ or downloads/ directories' });
  }

  try {
    const result = await healthService.isDuplicate(filepath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cleanup ───────────────────────────────────────────────────────

router.post('/cleanup', (req, res) => {
  const deep = req.query.deep === '1' || req.body?.deep === true;
  const result = deep
    ? healthService.deepCleanup()
    : { queue: healthService.cleanupQueue(), temp: healthService.cleanupTempFiles() };
  logger.info('Manual cleanup performed', { deep });
  res.json({ success: true, deep, ...result });
});

// ── ★ Metrics — จุดเดียวเห็นสุขภาพระบบทั้งหมด ─────────────────────
/**
 * GET /api/health/metrics
 * รวม: circuit breaker, queue, ffmpeg, disk, store writes, event bus, scheduler loop
 * ใช้ debug ปัญหาแบบ "ระบบช้า/ค้าง/ไม่ทำงาน" ได้ในคำขอเดียว
 */
router.get('/metrics', async (req, res) => {
  const safe = (fn, fallback = null) => { try { return fn(); } catch (_) { return fallback; } };

  const uploadQueue    = require('../services/queue');
  const videoTransform = require('../services/videoTransform');
  const scheduler      = require('../services/scheduler');
  const resilience     = require('../utils/resilience');
  const diskGuard      = require('../utils/diskGuard');
  const store          = require('../utils/store');
  const orchestrator   = require('../services/orchestrator');

  res.json({
    timestamp: new Date().toISOString(),
    process: {
      pid:      process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion:   process.version,
      memory:   safe(() => {
        const m = process.memoryUsage();
        return {
          rssBytes: m.rss, heapUsedBytes: m.heapUsed, heapTotalBytes: m.heapTotal,
          externalBytes: m.external,
        };
      }),
      activeHandles: safe(() => process._getActiveHandles?.().length ?? null),
      activeRequests: safe(() => process._getActiveRequests?.().length ?? null),
    },
    // ★ circuit breaker — บอกได้ทันทีว่า YouTube/tikwm ล่มอยู่ไหม
    circuits: safe(() => resilience.allBreakers(), []),
    queue:    safe(() => {
      const s = uploadQueue.getStatus({ maxItems: 0 });
      delete s.items;
      return s;
    }),
    ffmpeg: safe(() => ({ running: videoTransform.getRunning(), stats: videoTransform.getStats() })),
    scheduler: safe(() => ({ config: scheduler.getConfig(), loop: scheduler.getLoopState() })),
    disk:  safe(() => diskGuard.getDiskInfo()),
    // ★ store write metrics — ตรวจว่ามี write ค้างในคิวไหม (pending > 0 นานๆ = ดิสก์มีปัญหา)
    stores: safe(() => store.allMetrics(), []),
    eventBus: safe(() => ({ recentEvents: orchestrator.getEventHistory(10) })),
  });
});

// ── ★ POST /circuits/reset — ปลด circuit ที่เปิดอยู่ด้วยมือ ────────
router.post('/circuits/reset', (req, res) => {
  const resilience = require('../utils/resilience');
  const count = resilience.resetAllBreakers();
  logger.info('[Health] ผู้ใช้สั่ง reset circuit breakers', { count });
  res.json({ success: true, reset: count, circuits: resilience.allBreakers() });
});

// ── Logs ──────────────────────────────────────────────────────────

router.get('/logs', (req, res) => {
  const limit  = Math.max(1, Math.min(500, parseInt(req.query.limit) || 50));
  const level  = req.query.level || null;
  const logs   = logger.getRecentLogs(limit, level);
  res.json({ logs });
});

module.exports = router;
