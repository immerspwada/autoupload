/**
 * ★ Upload Routes — ทุกเหตุการณ์ผ่าน EventBus เท่านั้น
 *
 * แก้ไขจาก original:
 * 1. [HIGH] Race condition ใน /single และ /drop
 *    uploads.load() → push → save() โดยไม่ lock
 *    → ใช้ safeUpdate() ที่ serialize write queue แทน
 * 2. [HIGH] Race condition ใน /all (Queue path)
 *    uploads.load() ภายใน task function อาจ stale ถ้า concurrent task อื่นกำลัง save
 *    → ใช้ safeUpdate()
 * 3. [MEDIUM] เพิ่ม validation บน queue cancel id
 */
const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

const youtubeService = require('../services/youtube');
const uploadQueue    = require('../services/queue');
const healthService  = require('../services/health');
const orchestrator   = require('../services/orchestrator');
const { settings, uploads } = require('../utils/store');
const logger = require('../utils/logger');

const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];

// ── Multer setup ──────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    let name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const target = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(target)) {
      const ext  = path.extname(name);
      const base = path.basename(name, ext);
      name = `${base}_${Date.now()}${ext}`;
    }
    cb(null, name);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (VIDEO_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(new Error('ไม่รองรับไฟล์ประเภทนี้: ' + ext));
  },
  limits: { fileSize: 128 * 1024 * 1024 * 1024 }, // 128 GB
});

// ════════════════════════════════════════════════════════════
// PATH A — DIRECT UPLOAD (route emit เอง)
// Route → YouTube → Record → orchestrator.onUploadCompleted()
// ════════════════════════════════════════════════════════════

