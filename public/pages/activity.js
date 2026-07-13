// Page: Activity Log (/activity)
export function render() {
  return `
    <div class="activity-section">
      <div class="page-header">
        <h2>Activity Log</h2>
        <p>ติดตามกิจกรรมทั้งหมดแบบ real-time</p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="activity-type-filter" class="filter-select">
              <option value="">ทุกประเภท</option>
              <option value="upload">อัปโหลด</option>
              <option value="tiktok">TikTok</option>
              <option value="queue">คิว</option>
              <option value="scheduler">Scheduler</option>
              <option value="auth">Auth</option>
              <option value="health">Health</option>
            </select>
            <select id="activity-level-filter" class="filter-select">
              <option value="">ทุกระดับ</option>
              <option value="success">สำเร็จ</option>
              <option value="error">ข้อผิดพลาด</option>
              <option value="warning">คำเตือน</option>
              <option value="info">ข้อมูล</option>
            </select>
          </div>
          <div style="display:flex;gap:8px">
            <button id="btn-activity-refresh" class="btn btn-secondary btn-sm">รีเฟรช</button>
            <button id="btn-activity-clear" class="btn btn-danger btn-sm">ล้างทั้งหมด</button>
          </div>
        </div>
        <div class="card-body" style="padding-bottom:0">
          <div id="activity-stats" class="dashboard-grid" style="margin-bottom:0"></div>
        </div>
      </div>

      <div id="activity-loading" class="loading-state" style="display:none">
        <div class="spinner"></div>
        <p>กำลังโหลด...</p>
      </div>

      <div id="activity-timeline" class="activity-timeline"></div>

      <div class="activity-footer">
        <button id="btn-load-more" class="btn btn-secondary btn-sm" style="display:none">โหลดเพิ่ม</button>
      </div>
    </div>
  `;
}

let allActivities = [];
let filteredActivities = [];
let displayCount = 50;

export async function init() {
  await loadActivities();
  
  document.getElementById('btn-activity-refresh').addEventListener('click', loadActivities);
  document.getElementById('btn-activity-clear').addEventListener('click', clearActivities);
  document.getElementById('activity-type-filter').addEventListener('change', applyFilters);
  document.getElementById('activity-level-filter').addEventListener('change', applyFilters);
  
  const loadMoreBtn = document.getElementById('btn-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      displayCount += 50;
      renderTimeline(filteredActivities.slice(0, displayCount));
      if (displayCount >= filteredActivities.length) {
        loadMoreBtn.style.display = 'none';
      }
    });
  }
}

async function loadActivities() {
  const loading = document.getElementById('activity-loading');
  loading.style.display = 'flex';
  
  try {
    const res = await fetch('/api/activity?limit=200');
    const data = await res.json();
    
    allActivities = data.activities || [];
    renderStats(data.stats);
    applyFilters();
    
    loading.style.display = 'none';
  } catch (err) {
    loading.style.display = 'none';
    window.app.showToast('โหลดกิจกรรมล้มเหลว: ' + err.message, 'error');
  }
}

function applyFilters() {
  const typeFilter = document.getElementById('activity-type-filter').value;
  const levelFilter = document.getElementById('activity-level-filter').value;
  
  filteredActivities = allActivities.filter(activity => {
    if (typeFilter && !activity.type.startsWith(typeFilter)) return false;
    if (levelFilter && activity.level !== levelFilter) return false;
    return true;
  });
  
  displayCount = 50;
  renderTimeline(filteredActivities.slice(0, displayCount));
  
  const loadMoreBtn = document.getElementById('btn-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.style.display = filteredActivities.length > displayCount ? 'block' : 'none';
  }
}

