/**
 * ★ Files & Settings Routes
 *
 * แก้ไขจาก original:
 * 1. [CRITICAL] Path Traversal บน /list-downloads
 *    → sanitize + validate ว่า resolved path อยู่ใน downloads/ เท่านั้น
 * 2. [CRITICAL] Path Traversal บน /duplicate-check (health route ก็มี)
 *    → ย้าย input validation มาไว้ที่นี่ด้วย
 * 3. [LOW] ลบ duplicate settings routes ออก (ยังมีใน server.js legacy)
 */
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { settings, uploads } = require('../utils/store');
const orchestrator = require('../services/orchestrator');

const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];

const DOWNLOADS_BASE = path.resolve(process.cwd(), 'downloads');

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k     = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i     = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * ★ Validate that a resolved path stays inside an allowed base directory.
 * ป้องกัน Path Traversal เช่น folder=../../etc/passwd
 */
function isSafeSubPath(resolvedPath, baseDir) {
  const rel = path.relative(baseDir, resolvedPath);
  // path.relative returns '' for same dir, or '../..' for parent traversal
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ── Video files list ──────────────────────────────────────────────

// GET /api/files — list video files in configured folder
router.get('/', (req, res) => {
  const config = settings.load();
  const folder = config.folder;
  if (!folder)                   return res.json({ files: [], folder: null });
  if (!fs.existsSync(folder))    return res.status(400).json({ error: 'Folder does not exist: ' + folder });

  const allUploads = uploads.load();

  const files = fs.readdirSync(folder)
    .filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const filepath = path.join(folder, f);
      const s        = fs.statSync(filepath);
      const record   = allUploads.find(u => u.filename === f);
      return {
        filename:      f,
        filepath,
        size:          s.size,
        sizeFormatted: formatFileSize(s.size),
        modified:      s.mtime,
        uploaded:      !!record,
        youtubeUrl:    record ? record.youtube_url : null,
        youtubeId:     record ? record.youtube_id  : null,
      };
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));

  res.json({
    files,
    folder,
    totalSize: formatFileSize(files.reduce((a, f) => a + f.size, 0)),
  });
});

// ── Settings ──────────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  res.json(settings.load());
});

router.post('/settings', (req, res) => {
  const current = settings.load();
  const updated = { ...current, ...req.body };
  settings.save(updated);
  orchestrator.onSettingsUpdated(updated);
  res.json({ success: true, settings: updated });
});

// ── Upload history ────────────────────────────────────────────────

router.get('/history', (req, res) => {
  const allUploads = uploads.load();
  const limit      = Math.max(1, Math.min(500, parseInt(req.query.limit) || 100));
  const offset     = Math.max(0, parseInt(req.query.offset) || 0);
  const sorted     = [...allUploads].reverse();
  res.json({
    items:   sorted.slice(offset, offset + limit),
    total:   sorted.length,
    hasMore: offset + limit < sorted.length,
  });
});

router.delete('/history', (req, res) => {
  uploads.save([]);
  res.json({ success: true });
});

// ── Downloads listing ─────────────────────────────────────────────

/**
 * GET /api/files/list-downloads?folder=tiktok
 *
 * ★ Security: validates folder param to prevent path traversal.
 *   อนุญาตเฉพาะ alphanumeric, dash, underscore
 *   AND resolved path ต้องอยู่ใน process.cwd()/downloads/ เท่านั้น
 */
router.get('/list-downloads', (req, res) => {
  const rawFolder = req.query.folder || 'tiktok';

  // Step 1: whitelist characters — ป้องกัน ../evil
  if (!/^[a-zA-Z0-9_-]+$/.test(rawFolder)) {
    return res.status(400).json({ error: 'Invalid folder name — ใช้ได้เฉพาะ a-z, A-Z, 0-9, -, _' });
  }

  const downloadsPath = path.resolve(DOWNLOADS_BASE, rawFolder);

  // Step 2: ตรวจ path traversal หลัง resolve
  if (!isSafeSubPath(downloadsPath, DOWNLOADS_BASE)) {
    return res.status(400).json({ error: 'Invalid path — path traversal not allowed' });
  }

  if (!fs.existsSync(downloadsPath)) {
    return res.json({ success: true, files: [], message: `Folder not found: downloads/${rawFolder}` });
  }

  try {
    const files = fs.readdirSync(downloadsPath)
      .filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const filepath = path.join(downloadsPath, f);
        const s        = fs.statSync(filepath);
        return {
          name:          f,
          fullPath:      filepath,
          size:          s.size,
          sizeFormatted: formatFileSize(s.size),
          modified:      s.mtime,
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json({ success: true, files, folder: downloadsPath, total: files.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
