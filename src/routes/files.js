// Files & Settings Routes
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { settings, uploads } = require('../utils/store');

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

module.exports = router;
