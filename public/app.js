// ═══════════════════════════════════════════════════════════════
// YouTube Auto Uploader v2 — SPA Router (URL Path-based)
//
// แต่ละ tab = แต่ละ URL path = แต่ละไฟล์ใน /pages/*.js
// ═══════════════════════════════════════════════════════════════

const ROUTES = {
  '/':          () => import('./pages/dashboard.js?v=2'),
  '/dashboard': () => import('./pages/dashboard.js?v=2'),
  '/tiktok':    () => import('./pages/tiktok.js?v=4'),
  '/accounts':  () => import('./pages/accounts.js?v=1'),
  '/seo':       () => import('./pages/seo.js?v=2'),
  '/uploads':   () => import('./pages/uploads.js?v=1'),
  '/activity':  () => import('./pages/activity.js?v=2'),
  '/settings':  () => import('./pages/settings.js?v=2'),
};

let ws = null;
let wsReconnectTimer = null;
let currentPage = null;

// Theme handling
function applyTheme(theme) {
  document.body.classList.remove('theme-minimal-modern', 'theme-dark-pro', 'theme-youtube-brand');
  if (theme !== 'dark-pro') {
    document.body.classList.add(`theme-${theme}`);
  }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  // Apply saved theme
  const savedTheme = localStorage.getItem('theme') || 'dark-pro';
  applyTheme(savedTheme);

  initWebSocket();
  initNav();
  checkAuth();
  loadHealthStatus();
  navigate(location.hash.slice(1) || '/');

  // Auth callback params
  const params = new URLSearchParams(location.search);
  if (params.get('auth') === 'success') { showToast('เชื่อมต่อ YouTube สำเร็จ!', 'success'); history.replaceState({}, '', '/'); }
  else if (params.get('auth') === 'error') { showToast('เชื่อมต่อล้มเหลว: ' + (params.get('message')||''), 'error'); history.replaceState({}, '', '/'); }

  setInterval(loadHealthStatus, 30000);
});

// ==================== ROUTER ====================
function initNav() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const path = tab.dataset.path;
      navigate(path);
    });
  });

  window.addEventListener('hashchange', () => {
    navigate(location.hash.slice(1) || '/');
  });
}

async function navigate(path) {
  if (!path || !ROUTES[path]) path = '/';

  // ★ Cleanup previous page — ปิด SSE/EventSource และ timers ก่อนเปลี่ยนหน้า
  if (currentPage && typeof currentPage.cleanup === 'function') {
    try { currentPage.cleanup(); } catch (_) {}
  }

  // Update URL hash
  if (location.hash !== '#' + path) {
    history.pushState(null, '', '#' + path);
  }

  // Update active tab
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.path === path);
  });

  // Load page module
  const container = document.getElementById('page-content');
  try {
    const module = await ROUTES[path]();
    container.innerHTML = module.render();
    currentPage = module;
    if (module.init) await module.init();
  } catch (err) {
    container.innerHTML = `<p class="empty-state">❌ โหลดหน้าล้มเหลว: ${err.message}</p>`;
    console.error('Navigation error:', err);
  }
}

// ==================== WEBSOCKET ====================
function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.onopen = () => { updateConnectionDot(true); if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; } };
  ws.onmessage = (e) => handleWS(JSON.parse(e.data));
  ws.onclose = () => { updateConnectionDot(false); wsReconnectTimer = setTimeout(initWebSocket, 3000); };
  ws.onerror = () => ws.close();
}

function handleWS({ type, data }) {
  switch (type) {
    case 'tiktok:downloaded':
      // อัปเดต counter ใน status bar ถ้ามี
      (function() {
        const el = document.getElementById('sb-dl-count');
        if (el) el.textContent = (parseInt(el.textContent || '0') + 1) + ' วันนี้';
      })();
      break;
    case 'notification':
      showToast(`${data.title}: ${data.message}`, data.level === 'error' ? 'error' : data.level === 'success' ? 'success' : 'info');
      if (data.level === 'error' || data.level === 'success') sendDesktopNotif(data.title, data.message);
      break;
    case 'queue:progress':
      if (currentPage && currentPage.update) currentPage.update(data);
      break;
    case 'queue:completed':
      showToast(`อัปโหลดเสร็จ: ${data.filename}`, 'success');
      break;
    case 'queue:failed':
      showToast(`อัปโหลดล้มเหลว: ${data.filename}`, 'error');
      break;
    case 'queue:done':
      showToast('คิวเสร็จสิ้น', 'success');
      break;
    case 'watchlist:progress':
      // ★ Forward watchlist progress to TikTok page (regardless of who triggered the run)
      if (currentPage && (location.hash === '#/tiktok')) {
        if (currentPage.onWatchlistProgress) currentPage.onWatchlistProgress(data);
      }
      break;
    case 'dashboard:refresh':
      if (currentPage && location.hash === '#/' || location.hash === '#/dashboard') {
        if (currentPage.init) currentPage.init();
      }
      break;
    case 'system:status':
      updateStatusBar(data);
      break;
  }
}

