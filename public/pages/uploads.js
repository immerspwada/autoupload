// Page: Upload History (/uploads)
// แสดงประวัติการอัปโหลดทั้งหมด พร้อม YouTube stats feedback loop

export function render() {
  return `
    <div class="uploads-page">
      <div class="page-header">
        <h2>📊 Upload History & Analytics</h2>
        <p>ประวัติวิดีโอที่อัปโหลดทั้งหมด พร้อมยอด views จริงจาก YouTube เพื่อ feedback loop การเลือกคลิป</p>
      </div>

      <!-- Summary Cards -->
      <div id="analytics-summary" class="analytics-summary-row">
        <div class="analytics-card"><span class="analytics-value" id="as-videos">—</span><span class="analytics-label">วิดีโอทั้งหมด</span></div>
        <div class="analytics-card success"><span class="analytics-value" id="as-views">—</span><span class="analytics-label">Views รวม</span></div>
        <div class="analytics-card"><span class="analytics-value" id="as-watchtime">—</span><span class="analytics-label">Watch Time (ชม.)</span></div>
        <div class="analytics-card revenue"><span class="analytics-value" id="as-revenue">—</span><span class="analytics-label">รายได้ประมาณ ($)</span></div>
        <div class="analytics-card"><span class="analytics-value" id="as-accuracy">—</span><span class="analytics-label">Virality Accuracy</span></div>
      </div>

      <!-- Controls -->
      <div class="uploads-controls">
        <div class="uploads-filters">
          <select id="uh-source" class="sort-select">
            <option value="">ทุก source</option>
            <option value="tiktok">TikTok เท่านั้น</option>
            <option value="local">Upload โดยตรง</option>
          </select>
          <select id="uh-days" class="sort-select">
            <option value="7">7 วันล่าสุด</option>
            <option value="30" selected>30 วันล่าสุด</option>
            <option value="90">90 วันล่าสุด</option>
          </select>
          <label class="filter-chip">
            <input type="checkbox" id="uh-analytics-only">
            <span>แสดงเฉพาะที่มี analytics</span>
          </label>
        </div>
        <div class="uploads-actions">
          <button class="btn btn-secondary btn-sm" id="btn-uh-refresh">🔄 รีเฟรช Analytics</button>
        </div>
      </div>

      <!-- Analytics availability banner -->
      <div id="uh-analytics-banner" class="analytics-banner" style="display:none;"></div>

      <!-- Video List -->
      <div id="uh-loading" class="loading-state" style="display:none;"><div class="spinner"></div><p>กำลังโหลด analytics...</p></div>
      <div id="uh-video-list" class="uh-video-list">
        <p class="empty-state">กำลังโหลด...</p>
      </div>

      <!-- Pagination -->
      <div id="uh-pagination" class="uh-pagination" style="display:none;"></div>
    </div>`;
}

let _analyticsData = null;
let _historyData = null;
let _analyticsOnlyFilter = false;

export async function init() {
  document.getElementById('btn-uh-refresh').addEventListener('click', () => loadAll(true));
  document.getElementById('uh-source').addEventListener('change', () => loadHistory());
  document.getElementById('uh-days').addEventListener('change', () => loadAll(true));
  document.getElementById('uh-analytics-only').addEventListener('change', e => {
    _analyticsOnlyFilter = e.target.checked;
    renderList();
  });

  await loadAll(false);
}

async function loadAll(forceRefresh = false) {
  const btn = document.getElementById('btn-uh-refresh');
  btn.disabled = true;
  btn.textContent = '⏳ กำลังโหลด...';

  try {
    await Promise.all([loadAnalytics(), loadHistory()]);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 รีเฟรช Analytics';
  }
}

async function loadAnalytics() {
  const days = document.getElementById('uh-days')?.value || '30';
  try {
    const res = await fetch(`/api/analytics/summary?days=${days}`);
    if (!res.ok) {
      if (res.status === 401) {
        showAnalyticsBanner('warning', '⚠️ ยังไม่ได้เชื่อมต่อ YouTube — analytics ไม่พร้อมใช้งาน กด Login ก่อน');
        return;
      }
      throw new Error(await res.text());
    }
    const data = await res.json();
    _analyticsData = data;

    // Update summary cards
    const s = data.summary;
    setCard('as-videos', s.videos);
    setCard('as-views', fmtNum(s.views));
    setCard('as-watchtime', s.estimatedMinutesWatched > 0 ? Math.round(s.estimatedMinutesWatched / 60).toLocaleString() : '—');
    setCard('as-revenue', s.estimatedRevenue != null ? `$${s.estimatedRevenue.toFixed(2)}` : '—');

    // Virality accuracy: วัดว่า predicted score ตรงกับ actual performance แค่ไหน
    const accuracy = computeAccuracy(data.videos);
    setCard('as-accuracy', accuracy != null ? `${accuracy}%` : '—');

    if (!s.analyticsAvailable) {
      showAnalyticsBanner('info',
        '📊 YouTube Analytics API ไม่พร้อมใช้งาน (ต้องเพิ่ม scope <code>https://www.googleapis.com/auth/yt-analytics.readonly</code> และ re-login) — แสดงเฉพาะ views/likes จาก Data API');
    } else {
      hideAnalyticsBanner();
    }

    renderList();
  } catch (err) {
    showAnalyticsBanner('error', `❌ โหลด analytics ล้มเหลว: ${err.message}`);
  }
}

