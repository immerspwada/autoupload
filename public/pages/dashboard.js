// Page: Dashboard (/dashboard)
export function render() {
  return `
    <div class="page-header">
      <h2>Dashboard</h2>
      <p>ภาพรวมการอัปโหลดและสถานะระบบ</p>
    </div>
    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-icon">↑</div>
        <div class="stat-value" id="stat-total-uploads">0</div>
        <div class="stat-label">อัปโหลดทั้งหมด</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">GB</div>
        <div class="stat-value" id="stat-total-size">0 B</div>
        <div class="stat-label">ขนาดรวม</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">%</div>
        <div class="stat-value" id="stat-success-rate">0%</div>
        <div class="stat-label">อัตราสำเร็จ</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">24H</div>
        <div class="stat-value" id="stat-today">0</div>
        <div class="stat-label">อัปโหลดวันนี้</div>
      </div>
      <div class="stat-card stat-card-quota" id="quota-card">
        <div class="stat-icon">Q</div>
        <div class="stat-value" id="stat-quota-remaining">-</div>
        <div class="stat-label">คลิปที่อัปได้วันนี้</div>
      </div>
    </div>
    <div class="dashboard-sections">
      <div class="dashboard-section">
        <h3>7 วันย้อนหลัง</h3>
        <div id="chart-7days" class="chart-container"></div>
      </div>
      <div class="dashboard-section">
        <h3>การอัปโหลดตามชั่วโมง</h3>
        <div id="chart-hours" class="chart-container"></div>
      </div>
      <div class="dashboard-section">
        <h3>สถานะคิว</h3>
        <div id="dashboard-queue" class="queue-mini"></div>
      </div>
      <div class="dashboard-section">
        <h3>อัปโหลดล่าสุด</h3>
        <div id="dashboard-recent"></div>
      </div>
      <div class="dashboard-section" style="grid-column: 1 / -1;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3>กิจกรรมล่าสุด</h3>
          <a href="#/activity" class="dashboard-see-all">ดูทั้งหมด →</a>
        </div>
        <div id="dashboard-activity" class="activity-compact"></div>
      </div>
    </div>`;
}

