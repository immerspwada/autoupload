const express = require('express');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const multer = require('multer');

const app = express();
const PORT = 3000;

// Multer setup for drag & drop uploads
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Keep original filename, avoid overwrite by adding timestamp if exists
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
    const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (videoExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('ไม่รองรับไฟล์ประเภทนี้: ' + ext));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- JSON-based data store ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJSON(filename, fallback = {}) {
  const fp = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fp)) return fallback;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function saveJSON(filename, data) {
  const fp = path.join(DATA_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}

function getSettings() { return loadJSON('settings.json', {}); }
function saveSettings(s) { saveJSON('settings.json', s); }
function getUploads() { return loadJSON('uploads.json', []); }
function saveUploads(u) { saveJSON('uploads.json', u); }

// --- OAuth2 setup ---
let oauth2Client = null;
let credentials = null;

function getOAuth2Client() {
  if (!credentials) {
    const credPath = path.join(__dirname, 'client_secret.json');
    if (!fs.existsSync(credPath)) return null;
    const content = fs.readFileSync(credPath, 'utf8');
    credentials = JSON.parse(content);
  }

  if (!oauth2Client) {
    const cred = credentials.installed || credentials.web;
    const redirectUri = (cred.redirect_uris && cred.redirect_uris[0]) || `http://localhost:${PORT}/oauth2callback`;
    oauth2Client = new google.auth.OAuth2(cred.client_id, cred.client_secret, redirectUri);
  }

  const tokenPath = path.join(__dirname, 'token.json');
  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oauth2Client.setCredentials(token);
  }

  return oauth2Client;
}

// --- Routes ---

// Auth status
app.get('/api/auth/status', (req, res) => {
  const client = getOAuth2Client();
  if (!client) return res.json({ authenticated: false, hasCredentials: false });
  const hasToken = fs.existsSync(path.join(__dirname, 'token.json'));
  res.json({ authenticated: hasToken, hasCredentials: true });
});

// Start OAuth flow
app.get('/api/auth/login', (req, res) => {
  const client = getOAuth2Client();
  if (!client) return res.status(400).json({ error: 'Missing client_secret.json' });

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent'
  });
  res.json({ url: authUrl });
});

// OAuth callback
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const client = getOAuth2Client();
  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    fs.writeFileSync(path.join(__dirname, 'token.json'), JSON.stringify(tokens, null, 2));
    res.redirect('/?auth=success');
  } catch (error) {
    res.redirect('/?auth=error&message=' + encodeURIComponent(error.message));
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const tokenPath = path.join(__dirname, 'token.json');
  if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  oauth2Client = null;
  res.json({ success: true });
});

// Get settings
app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

// Save settings
app.post('/api/settings', (req, res) => {
  const current = getSettings();
  const updated = { ...current, ...req.body };
  saveSettings(updated);
  res.json({ success: true });
});

// List files in folder
app.get('/api/files', (req, res) => {
  const settings = getSettings();
  const folder = settings.folder;
  if (!folder) return res.json({ files: [], folder: null });
  if (!fs.existsSync(folder)) return res.status(400).json({ error: 'Folder does not exist: ' + folder });

  const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];
  const uploads = getUploads();

  const files = fs.readdirSync(folder)
    .filter(f => videoExtensions.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const filepath = path.join(folder, f);
      const stats = fs.statSync(filepath);
      const record = uploads.find(u => u.filename === f);
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
    });

  res.json({ files, folder });
});

