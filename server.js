// YouTube Auto Uploader - Advanced Server
const express = require('express');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const logger      = require('./src/utils/logger');
const C           = require('./src/config/constants');
const requestLogger = require('./src/middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');
const youtubeService = require('./src/services/youtube');
const uploadQueue    = require('./src/services/queue');
const scheduler      = require('./src/services/scheduler');
const healthService  = require('./src/services/health');
const orchestrator   = require('./src/services/orchestrator');
const eventBus       = require('./src/services/eventbus');

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

// Remove legacy direct queue→websocket wiring since orchestrator handles it

// ==================== Middleware ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(express.static(path.join(__dirname, 'public')));

// ==================== API Routes ====================
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

// Event Bus API
app.get('/api/events/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(orchestrator.getEventHistory(limit));
});

app.get('/api/events/rules', (req, res) => {
  res.json(orchestrator.getRules());
});

// ★ /api/settings — delegate to /api/files/settings
// ลบ inline handler ที่ซ้ำออก เหลือแค่ proxy ไป files route ที่ถูกต้อง
app.get('/api/settings',  (req, res) => res.redirect(307, '/api/files/settings'));
app.post('/api/settings', (req, res) => res.redirect(307, '/api/files/settings'));

// Legacy routes — removed upload/files/history/queue/scheduler pages
// These routes are kept for backward compatibility but return 404 if removed pages are accessed

app.get('/api/history', (req, res) => {
  const { uploads } = require('./src/utils/store');
  res.json(uploads.load().reverse());
});

app.delete('/api/history', (req, res) => {
  const { uploads } = require('./src/utils/store');
  uploads.save([]);
  res.json({ success: true });
});

// SSE upload progress (legacy compatibility)
app.get('/api/upload-progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

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

  req.on('close', () => clearInterval(interval));
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
server.listen(PORT, () => {
  logger.info('Server started', { port: PORT });

  console.log(`
╔══════════════════════════════════════════╗
║  🎬 YouTube Auto Uploader v2.0          ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ║
║  🌐 http://localhost:${PORT}               ║
║  📡 WebSocket: ws://localhost:${PORT}/ws    ║
║  📁 Folder watch + Auto scheduler       ║
║  🔄 Queue with retry & priority         ║
║  📊 Dashboard analytics                 ║
║  🎵 TikTok Download (No Watermark)      ║
╚══════════════════════════════════════════╝
  `);

  // Start scheduler if enabled
  scheduler.start();

  // Auto-cleanup every 6 hours
  setInterval(() => {
    try {
      healthService.cleanupQueue();
      healthService.cleanupTempFiles();
    } catch (err) {
      logger.error('Health cleanup error', { error: err.message });
    }
  }, C.HEALTH.CLEANUP_INTERVAL_MS);

  // Broadcast system status every 30 seconds
  setInterval(async () => {
    if (wsClients.size > 0) {
      const health = await healthService.getHealth();
      broadcast('system:status', {
        overall: health.overall,
        uptime:  health.uptimeFormatted,
        queue:   health.queue,
        youtube: health.youtube,
      });
    }
  }, C.HEALTH.STATUS_BROADCAST_MS);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  scheduler.stop();
  wss.close();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  scheduler.stop();
  wss.close();
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { error: reason?.message || String(reason) });
});
