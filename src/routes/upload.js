// Upload Routes
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const youtubeService = require('../services/youtube');
const uploadQueue = require('../services/queue');
const { settings, uploads, stats } = require('../utils/store');
const logger = require('../utils/logger');

const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];

// Multer setup
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    let name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const target = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(target)) {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      name = `${base}_${Date.now()}${ext}`;
    }
    cb(null, name);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (VIDEO_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(new Error('ไม่รองรับไฟล์ประเภทนี้: ' + ext));
  },
  limits: { fileSize: 128 * 1024 * 1024 * 1024 } // 128GB max
});

// Upload single file from folder
router.post('/single', async (req, res) => {
  const { filename, title, description, tags, privacy } = req.body;
  const config = settings.load();

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }

  if (!config.folder) return res.status(400).json({ error: 'No folder configured' });

  const filepath = path.join(config.folder, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found: ' + filename });

  // Check duplicate
  const allUploads = uploads.load();
  const existing = allUploads.find(u => u.filename === filename);
  if (existing) return res.status(409).json({ error: 'File already uploaded', youtubeUrl: existing.youtube_url });

  try {
    const result = await youtubeService.uploadVideo({
      filepath,
      title: title || path.basename(filename, path.extname(filename)),
      description: description || config.defaultDescription || '',
      tags: tags || config.defaultTags || '',
      privacy: privacy || config.privacy || 'public'
    });

    // Save record
    const record = {
      filename,
      filepath,
      youtube_id: result.videoId,
      youtube_url: result.youtubeUrl,
      uploaded_at: new Date().toISOString(),
      deleted: false,
      size: fs.existsSync(filepath) ? fs.statSync(filepath).size : 0
    };
    allUploads.push(record);

    // Delete if enabled
    const shouldDelete = config.deleteAfterUpload === true || config.deleteAfterUpload === 'true';
    if (shouldDelete && fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      record.deleted = true;
    }
    uploads.save(allUploads);

    // Update stats
    updateStats(record.size, true);

    res.json({ success: true, ...result, deleted: shouldDelete });
  } catch (error) {
    logger.error('Upload error', { filename, error: error.message });
    updateStats(0, false);
    res.status(500).json({ error: error.message });
  }
});

// Upload all pending files (via queue)
router.post('/all', (req, res) => {
  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }

  const config = settings.load();
  if (!config.folder) return res.status(400).json({ error: 'No folder configured' });

  const folder = config.folder;
  if (!fs.existsSync(folder)) return res.status(400).json({ error: 'Folder not found' });

  const allUploads = uploads.load();
  const files = fs.readdirSync(folder).filter(f => {
    if (!VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())) return false;
    return !allUploads.find(u => u.filename === f);
  });

  if (files.length === 0) {
    return res.json({ totalFiles: 0, message: 'No files to upload' });
  }

  // Queue all files
  files.forEach(filename => {
    const filepath = path.join(folder, filename);
    uploadQueue.add(async () => {
      const result = await youtubeService.uploadVideo({
        filepath,
        title: path.basename(filename, path.extname(filename)),
        description: config.defaultDescription || '',
        tags: config.defaultTags || '',
        privacy: config.privacy || 'public'
      });

      // Record
      const currentUploads = uploads.load();
      const record = {
        filename,
        filepath,
        youtube_id: result.videoId,
        youtube_url: result.youtubeUrl,
        uploaded_at: new Date().toISOString(),
        deleted: false,
        size: fs.existsSync(filepath) ? fs.statSync(filepath).size : 0
      };
      currentUploads.push(record);

      const shouldDelete = config.deleteAfterUpload === true || config.deleteAfterUpload === 'true';
      if (shouldDelete && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        record.deleted = true;
      }
      uploads.save(currentUploads);
      updateStats(record.size, true);

      return result;
    }, { filename });
  });

  res.json({ totalFiles: files.length, message: 'Queued for upload' });
});

// Direct drop-and-upload to YouTube
router.post('/drop', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const authStatus = youtubeService.isAuthenticated();
  if (!authStatus.authenticated) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }

  const config = settings.load();
  const filename = req.file.filename;
  const filepath = req.file.path;

  // Check duplicate
  const allUploads = uploads.load();
  const existing = allUploads.find(u => u.filename === filename);
  if (existing) {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    return res.status(409).json({ error: 'File already uploaded', youtubeUrl: existing.youtube_url });
  }

  try {
    const result = await youtubeService.uploadVideo({
      filepath,
      title: req.body.title || path.basename(filename, path.extname(filename)),
      description: req.body.description || config.defaultDescription || '',
      tags: req.body.tags || config.defaultTags || '',
      privacy: req.body.privacy || config.privacy || 'public'
    });

    const fileSize = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;

    allUploads.push({
      filename,
      filepath,
      youtube_id: result.videoId,
      youtube_url: result.youtubeUrl,
      uploaded_at: new Date().toISOString(),
      deleted: true,
      size: fileSize
    });
    uploads.save(allUploads);

    // Always delete temp file
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    updateStats(fileSize, true);

    res.json({ success: true, ...result, filename });
  } catch (error) {
    logger.error('Drop upload error', { filename, error: error.message });
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    updateStats(0, false);
    res.status(500).json({ error: error.message });
  }
});

// Queue status
router.get('/queue', (req, res) => {
  res.json(uploadQueue.getStatus());
});

// Pause/Resume queue
router.post('/queue/pause', (req, res) => {
  uploadQueue.pause();
  res.json({ success: true, paused: true });
});

router.post('/queue/resume', (req, res) => {
  uploadQueue.resume();
  res.json({ success: true, paused: false });
});

router.delete('/queue/:id', (req, res) => {
  const cancelled = uploadQueue.cancel(parseInt(req.params.id));
  res.json({ success: cancelled });
});

function updateStats(size, success) {
  const allStats = stats.load();
  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours().toString();

  if (success) {
    allStats.totalUploads = (allStats.totalUploads || 0) + 1;
    allStats.totalSize = (allStats.totalSize || 0) + (size || 0);
  } else {
    allStats.failedUploads = (allStats.failedUploads || 0) + 1;
  }

  if (!allStats.dailyStats) allStats.dailyStats = {};
  if (!allStats.dailyStats[today]) allStats.dailyStats[today] = { uploads: 0, failures: 0, size: 0 };
  if (success) {
    allStats.dailyStats[today].uploads++;
    allStats.dailyStats[today].size += (size || 0);
  } else {
    allStats.dailyStats[today].failures++;
  }

  if (!allStats.uploadsByHour) allStats.uploadsByHour = {};
  allStats.uploadsByHour[hour] = (allStats.uploadsByHour[hour] || 0) + 1;

  stats.save(allStats);
}

module.exports = router;