router.post('/single', async (req, res) => {
  const { filename, title, description, tags, privacy } = req.body;
  const config = settings.load();

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }
  if (!config.folder) return res.status(400).json({ error: 'No folder configured' });

  // Basic filename validation — ป้องกัน path traversal
  if (!filename || filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filepath = path.join(config.folder, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found: ' + filename });

  // Hash-based duplicate check
  const dupCheck = await healthService.isDuplicate(filepath);
  if (dupCheck.duplicate) {
    orchestrator.onDuplicateDetected({ filename, originalFile: dupCheck.originalFile, hash: dupCheck.hash });
    return res.status(409).json({
      error: 'ไฟล์ซ้ำ (hash match)',
      originalFile: dupCheck.originalFile,
      youtubeUrl: dupCheck.youtubeUrl,
    });
  }

  // Filename-based duplicate check
  const existing = uploads.load().find(u => u.filename === filename);
  if (existing) return res.status(409).json({ error: 'File already uploaded', youtubeUrl: existing.youtube_url });

  try {
    const fileSize = fs.statSync(filepath).size;

    const result = await youtubeService.uploadVideo({
      filepath,
      title:       title || path.basename(filename, path.extname(filename)),
      description: description || config.defaultDescription || '',
      tags:        tags        || config.defaultTags        || '',
      privacy:     privacy     || config.privacy            || 'public',
    });

    const shouldDelete = config.deleteAfterUpload === true || config.deleteAfterUpload === 'true';

    // ★ Atomic / race-safe record write
    await uploads.safeUpdate(arr => {
      const record = {
        filename,
        filepath,
        youtube_id:  result.videoId,
        youtube_url: result.youtubeUrl,
        uploaded_at: new Date().toISOString(),
        deleted:     false,
        size:        fileSize,
        hash:        dupCheck.hash,
        source:      'folder',
      };
      if (shouldDelete && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        record.deleted = true;
      }
      arr.push(record);
      return arr;
    });

    // ★ PATH A — emit ผ่าน EventBus (stats / dashboard / notification)
    orchestrator.onUploadCompleted({
      filename, size: fileSize, hash: dupCheck.hash, source: 'folder',
      videoId: result.videoId, youtubeUrl: result.youtubeUrl,
    });

    res.json({ success: true, ...result, deleted: shouldDelete });
  } catch (error) {
    logger.error('Upload error', { filename, error: error.message });
    orchestrator.onUploadFailed({ filename, error: error.message, source: 'folder' });
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// PATH B — QUEUE UPLOAD (Queue emit completed/failed อัตโนมัติ)
// Route → Queue.add() → Queue.emit('completed') → Orchestrator → EventBus
// ★ ห้ามเรียก orchestrator.onUploadCompleted() ภายใน task function
// ════════════════════════════════════════════════════════════

router.post('/all', (req, res) => {
  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }

  const config = settings.load();
  if (!config.folder) return res.status(400).json({ error: 'No folder configured' });

  const folder = config.folder;
  if (!fs.existsSync(folder)) return res.status(400).json({ error: 'Folder not found' });

  // Build uploaded set for O(1) lookup
  const allUploads   = uploads.load();
  const uploadedSet  = new Set(allUploads.map(u => u.filename));

  const files = fs.readdirSync(folder).filter(f => {
    if (!VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())) return false;
    return !uploadedSet.has(f);
  });

  if (files.length === 0) {
    return res.json({ totalFiles: 0, message: 'No files to upload' });
  }

  files.forEach(filename => {
    const filepath = path.join(folder, filename);
    uploadQueue.add(async () => {
      const fileSize = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;

      const result = await youtubeService.uploadVideo({
        filepath,
        title:       path.basename(filename, path.extname(filename)),
        description: config.defaultDescription || '',
        tags:        config.defaultTags        || '',
        privacy:     config.privacy            || 'public',
      });

      const shouldDelete = config.deleteAfterUpload === true || config.deleteAfterUpload === 'true';

      // ★ safeUpdate — ป้องกัน lost-update เมื่อหลาย task เขียนพร้อมกัน
      await uploads.safeUpdate(arr => {
        const record = {
          filename, filepath,
          youtube_id:  result.videoId,
          youtube_url: result.youtubeUrl,
          uploaded_at: new Date().toISOString(),
          deleted:     false,
          size:        fileSize,
          source:      'folder',
        };
        if (shouldDelete && fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          record.deleted = true;
        }
        arr.push(record);
        return arr;
      });

      // ★ ห้าม emit ที่นี่ — Queue.emit('completed') → orchestrator._wireQueue() จัดการ
      return { ...result, size: fileSize };
    }, { filename });
  });

  res.json({ totalFiles: files.length, message: 'Queued for upload' });
});

// ════════════════════════════════════════════════════════════
// PATH A — DROP UPLOAD (Direct — route emit เอง)
// ════════════════════════════════════════════════════════════

router.post('/drop', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }

  const config   = settings.load();
  const filename = req.file.filename;
  const filepath = req.file.path;

  // Hash-based duplicate check
  const dupCheck = await healthService.isDuplicate(filepath);
  if (dupCheck.duplicate) {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    orchestrator.onDuplicateDetected({ filename, originalFile: dupCheck.originalFile, hash: dupCheck.hash });
    return res.status(409).json({
      error:        'ไฟล์ซ้ำ',
      originalFile: dupCheck.originalFile,
      youtubeUrl:   dupCheck.youtubeUrl,
    });
  }

  try {
    const fileSize = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;

    const result = await youtubeService.uploadVideo({
      filepath,
      title:       req.body.title       || path.basename(filename, path.extname(filename)),
      description: req.body.description || config.defaultDescription || '',
      tags:        req.body.tags        || config.defaultTags        || '',
      privacy:     req.body.privacy     || config.privacy            || 'public',
    });

    // ★ safeUpdate — always delete temp after drop upload
    await uploads.safeUpdate(arr => {
      arr.push({
        filename, filepath,
        youtube_id:  result.videoId,
        youtube_url: result.youtubeUrl,
        uploaded_at: new Date().toISOString(),
        deleted:     true,
        size:        fileSize,
        hash:        dupCheck.hash,
        source:      'drop',
      });
      return arr;
    });

    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

    // ★ PATH A — emit
    orchestrator.onUploadCompleted({
      filename, size: fileSize, hash: dupCheck.hash, source: 'drop',
      videoId: result.videoId, youtubeUrl: result.youtubeUrl,
    });

    res.json({ success: true, ...result, filename });
  } catch (error) {
    logger.error('Drop upload error', { filename, error: error.message });
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    orchestrator.onUploadFailed({ filename, error: error.message, source: 'drop' });
    res.status(500).json({ error: error.message });
  }
});

// ── Queue management ──────────────────────────────────────────────

router.get('/queue', (_req, res) => {
  res.json(uploadQueue.getStatus());
});

router.post('/queue/pause', (_req, res) => {
  uploadQueue.pause();
  res.json({ success: true, paused: true });
});

router.post('/queue/resume', (_req, res) => {
  uploadQueue.resume();
  res.json({ success: true, paused: false });
});

router.delete('/queue/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid queue id' });
  const cancelled = uploadQueue.cancel(id);
  res.json({ success: cancelled });
});

module.exports = router;
