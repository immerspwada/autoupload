// YouTube Auto Uploader - Advanced Server
const express = require('express');
const path = require('path');
const http = require('http');
const os = require('os');
const { WebSocketServer } = require('ws');
const compression = require('compression');

const logger      = require('./src/utils/logger');
const C           = require('./src/config/constants');
const requestLogger = require('./src/middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');
const sec         = require('./src/middleware/security');
const storeModule = require('./src/utils/store');
const youtubeService = require('./src/services/youtube');
const uploadQueue    = require('./src/services/queue');
const scheduler      = require('./src/services/scheduler');
const healthService  = require('./src/services/health');
const orchestrator   = require('./src/services/orchestrator');

// Routes
const authRoutes = require('./src/routes/auth');
const filesRoutes = require('./src/routes/files');
const uploadRoutes = require('./src/routes/upload');
const statsRoutes = require('./src/routes/stats');
const tiktokRoutes = require('./src/routes/tiktok');
const healthRoutes = require('./src/routes/health');
const seoRoutes = require('./src/routes/seo');
const activityRoutes = require('./src/routes/activity');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// หา LAN IP (IPv4, non-internal) สำหรับเข้าใช้งานจากเครื่องอื่นในเน็ตเวิร์ก
function getLanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push({ name, address: net.address });
    }
  }
  return out;
}

// ==================== WebSocket Setup ====================
const wss = new WebSocketServer({ server, path: '/ws' });

const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  logger.debug('WebSocket client connected', { total: wsClients.size });

  // Send initial status
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      queue: uploadQueue.getStatus(),
      scheduler: scheduler.getConfig()
    }
  }));

  ws.on('close', () => {
    wsClients.delete(ws);
  });

  ws.on('error', () => {
    wsClients.delete(ws);
  });
});

function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  wsClients.forEach(ws => {
    if (ws.readyState === 1) { // OPEN
      try {
        ws.send(message);
      } catch (err) {
        // Client disconnected mid-send — remove silently
        wsClients.delete(ws);
      }
    }
  });
}

// Wire up all services via Orchestrator (central event bus)
orchestrator.init(broadcast);

// ★ Task 14: Wire Engine (Autonomous Upload Engine)
const engine = require('./src/services/engine');
engine.init(broadcast);

// Remove legacy direct queue→websocket wiring since orchestrator handles it

// ==================== Middleware ====================
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(compression()); // Compress all responses
app.use(sec.securityHeaders);

// ★ Body limit — batch payload มี video object เต็มก้อน จึงต้องใหญ่กว่า default 100kb
//   แต่ไม่ปล่อยไม่จำกัด (กัน memory exhaustion)
app.use(express.json({ limit: process.env.BODY_LIMIT || '4mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.BODY_LIMIT || '4mb' }));
app.use(requestLogger);

// ★ Rate limit — กันยิงถี่ทำ event loop ตาย (SSE/WS ยกเว้น)
app.use('/api/', sec.rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 600,
  name: 'api',
  skip: (req) => req.path.startsWith('/api/health/live')
              || req.path.startsWith('/api/health/ready')
              || req.path.includes('/progress-stream'),
}));

// ★ Auth — เปิดใช้เมื่อตั้ง DASHBOARD_PASSWORD
app.use(sec.authMiddleware);

// Static file serving with cache headers
const staticOptions = {
  maxAge: '1d', // 1 day cache for static assets
  etag: true,
  lastModified: true
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// ==================== API Routes ====================
app.use('/api/security', require('./src/routes/security'));
app.use('/api/auth', authRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/tiktok', tiktokRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/quota', require('./src/routes/quota'));
app.use('/api/activity', activityRoutes);
app.use('/api/accounts', require('./src/routes/accounts'));
app.use('/api/watchlist', require('./src/routes/watchlist'));
app.use('/api/analytics', require('./src/routes/analytics'));
app.use('/api/transform', require('./src/routes/transform'));
app.use('/api/manage', require('./src/routes/manage'));
app.use('/api/engine', require('./src/routes/engine'));

// Event Bus API
app.get('/api/events/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(orchestrator.getEventHistory(limit));
});

app.get('/api/events/rules', (req, res) => {
  res.json(orchestrator.getRules());
});

// ★ /api/settings — proxy to files route
app.get('/api/settings',  (req, res) => res.redirect(307, '/api/files/settings'));
app.post('/api/settings', (req, res) => res.redirect(307, '/api/files/settings'));

// Legacy upload history (backward compat)
app.get('/api/history', (req, res, next) => {
  try {
    const { uploads } = storeModule;
    // ★ load() คืน clone แล้ว — reverse() ปลอดภัย ไม่กระทบ cache ที่คนอื่นถืออยู่
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    res.json(uploads.load().reverse().slice(0, limit));
  } catch (err) { next(err); }
});

app.delete('/api/history', sec.requireAuthForDestructive, async (req, res, next) => {
  try {
    const { uploads } = storeModule;
    const before = uploads.loadRef().length;
    await uploads.safeUpdate(() => []);
    logger.warn('ล้างประวัติการอัปโหลดทั้งหมด', { removed: before, ip: req.ip });
    res.json({ success: true, removed: before });
  } catch (err) { next(err); }
});

// ★ SSE registry — ต้องปิด stream พวกนี้ตอน shutdown ไม่งั้น server.close() ค้างตลอด
const sseClients = new Set();

// SSE upload progress (legacy compatibility)
app.get('/api/upload-progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendStatus = () => {
    const status = uploadQueue.getStatus();
    const legacyFormat = {
      current: status.done + status.processing,
      total: status.total,
      currentFile: status.items.find(i => i.status === 'processing')?.filename || '',
      status: status.pending === 0 && status.processing === 0 ? 'done' : 'uploading',
      results: status.items.filter(i => ['done', 'failed'].includes(i.status)).map(i => ({
        filename: i.filename,
        success: i.status === 'done'
      }))
    };
    res.write(`data: ${JSON.stringify(legacyFormat)}\n\n`);
  };

  const interval = setInterval(sendStatus, 1000);
  sendStatus();

  const client = { res, cleanup: () => clearInterval(interval) };
  sseClients.add(client);

  req.on('close', () => {
    clearInterval(interval);
    sseClients.delete(client);
  });
});