function renderStats(stats) {
  if (!stats) return;
  const el = document.getElementById('activity-stats');
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">📋</div>
      <div class="stat-value">${stats.total || 0}</div>
      <div class="stat-label">ทั้งหมด</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">📅</div>
      <div class="stat-value">${stats.today || 0}</div>
      <div class="stat-label">วันนี้</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">✓</div>
      <div class="stat-value">${stats.byLevel?.success || 0}</div>
      <div class="stat-label">สำเร็จ</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">✕</div>
      <div class="stat-value">${stats.byLevel?.error || 0}</div>
      <div class="stat-label">ผิดพลาด</div>
    </div>
  `;
}

function renderTimeline(activities) {
  const el = document.getElementById('activity-timeline');
  
  if (activities.length === 0) {
    el.innerHTML = '<p class="empty-state">ไม่มีกิจกรรม</p>';
    return;
  }
  
  // Group by date
  const grouped = {};
  activities.forEach(activity => {
    const date = activity.timestamp.split('T')[0];
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(activity);
  });
  
  let html = '';
  Object.keys(grouped).sort().reverse().forEach(date => {
    const dateLabel = formatDate(date);
    html += `<div class="activity-date-group">
      <div class="activity-date-label">${dateLabel}</div>
      <div class="activity-items">`;
    
    grouped[date].forEach(activity => {
      html += renderActivity(activity);
    });
    
    html += `</div></div>`;
  });
  
  el.innerHTML = html;
}

function renderActivity(activity) {
  const icon = getActivityIcon(activity.type, activity.level);
  const time = new Date(activity.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const levelClass = activity.level || 'info';
  
  let detailsHtml = '';
  if (activity.data && Object.keys(activity.data).length > 0) {
    if (activity.data.youtubeUrl) {
      detailsHtml += `<a href="${activity.data.youtubeUrl}" target="_blank" class="activity-link">🔗 YouTube</a>`;
    }
    if (activity.data.error) {
      detailsHtml += `<div class="activity-error">${window.app.escapeHtml(activity.data.error)}</div>`;
    }
  }
  
  return `
    <div class="activity-item activity-${levelClass}">
      <div class="activity-icon">${icon}</div>
      <div class="activity-content">
        <div class="activity-message">${window.app.escapeHtml(activity.message)}</div>
        ${detailsHtml}
        <div class="activity-meta">
          <span class="activity-time">${time}</span>
          <span class="activity-type">${formatType(activity.type)}</span>
        </div>
      </div>
    </div>
  `;
}

function getActivityIcon(type, level) {
  if (level === 'success') return '✓';
  if (level === 'error')   return '✕';
  if (level === 'warning') return '!';
  if (type.startsWith('upload'))    return '↑';
  if (type.startsWith('tiktok'))    return 'TT';
  if (type.startsWith('queue'))     return 'Q';
  if (type.startsWith('scheduler')) return 'S';
  if (type.startsWith('auth'))      return 'A';
  if (type.startsWith('health'))    return 'H';
  return 'i';
}

function formatType(type) {
  const map = {
    'upload:success': 'อัปโหลดสำเร็จ',
    'upload:failed': 'อัปโหลดล้มเหลว',
    'tiktok:downloaded': 'TikTok ดาวน์โหลด',
    'queue:completed': 'คิวเสร็จสิ้น',
    'scheduler:scan': 'Scheduler สแกน',
    'auth:login': 'เข้าสู่ระบบ',
    'auth:logout': 'ออกจากระบบ',
    'health:cleanup': 'ล้างข้อมูล'
  };
  return map[type] || type;
}

function formatDate(dateStr) {
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (dateStr === today)     return 'วันนี้';
  if (dateStr === yesterday) return 'เมื่อวาน';
  const date = new Date(dateStr);
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function clearActivities() {
  if (!confirm('ต้องการล้างประวัติกิจกรรมทั้งหมด?')) return;
  
  try {
    const res = await fetch('/api/activity/clear', { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      window.app.showToast('ล้างประวัติเรียบร้อย', 'success');
      await loadActivities();
    }
  } catch (err) {
    window.app.showToast('ล้างล้มเหลว: ' + err.message, 'error');
  }
}
