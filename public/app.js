// YouTube Auto Uploader - Frontend App

let dropQueue = []; // Files queued for upload

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initDropZone();
  checkAuth();
  loadSettings();
  loadFiles();
  loadHistory();

  // Check URL params for auth callback
  const params = new URLSearchParams(window.location.search);
  if (params.get('auth') === 'success') {
    showToast('เชื่อมต่อ YouTube สำเร็จ!', 'success');
    window.history.replaceState({}, '', '/');
  } else if (params.get('auth') === 'error') {
    showToast('เชื่อมต่อ YouTube ล้มเหลว: ' + (params.get('message') || ''), 'error');
    window.history.replaceState({}, '', '/');
  }
});

// ==================== TAB NAVIGATION ====================
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

      if (tab.dataset.tab === 'files') loadFiles();
      if (tab.dataset.tab === 'history') loadHistory();
    });
  });
}

// ==================== DROP ZONE ====================
function initDropZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Click to select files
  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    addFilesToQueue(Array.from(e.target.files));
    fileInput.value = '';
  });

  // Drag & Drop events
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg'].includes(ext);
    });

    if (files.length === 0) {
      showToast('ไม่มีไฟล์วิดีโอที่รองรับ', 'error');
      return;
    }

    addFilesToQueue(files);
  });

  // Also enable full-page drop
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // Upload queue button
  document.getElementById('btn-upload-queue').addEventListener('click', uploadQueue);
  document.getElementById('btn-clear-queue').addEventListener('click', clearQueue);
}

function addFilesToQueue(files) {
  files.forEach(file => {
    // Avoid duplicates in queue
    if (dropQueue.find(q => q.file.name === file.name && q.file.size === file.size)) return;
    dropQueue.push({ file, status: 'pending', result: null });
  });
  renderQueue();
}

