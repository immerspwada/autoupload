// Page: Settings (/settings)
export function render() {
  return `
    <div class="page-header">
      <h2>Settings</h2>
      <p class="section-desc">ตั้งค่าทั่วไป, Scheduler 24/7, และ quota</p>
    </div>

    <!-- ══ General Settings ══════════════════════════════════════ -->
    <form id="settings-form" class="settings-form card" style="margin-bottom:20px">
      <h3 style="margin:0 0 16px;font-size:15px;color:var(--text-primary)">⚙️ ตั้งค่าทั่วไป</h3>
      <div class="form-group">
        <label for="folder">โฟลเดอร์วิดีโอ (path เต็ม)</label>
        <input type="text" id="folder" name="folder" placeholder="/Users/you/Videos/youtube">
        <small>ระบุ path ของโฟลเดอร์ที่เก็บวิดีโอ (ถ้าใช้ folder mode)</small>
      </div>
      <div class="form-group">
        <label for="privacy">ระดับความเป็นส่วนตัว</label>
        <select id="privacy" name="privacy">
          <option value="public">สาธารณะ (Public)</option>
          <option value="unlisted">ไม่แสดงในรายการ (Unlisted)</option>
          <option value="private">ส่วนตัว (Private)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="deleteAfterUpload">
          ลบไฟล์หลังอัปโหลดสำเร็จ
        </label>
        <small>ไฟล์วิดีโอจะถูกลบหลังอัปโหลดขึ้น YouTube สำเร็จ</small>
      </div>
      <div class="form-group">
        <label for="defaultDescription">คำอธิบายเริ่มต้น</label>
        <textarea id="defaultDescription" rows="3" placeholder="คำอธิบายวิดีโอ..."></textarea>
      </div>
      <div class="form-group">
        <label for="defaultTags">แท็กเริ่มต้น (คั่นด้วยคอมม่า)</label>
        <input type="text" id="defaultTags" placeholder="vlog, thailand, daily">
      </div>
      <button type="submit" class="btn btn-primary">บันทึกการตั้งค่า</button>
    </form>

    <!-- ══ Scheduler (24/7 Auto-loop) ═══════════════════════════ -->
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <h3 style="margin:0;font-size:15px;color:var(--text-primary)">⏰ Scheduler — ทำงานเอง 24/7</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-muted)">
            สแกนโฟลเดอร์ตามรอบเวลา • ถ้า quota หมดรอจนถึงเที่ยงคืน PST แล้วเริ่มใหม่
          </p>
        </div>
        <label class="toggle-switch" title="เปิด/ปิด Scheduler">
          <input type="checkbox" id="scheduler-enabled">
          <span class="toggle-slider"></span>
        </label>
      </div>

      <!-- Quota pause banner (hidden by default) -->
      <div id="quota-pause-banner" class="quota-pause-banner" style="display:none">
        ⏸️ Quota หมดแล้ววันนี้ — Scheduler กำลังรอ quota reset
        <span id="quota-resume-at"></span>
      </div>

      <div class="scheduler-grid">
        <div class="form-group">
          <label for="scheduler-interval">สแกนทุก (นาที)</label>
          <input type="number" id="scheduler-interval" min="5" max="1440" value="30" style="width:120px">
          <small>แนะนำ 30–60 นาที</small>
        </div>
        <div class="form-group">
          <label>สถานะล่าสุด</label>
          <div id="scheduler-last-run" style="font-size:13px;color:var(--text-muted);padding:6px 0">—</div>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:4px;flex-wrap:wrap">
        <button class="btn btn-primary" id="scheduler-save-btn">บันทึก Scheduler</button>
        <button class="btn btn-secondary" id="scheduler-scan-btn">▶ สแกนตอนนี้</button>
      </div>
    </div>

    <!-- ══ Quota Status ══════════════════════════════════════════ -->
    <div class="card">
      <h3 style="margin:0 0 16px;font-size:15px;color:var(--text-primary)">📊 YouTube API Quota</h3>
      <div id="quota-detail" class="quota-detail-box">
        <span style="color:var(--text-muted)">กำลังโหลด...</span>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-secondary" id="quota-refresh-btn">🔄 รีเฟรช Quota</button>
        <button class="btn btn-secondary" id="quota-guide-btn">📖 Extended Quota Guide</button>
      </div>
      <div id="quota-guide-box" style="display:none;margin-top:16px" class="quota-guide-content"></div>
    </div>`;
}