export async function init() {
  try {
    const res = await fetch('/api/stats/dashboard');
    const data = await res.json();

    document.getElementById('stat-total-uploads').textContent = data.overview.totalUploads;
    document.getElementById('stat-total-size').textContent = data.overview.totalSizeFormatted;
    document.getElementById('stat-success-rate').textContent = data.overview.successRate + '%';
    document.getElementById('stat-today').textContent = data.today.uploads || 0;

    // ★ แสดง Quota Status
    if (data.quota) {
      renderQuotaCard(data.quota);
      // ★ แสดง warning ถ้า quota ใกล้หมด
      if (data.quota.status !== 'ok') {
        showQuotaWarning(data.quota);
      }
    }

    renderChart7Days(data.last7Days);
    renderChartHours(data.uploadsByHour);
    renderQueue(data.queue);
    renderRecent(data.recentUploads);
    renderRecentActivity();
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function renderQuotaCard(quota) {
  const card = document.getElementById('quota-card');
  const valueEl = document.getElementById('stat-quota-remaining');
  
  valueEl.textContent = quota.uploadsRemaining;
  
  // เปลี่ยนสีตามสถานะ
  card.className = 'stat-card stat-card-quota';
  if (quota.status === 'critical') {
    card.classList.add('quota-critical');
  } else if (quota.status === 'warning') {
    card.classList.add('quota-warning');
  } else {
    card.classList.add('quota-ok');
  }
  
  // แสดง tooltip/info
  const percent = quota.percentUsed.toFixed(0);
  card.title = `Quota: ${quota.used}/${quota.limit} (${percent}%)\nReset: ${new Date(quota.nextReset).toLocaleString('th-TH')}`;
}

function renderChart7Days(days) {
  const el = document.getElementById('chart-7days');
  if (!days || days.length === 0) { el.innerHTML = '<p class="empty-state small">ยังไม่มีข้อมูล</p>'; return; }
  const max = Math.max(...days.map(d => d.uploads), 1);
  el.innerHTML = `<div class="bar-chart">${days.map(d => {
    const h = Math.max((d.uploads / max) * 100, 4);
    return `<div class="bar-item"><div class="bar-value">${d.uploads}</div><div class="bar" style="height:${h}%"></div><div class="bar-label">${d.date.slice(5)}</div></div>`;
  }).join('')}</div>`;
}

function renderChartHours(hourData) {
  const el = document.getElementById('chart-hours');
  if (!hourData || Object.keys(hourData).length === 0) { el.innerHTML = '<p class="empty-state small">ยังไม่มีข้อมูล</p>'; return; }
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const max = Math.max(...hours.map(h => hourData[h] || 0), 1);
  el.innerHTML = `<div class="bar-chart bar-chart-hours">${hours.map(h => {
    const val = hourData[h] || 0;
    const height = Math.max((val / max) * 100, 2);
    return `<div class="bar-item mini"><div class="bar" style="height:${height}%" title="${h}:00 — ${val}"></div>${h % 6 === 0 ? `<div class="bar-label">${h}:00</div>` : ''}</div>`;
  }).join('')}</div>`;
}

function renderQueue(queue) {
  const el = document.getElementById('dashboard-queue');
  if (!queue || queue.total === 0) { el.innerHTML = '<p class="empty-state small">คิวว่าง</p>'; return; }
  el.innerHTML = `<div class="queue-summary">
    <span class="queue-badge pending">รอ ${queue.pending}</span>
    <span class="queue-badge processing">กำลังทำ ${queue.processing}</span>
    <span class="queue-badge done">เสร็จ ${queue.done}</span>
    <span class="queue-badge failed">ล้มเหลว ${queue.failed}</span>
  </div>`;
}

function renderRecent(items) {
  const el = document.getElementById('dashboard-recent');
  if (!items || items.length === 0) { el.innerHTML = '<p class="empty-state small">ยังไม่มีประวัติ</p>'; return; }
  el.innerHTML = items.map(item => `
    <div class="recent-item">
      <span class="recent-name">${window.app.escapeHtml(item.filename)}</span>
      <a href="${item.youtube_url}" target="_blank" class="recent-link">↗</a>
      <span class="recent-time">${window.app.timeAgo(item.uploaded_at)}</span>
    </div>`).join('');
}

async function renderRecentActivity() {
  const el = document.getElementById('dashboard-activity');
  try {
    const res = await fetch('/api/activity?limit=10');
    const data = await res.json();
    
    if (!data.activities || data.activities.length === 0) {
      el.innerHTML = '<p class="empty-state small">ยังไม่มีกิจกรรม</p>';
      return;
    }
    
    el.innerHTML = data.activities.map(activity => {
      const icon = getActivityIcon(activity.type, activity.level);
      const time = new Date(activity.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const levelClass = activity.level || 'info';
      
      return `
        <div class="activity-item activity-${levelClass}">
          <div class="activity-icon">${icon}</div>
          <div class="activity-content">
            <div class="activity-message">${window.app.escapeHtml(activity.message)}</div>
            <div class="activity-meta">
              <span class="activity-time">${time}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    el.innerHTML = '<p class="empty-state small">โหลดกิจกรรมล้มเหลว</p>';
  }
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

// ★ NEW: Show quota warning banner
let quotaWarningShown = false;
function showQuotaWarning(quota) {
  if (quotaWarningShown || window._dashboardQuotaWarningShown) return;
  quotaWarningShown = true;
  window._dashboardQuotaWarningShown = true;

  const banner = document.createElement('div');
  banner.className = 'quota-warning-banner';
  banner.style.cssText = `
    background: var(--bg-card);
    color: var(--text-primary);
    padding: 14px 16px;
    border-radius: var(--radius-md);
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--warning);
    box-shadow: var(--shadow-sm);
  `;

  const message = quota.status === 'critical'
    ? `Quota ไม่พอสำหรับอัปโหลดวันนี้`
    : `Quota ใกล้หมด (${quota.percentUsed.toFixed(0)}%) — อัปโหลดได้อีก ${quota.uploadsRemaining} คลิป`;

  banner.innerHTML = `
    <div style="width:32px;height:32px;border-radius:999px;display:grid;place-items:center;background:var(--warning-bg);color:var(--warning);font-weight:700;">Q</div>
    <div style="flex: 1;">
      <strong>${message}</strong>
      <div style="color:var(--text-muted); font-size: 0.88em; margin-top: 4px;">
        Reset เที่ยงคืน PST (${new Date(quota.nextReset).toLocaleString('th-TH')})
      </div>
    </div>
    <button onclick="window.showExtendedQuotaGuide()" style="
      background: var(--text-primary);
      color: white;
      border: 1px solid var(--text-primary);
      padding: 8px 14px;
      border-radius: var(--radius-md);
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    ">
      ขอ Extended Quota →
    </button>
    <button onclick="this.parentElement.remove(); window._dashboardQuotaWarningShown = false;" style="
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
      padding: 8px 12px;
      border-radius: var(--radius-md);
      cursor: pointer;
    ">×</button>
  `;

  const grid = document.querySelector('.dashboard-grid');
  grid.parentElement.insertBefore(banner, grid);
}

// ★ NEW: Show extended quota guide modal
window.showExtendedQuotaGuide = async function() {
  try {
    const res = await fetch('/api/quota/extended-guide');
    const guide = await res.json();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(17,24,39,0.45);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 20px;
    `;

    modal.innerHTML = `
      <div style="
        background: var(--bg-card);
        color: var(--text-primary);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        max-width: 700px;
        max-height: 90vh;
        overflow-y: auto;
        padding: 24px;
        box-shadow: var(--shadow-lg);
      ">
        <h2 style="margin-top: 0; font-size:1.1rem;">ขอ Extended Quota (1M units/day)</h2>
        
        <div style="background: var(--surface); padding: 14px; border-radius: var(--radius-md); margin: 16px 0; border:1px solid var(--border);">
          <div><strong>ปัจจุบัน:</strong> ${guide.currentLimit.toLocaleString()} units/day = ${guide.benefits.current}</div>
          <div><strong>หลังขอ:</strong> 1,000,000 units/day = ${guide.benefits.after}</div>
          ${guide.isExtended ? '<div style="color: var(--success); margin-top: 8px;">Extended Quota เปิดใช้งานแล้ว</div>' : ''}
        </div>

        <h3>ขั้นตอน</h3>
        <ol style="line-height: 1.8;">
          <li>${guide.guide.step1}</li>
          <li>${guide.guide.step2}</li>
          <li>${guide.guide.step3}</li>
          <li>${guide.guide.step4}</li>
          <li>${guide.guide.step5}</li>
          <li>
            <strong>เหตุผล (คัดลอกไปวางได้เลย):</strong>
            <textarea readonly style="
              width: 100%;
              height: 140px;
              margin-top: 8px;
              padding: 12px;
              background: white;
              border: 1px solid var(--border);
              border-radius: var(--radius-md);
              color: var(--text-primary);
              font-family: monospace;
              font-size: 13px;
              resize: vertical;
            ">${guide.guide.step6}</textarea>
          </li>
          <li>${guide.guide.step7}</li>
          <li>${guide.guide.step8}</li>
        </ol>

        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <a href="https://console.cloud.google.com" target="_blank" style="
            flex: 1;
            background: var(--text-primary);
            color: white;
            padding: 12px 24px;
            border-radius: var(--radius-md);
            text-decoration: none;
            text-align: center;
            font-weight: bold;
          ">
            เปิด Google Cloud Console →
          </a>
          <button onclick="this.closest('.modal-overlay').remove()" style="
            background: white;
            color: var(--text-secondary);
            border: 1px solid var(--border);
            padding: 12px 24px;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-weight: bold;
          ">
            ปิด
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (err) {
    alert('ไม่สามารถโหลดคำแนะนำได้: ' + err.message);
  }
};
