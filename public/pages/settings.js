// Page: Settings (/settings)
export function render() {
  return `
    <div class="settings-page">
      <div class="page-header">
        <h2>Settings</h2>
        <p>ตั้งค่าทั่วไป, Scheduler 24/7, และ YouTube quota</p>
      </div>

      <!-- General Settings -->
      <div class="card settings-card">
        <div class="card-header">
          <h3>General</h3>
        </div>
        <div class="card-body">
          <form id="settings-form">
            <div class="settings-row">
              <div class="form-group">
                <label for="folder">Watch Folder</label>
                <input type="text" id="folder" name="folder" placeholder="/Users/you/Videos/youtube">
                <small>Path โฟลเดอร์ที่ระบบจะสแกนหาวิดีโอใหม่</small>
              </div>
              <div class="form-group" style="max-width:200px">
                <label for="privacy">Privacy</label>
                <select id="privacy" name="privacy">
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label for="defaultDescription">Default Description</label>
              <textarea id="defaultDescription" rows="2" placeholder="คำอธิบายเริ่มต้นสำหรับทุกวิดีโอ..."></textarea>
            </div>
            <div class="form-group">
              <label for="defaultTags">Default Tags</label>
              <input type="text" id="defaultTags" placeholder="vlog, thailand, daily">
              <small>คั่นด้วยคอมม่า</small>
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="deleteAfterUpload">
                <span>ลบไฟล์หลังอัปโหลดสำเร็จ</span>
              </label>
            </div>
            <button type="submit" class="btn btn-primary">บันทึก</button>
          </form>
        </div>
      </div>

      <!-- Scheduler -->
      <div class="card settings-card">
        <div class="card-header">
          <div>
            <h3>Scheduler</h3>
            <p class="card-subtitle">สแกนโฟลเดอร์ตามรอบเวลา — ถ้า quota หมดรอถึงเที่ยงคืน PST แล้วเริ่มใหม่เอง</p>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="scheduler-enabled">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="card-body">
          <div id="quota-pause-banner" class="quota-pause-banner" style="display:none">
            Quota หมดแล้ววันนี้ — กำลังรอ reset
            <span id="quota-resume-at"></span>
          </div>
          <div class="settings-row">
            <div class="form-group">
              <label for="scheduler-interval">สแกนทุก (นาที)</label>
              <input type="number" id="scheduler-interval" min="5" max="1440" value="30" style="width:100px">
              <small>แนะนำ 30–60 นาที</small>
            </div>
            <div class="form-group">
              <label>สถานะล่าสุด</label>
              <div id="scheduler-last-run" class="settings-status-text">—</div>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" id="scheduler-save-btn">บันทึก</button>
            <button class="btn btn-secondary" id="scheduler-scan-btn">สแกนตอนนี้</button>
          </div>
        </div>
      </div>

      <!-- Quota -->
      <div class="card settings-card">
        <div class="card-header">
          <h3>YouTube API Quota</h3>
          <div class="btn-row">
            <button class="btn btn-secondary btn-sm" id="quota-refresh-btn">รีเฟรช</button>
            <button class="btn btn-secondary btn-sm" id="quota-guide-btn">ขอ Extended Quota</button>
          </div>
        </div>
        <div class="card-body">
          <div id="quota-detail">
            <p class="section-desc">กำลังโหลด...</p>
          </div>
          <div id="quota-guide-box" style="display:none;margin-top:16px"></div>
        </div>
      </div>

      <!-- Export / Share -->
      <div class="card settings-card">
        <div class="card-header">
          <h3>Export / Share Config</h3>
        </div>
        <div class="card-body">
          <p class="section-desc" style="margin-bottom:14px">
            Export settings, keywords, scheduler config เป็น JSON — แล้ว Import ใน instance ใหม่ได้ทันที<br>
            (ไม่รวม OAuth token และ client secret — ต้อง login ใหม่ทุก instance)
          </p>
          <div class="btn-row">
            <button class="btn btn-secondary" id="btn-export-config">Download config.json</button>
            <button class="btn btn-secondary" onclick="window.app.navigate('/setup')">Setup Wizard</button>
          </div>
        </div>
      </div>
    </div>`;
}