// Upload a single file
app.post('/api/upload', async (req, res) => {
  const { filename, title, description, tags, privacy } = req.body;

  const client = getOAuth2Client();
  if (!client || !client.credentials || !client.credentials.access_token) {
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }

  const settings = getSettings();
  if (!settings.folder) return res.status(400).json({ error: 'No folder configured' });

  const filepath = path.join(settings.folder, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found: ' + filename });

  // Check duplicate
  const uploads = getUploads();
  const existing = uploads.find(u => u.filename === filename);
  if (existing) return res.status(409).json({ error: 'File already uploaded', youtubeUrl: existing.youtube_url });

  try {
    const youtube = google.youtube({ version: 'v3', auth: client });
    const videoTitle = title || path.basename(filename, path.extname(filename));
    const videoPrivacy = privacy || settings.privacy || 'public';

    const response = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: videoTitle,
          description: description || settings.defaultDescription || '',
          tags: tags ? tags.split(',').map(t => t.trim()) : []
        },
        status: {
          privacyStatus: videoPrivacy,
          selfDeclaredMadeForKids: false
        }
      },
      media: { body: fs.createReadStream(filepath) }
    });

    const videoId = response.data.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Save record
    uploads.push({
      filename,
      filepath,
      youtube_id: videoId,
      youtube_url: youtubeUrl,
      uploaded_at: new Date().toISOString(),
      deleted: false
    });
    saveUploads(uploads);

    // Delete if enabled
    const shouldDelete = settings.deleteAfterUpload === true || settings.deleteAfterUpload === 'true';
    if (shouldDelete) {
      fs.unlinkSync(filepath);
      const idx = uploads.findIndex(u => u.filename === filename);
      if (idx !== -1) uploads[idx].deleted = true;
      saveUploads(uploads);
    }

    res.json({ success: true, videoId, youtubeUrl, deleted: shouldDelete });
  } catch (error) {
    console.error('Upload error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Upload all pending files
app.post('/api/upload-all', async (req, res) => {
  const client = getOAuth2Client();
  if (!client || !client.credentials || !client.credentials.access_token) {
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }

  const settings = getSettings();
  if (!settings.folder) return res.status(400).json({ error: 'No folder configured' });

  const folder = settings.folder;
  const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'];
  const uploads = getUploads();

  const files = fs.readdirSync(folder)
    .filter(f => {
      if (!videoExtensions.includes(path.extname(f).toLowerCase())) return false;
      return !uploads.find(u => u.filename === f);
    });

  res.json({ totalFiles: files.length, message: 'Upload started in background' });

  // Process in background
  processUploads(files, folder, client, settings);
});

// Upload progress (SSE)
let uploadProgress = { current: 0, total: 0, currentFile: '', status: 'idle', results: [] };

app.get('/api/upload-progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify(uploadProgress)}\n\n`);
    if (uploadProgress.status === 'done' || uploadProgress.status === 'idle') {
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

async function processUploads(files, folder, client, settings) {
  const youtube = google.youtube({ version: 'v3', auth: client });
  const shouldDelete = settings.deleteAfterUpload === true || settings.deleteAfterUpload === 'true';
  const privacy = settings.privacy || 'public';
  const defaultDesc = settings.defaultDescription || '';
  const defaultTags = settings.defaultTags || '';

  uploadProgress = { current: 0, total: files.length, currentFile: '', status: 'uploading', results: [] };

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filepath = path.join(folder, filename);
    uploadProgress.current = i + 1;
    uploadProgress.currentFile = filename;

    try {
      const videoTitle = path.basename(filename, path.extname(filename));

      const response = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
          snippet: {
            title: videoTitle,
            description: defaultDesc,
            tags: defaultTags ? defaultTags.split(',').map(t => t.trim()) : []
          },
          status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: false
          }
        },
        media: { body: fs.createReadStream(filepath) }
      });

      const videoId = response.data.id;
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

      const uploads = getUploads();
      uploads.push({
        filename,
        filepath,
        youtube_id: videoId,
        youtube_url: youtubeUrl,
        uploaded_at: new Date().toISOString(),
        deleted: false
      });

      if (shouldDelete) {
        fs.unlinkSync(filepath);
        uploads[uploads.length - 1].deleted = true;
      }

      saveUploads(uploads);
      uploadProgress.results.push({ filename, success: true, youtubeUrl });
    } catch (error) {
      console.error(`Error uploading ${filename}:`, error.message);
      uploadProgress.results.push({ filename, success: false, error: error.message });
    }

    // Delay between uploads to avoid rate limiting
    if (i < files.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  uploadProgress.status = 'done';
}

// Get upload history
app.get('/api/history', (req, res) => {
  const uploads = getUploads();
  res.json(uploads.reverse());
});

// Clear history
app.delete('/api/history', (req, res) => {
  saveUploads([]);
  res.json({ success: true });
});

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- Drag & Drop: receive files via browser ---
app.post('/api/drop-upload', upload.array('videos', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files received' });
  }

  const results = req.files.map(f => ({
    filename: f.filename,
    size: f.size,
    sizeFormatted: formatFileSize(f.size),
    path: f.path
  }));

  res.json({ success: true, files: results });
});

// --- Direct upload from drop zone (upload dropped file directly to YouTube) ---
app.post('/api/drop-and-upload-youtube', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const client = getOAuth2Client();
  if (!client || !client.credentials || !client.credentials.access_token) {
    return res.status(401).json({ error: 'Not authenticated with YouTube' });
  }

  const settings = getSettings();
  const filename = req.file.filename;
  const filepath = req.file.path;

  // Check duplicate
  const uploads = getUploads();
  const existing = uploads.find(u => u.filename === filename);
  if (existing) {
    fs.unlinkSync(filepath); // remove temp
    return res.status(409).json({ error: 'File already uploaded', youtubeUrl: existing.youtube_url });
  }

  try {
    const youtube = google.youtube({ version: 'v3', auth: client });
    const videoTitle = req.body.title || path.basename(filename, path.extname(filename));
    const videoPrivacy = req.body.privacy || settings.privacy || 'public';
    const videoDesc = req.body.description || settings.defaultDescription || '';
    const videoTags = req.body.tags || settings.defaultTags || '';

    const response = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: videoTitle,
          description: videoDesc,
          tags: videoTags ? videoTags.split(',').map(t => t.trim()) : []
        },
        status: {
          privacyStatus: videoPrivacy,
          selfDeclaredMadeForKids: false
        }
      },
      media: { body: fs.createReadStream(filepath) }
    });

    const videoId = response.data.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    uploads.push({
      filename,
      filepath,
      youtube_id: videoId,
      youtube_url: youtubeUrl,
      uploaded_at: new Date().toISOString(),
      deleted: false
    });
    saveUploads(uploads);

    // Always delete temp file after upload
    fs.unlinkSync(filepath);
    uploads[uploads.length - 1].deleted = true;
    saveUploads(uploads);

    res.json({ success: true, videoId, youtubeUrl, filename });
  } catch (error) {
    console.error('Drop upload error:', error.message);
    // Clean up temp file on error
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎬 YouTube Auto Uploader`);
  console.log(`🌐 เปิดเบราว์เซอร์: http://localhost:${PORT}`);
  console.log(`📁 ตั้งค่าโฟลเดอร์วิดีโอในหน้าเว็บ`);
  console.log(`📤 หรือลากไฟล์วางเพื่ออัปโหลดทันที\n`);
});
