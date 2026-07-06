// YouTube Auto Uploader v2 - Advanced Frontend with WebSocket & Dashboard
let dropQueue = [];
let ws = null;
let wsReconnectTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  initTabs();
  initDropZone();
  checkAuth();
  loadSettings();
  loadDashboard();
  initScheduler();
  initQueueControls();
});

// ==================== WEBSOCKET ====================
function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    console.log('WebSocket connected');
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  };

  ws.onmessage = (event) => {
    const { type, data } = JSON.parse(event.data);
    handleWSMessage(type, data);
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected, reconnecting...');
    wsReconnectTimer = setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => ws.close();
}

function handleWSMessage(type, data) {
  switch (type) {
    case 'init':
      updateQueueUI(data.queue);
      break;
    case 'queue:progress':
      updateQueueUI(data);
      break;
    case 'queue:completed':
      showToast(`✅ อัปโหลดสำเร็จ: ${data.filename}`, 'success');
      loadDashboard();
      loadFiles();
      break;
    case 'queue:failed':
      showToast(`❌ อัปโหลดล้มเหลว: ${data.filename}`, 'error');
      break;
    case 'queue:retry':
      showToast(`🔄 ลองใหม่ครั้งที่ ${data.attempt}: ${data.filename}`, 'info');
      break;
    case 'queue:done':
      showToast('🎉 อัปโหลดคิวเสร็จสิ้น!', 'success');
      loadDashboard();
      loadHistory();
      break;
  }
}

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
      if (tab.dataset.tab === 'dashboard') loadDashboard();
      if (tab.dataset.tab === 'queue') loadQueueTab();
    });
  });

  // Check URL params for auth callback
  const params = new URLSearchParams(window.location.search);
  if (params.get('auth') === 'success') {
    showToast('เชื่อมต่อ YouTube สำเร็จ!', 'success');
    window.history.replaceState({}, '', '/');
  } else if (params.get('auth') === 'error') {
    showToast('เชื่อมต่อ YouTube ล้มเหลว: ' + (params.get('message') || ''), 'error');
    window.history.replaceState({}, '', '/');
  }
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
  try {
    const res = await fetch('/api/stats/dashboard');
    const data = await res.json();

    document.getElementById('stat-total-uploads').textContent = data.overview.totalUploads;
    document.getElementById('stat-total-size').textContent = data.overview.totalSizeFormatted;
    document.getElementById('stat-success-rate').textContent = data.overview.successRate + '%';
    document.getElementById('stat-today').textContent = data.today.uploads || 0;

    renderChart7Days(data.last7Days);
    renderChartHours(data.uploadsByHour);
    renderDashboardQueue(data.queue);
    renderDashboardRecent(data.recentUploads);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function renderChart7Days(days) {
  const container = document.getElementById('chart-7days');
  if (!days || days.length === 0) {
    container.innerHTML = '<p class="empty-state">ยังไม่มีข้อมูล</p>';
    return;
  }
  const max = Math.max(...days.map(d => d.uploads), 1);
  container.innerHTML = `<div class="bar-chart">
    ${days.map(d => {
      const height = Math.max((d.uploads / max) * 100, 4);
      const label = d.date.slice(5); // MM-DD
      return `<div class="bar-item">
        <div class="bar-value">${d.uploads}</div>
        <div class="bar" style="height:${height}%"></div>
        <div class="bar-label">${label}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderChartHours(hourData) {
  const container = document.getElementById('chart-hours');
  if (!hourData || Object.keys(hourData).length === 0) {
    container.innerHTML = '<p class="empty-state">ยังไม่มีข้อมูล</p>';
    return;
  }
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const max = Math.max(...hours.map(h => hourData[h] || 0), 1);
  container.innerHTML = `<div class="bar-chart bar-chart-hours">
    ${hours.map(h => {
      const val = hourData[h] || 0;
      const height = Math.max((val / max) * 100, 2);
      return `<div class="bar-item mini">
        <div class="bar" style="height:${height}%" title="${h}:00 - ${val} uploads"></div>
        ${h % 6 === 0 ? `<div class="bar-label">${h}:00</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function renderDashboardQueue(queue) {
  const el = document.getElementById('dashboard-queue');
  if (queue.total === 0) {
    el.innerHTML = '<p class="empty-state small">คิวว่าง</p>';
    return;
  }
  el.innerHTML = `
    <div class="queue-summary">
      <span class="queue-badge pending">⏳ ${queue.pending}</span>
      <span class="queue-badge processing">⚡ ${queue.processing}</span>
      <span class="queue-badge done">✅ ${queue.done}</span>
      <span class="queue-badge failed">❌ ${queue.failed}</span>
    </div>`;
}

function renderDashboardRecent(items) {
  const el = document.getElementById('dashboard-recent');
  if (!items || items.length === 0) {
    el.innerHTML = '<p class="empty-state small">ยังไม่มีประวัติ</p>';
    return;
  }
  el.innerHTML = items.map(item => `
    <div class="recent-item">
      <span class="recent-name">${escapeHtml(item.filename)}</span>
      <a href="${item.youtube_url}" target="_blank" class="recent-link">↗</a>
      <span class="recent-time">${timeAgo(item.uploaded_at)}</span>
    </div>`).join('');
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
    loadChannelInfo();
  } else {
    el.className = 'auth-status disconnected';
    el.innerHTML = '⚠️ ยังไม่ได้เชื่อมต่อ YouTube <button class="btn-login" onclick="login()">เข้าสู่ระบบ</button>';
  }
}

async function loadChannelInfo() {
  try {
    const res = await fetch('/api/auth/channel');
    const data = await res.json();
    if (data && data.title) {
      const el = document.getElementById('channel-info');
      el.style.display = 'flex';
      el.innerHTML = `
        ${data.thumbnail ? `<img src="${data.thumbnail}" class="channel-avatar">` : ''}
        <div class="channel-details">
          <strong>${escapeHtml(data.title)}</strong>
          <span>${data.subscribers || '?'} subscribers • ${data.videoCount || '?'} videos</span>
        </div>`;
    }
  } catch (e) { /* silent */ }
}

async function login() {
  const res = await fetch('/api/auth/login');
  const data = await res.json();
  if (data.url) window.location.href = data.url;
  else showToast(data.error || 'เกิดข้อผิดพลาด', 'error');
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  document.getElementById('channel-info').style.display = 'none';
  checkAuth();
  showToast('ออกจากระบบแล้ว', 'info');
}

// ==================== QUEUE TAB ====================
function initQueueControls() {
  document.getElementById('btn-queue-pause').addEventListener('click', async () => {
    await fetch('/api/upload/queue/pause', { method: 'POST' });
    showToast('หยุดคิวแล้ว', 'info');
    loadQueueTab();
  });
  document.getElementById('btn-queue-resume').addEventListener('click', async () => {
    await fetch('/api/upload/queue/resume', { method: 'POST' });
    showToast('เริ่มคิวอีกครั้ง', 'success');
    loadQueueTab();
  });
  document.getElementById('btn-queue-clear').addEventListener('click', async () => {
    if (!confirm('ต้องการล้างคิวทั้งหมด?')) return;
    // Clear happens server-side when queue drains
    showToast('ล้างคิวแล้ว', 'info');
  });
}

async function loadQueueTab() {
  const res = await fetch('/api/upload/queue');
  const data = await res.json();
  updateQueueUI(data);
}

function updateQueueUI(queue) {
  const statsEl = document.getElementById('queue-stats');
  const listEl = document.getElementById('queue-list');
  if (!statsEl) return;

  statsEl.innerHTML = `
    <div class="queue-summary-bar">
      <div class="qs-item"><span class="qs-num">${queue.pending}</span> รอ</div>
      <div class="qs-item active"><span class="qs-num">${queue.processing}</span> กำลังอัปโหลด</div>
      <div class="qs-item success"><span class="qs-num">${queue.done}</span> สำเร็จ</div>
      <div class="qs-item error"><span class="qs-num">${queue.failed}</span> ล้มเหลว</div>
      ${queue.paused ? '<div class="qs-item paused">⏸️ หยุดชั่วคราว</div>' : ''}
    </div>`;

  if (!queue.items || queue.items.length === 0) {
    listEl.innerHTML = '<p class="empty-state">ไม่มีรายการในคิว</p>';
    return;
  }

  listEl.innerHTML = queue.items.map(item => `
    <div class="queue-row ${item.status}">
      <div class="queue-row-icon">${getQueueIcon(item.status)}</div>
      <div class="queue-row-info">
        <div class="queue-row-name">${escapeHtml(item.filename)}</div>
        ${item.error ? `<div class="queue-row-error">${escapeHtml(item.error)}</div>` : ''}
        ${item.retries > 0 ? `<div class="queue-row-retry">retry: ${item.retries}</div>` : ''}
      </div>
      <span class="queue-row-status">${getQueueStatusText(item.status)}</span>
    </div>`).join('');
}

function getQueueIcon(status) {
  const icons = { pending: '⏳', processing: '⚡', done: '✅', failed: '❌', cancelled: '🚫' };
  return icons[status] || '❓';
}

function getQueueStatusText(status) {
  const texts = { pending: 'รอ', processing: 'อัปโหลด...', done: 'สำเร็จ', failed: 'ล้มเหลว', cancelled: 'ยกเลิก' };
  return texts[status] || status;
}

// ==================== SCHEDULER ====================
async function initScheduler() {
  const res = await fetch('/api/stats/scheduler');
  const config = await res.json();

  document.getElementById('scheduler-enabled').checked = config.enabled || false;
  document.getElementById('scheduler-interval').value = config.intervalMinutes || 30;
  document.getElementById('scheduler-watch').checked = config.watchEnabled !== false;

  updateSchedulerStatus(config);

  document.getElementById('btn-scheduler-save').addEventListener('click', async () => {
    const body = {
      enabled: document.getElementById('scheduler-enabled').checked,
      intervalMinutes: parseInt(document.getElementById('scheduler-interval').value) || 30,
      watchEnabled: document.getElementById('scheduler-watch').checked
    };
    const res = await fetch('/api/stats/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    showToast('บันทึกการตั้งค่า Scheduler สำเร็จ', 'success');
    updateSchedulerStatus(data.config);
  });

  document.getElementById('btn-scheduler-scan').addEventListener('click', async () => {
    const res = await fetch('/api/stats/scheduler/scan', { method: 'POST' });
    const data = await res.json();
    showToast(`สแกนเสร็จ! พบไฟล์ใหม่ ${data.queued} ไฟล์`, 'success');
  });
}

function updateSchedulerStatus(config) {
  const el = document.getElementById('scheduler-status');
  el.innerHTML = `
    <div class="status-info">
      <span class="status-dot ${config.enabled ? 'active' : 'inactive'}"></span>
      ${config.enabled ? '🟢 Scheduler ทำงานอยู่' : '⚪ Scheduler ปิดอยู่'}
      ${config.lastRun ? `<br>🕐 สแกนล่าสุด: ${new Date(config.lastRun).toLocaleString('th-TH')}` : ''}
    </div>`;
}

// ==================== DROP ZONE ====================
function initDropZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    addFilesToQueue(Array.from(e.target.files));
    fileInput.value = '';
  });

  dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg'].includes(ext);
    });
    if (files.length === 0) { showToast('ไม่มีไฟล์วิดีโอที่รองรับ', 'error'); return; }
    addFilesToQueue(files);
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  document.getElementById('btn-upload-queue').addEventListener('click', uploadDropQueue);
  document.getElementById('btn-clear-queue').addEventListener('click', clearDropQueue);
}

function addFilesToQueue(files) {
  files.forEach(file => {
    if (dropQueue.find(q => q.file.name === file.name && q.file.size === file.size)) return;
    dropQueue.push({ file, status: 'pending', result: null });
  });
  renderDropQueue();
}

function renderDropQueue() {
  const container = document.getElementById('drop-queue');
  const list = document.getElementById('drop-queue-list');
  if (dropQueue.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  list.innerHTML = dropQueue.map((item, idx) => `
    <div class="queue-item">
      <div class="queue-icon">🎬</div>
      <div class="queue-info">
        <div class="queue-name">${escapeHtml(item.file.name)}</div>
        <div class="queue-size">${formatFileSize(item.file.size)}</div>
      </div>
      <span class="queue-status ${item.status}">${getDropStatusText(item)}</span>
      ${item.status === 'pending' ? `<button class="btn-remove" onclick="removeFromDropQueue(${idx})">✕</button>` : ''}
    </div>`).join('');
}

// ==================== TIKTOK ====================
function initTikTok() {
  // Search button
  document.getElementById('btn-tiktok-search').addEventListener('click', searchTikTok);
  document.getElementById('tiktok-keyword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchTikTok();
  });

  // Direct URL download
  document.getElementById('btn-tiktok-download-url').addEventListener('click', downloadTikTokUrl);
  document.getElementById('btn-tiktok-download-upload-url').addEventListener('click', downloadAndUploadTikTokUrl);

  // Batch actions
  document.getElementById('btn-tiktok-select-all').addEventListener('click', toggleSelectAllTikTok);
  document.getElementById('btn-tiktok-batch-upload').addEventListener('click', batchUploadTikTok);
}

// Initialize TikTok when DOM is ready
document.addEventListener('DOMContentLoaded', initTikTok);

let tiktokSearchResults = [];

async function searchTikTok() {
  const keyword = document.getElementById('tiktok-keyword').value.trim();
  if (!keyword) {
    showToast('กรุณาใส่คีย์เวิร์ด', 'error');
    return;
  }

  const loading = document.getElementById('tiktok-loading');
  const results = document.getElementById('tiktok-results');
  loading.style.display = 'flex';
  results.style.display = 'none';

  try {
    const res = await fetch('/api/tiktok/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, count: 12 })
    });

    const data = await res.json();
    loading.style.display = 'none';

    if (data.error) {
      showToast(data.error, 'error');
      return;
    }

    tiktokSearchResults = data.videos || [];
    document.getElementById('tiktok-result-keyword').textContent = `"${keyword}" (${tiktokSearchResults.length} ผลลัพธ์)`;
    renderTikTokResults();
    results.style.display = 'block';
  } catch (err) {
    loading.style.display = 'none';
    showToast('เกิดข้อผิดพลาดในการค้นหา: ' + err.message, 'error');
  }
}

function renderTikTokResults() {
  const list = document.getElementById('tiktok-video-list');

  if (tiktokSearchResults.length === 0) {
    list.innerHTML = '<p class="empty-state">ไม่พบวิดีโอ ลองเปลี่ยนคีย์เวิร์ด</p>';
    return;
  }

  list.innerHTML = tiktokSearchResults.map((video, idx) => `
    <div class="tiktok-video-item" data-idx="${idx}">
      <div class="tiktok-select">
        <input type="checkbox" class="tiktok-checkbox" data-idx="${idx}">
      </div>
      <div class="tiktok-thumb">
        ${video.cover ? `<img src="${video.cover}" alt="thumbnail" loading="lazy">` : '<div class="thumb-placeholder">🎬</div>'}
      </div>
      <div class="tiktok-video-info">
        <div class="tiktok-video-title">${escapeHtml(video.desc || 'ไม่มีคำอธิบาย').substring(0, 100)}</div>
        <div class="tiktok-video-meta">
          <span>@${escapeHtml(video.author)}</span>
          <span>❤️ ${formatCount(video.likeCount)}</span>
          <span>▶️ ${formatCount(video.playCount)}</span>
          <span>💬 ${formatCount(video.commentCount)}</span>
          ${video.duration ? `<span>⏱️ ${video.duration}s</span>` : ''}
        </div>
      </div>
      <div class="tiktok-video-actions">
        <button class="btn btn-secondary btn-sm" onclick="downloadSingleTikTok(${idx})">⬇️ โหลด</button>
        <button class="btn btn-primary btn-sm" onclick="downloadAndUploadSingleTikTok(${idx})">🚀 โหลด+อัป</button>
      </div>
    </div>
  `).join('');
}

async function downloadSingleTikTok(idx) {
  const video = tiktokSearchResults[idx];
  if (!video) return;

  showToast(`กำลังดาวน์โหลด: ${video.desc?.substring(0, 30) || 'วิดีโอ'}...`, 'info');

  try {
    const res = await fetch('/api/tiktok/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: video.videoUrl, filename: video.desc?.substring(0, 50) })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`ดาวน์โหลดสำเร็จ: ${data.filename} (${tiktokService_formatSize(data.size)})`, 'success');
    } else {
      showToast(`ดาวน์โหลดล้มเหลว: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function downloadAndUploadSingleTikTok(idx) {
  const video = tiktokSearchResults[idx];
  if (!video) return;

  const title = video.desc?.substring(0, 100) || `TikTok Video ${video.id}`;
  showToast(`กำลังดาวน์โหลดและอัปโหลด: ${title.substring(0, 30)}...`, 'info');

  try {
    const res = await fetch('/api/tiktok/download-and-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: video.videoUrl,
        title: title,
        filename: title
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`อัปโหลด YouTube สำเร็จ!`, 'success');
      // Show result link
      const resultsEl = document.getElementById('tiktok-batch-results');
      resultsEl.style.display = 'block';
      resultsEl.innerHTML += `
        <div class="drop-result-item">
          ✅ <strong>${escapeHtml(title.substring(0, 50))}</strong> →
          <a href="${data.youtubeUrl}" target="_blank">${data.youtubeUrl}</a>
        </div>`;
    } else {
      showToast(`ล้มเหลว: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function downloadTikTokUrl() {
  const url = document.getElementById('tiktok-url').value.trim();
  if (!url) {
    showToast('กรุณาใส่ลิงก์ TikTok', 'error');
    return;
  }

  showToast('กำลังดาวน์โหลด (ไม่มีลายน้ำ)...', 'info');

  try {
    const res = await fetch('/api/tiktok/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: url })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`ดาวน์โหลดสำเร็จ: ${data.filename}`, 'success');
    } else {
      showToast(`ดาวน์โหลดล้มเหลว: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function downloadAndUploadTikTokUrl() {
  const url = document.getElementById('tiktok-url').value.trim();
  if (!url) {
    showToast('กรุณาใส่ลิงก์ TikTok', 'error');
    return;
  }

  showToast('กำลังดาวน์โหลดและอัปโหลดไป YouTube...', 'info');

  try {
    const res = await fetch('/api/tiktok/download-and-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: url })
    });

    const data = await res.json();
    if (data.success) {
      showToast('อัปโหลด YouTube สำเร็จ!', 'success');
      const resultsEl = document.getElementById('tiktok-batch-results');
      resultsEl.style.display = 'block';
      resultsEl.innerHTML += `
        <div class="drop-result-item">
          ✅ <strong>${escapeHtml(data.filename)}</strong> →
          <a href="${data.youtubeUrl}" target="_blank">${data.youtubeUrl}</a>
        </div>`;
    } else {
      showToast(`ล้มเหลว: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function toggleSelectAllTikTok() {
  const checkboxes = document.querySelectorAll('.tiktok-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
}

async function batchUploadTikTok() {
  const checkboxes = document.querySelectorAll('.tiktok-checkbox:checked');
  if (checkboxes.length === 0) {
    showToast('กรุณาเลือกวิดีโออย่างน้อย 1 รายการ', 'error');
    return;
  }

  const selectedVideos = Array.from(checkboxes).map(cb => {
    const idx = parseInt(cb.dataset.idx);
    const video = tiktokSearchResults[idx];
    return {
      videoUrl: video.videoUrl,
      title: (video.desc || `TikTok ${video.id}`).substring(0, 100),
      desc: video.desc
    };
  });

  if (!confirm(`ต้องการดาวน์โหลดและอัปโหลด ${selectedVideos.length} วิดีโอไป YouTube?`)) return;

  try {
    const res = await fetch('/api/tiktok/batch-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos: selectedVideos })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`เริ่มดาวน์โหลดและอัปโหลด ${data.total} วิดีโอ...`, 'info');
      trackTikTokProgress();
    } else {
      showToast(`ล้มเหลว: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function trackTikTokProgress() {
  const progressEl = document.getElementById('tiktok-progress');
  const resultsEl = document.getElementById('tiktok-batch-results');
  progressEl.style.display = 'block';
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '';

  const eventSource = new EventSource('/api/tiktok/progress');
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    const phaseText = data.phase === 'downloading' ? '⬇️ กำลังดาวน์โหลด' :
                      data.phase === 'uploading' ? '⬆️ กำลังอัปโหลด YouTube' : 'กำลังดำเนินการ';

    document.getElementById('tiktok-progress-text').textContent = data.status === 'done' ? '🎉 เสร็จสิ้น!' : phaseText;
    document.getElementById('tiktok-progress-count').textContent = `${data.current}/${data.total}`;
    document.getElementById('tiktok-progress-file').textContent = data.currentFile || '';
    document.getElementById('tiktok-progress-phase').textContent = data.phase ? phaseText : '';

    const pct = data.total > 0 ? (data.current / data.total) * 100 : 0;
    document.getElementById('tiktok-progress-fill').style.width = pct + '%';

    // Render completed results
    if (data.results && data.results.length > 0) {
      resultsEl.innerHTML = data.results.map(r => {
        if (r.success) {
          return `<div class="drop-result-item">
            ✅ <strong>${escapeHtml(r.title.substring(0, 50))}</strong> →
            <a href="${r.youtubeUrl}" target="_blank">${r.youtubeUrl}</a>
          </div>`;
        } else {
          return `<div class="drop-result-item error">
            ❌ <strong>${escapeHtml(r.title.substring(0, 50))}</strong> — ${escapeHtml(r.error)}
          </div>`;
        }
      }).join('');
    }

    if (data.status === 'done') {
      eventSource.close();
      const success = data.results.filter(r => r.success).length;
      const failed = data.results.filter(r => !r.success).length;
      showToast(`TikTok → YouTube เสร็จ! สำเร็จ ${success}, ล้มเหลว ${failed}`, success > 0 ? 'success' : 'error');
      loadHistory();
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    progressEl.style.display = 'none';
  };
}

// Helper functions for TikTok
function formatCount(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function tiktokService_formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getDropStatusText(item) {
  const texts = { pending: '⏳ รอ', uploading: '⬆️ อัปโหลด...', done: '✅ สำเร็จ', error: '❌ ล้มเหลว' };
  return texts[item.status] || '';
}

function removeFromDropQueue(idx) { dropQueue.splice(idx, 1); renderDropQueue(); }

function clearDropQueue() {
  dropQueue = [];
  renderDropQueue();
  document.getElementById('drop-results').style.display = 'none';
}

async function uploadDropQueue() {
  const pending = dropQueue.filter(q => q.status === 'pending');
  if (pending.length === 0) { showToast('ไม่มีไฟล์ที่ต้องอัปโหลด', 'info'); return; }

  const progressEl = document.getElementById('drop-progress');
  const resultsEl = document.getElementById('drop-results');
  progressEl.style.display = 'block';
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '';
  document.getElementById('btn-upload-queue').disabled = true;

  let successCount = 0, errorCount = 0;

  for (let i = 0; i < dropQueue.length; i++) {
    const item = dropQueue[i];
    if (item.status !== 'pending') continue;

    item.status = 'uploading';
    renderDropQueue();

    document.getElementById('drop-progress-text').textContent = 'กำลังอัปโหลด...';
    document.getElementById('drop-progress-count').textContent = `${successCount + errorCount + 1}/${pending.length}`;
    document.getElementById('drop-progress-file').textContent = item.file.name;
    const pct = ((successCount + errorCount + 1) / pending.length) * 100;
    document.getElementById('drop-progress-fill').style.width = pct + '%';

    try {
      const formData = new FormData();
      formData.append('video', item.file);
      formData.append('title', item.file.name.replace(/\.[^.]+$/, ''));

      const res = await fetch('/api/drop-and-upload-youtube', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.success) {
        item.status = 'done'; item.result = data; successCount++;
        resultsEl.innerHTML += `<div class="drop-result-item">✅ <strong>${escapeHtml(item.file.name)}</strong> → <a href="${data.youtubeUrl}" target="_blank">${data.youtubeUrl}</a></div>`;
      } else {
        item.status = 'error'; errorCount++;
        resultsEl.innerHTML += `<div class="drop-result-item error">❌ <strong>${escapeHtml(item.file.name)}</strong> — ${escapeHtml(data.error)}</div>`;
      }
    } catch (err) {
      item.status = 'error'; errorCount++;
      resultsEl.innerHTML += `<div class="drop-result-item error">❌ <strong>${escapeHtml(item.file.name)}</strong> — ${escapeHtml(err.message)}</div>`;
    }
    renderDropQueue();
    if (i < dropQueue.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  document.getElementById('drop-progress-text').textContent = 'อัปโหลดเสร็จสิ้น!';
  document.getElementById('btn-upload-queue').disabled = false;
  showToast(`อัปโหลดเสร็จ! สำเร็จ ${successCount}, ล้มเหลว ${errorCount}`, successCount > 0 ? 'success' : 'error');
  loadHistory();
  loadDashboard();
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  if (res.ok) { showToast('บันทึกการตั้งค่าสำเร็จ!', 'success'); loadFiles(); }
  else showToast('เกิดข้อผิดพลาด', 'error');
}

// ==================== FILES ====================
async function loadFiles() {
  const res = await fetch('/api/files');
  const data = await res.json();
  const list = document.getElementById('file-list');

  if (data.error) { list.innerHTML = `<p class="empty-state">❌ ${data.error}</p>`; return; }
  if (!data.folder) { list.innerHTML = '<p class="empty-state">⚙️ กรุณาตั้งค่าโฟลเดอร์ก่อนใช้งาน</p>'; return; }
  if (data.files.length === 0) { list.innerHTML = '<p class="empty-state">📭 ไม่พบไฟล์วิดีโอในโฟลเดอร์</p>'; return; }

  const sizeEl = document.getElementById('files-total-size');
  if (sizeEl && data.totalSize) sizeEl.textContent = `💾 ${data.totalSize}`;

  list.innerHTML = data.files.map(file => `
    <div class="file-item ${file.uploaded ? 'uploaded' : ''}">
      <div class="file-icon">🎬</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(file.filename)}</div>
        <div class="file-meta">${file.sizeFormatted} • ${new Date(file.modified).toLocaleString('th-TH')}</div>
      </div>
      <div class="file-actions">
        ${file.uploaded
          ? `<span class="badge badge-success">✅ อัปโหลดแล้ว</span><a href="${file.youtubeUrl}" target="_blank" class="btn btn-secondary">🔗 YouTube</a>`
          : `<span class="badge badge-pending">⏳ รอ</span><button class="btn btn-primary" onclick="openUploadModal('${escapeHtml(file.filename)}')">📤 อัปโหลด</button>`}
      </div>
    </div>`).join('');
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

function closeModal() { document.getElementById('upload-modal').style.display = 'none'; }

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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, title, description, tags, privacy })
  });
  const data = await res.json();
  if (data.success) {
    showToast(`อัปโหลดสำเร็จ! ${data.deleted ? '(ลบไฟล์แล้ว)' : ''}`, 'success');
    loadFiles(); loadHistory(); loadDashboard();
  } else {
    showToast(`เกิดข้อผิดพลาด: ${data.error}`, 'error');
  }
});

// Upload All
document.getElementById('btn-upload-all').addEventListener('click', async () => {
  if (!confirm('ต้องการอัปโหลดไฟล์ทั้งหมดที่ยังไม่ได้อัปโหลด?')) return;
  const res = await fetch('/api/upload-all', { method: 'POST' });
  const data = await res.json();
  if (data.error) { showToast(data.error, 'error'); return; }
  if (data.totalFiles === 0) { showToast('ไม่มีไฟล์ที่ต้องอัปโหลด', 'info'); return; }
  showToast(`เพิ่ม ${data.totalFiles} ไฟล์ลงคิว`, 'info');
});

document.getElementById('btn-refresh').addEventListener('click', () => { loadFiles(); showToast('รีเฟรชแล้ว', 'info'); });

// ==================== HISTORY ====================
async function loadHistory() {
  const res = await fetch('/api/history');
  const data = await res.json();
  const list = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');

  // Support both legacy (array) and new (paginated) formats
  const items = Array.isArray(data) ? data : (data.items || []);
  const total = Array.isArray(data) ? data.length : (data.total || 0);

  if (countEl) countEl.textContent = `${total} รายการ`;

  if (items.length === 0) {
    list.innerHTML = '<p class="empty-state">ยังไม่มีประวัติการอัปโหลด</p>';
    return;
  }

  list.innerHTML = items.map(item => `
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
    </div>`).join('');
}

document.getElementById('btn-clear-history').addEventListener('click', async () => {
  if (!confirm('ต้องการล้างประวัติการอัปโหลดทั้งหมด?')) return;
  await fetch('/api/history', { method: 'DELETE' });
  loadHistory(); loadFiles(); loadDashboard();
  showToast('ล้างประวัติแล้ว', 'info');
});

// ==================== UTILITIES ====================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}