async function loadHistory() {
  const source = document.getElementById('uh-source')?.value || '';
  const url = `/api/analytics/upload-history?limit=200${source ? `&source=${source}` : ''}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    _historyData = data;
    renderList();
  } catch (err) {
    document.getElementById('uh-video-list').innerHTML =
      `<p class="empty-state">โหลดประวัติล้มเหลว: ${err.message}</p>`;
  }
}

function renderList() {
  const el = document.getElementById('uh-video-list');
  if (!_historyData) { el.innerHTML = '<p class="empty-state">กำลังโหลด...</p>'; return; }

  const items = _historyData.items || [];
  if (items.length === 0) {
    el.innerHTML = '<p class="empty-state">ยังไม่มีประวัติการอัปโหลด</p>';
    return;
  }

  // Build analytics lookup from _analyticsData
  const analyticsMap = {};
  if (_analyticsData?.videos) {
    for (const v of _analyticsData.videos) {
      analyticsMap[v.videoId] = v;
    }
  }

  let rendered = items;
  if (_analyticsOnlyFilter) {
    rendered = items.filter(item => analyticsMap[item.youtube_id]?.views > 0);
  }

  if (rendered.length === 0) {
    el.innerHTML = '<p class="empty-state">ไม่มีวิดีโอที่ตรงเงื่อนไข</p>';
    return;
  }

  el.innerHTML = rendered.map(item => {
    const analytics = analyticsMap[item.youtube_id] || {};
    const views = analytics.views ?? 0;
    const watchMin = analytics.watchMinutes;
    const revenue = analytics.estimatedRevenue;
    const scoreDelta = analytics.scoreDelta;
    const predicted = analytics.predictedViralityScore;
    const actual = analytics.actualPerformanceScore;

    const sourceLabel = item.source === 'tiktok'
      ? `<span class="badge badge-tiktok">TikTok</span>`
      : `<span class="badge badge-local">Upload</span>`;

    const deltaClass = scoreDelta == null ? '' : scoreDelta >= 0 ? 'delta-positive' : 'delta-negative';
    const deltaText = scoreDelta != null
      ? `<span class="score-delta ${deltaClass}" title="Virality score ที่ทำนาย vs actual">${scoreDelta >= 0 ? '+' : ''}${scoreDelta}</span>`
      : '';

    const thumbnail = analytics.thumbnail
      ? `<img src="${window.app.escapeHtml(analytics.thumbnail)}" loading="lazy" class="uh-thumb-img">`
      : `<div class="uh-thumb-placeholder">🎬</div>`;

    const revenueText = revenue != null
      ? `<span class="uh-revenue">$${revenue.toFixed(4)}</span>`
      : '';

    return `
      <div class="uh-video-item">
        <div class="uh-thumb">
          ${thumbnail}
          ${sourceLabel}
        </div>
        <div class="uh-info">
          <div class="uh-title">
            <a href="https://www.youtube.com/watch?v=${window.app.escapeHtml(item.youtube_id)}"
               target="_blank" rel="noopener">
              ${window.app.escapeHtml(item.title || item.filename || '(ไม่มีชื่อ)')}
            </a>
          </div>
          <div class="uh-meta">
            <span>📅 ${fmtDate(item.uploaded_at)}</span>
            ${item.source_url ? `<a href="${window.app.escapeHtml(item.source_url)}" target="_blank" rel="noopener" class="uh-source-link" title="ดูต้นทาง TikTok">🔗 ต้นทาง</a>` : ''}
          </div>
          <div class="uh-stats">
            <span class="uh-stat-pill views">👁 ${fmtNum(views)} views</span>
            ${watchMin != null ? `<span class="uh-stat-pill">⏱ ${Math.round(watchMin)} นาที</span>` : ''}
            ${revenueText}
            ${predicted != null ? `<span class="uh-stat-pill" title="Predicted virality score">🎯 Pred: ${predicted}</span>` : ''}
            ${actual != null ? `<span class="uh-stat-pill" title="Actual performance score">📈 Actual: ${actual} ${deltaText}</span>` : ''}
          </div>
        </div>
        <div class="uh-actions">
          <a href="https://www.youtube.com/watch?v=${window.app.escapeHtml(item.youtube_id)}"
             target="_blank" rel="noopener" class="btn btn-secondary btn-sm">YouTube</a>
        </div>
      </div>`;
  }).join('');
}

function computeAccuracy(videos) {
  if (!videos || videos.length === 0) return null;
  const scored = videos.filter(v => v.scoreDelta != null);
  if (scored.length < 3) return null; // ไม่พอ sample
  // accuracy = % ที่ predicted direction ถูก (ทำนายสูง = actual สูง)
  const correct = scored.filter(v => {
    const p = v.predictedViralityScore;
    const a = v.actualPerformanceScore;
    const median = 50;
    return (p >= median && a >= median) || (p < median && a < median);
  }).length;
  return Math.round((correct / scored.length) * 100);
}

function setCard(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

function showAnalyticsBanner(level, html) {
  const el = document.getElementById('uh-analytics-banner');
  if (!el) return;
  el.style.display = 'block';
  el.className = `analytics-banner analytics-banner-${level}`;
  el.innerHTML = html;
}

function hideAnalyticsBanner() {
  const el = document.getElementById('uh-analytics-banner');
  if (el) el.style.display = 'none';
}
