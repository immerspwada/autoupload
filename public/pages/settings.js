// Page: Settings (/settings)
function applyTheme(theme) {
  document.body.classList.remove('theme-minimal-modern', 'theme-dark-pro', 'theme-youtube-brand');
  if (theme !== 'dark-pro') {
    document.body.classList.add(`theme-${theme}`);
  }
}

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
          <!-- Theme Switcher -->
          <div class="form-group">
            <label>Theme</label>
            <div class="theme-selector">
              <button type="button" class="theme-btn" data-theme="minimal-modern">
                <div class="theme-preview" style="background: linear-gradient(135deg, #f8fafc, #e2e8f0);"></div>
                <span>Minimal Modern</span>
              </button>
              <button type="button" class="theme-btn" data-theme="dark-pro">
                <div class="theme-preview" style="background: linear-gradient(135deg, #020617, #111827);"></div>
                <span>Dark Pro</span>
              </button>
              <button type="button" class="theme-btn" data-theme="youtube-brand">
                <div class="theme-preview" style="background: linear-gradient(135deg, #ff000015, #ff000025);"></div>
                <span>YouTube Brand</span>
              </button>
            </div>
          </div>

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

            <!-- ★ Channel Stage — กำหนดกลยุทธ์การเลือกคลิป -->
            <div class="form-group">
              <label for="channelStage">ระยะของช่อง (กลยุทธ์การเลือกคลิป)</label>
              <select id="channelStage" name="channelStage">
                <option value="early_stage">🌱 เริ่มต้น — เน้นผู้ติดตาม + Watch Time (ยังไม่ถึง 1,000 subs)</option>
                <option value="pre_ypp">📈 รอ YPP — เน้น Watch Hours สะสม (1,000 subs แล้ว รอ 4,000 ชม.)</option>
                <option value="monetized">💰 Monetized — เน้นรายได้โฆษณา (ผ่าน YPP แล้ว)</option>
              </select>
              <small>
                ระบบจะปรับ scoring model ให้เหมาะกับระยะของช่อง<br>
                🌱 <strong>เริ่มต้น</strong>: เลือกคลิป tutorial/howto/storytelling ที่มีโอกาสสร้าง subscriber สูง<br>
                📈 <strong>รอ YPP</strong>: เลือกคลิปยาว ≥60s ที่ engagement ดี สะสม watch hours เร็ว<br>
                💰 <strong>Monetized</strong>: เลือกคลิปที่มีโอกาส RPM สูง (tech, finance, howto)
              </small>
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

      <!-- Video Transform (ป้องกัน Reused Content) -->
      <div class="card settings-card">
        <div class="card-header">
          <div>
            <h3>🎬 Video Transform</h3>
            <p class="card-subtitle">แปลงวิดีโอก่อนอัป — ป้องกัน "Reused Content" demonetize</p>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="vt-enabled" checked>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="card-body" id="vt-settings-body">
          <div id="vt-ffmpeg-status" class="section-desc" style="margin-bottom:12px;">
            กำลังเช็ค ffmpeg...
          </div>

          <div class="settings-row">
            <div class="form-group">
              <label for="vt-mode">Transform Mode</label>
              <select id="vt-mode">
                <option value="minimal">Minimal — zoom + color เล็กน้อย (เร็ว)</option>
                <option value="standard" selected>Standard — overlay + watermark + visual</option>
                <option value="full">Full — intro + outro + overlay + watermark</option>
              </select>
              <small>Standard แนะนำ: เพิ่ม uniqueness โดยไม่ใช้เวลาแปลงนาน</small>
            </div>
          </div>

          <div class="settings-row">
            <div class="form-group">
              <label for="vt-channel-name">Channel Name (สำหรับ Watermark)</label>
              <input type="text" id="vt-channel-name" placeholder="ชื่อช่อง YouTube ของคุณ">
              <small>แสดงเป็น watermark มุมขวาล่าง</small>
            </div>
            <div class="form-group" style="max-width:160px">
              <label for="vt-resolution">Output Resolution</label>
              <select id="vt-resolution">
                <option value="720p">720p</option>
                <option value="1080p" selected>1080p</option>
              </select>
            </div>
          </div>

          <div class="settings-row">
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="vt-overlay" checked>
                <span>แสดงชื่อเรื่องบนวิดีโอ (5 วิแรก)</span>
              </label>
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="vt-watermark" checked>
                <span>Watermark ชื่อช่อง</span>
              </label>
            </div>
          </div>

          <div class="settings-row">
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="vt-visual" checked>
                <span>Visual Transform (zoom/color — anti-fingerprint)</span>
              </label>
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="vt-mirror">
                <span>Mirror (พลิกซ้ายขวา — ตรวจจับยากมาก)</span>
              </label>
            </div>
          </div>

          <div class="btn-row">
            <button class="btn btn-primary" id="vt-save-btn">บันทึก</button>
          </div>
          <div id="vt-stats" class="section-desc" style="margin-top:10px;"></div>
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
    </div>`;
}

export async function init() {
  // Theme handling
  const savedTheme = localStorage.getItem('theme') || 'dark-pro';
  applyTheme(savedTheme);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === savedTheme);
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      localStorage.setItem('theme', btn.dataset.theme);
      window.app.showToast('Theme updated!', 'success');
    });
  });

  // General settings
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    if (s.folder)             document.getElementById('folder').value = s.folder;
    if (s.privacy)            document.getElementById('privacy').value = s.privacy;
    if (s.deleteAfterUpload)  document.getElementById('deleteAfterUpload').checked = s.deleteAfterUpload === 'true' || s.deleteAfterUpload === true;
    if (s.defaultDescription) document.getElementById('defaultDescription').value = s.defaultDescription;
    if (s.defaultTags)        document.getElementById('defaultTags').value = s.defaultTags;
    document.getElementById('channelStage').value = s.channelStage || 'early_stage';
  } catch(e) {
    console.warn('Settings load failed:', e.message);
  }

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      folder:             document.getElementById('folder').value,
      privacy:            document.getElementById('privacy').value,
      deleteAfterUpload:  document.getElementById('deleteAfterUpload').checked,
      defaultDescription: document.getElementById('defaultDescription').value,
      defaultTags:        document.getElementById('defaultTags').value,
      channelStage:       document.getElementById('channelStage').value
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

  // ★ Video Transform settings
  await initVideoTransformSettings();

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
  } catch(e) {
    console.warn('Scheduler config load failed:', e.message);
  }
}

async function loadQuotaDetail() {
  const box = document.getElementById('quota-detail');
  try {
    const q = await (await fetch('/api/quota/status')).json();
    const pct    = q.percentUsed || 0;
    const barPct = Math.min(100, pct);
    const tier   = pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : 'ok';
    const resetStr = q.nextReset
      ? new Date(q.nextReset).toLocaleString('th-TH', { timeZone:'Asia/Bangkok', hour:'2-digit', minute:'2-digit' })
      : '—';

    box.innerHTML = `
      <div class="quota-bar-header">
        <span>${(q.used||0).toLocaleString()} / ${(q.limit||10000).toLocaleString()} units</span>
        <span class="quota-remaining-label quota-tier-${tier}">${q.uploadsRemaining ?? 0} uploads เหลือ</span>
      </div>
      <div class="quota-track">
        <div class="quota-track-fill quota-tier-${tier}" style="width:${barPct}%"></div>
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