export async function init() {
  // ── Load general settings ───────────────────────────────────
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    if (s.folder)              document.getElementById('folder').value = s.folder;
    if (s.privacy)             document.getElementById('privacy').value = s.privacy;
    if (s.deleteAfterUpload)   document.getElementById('deleteAfterUpload').checked = s.deleteAfterUpload === 'true' || s.deleteAfterUpload === true;
    if (s.defaultDescription)  document.getElementById('defaultDescription').value = s.defaultDescription;
    if (s.defaultTags)         document.getElementById('defaultTags').value = s.defaultTags;
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
    if (r.ok) window.app.showToast('บันทึกสำเร็จ!', 'success');
    else window.app.showToast('เกิดข้อผิดพลาด', 'error');
  });

  // ── Load scheduler config ────────────────────────────────────
  await loadSchedulerConfig();

  // Save scheduler
  document.getElementById('scheduler-save-btn').addEventListener('click', async () => {
    const enabled  = document.getElementById('scheduler-enabled').checked;
    const interval = parseInt(document.getElementById('scheduler-interval').value) || 30;
    const r = await fetch('/api/stats/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, intervalMinutes: interval })
    });
    if (r.ok) {
      window.app.showToast(enabled ? '✅ Scheduler เปิดแล้ว ทำงานเอง 24/7' : '⏹ Scheduler ปิดแล้ว', 'success');
      await loadSchedulerConfig();
    } else {
      window.app.showToast('เกิดข้อผิดพลาด', 'error');
    }
  });

  // Scan now
  document.getElementById('scheduler-scan-btn').addEventListener('click', async () => {
    const btn = document.getElementById('scheduler-scan-btn');
    btn.disabled = true; btn.textContent = '⏳ กำลังสแกน...';
    try {
      const r = await fetch('/api/stats/scheduler/scan', { method: 'POST' });
      const d = await r.json();
      window.app.showToast(`สแกนเสร็จ: พบ ${d.scanned} ไฟล์, เพิ่มคิว ${d.queued} ไฟล์`, 'success');
      await loadSchedulerConfig();
    } catch(e) {
      window.app.showToast('สแกนล้มเหลว', 'error');
    } finally {
      btn.disabled = false; btn.textContent = '▶ สแกนตอนนี้';
    }
  });

  // ── Load quota ───────────────────────────────────────────────
  await loadQuotaDetail();

  document.getElementById('quota-refresh-btn').addEventListener('click', loadQuotaDetail);

  document.getElementById('quota-guide-btn').addEventListener('click', async () => {
    const box = document.getElementById('quota-guide-box');
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    try {
      const r = await fetch('/api/quota/extended-guide');
      const d = await r.json();
      box.innerHTML = renderQuotaGuide(d);
      box.style.display = 'block';
    } catch(e) {
      box.innerHTML = '<p style="color:var(--text-muted)">โหลดไม่ได้</p>';
      box.style.display = 'block';
    }
  });
}

async function loadSchedulerConfig() {
  try {
    const r = await fetch('/api/stats/scheduler');
    const s = await r.json();

    document.getElementById('scheduler-enabled').checked = !!s.enabled;
    if (s.intervalMinutes) document.getElementById('scheduler-interval').value = s.intervalMinutes;

    // Last run
    const lrEl = document.getElementById('scheduler-last-run');
    if (s.lastRun) {
      lrEl.textContent = `สแกนล่าสุด: ${window.app.timeAgo(s.lastRun)}`;
    } else {
      lrEl.textContent = s.enabled ? 'เปิดอยู่ — ยังไม่ได้สแกน' : 'ปิดอยู่';
    }

    // Quota-pause banner
    const banner = document.getElementById('quota-pause-banner');
    if (s.quotaPaused) {
      banner.style.display = 'flex';
      if (s.quotaResumeAt) {
        const resumeTime = new Date(s.quotaResumeAt).toLocaleString('th-TH', {
          timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
        });
        document.getElementById('quota-resume-at').textContent = ` — จะเริ่มใหม่ ${resumeTime}`;
      }
    } else {
      banner.style.display = 'none';
    }
  } catch(e) {}
}

async function loadQuotaDetail() {
  const box = document.getElementById('quota-detail');
  try {
    const r = await fetch('/api/quota/status');
    const q = await r.json();
    const pct = q.percentUsed || 0;
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
    const barWidth = Math.min(100, pct);

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:13px">ใช้ไป ${q.used?.toLocaleString()} / ${q.limit?.toLocaleString()} units (${pct.toFixed(1)}%)</span>
        <span style="font-size:13px;color:${color};font-weight:600">เหลือ ${q.uploadsRemaining} uploads</span>
      </div>
      <div style="background:var(--bg-tertiary);border-radius:6px;height:8px;overflow:hidden">
        <div style="width:${barWidth}%;height:100%;background:${color};border-radius:6px;transition:width 0.3s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:var(--text-muted)">
        <span>📅 วันที่ ${q.date}</span>
        <span>🔄 Reset: ${q.nextReset ? new Date(q.nextReset).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}) : '—'}</span>
      </div>
      ${q.status === 'critical' ? `<div class="quota-warning-msg">🚨 Quota วิกฤต! ระบบจะรอ reset แล้วเริ่มใหม่เอง</div>` : ''}
      ${q.status === 'warning'  ? `<div class="quota-warning-msg" style="background:rgba(245,158,11,0.1);border-color:#f59e0b;color:#f59e0b">⚠️ Quota ใกล้หมด — ระบบใช้ smart filter อัปเฉพาะคลิปดี</div>` : ''}`;
  } catch(e) {
    box.innerHTML = '<span style="color:var(--text-muted)">โหลด quota ไม่ได้</span>';
  }
}

function renderQuotaGuide(d) {
  const steps = Object.entries(d.guide || {})
    .map(([k, v]) => `<li>${v}</li>`).join('');
  return `
    <div style="background:var(--bg-tertiary);border-radius:8px;padding:16px">
      <h4 style="margin:0 0 12px;color:var(--accent)">📖 วิธีขอ Extended Quota</h4>
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px">
        ปัจจุบัน: <strong>${d.currentLimit?.toLocaleString()} units/day (${d.benefits?.current})</strong>
        → หลังขอ: <strong>${d.benefits?.after}</strong>
      </p>
      <ol style="font-size:13px;margin:0 0 12px;padding-left:18px;line-height:1.8">${steps}</ol>
    </div>`;
}