// OAuth callback
app.get('/oauth2callback', async (req, res) => {
  const { code, state } = req.query;
  try {
    await youtubeService.handleCallback(code, state);
    orchestrator.onAuthLogin();
    
    // Check if multi-account login
    if (state) {
      try {
        const stateData = JSON.parse(state);
        if (stateData.accountId) {
          res.redirect('/?auth=success&account=true');
          return;
        }
      } catch (e) {
        // Ignore
      }
    }
    
    res.redirect('/?auth=success');
  } catch (error) {
    logger.error('OAuth callback error', { error: error.message });
    res.redirect('/?auth=error&message=' + encodeURIComponent(error.message));
  }
});

// ==================== Error Handling ====================
app.use(notFoundHandler);
app.use(errorHandler);

// ==================== Start Server ====================
// ★ Timer registry — ต้องเคลียร์ตอน shutdown ไม่งั้นทำงานต่อระหว่างปิดระบบ
const timers = [];

// ★ HTTP timeouts — เดิมไม่ตั้งเลย socket ค้างได้ไม่จำกัด
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 70_000;          // ต้องมากกว่า keepAliveTimeout
server.requestTimeout   = 0;               // 0 = ไม่จำกัด (upload ไฟล์ใหญ่ใช้เวลานาน)
server.timeout          = 0;               // per-socket inactivity จัดการที่ระดับ route แทน
server.maxHeadersCount  = 100;

server.on('clientError', (err, socket) => {
  if (socket.writable && !socket.destroyed) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  }
  logger.debug('Client error', { error: err.message });
});