function renderQueue() {
  const container = document.getElementById('drop-queue');
  const list = document.getElementById('drop-queue-list');

  if (dropQueue.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  list.innerHTML = dropQueue.map((item, idx) => `
    <div class="queue-item">
      <div class="queue-icon">🎬</div>
      <div class="queue-info">
        <div class="queue-name">${escapeHtml(item.file.name)}</div>
        <div class="queue-size">${formatFileSize(item.file.size)}</div>
      </div>
      <span class="queue-status ${item.status}">${getStatusText(item)}</span>
      ${item.status === 'pending' ? `<button class="btn-remove" onclick="removeFromQueue(${idx})">✕</button>` : ''}
    </div>
  `).join('');
}

function getStatusText(item) {
  switch (item.status) {
    case 'pending': return '⏳ รอดำเนินการ';
    case 'uploading': return '⬆️ กำลังอัปโหลด...';
    case 'done': return '✅ สำเร็จ';
    case 'error': return '❌ ล้มเหลว';
    default: return '';
  }
}

function removeFromQueue(idx) {
  dropQueue.splice(idx, 1);
  renderQueue();
}

function clearQueue() {
  dropQueue = [];
  renderQueue();
  document.getElementById('drop-results').style.display = 'none';
}

async function uploadQueue() {
  const pending = dropQueue.filter(q => q.status === 'pending');
  if (pending.length === 0) {
    showToast('ไม่มีไฟล์ที่ต้องอัปโหลด', 'info');
    return;
  }

  const progressEl = document.getElementById('drop-progress');
  const resultsEl = document.getElementById('drop-results');
  progressEl.style.display = 'block';
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '';

  document.getElementById('btn-upload-queue').disabled = true;

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < dropQueue.length; i++) {
    const item = dropQueue[i];
    if (item.status !== 'pending') continue;

    item.status = 'uploading';
    renderQueue();

    document.getElementById('drop-progress-text').textContent = 'กำลังอัปโหลด...';
    document.getElementById('drop-progress-count').textContent = `${successCount + errorCount + 1}/${pending.length}`;
    document.getElementById('drop-progress-file').textContent = item.file.name;
    const pct = ((successCount + errorCount + 1) / pending.length) * 100;
    document.getElementById('drop-progress-fill').style.width = pct + '%';

    try {
      const formData = new FormData();
      formData.append('video', item.file);
      formData.append('title', item.file.name.replace(/\.[^.]+$/, ''));

      const res = await fetch('/api/drop-and-upload-youtube', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (data.success) {
        item.status = 'done';
        item.result = data;
        successCount++;
        resultsEl.innerHTML += `
          <div class="drop-result-item">
            ✅ <strong>${escapeHtml(item.file.name)}</strong> →
            <a href="${data.youtubeUrl}" target="_blank">${data.youtubeUrl}</a>
          </div>`;
      } else {
        item.status = 'error';
        item.result = data;
        errorCount++;
        resultsEl.innerHTML += `
          <div class="drop-result-item error">
            ❌ <strong>${escapeHtml(item.file.name)}</strong> — ${escapeHtml(data.error)}
          </div>`;
      }
    } catch (err) {
      item.status = 'error';
      errorCount++;
      resultsEl.innerHTML += `
        <div class="drop-result-item error">
          ❌ <strong>${escapeHtml(item.file.name)}</strong> — ${escapeHtml(err.message)}
        </div>`;
    }

    renderQueue();

    // Delay between uploads
    if (i < dropQueue.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  document.getElementById('drop-progress-text').textContent = 'อัปโหลดเสร็จสิ้น!';
  document.getElementById('btn-upload-queue').disabled = false;

  showToast(`อัปโหลดเสร็จ! สำเร็จ ${successCount}, ล้มเหลว ${errorCount}`, successCount > 0 ? 'success' : 'error');
  loadHistory();
}

// ==================== AUTH ====================
async function checkAuth() {
  const res = await fetch('/api/auth/status');
  const data = await res.json();
  const el = document.getElementById('auth-status');

  if (!data.hasCredentials) {
    el.className = 'auth-status disconnected';
    el.innerHTML = '⚠️ ไม่พบ client_secret.json - กรุณาเพิ่มไฟล์ OAuth credentials';
  } else if (data.authenticated) {
    el.className = 'auth-status connected';
    el.innerHTML = '✅ เชื่อมต่อ YouTube แล้ว <button class="btn-logout" onclick="logout()">ออกจากระบบ</button>';
  } else {
    el.className = 'auth-status disconnected';
    el.innerHTML = '⚠️ ยังไม่ได้เชื่อมต่อ YouTube <button class="btn-login" onclick="login()">เข้าสู่ระบบ</button>';
  }
}

async function login() {
  const res = await fetch('/api/auth/login');
  const data = await res.json();
  if (data.url) {
    window.location.href = data.url;
  } else {
    showToast(data.error || 'เกิดข้อผิดพลาด', 'error');
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  checkAuth();
  showToast('ออกจากระบบแล้ว', 'info');
}

// ==================== SETTINGS ====================
async function loadSettings() {
  const res = await fetch('/api/settings');
  const settings = await res.json();

  if (settings.folder) document.getElementById('folder').value = settings.folder;
  if (settings.privacy) document.getElementById('privacy').value = settings.privacy;
  if (settings.deleteAfterUpload) document.getElementById('deleteAfterUpload').checked = settings.deleteAfterUpload === 'true' || settings.deleteAfterUpload === true;
  if (settings.defaultDescription) document.getElementById('defaultDescription').value = settings.defaultDescription;
  if (settings.defaultTags) document.getElementById('defaultTags').value = settings.defaultTags;

  document.getElementById('settings-form').addEventListener('submit', saveSettings);
}

async function saveSettings(e) {
  e.preventDefault();

  const data = {
    folder: document.getElementById('folder').value,
    privacy: document.getElementById('privacy').value,
    deleteAfterUpload: document.getElementById('deleteAfterUpload').checked,
    defaultDescription: document.getElementById('defaultDescription').value,
    defaultTags: document.getElementById('defaultTags').value
  };

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (res.ok) {
    showToast('บันทึกการตั้งค่าสำเร็จ!', 'success');
    loadFiles();
  } else {
    showToast('เกิดข้อผิดพลาด', 'error');
  }
}

// ==================== FILES ====================
async function loadFiles() {
  const res = await fetch('/api/files');
  const data = await res.json();
  const list = document.getElementById('file-list');

  if (data.error) {
    list.innerHTML = `<p class="empty-state">❌ ${data.error}</p>`;
    return;
  }

  if (!data.folder) {
    list.innerHTML = '<p class="empty-state">⚙️ กรุณาตั้งค่าโฟลเดอร์ก่อนใช้งาน</p>';
    return;
  }

  if (data.files.length === 0) {
    list.innerHTML = '<p class="empty-state">📭 ไม่พบไฟล์วิดีโอในโฟลเดอร์</p>';
    return;
  }

  list.innerHTML = data.files.map(file => `
    <div class="file-item ${file.uploaded ? 'uploaded' : ''}">
      <div class="file-icon">🎬</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(file.filename)}</div>
        <div class="file-meta">${file.sizeFormatted} • ${new Date(file.modified).toLocaleString('th-TH')}</div>
      </div>
      <div class="file-actions">
        ${file.uploaded
          ? `<span class="badge badge-success">✅ อัปโหลดแล้ว</span>
             <a href="${file.youtubeUrl}" target="_blank" class="btn btn-secondary">🔗 ดูบน YouTube</a>`
          : `<span class="badge badge-pending">⏳ รอดำเนินการ</span>
             <button class="btn btn-primary" onclick="openUploadModal('${escapeHtml(file.filename)}')">📤 อัปโหลด</button>`
        }
      </div>
    </div>
  `).join('');
}

// Upload Modal
function openUploadModal(filename) {
  document.getElementById('upload-filename').value = filename;
  document.getElementById('upload-title').value = filename.replace(/\.[^.]+$/, '');
  document.getElementById('upload-description').value = document.getElementById('defaultDescription').value || '';
  document.getElementById('upload-tags').value = document.getElementById('defaultTags').value || '';
  document.getElementById('upload-privacy').value = document.getElementById('privacy').value || 'public';
  document.getElementById('upload-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('upload-modal').style.display = 'none';
}

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const filename = document.getElementById('upload-filename').value;
  const title = document.getElementById('upload-title').value;
  const description = document.getElementById('upload-description').value;
  const tags = document.getElementById('upload-tags').value;
  const privacy = document.getElementById('upload-privacy').value;

  closeModal();
  showToast(`กำลังอัปโหลด ${filename}...`, 'info');

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, title, description, tags, privacy })
  });

  const data = await res.json();

  if (data.success) {
    showToast(`อัปโหลดสำเร็จ! ${data.deleted ? '(ลบไฟล์แล้ว)' : ''}`, 'success');
    loadFiles();
    loadHistory();
  } else {
    showToast(`เกิดข้อผิดพลาด: ${data.error}`, 'error');
  }
});

