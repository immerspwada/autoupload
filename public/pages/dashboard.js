// Page: Dashboard (/dashboard)
export function render() {
  return `
    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-icon">📤</div>
        <div class="stat-value" id="stat-total-uploads">0</div>
        <div class="stat-label">อัปโหลดทั้งหมด</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">💾</div>
        <div class="stat-value" id="stat-total-size">0 B</div>
        <div class="stat-label">ขนาดรวม</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✅</div>
        <div class="stat-value" id="stat-success-rate">0%</div>
        <div class="stat-label">อัตราสำเร็จ</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📅</div>
        <div class="stat-value" id="stat-today">0</div>
        <div class="stat-label">อัปโหลดวันนี้</div>
      </div>
    </div>
    <div class="dashboard-sections">
      <div class="dashboard-section">
        <h3>📈 กราฟ 7 วันย้อนหลัง</h3>
        <div id="chart-7days" class="chart-container"></div>
      </div>
      <div class="dashboard-section">
        <h3>🕐 การอัปโหลดตามชั่วโมง</h3>
        <div id="chart-hours" class="chart-container"></div>
      </div>
      <div class="dashboard-section">
        <h3>🔄 สถานะคิว</h3>
        <div id="dashboard-queue" class="queue-mini"></div>
      </div>
      <div class="dashboard-section">
        <h3>📋 อัปโหลดล่าสุด</h3>
        <div id="dashboard-recent"></div>
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

    renderChart7Days(data.last7Days);
    renderChartHours(data.uploadsByHour);
    renderQueue(data.queue);
    renderRecent(data.recentUploads);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
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
    <span class="queue-badge pending">⏳ ${queue.pending}</span>
    <span class="queue-badge processing">⚡ ${queue.processing}</span>
    <span class="queue-badge done">✅ ${queue.done}</span>
    <span class="queue-badge failed">❌ ${queue.failed}</span>
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