// ==================== AUTH ====================
async function checkAuth() {
  const res = await fetch('/api/auth/status');
  const data = await res.json();
  const el = document.getElementById('auth-status');
  if (!data.hasCredentials) {
    el.className = 'auth-status disconnected';
    el.innerHTML = '⚠️ ไม่พบ client_secret.json';
  } else if (data.authenticated) {
    el.className = 'auth-status connected';
    el.innerHTML = '✅ YouTube เชื่อมต่อแล้ว <button class="btn-logout" onclick="window.app.logout()">ออก</button>';
    loadChannel();
  } else {
    el.className = 'auth-status disconnected';
    el.innerHTML = '⚠️ ยังไม่เชื่อมต่อ <button class="btn-login" onclick="window.app.login()">เข้าสู่ระบบ</button>';
  }
}

async function loadChannel() {
  try {
    const res = await fetch('/api/auth/channel');
    const d = await res.json();
    if (d && d.title) {
      const el = document.getElementById('channel-info'); el.style.display = 'flex';
      el.innerHTML = `${d.thumbnail?`<img src="${d.thumbnail}" class="channel-avatar">`:''}<div class="channel-details"><strong>${escapeHtml(d.title)}</strong><span>${d.subscribers||'?'} subs • ${d.videoCount||'?'} videos</span></div>`;
    }
  } catch(e) {}
}

// ==================== STATUS BAR ====================
function updateConnectionDot(connected) {
  const dot = document.querySelector('#sb-connection .sb-dot');
  const text = document.querySelector('#sb-connection .sb-text');
  if (dot) { 
    dot.className = `sb-dot ${connected?'connected':'disconnected'}`; 
  }
  if (text) { 
    text.textContent = connected ? 'เชื่อมต่อแล้ว' : 'ขาดการเชื่อมต่อ'; 
  }
}

function updateStatusBar(data) {
  if (!data) return;
  
  // Queue status
  const qEl = document.querySelector('#sb-queue .sb-text');
  const qContainer = document.getElementById('sb-queue');
  const qPauseBtn = document.getElementById('sb-queue-pause');
  if (qEl && data.queue) {
    const p = data.queue.pending||0, pr = data.queue.processing||0;
    const paused = data.queue.paused || false;
    if (pr > 0 || p > 0) {
      qEl.textContent = paused
        ? `⏸ หยุดชั่วคราว | รอ ${p}`
        : `กำลังอัป ${pr} | รอ ${p}`;
      qContainer.classList.toggle('queue-active', !paused && pr > 0);
      qContainer.classList.toggle('queue-paused', paused);
      if (qPauseBtn) {
        qPauseBtn.style.display = 'inline-flex';
        qPauseBtn.textContent = paused ? '▶' : '⏸';
        qPauseBtn.title = paused ? 'เริ่มคิวต่อ' : 'หยุดคิวชั่วคราว';
      }
    } else {
      qEl.textContent = 'คิวว่าง';
      qContainer.classList.remove('queue-active', 'queue-paused');
      if (qPauseBtn) qPauseBtn.style.display = 'none';
    }
  }
  
  // Uptime
  const uEl = document.querySelector('#sb-uptime .sb-text');
  if (uEl && data.uptime) uEl.textContent = data.uptime;
  
  // Health status
  const hEl = document.getElementById('sb-health');
  if (hEl && data.overall) {
    const icon = hEl.querySelector('.sb-icon');
    const text = hEl.querySelector('.sb-text');
    const map = { 
      healthy: ['H','ปกติ','health-ok'], 
      warning: ['!','เตือน','health-warning'], 
      critical: ['!','วิกฤต','health-critical'], 
      error: ['!','ผิดพลาด','health-critical'] 
    };
    const [i, t, cls] = map[data.overall] || ['?','?',''];
    if (icon) icon.textContent = i;
    if (text) text.textContent = t;
    hEl.className = 'status-bar-item';
    if (cls) hEl.classList.add(cls);
  }
}

async function loadHealthStatus() {
  try { 
    const r = await fetch('/api/health'); 
    updateStatusBar(await r.json()); 
    // Load quota status
    const qr = await fetch('/api/stats/quota');
    updateQuotaStatus(await qr.json());
  } catch(e) {}
}