// Upload All
document.getElementById('btn-upload-all').addEventListener('click', async () => {
  if (!confirm('ต้องการอัปโหลดไฟล์ทั้งหมดที่ยังไม่ได้อัปโหลด?')) return;

  const res = await fetch('/api/upload-all', { method: 'POST' });
  const data = await res.json();

  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  if (data.totalFiles === 0) {
    showToast('ไม่มีไฟล์ที่ต้องอัปโหลด', 'info');
    return;
  }

  showToast(`เริ่มอัปโหลด ${data.totalFiles} ไฟล์`, 'info');
  trackProgress();
});

function trackProgress() {
  const container = document.getElementById('progress-bar');
  container.style.display = 'block';

  const eventSource = new EventSource('/api/upload-progress');
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    document.getElementById('progress-text').textContent =
      data.status === 'done' ? 'อัปโหลดเสร็จสิ้น!' : 'กำลังอัปโหลด...';
    document.getElementById('progress-count').textContent = `${data.current}/${data.total}`;
    document.getElementById('progress-file').textContent = data.currentFile || '';

    const pct = data.total > 0 ? (data.current / data.total) * 100 : 0;
    document.getElementById('progress-fill').style.width = pct + '%';

    if (data.status === 'done') {
      eventSource.close();
      loadFiles();
      loadHistory();

      const success = data.results.filter(r => r.success).length;
      const failed = data.results.filter(r => !r.success).length;
      showToast(`อัปโหลดเสร็จ! สำเร็จ ${success} ไฟล์, ล้มเหลว ${failed} ไฟล์`, success > 0 ? 'success' : 'error');

      setTimeout(() => { container.style.display = 'none'; }, 5000);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    container.style.display = 'none';
  };
}

// Refresh
document.getElementById('btn-refresh').addEventListener('click', () => {
  loadFiles();
  showToast('รีเฟรชแล้ว', 'info');
});

// ==================== HISTORY ====================
async function loadHistory() {
  const res = await fetch('/api/history');
  const data = await res.json();
  const list = document.getElementById('history-list');

  if (data.length === 0) {
    list.innerHTML = '<p class="empty-state">ยังไม่มีประวัติการอัปโหลด</p>';
    return;
  }

  list.innerHTML = data.map(item => `
    <div class="history-item">
      <div class="file-icon">${item.deleted ? '🗑️' : '✅'}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(item.filename)}</div>
        <div class="file-meta">
          ${new Date(item.uploaded_at).toLocaleString('th-TH')}
          ${item.deleted ? ' • ลบไฟล์แล้ว' : ''}
          ${item.youtube_url ? ` • <a href="${item.youtube_url}" target="_blank">ดูบน YouTube ↗</a>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('btn-clear-history').addEventListener('click', async () => {
  if (!confirm('ต้องการล้างประวัติการอัปโหลดทั้งหมด?')) return;

  await fetch('/api/history', { method: 'DELETE' });
  loadHistory();
  loadFiles();
  showToast('ล้างประวัติแล้ว', 'info');
});

// ==================== UTILITIES ====================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