export async function init() {
  // General settings
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    if (s.folder)             document.getElementById('folder').value = s.folder;
    if (s.privacy)            document.getElementById('privacy').value = s.privacy;
    if (s.deleteAfterUpload)  document.getElementById('deleteAfterUpload').checked = s.deleteAfterUpload === 'true' || s.deleteAfterUpload === true;
    if (s.defaultDescription) document.getElementById('defaultDescription').value = s.defaultDescription;
    if (s.defaultTags)        document.getElementById('defaultTags').value = s.defaultTags;
  } catch(e) {}

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      folder:             document.getElementById('folder').value,
      privacy:            document.getElementById('privacy').value,
      deleteAfterUpload:  document.getElementById('deleteAfterUpload').checked,
      defaultDescription: document.getElementById('defaultDescription').value,
      defaultTags:        document.getElementById('defaultTags').value
    };
    const r = await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
    window.app.showToast(r.ok ? 'บันทึกสำเร็จ' : 'เกิดข้อผิดพลาด', r.ok ? 'success' : 'error');
  });

  // Scheduler
  await loadSchedulerConfig();

  document.getElementById('scheduler-save-btn').addEventListener('click', async () => {
    const enabled  = document.getElementById('scheduler-enabled').checked;
    const interval = parseInt(document.getElementById('scheduler-interval').value) || 30;
    const r = await fetch('/api/stats/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, intervalMinutes: interval })
    });
    if (r.ok) {
      window.app.showToast(enabled ? 'Scheduler เปิดแล้ว — ทำงาน 24/7' : 'Scheduler ปิดแล้ว', 'success');
      await loadSchedulerConfig();
    } else {
      window.app.showToast('เกิดข้อผิดพลาด', 'error');
    }
  });

  document.getElementById('scheduler-scan-btn').addEventListener('click', async () => {
    const btn = document.getElementById('scheduler-scan-btn');
    btn.disabled = true; btn.textContent = 'กำลังสแกน...';
    try {
      const r = await fetch('/api/stats/scheduler/scan', { method: 'POST' });
      const d = await r.json();
      window.app.showToast(`พบ ${d.scanned} ไฟล์, เพิ่มคิว ${d.queued} ไฟล์`, 'success');
      await loadSchedulerConfig();
    } catch(e) {
      window.app.showToast('สแกนล้มเหลว', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'สแกนตอนนี้';
    }
  });

  // Quota
  await loadQuotaDetail();
  document.getElementById('quota-refresh-btn').addEventListener('click', loadQuotaDetail);
  document.getElementById('quota-guide-btn').addEventListener('click', async () => {
    const box = document.getElementById('quota-guide-box');
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    try {
      const d = await (await fetch('/api/quota/extended-guide')).json();
      box.innerHTML = renderQuotaGuide(d);
      box.style.display = 'block';
    } catch(e) {
      box.innerHTML = '<p class="section-desc">โหลดไม่ได้</p>';
      box.style.display = 'block';
    }
  });

  // Export config
  document.getElementById('btn-export-config').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/setup/export');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'autoupload-config.json'; a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      window.app.showToast('Export ล้มเหลว', 'error');
    }
  });
}

async function loadSchedulerConfig() {
  try {
    const r = await fetch('/api/stats/scheduler');
    const s = await r.json();

    document.getElementById('scheduler-enabled').checked = !!s.enabled;
    if (s.intervalMinutes) document.getElementById('scheduler-interval').value = s.intervalMinutes;

    const lrEl = document.getElementById('scheduler-last-run');
    lrEl.textContent = s.lastRun
      ? `สแกนล่าสุด ${window.app.timeAgo(s.lastRun)}`
      : s.enabled ? 'เปิดอยู่ — ยังไม่ได้สแกน' : 'ปิดอยู่';

    const banner = document.getElementById('quota-pause-banner');
    if (s.quotaPaused) {
      banner.style.display = 'flex';
      if (s.quotaResumeAt) {
        const t = new Date(s.quotaResumeAt).toLocaleString('th-TH', {
          timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit', day:'numeric', month:'short'
        });
        document.getElementById('quota-resume-at').textContent = ` — จะเริ่มใหม่ ${t}`;
      }
    } else {
      banner.style.display = 'none';
    }
  } catch(e) {}
}

async function loadQuotaDetail() {
  const box = document.getElementById('quota-detail');
  try {
    const q = await (await fetch('/api/quota/status')).json();
    const pct     = q.percentUsed || 0;
    const barPct  = Math.min(100, pct);
    const barColor = pct >= 90 ? 'var(--error)' : pct >= 70 ? 'var(--warning)' : 'var(--success)';
    const resetStr = q.nextReset
      ? new Date(q.nextReset).toLocaleString('th-TH', { timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit' })
      : '—';

    box.innerHTML = `
      <div class="quota-bar-header">
        <span>${(q.used||0).toLocaleString()} / ${(q.limit||10000).toLocaleString()} units</span>
        <span class="quota-remaining-label" style="color:${barColor}">${q.uploadsRemaining ?? 0} uploads เหลือ</span>
      </div>
      <div class="quota-track">
        <div class="quota-track-fill" style="width:${barPct}%;background:${barColor}"></div>
      </div>
      <div class="quota-meta">
        <span>${pct.toFixed(1)}% ใช้แล้ว</span>
        <span>Reset ${resetStr} น.</span>
        <span>วันที่ ${q.date || '—'}</span>
      </div>
      ${q.status === 'critical' ? `<div class="quota-alert quota-alert-error">Quota วิกฤต — ระบบจะหยุดรอ reset แล้วเริ่มเองอัตโนมัติ</div>` : ''}
      ${q.status === 'warning'  ? `<div class="quota-alert quota-alert-warn">Quota ใกล้หมด — ระบบใช้ smart filter อัปเฉพาะคลิปคะแนนสูง</div>` : ''}`;
  } catch(e) {
    box.innerHTML = '<p class="section-desc">โหลด quota ไม่ได้</p>';
  }
}

function renderQuotaGuide(d) {
  const steps = Object.values(d.guide || {}).map(v => `<li>${v}</li>`).join('');
  return `
    <div class="quota-guide-panel">
      <h4>วิธีขอ Extended Quota (1M units/day)</h4>
      <p class="section-desc" style="margin-bottom:12px">
        ปัจจุบัน: <strong>${(d.currentLimit||0).toLocaleString()} units/day (${d.benefits?.current})</strong>
        → หลังขอ: <strong>${d.benefits?.after}</strong>
      </p>
      <ol class="howto-list">${steps}</ol>
    </div>`;
}
