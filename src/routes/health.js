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
    res.status(ready ? 200 : 503).json({
      status:  ready ? 'ready' : 'not_ready',
      overall: health.overall,
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
  const queueResult = healthService.cleanupQueue();
  const tempResult  = healthService.cleanupTempFiles();
  logger.info('Manual cleanup performed');
  res.json({ success: true, queue: queueResult, tempFiles: tempResult });
});

// ── Logs ──────────────────────────────────────────────────────────

router.get('/logs', (req, res) => {
  const limit  = Math.max(1, Math.min(500, parseInt(req.query.limit) || 50));
  const level  = req.query.level || null;
  const logs   = logger.getRecentLogs(limit, level);
  res.json({ logs });
});

module.exports = router;