server.listen(PORT, HOST, () => {
  const lanIPs = getLanIPs();
  logger.info('Server started', { port: PORT, host: HOST, lan: lanIPs.map(i => i.address) });

  console.log(`
╔══════════════════════════════════════════╗
║  🎬 YouTube Auto Uploader v2.0          ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ║
║  📁 Folder watch + Auto scheduler       ║
║  🔄 Queue with retry & priority         ║
║  📊 Dashboard analytics                 ║
║  🎵 TikTok Download (No Watermark)      ║
╚══════════════════════════════════════════╝

  🖥  Local:    http://localhost:${PORT}
${lanIPs.map(i => `  🌐 Network:  http://${i.address}:${PORT}   (${i.name})`).join('\n') || '  🌐 Network:  ไม่พบ LAN IP'}
  📡 WebSocket: ws://<host>:${PORT}/ws
  🔓 Binding:   ${HOST}${HOST === '0.0.0.0' ? ' (เข้าถึงได้จากทุกเครื่องในเน็ตเวิร์ก)' : ''}
  `);

  if (HOST === '0.0.0.0' && !process.env.DASHBOARD_PASSWORD) {
    console.log('  ⚠️  ไม่ได้ตั้ง DASHBOARD_PASSWORD — ใครก็ตามในเน็ตเวิร์กเดียวกันเข้าใช้งาน dashboard ได้\n');
  }

  // ★ Production guard: บังคับ DASHBOARD_PASSWORD + APP_URL ในโหมด production
  if (process.env.NODE_ENV === 'production') {
    const pw = process.env.DASHBOARD_PASSWORD || '';
    if (pw.length < 12) {
      logger.error('★ DASHBOARD_PASSWORD ต้องมีอย่างน้อย 12 ตัวอักษรสำหรับ production — ระบบถูกล็อก');
      console.error('\n  ❌ DASHBOARD_PASSWORD ไม่ได้ตั้งหรือสั้นเกินไป (ต้อง ≥12 ตัวอักษร)\n     ตั้งค่าแล้ว restart: fly secrets set DASHBOARD_PASSWORD=yourpassword\n');
    }
    const appUrl = process.env.APP_URL || '';
    if (!appUrl.startsWith('https://')) {
      logger.error('★ APP_URL ต้องเป็น https:// สำหรับ production (OAuth redirect จะไม่ทำงาน)');
      console.error('\n  ❌ APP_URL ไม่ได้ตั้งหรือไม่เริ่มด้วย https://\n     ตั้งค่า: fly secrets set APP_URL=https://your-app.fly.dev\n');
    }
  }

  // Start scheduler if enabled
  scheduler.start();

  // Auto-cleanup every 6 hours
  timers.push(setInterval(() => {
    try {
      healthService.cleanupQueue();
      healthService.cleanupTempFiles();
    } catch (err) {
      logger.error('Health cleanup error', { error: err.message });
    }
  }, C.HEALTH.CLEANUP_INTERVAL_MS));

  // Broadcast system status every 30 seconds
  // ★ ต้องมี try/catch — เดิมถ้า getHealth() throw (โฟลเดอร์อ่านไม่ได้) จะเกิด
  //   unhandledRejection ทุก 30 วิตลอดไป
  timers.push(setInterval(async () => {
    try {
      if (wsClients.size === 0) return;
      const health = await healthService.getHealth();
      broadcast('system:status', {
        overall: health.overall,
        uptime:  health.uptimeFormatted,
        queue:   health.queue,
        youtube: health.youtube,
      });
    } catch (err) {
      logger.error('Status broadcast error', { error: err.message });
    }
  }, C.HEALTH.STATUS_BROADCAST_MS));

  // ★ Health watchdog — dispatch health:status_changed เพื่อให้ EventBus Rule 9
  //   (critical → auto-pause queue) ทำงานจริง เดิมไม่มีใคร emit event นี้เลย
  let lastHealthStatus = null;
  const checkHealthStatus = async () => {
    try {
      const health = await healthService.getHealth();
      if (health.overall === lastHealthStatus) return;

      const previous = lastHealthStatus;
      lastHealthStatus = health.overall;

      // ★ รอบแรก: แจ้งเฉพาะกรณีที่ไม่ปกติ — ระบบที่เริ่มมาพร้อมดิสก์เต็ม
      //   ต้องถูก auto-pause ทันที ไม่ใช่รอให้สถานะ "เปลี่ยน" ก่อน
      if (previous === null && health.overall === 'healthy') return;

      orchestrator.onHealthStatusChanged(health.overall, previous ?? 'unknown', health);
    } catch (err) {
      logger.error('Health watchdog error', { error: err.message });
    }
  };

  // เช็คครั้งแรกหลังบูตเสร็จ (หน่วง 5 วิ ให้ service ตั้งตัวก่อน)
  const firstCheck = setTimeout(checkHealthStatus, 5000);
  if (firstCheck.unref) firstCheck.unref();
  timers.push(setInterval(checkHealthStatus, C.HEALTH.WATCHDOG_INTERVAL_MS || 60_000));
});

// ══════════════════════════════════════════════════════════════════
//  Graceful shutdown
// ══════════════════════════════════════════════════════════════════
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    logger.warn(`${signal} ซ้ำระหว่างปิดระบบ — บังคับออกทันที`);
    process.exit(exitCode || 1);
  }
  shuttingDown = true;
  logger.info(`${signal} — เริ่มปิดระบบอย่างปลอดภัย...`);

  // ★ Hard deadline — ถ้าปิดไม่จบใน 20s ให้ออกเลย (กันค้างเพราะ SSE/socket)
  const forceTimer = setTimeout(() => {
    logger.error('ปิดระบบไม่จบในเวลา — บังคับออก');
    process.exit(exitCode || 1);
  }, parseInt(process.env.SHUTDOWN_TIMEOUT_MS) || 20_000);
  forceTimer.unref();

  const step = async (label, fn) => {
    try { await fn(); logger.debug(`[Shutdown] ${label} ✓`); }
    catch (err) { logger.error(`[Shutdown] ${label} ✗`, { error: err.message }); }
  };

  // 1) หยุดรับงานใหม่
  await step('หยุด Engine', () => engine.shutdown());
  await step('หยุด scheduler', () => scheduler.stop());
  await step('หยุดรับงานเข้าคิว', () => uploadQueue.pause());

  // 2) เคลียร์ timer ทั้งหมด (เดิมไม่เคลียร์ → ทำงานต่อระหว่างปิด)
  await step('เคลียร์ timers', () => { timers.forEach(clearInterval); timers.length = 0; });

  // 3) ฆ่า ffmpeg ที่ยังวิ่ง — ไม่งั้นเหลือ zombie process กินซีพียู
  await step('ยุติงาน ffmpeg', () => {
    const vt = require('./src/services/videoTransform');
    if (typeof vt.killAll === 'function') return vt.killAll('shutdown');
  });

  // 4) ปิด SSE + WebSocket (ตัวการที่ทำให้ server.close() ค้างตลอด)
  await step('ปิด SSE streams', () => {
    for (const c of sseClients) {
      try { c.cleanup(); c.res.end(); } catch (_) {}
    }
    sseClients.clear();
  });
  await step('ปิด WebSocket', () => {
    for (const ws of wsClients) { try { ws.close(1001, 'server shutdown'); } catch (_) {} }
    wsClients.clear();
    wss.close();
  });

  // 5) ★ flush ข้อมูลที่ค้างในคิวเขียน — เดิมข้อมูลอัปโหลดล่าสุดหายทุกครั้งที่ restart
  await step('บันทึกข้อมูลที่ค้าง', () => storeModule.flushAll());
  await step('บันทึก hash registry', () => healthService.flushHashes());

  // 6) ปิด HTTP server
  await step('ปิด HTTP server', () => new Promise(resolve => {
    server.close(resolve);
    // ตัด keep-alive connection ที่ยังเปิดอยู่
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }, 3000).unref?.();
  }));

  clearTimeout(forceTimer);
  logger.info('ปิดระบบเรียบร้อย');
  process.exit(exitCode);
}

process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(1)); });

// ★ uncaughtException — เดิม log แล้วปล่อยให้วิ่งต่อ = state พัง เขียนข้อมูลผิด เงียบๆ
//   ตอนนี้: log → flush ข้อมูล → ออกด้วย code 1 ให้ process manager restart ให้
process.on('uncaughtException', (err) => {
  logger.error('★ Uncaught exception — ปิดระบบเพื่อป้องกันข้อมูลเสียหาย', {
    error: err?.message, stack: err?.stack,
  });
  shutdown('uncaughtException', 1).catch(() => process.exit(1));
});

// ★ unhandledRejection — ไม่ปิดทันที (rejection เดี่ยวๆ ไม่ได้ทำ state พังเสมอ)
//   แต่ถ้าเกิดถี่ = ระบบพังจริง → ปิดให้ supervisor restart
const rejectionWindow = [];
const REJECTION_LIMIT = parseInt(process.env.REJECTION_LIMIT) || 10;
const REJECTION_WINDOW_MS = 60_000;

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const now = Date.now();
  rejectionWindow.push(now);
  while (rejectionWindow.length && now - rejectionWindow[0] > REJECTION_WINDOW_MS) rejectionWindow.shift();

  logger.error('Unhandled rejection', {
    error: err.message,
    stack: err.stack,
    recentCount: rejectionWindow.length,
  });

  if (rejectionWindow.length >= REJECTION_LIMIT) {
    logger.error(`★ unhandled rejection ${rejectionWindow.length} ครั้งใน 1 นาที — ระบบไม่เสถียร ปิดเพื่อ restart`);
    shutdown('unhandledRejection-storm', 1).catch(() => process.exit(1));
  }
});

module.exports = { app, server, broadcast };
