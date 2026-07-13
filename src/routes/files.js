// Files & Settings Routes
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { settings, uploads } = require('../utils/store');
const orchestrator = require('../services/orchestrator');

const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// List files in configured folder
router.get('/', (req, res) => {
  const config = settings.load();
  const folder = config.folder;
  if (!folder) return res.json({ files: [], folder: null });
  if (!fs.existsSync(folder)) return res.status(400).json({ error: 'Folder does not exist: ' + folder });

  const allUploads = uploads.load();

  const files = fs.readdirSync(folder)
    .filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const filepath = path.join(folder, f);
      const stats = fs.statSync(filepath);
      const record = allUploads.find(u => u.filename === f);
      return {
        filename: f,
        filepath,
        size: stats.size,
        sizeFormatted: formatFileSize(stats.size),
        modified: stats.mtime,
        uploaded: !!record,
        youtubeUrl: record ? record.youtube_url : null,
        youtubeId: record ? record.youtube_id : null
      };
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));

  res.json({ files, folder, totalSize: formatFileSize(files.reduce((a, f) => a + f.size, 0)) });
});

// Settings
router.get('/settings', (req, res) => {
  res.json(settings.load());
});

router.post('/settings', (req, res) => {
  const current = settings.load();
  const updated = { ...current, ...req.body };
  settings.save(updated);
  // ★ emit settings change → watcher restart + dashboard refresh
  orchestrator.onSettingsUpdated(updated);
  res.json({ success: true, settings: updated });
});

// History
router.get('/history', (req, res) => {
  const allUploads = uploads.load();
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  const sorted = [...allUploads].reverse();
  res.json({
    items: sorted.slice(offset, offset + limit),
    total: sorted.length,
    hasMore: offset + limit < sorted.length
  });
});

router.delete('/history', (req, res) => {
  uploads.save([]);
  res.json({ success: true });
});

// List downloads (สำหรับ Browser Upload)
router.get('/list-downloads', (req, res) => {
  const { folder = 'tiktok' } = req.query;
  const downloadsPath = path.join(process.cwd(), 'downloads', folder);

  if (!fs.existsSync(downloadsPath)) {
    return res.json({ 
      success: true, 
      files: [], 
      message: `Folder not found: downloads/${folder}` 
    });
  }

  try {
    const files = fs.readdirSync(downloadsPath)
      .filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const filepath = path.join(downloadsPath, f);
        const stats = fs.statSync(filepath);
        return {
          name: f,
          fullPath: filepath,
          size: stats.size,
          sizeFormatted: formatFileSize(stats.size),
          modified: stats.mtime,
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json({ 
      success: true, 
      files,
      folder: downloadsPath,
      total: files.length
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
