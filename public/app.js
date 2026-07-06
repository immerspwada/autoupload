// ═══════════════════════════════════════════════════════════════
// YouTube Auto Uploader v2 — SPA Router (URL Path-based)
//
// แต่ละ tab = แต่ละ URL path = แต่ละไฟล์ใน /pages/*.js
// ═══════════════════════════════════════════════════════════════

const ROUTES = {
  '/':          () => import('./pages/dashboard.js'),
  '/dashboard': () => import('./pages/dashboard.js'),
  '/upload':    () => import('./pages/upload.js'),
  '/tiktok':    () => import('./pages/tiktok.js'),
  '/seo':       () => import('./pages/seo.js'),
  '/files':     () => import('./pages/files.js'),
  '/queue':     () => import('./pages/queue.js'),
  '/scheduler': () => import('./pages/scheduler.js'),
  '/settings':  () => import('./pages/settings.js'),
  '/history':   () => import('./pages/history.js'),
};

let ws = null;
let wsReconnectTimer = null;
let currentPage = null;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
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
    case 'notification':
      showToast(`${data.title}: ${data.message}`, data.level === 'error' ? 'error' : data.level === 'success' ? 'success' : 'info');
      if (data.level === 'error' || data.level === 'success') sendDesktopNotif(data.title, data.message);
      break;
    case 'queue:progress':
      if (currentPage && currentPage.update) currentPage.update(data);
      break;
    case 'queue:completed':
      showToast(`✅ ${data.filename}`, 'success');
      break;
    case 'queue:failed':
      showToast(`❌ ${data.filename}`, 'error');
      break;
    case 'queue:done':
      showToast('🎉 คิวเสร็จสิ้น!', 'success');
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
  if (dot) { dot.className = `sb-dot ${connected?'connected':'disconnected'}`; }
  if (text) { text.textContent = connected ? 'เชื่อมต่อ' : 'ขาด'; }
}

function updateStatusBar(data) {
  if (!data) return;
  const qEl = document.querySelector('#sb-queue .sb-text');
  if (qEl && data.queue) {
    const p = data.queue.pending||0, pr = data.queue.processing||0;
    qEl.textContent = pr > 0 ? `อัปโหลด: ${pr} | รอ: ${p}` : p > 0 ? `คิว: ${p}` : 'คิวว่าง';
  }
  const uEl = document.querySelector('#sb-uptime .sb-text');
  if (uEl && data.uptime) uEl.textContent = data.uptime;
  const hEl = document.getElementById('sb-health');
  if (hEl && data.overall) {
    const icon = hEl.querySelector('.sb-icon'), text = hEl.querySelector('.sb-text');
    const map = { healthy:['💚','ปกติ'], warning:['💛','เตือน'], critical:['🔴','วิกฤต'], error:['❌','ผิดพลาด'] };
    const [i,t] = map[data.overall] || ['❓','?'];
    icon.textContent = i; text.textContent = t;
  }
}

async function loadHealthStatus() {
  try { const r = await fetch('/api/health'); updateStatusBar(await r.json()); } catch(e) {}
}

async function runCleanup() {
  try { const r = await fetch('/api/health/cleanup',{method:'POST'}); const d=await r.json(); showToast(`🧹 ลบ ${d.tempFiles.cleaned} ไฟล์ temp`, 'success'); } catch(e) { showToast('ล้มเหลว','error'); }
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
  const res = await fetch('/api/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.success) { showToast('อัปโหลดสำเร็จ!', 'success'); if (currentPage && currentPage.init) currentPage.init(); }
  else showToast(data.error, 'error');
});

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  const paths = ['/','/upload','/tiktok','/seo','/files','/queue','/scheduler','/settings','/history'];
  if (e.key >= '1' && e.key <= '9') { e.preventDefault(); navigate(paths[parseInt(e.key)-1]); return; }
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
window.app = { showToast, escapeHtml, formatFileSize, timeAgo, openUploadModal, login, logout: doLogout, navigate };
window.closeModal = closeModal;
window.runCleanup = runCleanup;

async function login() { const r=await fetch('/api/auth/login'); const d=await r.json(); if(d.url) location.href=d.url; else showToast(d.error,'error'); }
async function doLogout() { await fetch('/api/auth/logout',{method:'POST'}); document.getElementById('channel-info').style.display='none'; checkAuth(); showToast('ออกจากระบบ','info'); }
