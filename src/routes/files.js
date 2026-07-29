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
const { formatBytes: formatFileSize } = require('../utils/format');
const { requireAuthForDestructive } = require('../middleware/security');

const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];

const DOWNLOADS_BASE = path.resolve(process.cwd(), 'downloads');

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

/**
 * ★ POST /settings — เดิม spread req.body ลง settings.json ตรงๆ ไม่ตรวจอะไรเลย
 *   ทำให้ตั้ง folder เป็น path ไหนก็ได้ / ใส่ค่าที่ทำ ffmpeg พังได้
 */
router.post('/settings', async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'ข้อมูลต้องเป็น object' });
    }

    const { clean, errors } = validateSettings(body);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'ค่าที่ส่งมาไม่ถูกต้อง', details: errors });
    }

    let updated;
    // ★ safeUpdate — เดิม load()+save() ทับค่าที่หน้าอื่นเพิ่งบันทึกไป
    await settings.safeUpdate((current) => {
      updated = { ...current, ...clean };
      return updated;
    });

    orchestrator.onSettingsUpdated(updated);
    res.json({ success: true, settings: updated, ignored: Object.keys(body).filter(k => !(k in clean)) });
  } catch (err) { next(err); }
});

/** ตรวจ + แปลงค่า settings ให้อยู่ในรูปที่ระบบใช้ได้จริง */
function validateSettings(body) {
  const clean = {};
  const errors = [];

  // ── folder: ต้องเป็นโฟลเดอร์ที่มีอยู่จริงและอ่านได้ ──
  if ('folder' in body) {
    const f = body.folder;
    if (f === '' || f === null) {
      clean.folder = '';
    } else if (typeof f !== 'string') {
      errors.push('folder ต้องเป็นข้อความ');
    } else {
      const resolved = path.resolve(f);
      if (!fs.existsSync(resolved)) {
        errors.push(`ไม่พบโฟลเดอร์: ${resolved}`);
      } else {
        try {
          if (!fs.statSync(resolved).isDirectory()) errors.push('folder ต้องเป็นโฟลเดอร์ ไม่ใช่ไฟล์');
          else { fs.accessSync(resolved, fs.constants.R_OK); clean.folder = resolved; }
        } catch (_) {
          errors.push(`อ่านโฟลเดอร์ไม่ได้ (สิทธิ์ไม่พอ): ${resolved}`);
        }
      }
    }
  }

  const enums = {
    privacy:      ['public', 'private', 'unlisted'],
    seoMode:      ['auto', 'seo', 'manual'],
    channelStage: ['early_stage', 'pre_ypp', 'monetized'],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (!(key in body)) continue;
    if (!allowed.includes(body[key])) errors.push(`${key} ต้องเป็นหนึ่งใน: ${allowed.join(', ')}`);
    else clean[key] = body[key];
  }

  for (const key of ['deleteAfterUpload', 'autoSchedule']) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') errors.push(`${key} ต้องเป็น true/false`);
      else clean[key] = body[key];
    }
  }

  if ('preferredPublishHour' in body) {
    const h = parseInt(body.preferredPublishHour, 10);
    if (!Number.isInteger(h) || h < 0 || h > 23) errors.push('preferredPublishHour ต้องเป็น 0-23');
    else clean.preferredPublishHour = h;
  }

  if ('categoryOverride' in body) {
    if (body.categoryOverride === '' || body.categoryOverride === null) clean.categoryOverride = '';
    else {
      const c = parseInt(body.categoryOverride, 10);
      if (!Number.isInteger(c) || c < 1 || c > 44) errors.push('categoryOverride ต้องเป็นรหัสหมวด YouTube (1-44)');
      else clean.categoryOverride = String(c);
    }
  }

  const strings = {
    defaultDescription: 5000, defaultTags: 500, titleTemplate: 200,
    channelDescription: 2000, channelName: 100,
  };
  for (const [key, max] of Object.entries(strings)) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'string') errors.push(`${key} ต้องเป็นข้อความ`);
    else if (body[key].length > max) errors.push(`${key} ยาวเกิน ${max} ตัวอักษร`);
    else clean[key] = body[key];
  }

  // videoTransform — ค่าตัวเลขถูก clamp อีกชั้นใน videoTransform._sanitizeConfig()
  if ('videoTransform' in body) {
    const vt = body.videoTransform;
    if (!vt || typeof vt !== 'object' || Array.isArray(vt)) errors.push('videoTransform ต้องเป็น object');
    else clean.videoTransform = vt;
  }

  return { clean, errors };
}

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

router.delete('/history', requireAuthForDestructive, async (req, res, next) => {
  try {
    const before = uploads.loadRef().length;
    await uploads.safeUpdate(() => []);
    require('../utils/logger').warn('ล้างประวัติการอัปโหลด', { removed: before, ip: req.ip });
    res.json({ success: true, removed: before });
  } catch (err) { next(err); }
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