// ═══════════════════════════════════════════════════════════════════
// Video Transform Settings
// ═══════════════════════════════════════════════════════════════════

async function initVideoTransformSettings() {
  const statusEl = document.getElementById('vt-ffmpeg-status');
  
  try {
    // Load current status + config
    const res = await fetch('/api/transform/status');
    const data = await res.json();
    
    // Show ffmpeg status
    if (data.ffmpeg?.available) {
      statusEl.innerHTML = `<span style="color:var(--success)">✓ ffmpeg พร้อมใช้งาน</span> — ` +
        `${data.stats.processed} วิดีโอแปลงแล้ว` +
        (data.stats.avgProcessingTime ? ` (เฉลี่ย ${(data.stats.avgProcessingTime/1000).toFixed(1)}s)` : '');
    } else {
      statusEl.innerHTML = `<span style="color:var(--error)">✗ ffmpeg ไม่พร้อม</span> — ${data.ffmpeg?.error || 'ติดตั้ง ffmpeg ก่อนใช้งาน'}`;
    }

    // Load full config
    const configRes = await fetch('/api/transform/config');
    const config = await configRes.json();
    
    // Set UI values
    document.getElementById('vt-enabled').checked = config.enabled !== false;
    document.getElementById('vt-mode').value = config.mode || 'standard';
    document.getElementById('vt-channel-name').value = config.watermark?.text || '';
    document.getElementById('vt-resolution').value = config.output?.resolution || '1080p';
    document.getElementById('vt-overlay').checked = config.overlay?.enabled !== false;
    document.getElementById('vt-watermark').checked = config.watermark?.enabled !== false;
    document.getElementById('vt-visual').checked = config.visual?.enabled !== false;
    document.getElementById('vt-mirror').checked = config.visual?.mirror || false;
    
  } catch (e) {
    statusEl.innerHTML = '<span style="color:var(--warning)">⚠ ไม่สามารถเช็คสถานะ transform ได้</span>';
    console.warn('VT status load failed:', e.message);
  }

  // Save handler
  document.getElementById('vt-save-btn').addEventListener('click', async () => {
    const mode = document.getElementById('vt-mode').value;
    const channelName = document.getElementById('vt-channel-name').value.trim();
    
    const config = {
      enabled: document.getElementById('vt-enabled').checked,
      mode,
      overlay: {
        enabled: document.getElementById('vt-overlay').checked,
        position: 'top',
        style: 'subtitle',
        fontSize: 24,
        showDuration: 5,
      },
      watermark: {
        enabled: document.getElementById('vt-watermark').checked,
        text: channelName,
        position: 'bottom-right',
        opacity: 0.4,
        fontSize: 16,
      },
      visual: {
        enabled: document.getElementById('vt-visual').checked,
        zoom: 1.02,
        brightness: 0.02,
        contrast: 1.02,
        saturation: 1.05,
        speed: 1.0,
        mirror: document.getElementById('vt-mirror').checked,
      },
      output: {
        resolution: document.getElementById('vt-resolution').value,
        fps: 30,
        videoBitrate: '4000k',
        audioBitrate: '192k',
      },
    };

    // Mode presets
    if (mode === 'minimal') {
      config.overlay.enabled = false;
      config.watermark.enabled = false;
      config.intro = { enabled: false };
      config.outro = { enabled: false };
    } else if (mode === 'full') {
      config.intro = { enabled: true, duration: 3, style: 'fade', text: channelName };
      config.outro = { enabled: true, duration: 4, style: 'fade', text: 'Subscribe & Like 👆' };
    } else {
      config.intro = { enabled: false };
      config.outro = { enabled: false };
    }

    // Also save channel name to general settings
    if (channelName) {
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelName })
      }).catch(() => {});
    }

    const r = await fetch('/api/transform/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (r.ok) {
      window.app.showToast('Video Transform บันทึกแล้ว ✓', 'success');
    } else {
      window.app.showToast('บันทึกไม่สำเร็จ', 'error');
    }
  });
}