function updateQuotaStatus(quota) {
  const el = document.getElementById('sb-quota-text');
  const container = document.getElementById('sb-quota');
  if (!el || !container) return;
  
  // รองรับ multi-account: ใช้ total uploads left ถ้ามีหลาย account
  const remaining = quota.uploadsRemaining ?? quota.remaining ?? 0;
  const used = quota.used || 0;
  const limit = quota.limit || 10000;
  const percent = quota.percentUsed || ((used / limit) * 100);
  const isMulti = quota.multiAccount && quota.accounts?.length > 1;
  const accountCount = quota.accounts?.filter(a => a.isAuthenticated)?.length || 1;

  if (isMulti) {
    el.textContent = `${remaining} คลิป (${accountCount} accs)`;
  } else {
    el.textContent = `${remaining} คลิป`;
  }
  
  // เปลี่ยนสีตามสถานะ
  container.className = 'status-bar-item';
  if (percent >= 90) {
    container.classList.add('quota-critical');
    container.title = isMulti
      ? `Quota เกือบหมดทุก account: ${used}/${limit} (${percent.toFixed(0)}%)`
      : `Quota เกือบหมด: ${used}/${limit} (${percent.toFixed(0)}%)`;
  } else if (percent >= 70) {
    container.classList.add('quota-warning');
    container.title = `Quota: ${used}/${limit} (${percent.toFixed(0)}%)`;
  } else {
    container.classList.add('quota-ok');
    container.title = isMulti
      ? `Quota รวม ${accountCount} accounts: ${used}/${limit} (${percent.toFixed(0)}%) — ${remaining} uploads left`
      : `Quota: ${used}/${limit} (${percent.toFixed(0)}%)`;
  }
}

async function runCleanup() {
  try { const r = await fetch('/api/health/cleanup',{method:'POST'}); const d=await r.json(); showToast(`ลบ ${d.tempFiles.cleaned} ไฟล์ temp`, 'success'); } catch(e) { showToast('ล้มเหลว','error'); }
}

// ==================== UPLOAD MODAL ====================
function openUploadModal(filename) {
  document.getElementById('upload-filename').value = filename;
  document.getElementById('upload-title').value = filename.replace(/\.[^.]+$/, '');
  document.getElementById('upload-modal').style.display = 'flex';
}

function closeModal() { document.getElementById('upload-modal').style.display = 'none'; }

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const filename = document.getElementById('upload-filename').value;
  const body = { filename, title: document.getElementById('upload-title').value, description: document.getElementById('upload-description').value, tags: document.getElementById('upload-tags').value, privacy: document.getElementById('upload-privacy').value };
  closeModal(); showToast(`อัปโหลด ${filename}...`, 'info');
  const res = await fetch('/api/upload/single', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.success) { showToast('อัปโหลดสำเร็จ!', 'success'); if (currentPage && currentPage.init) currentPage.init(); }
  else showToast(data.error || 'อัปโหลดล้มเหลว', 'error');
});

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  const paths = ['/','/tiktok','/accounts','/seo','/uploads','/activity','/settings'];
  if (e.key >= '1' && e.key <= String(paths.length)) { e.preventDefault(); navigate(paths[parseInt(e.key)-1]); return; }
  switch (e.key.toLowerCase()) {
    case 'r': e.preventDefault(); if (window.filesPage) window.filesPage.reload(); showToast('🔄','info'); break;
    case '?': e.preventDefault(); const m=document.getElementById('shortcuts-modal'); m.style.display=m.style.display==='none'?'flex':'none'; break;
    case 'escape': document.getElementById('upload-modal').style.display='none'; document.getElementById('shortcuts-modal').style.display='none'; break;
  }
});

// ==================== NOTIFICATIONS ====================
function sendDesktopNotif(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
}
document.addEventListener('click', () => { if ('Notification' in window && Notification.permission==='default') Notification.requestPermission(); }, { once: true });

// ==================== UTILITIES ====================
function showToast(msg, type = 'info') {
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 4000);
}

function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

function formatFileSize(bytes) {
  if (!bytes) return '0 B'; const k=1024; const s=['B','KB','MB','GB'];
  const i=Math.floor(Math.log(bytes)/Math.log(k));
  return parseFloat((bytes/Math.pow(k,i)).toFixed(2))+' '+s[i];
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff/60000);
  if (m<1) return 'เมื่อสักครู่'; if (m<60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m/60); if (h<24) return `${h} ชม.ที่แล้ว`;
  return `${Math.floor(h/24)} วันที่แล้ว`;
}

// ==================== GLOBAL EXPORTS ====================
window.app = { showToast, escapeHtml, formatFileSize, timeAgo, openUploadModal, login, logout: doLogout, navigate, toggleQueuePause };
window.closeModal = closeModal;
window.runCleanup = runCleanup;

async function toggleQueuePause() {
  const btn = document.getElementById('sb-queue-pause');
  const isPaused = btn && btn.textContent === '▶';
  try {
    const endpoint = isPaused ? '/api/upload/queue/resume' : '/api/upload/queue/pause';
    await fetch(endpoint, { method: 'POST' });
    showToast(isPaused ? 'เริ่มคิวต่อแล้ว' : 'หยุดคิวชั่วคราวแล้ว', 'success');
    // สถานะจะอัปเดตผ่าน WebSocket system:status
    setTimeout(loadHealthStatus, 500);
  } catch(e) {
    showToast('ไม่สามารถเปลี่ยนสถานะคิวได้', 'error');
  }
}

async function login() { const r=await fetch('/api/auth/login'); const d=await r.json(); if(d.url) location.href=d.url; else showToast(d.error,'error'); }
async function doLogout() { await fetch('/api/auth/logout',{method:'POST'}); document.getElementById('channel-info').style.display='none'; checkAuth(); showToast('ออกจากระบบ','info'); }
