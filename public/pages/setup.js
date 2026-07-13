// Setup Wizard — แสดงเมื่อยังไม่มี credentials
export function render() {
  return `
    <div class="setup-page">
      <div class="setup-hero">
        <h1>ยินดีต้อนรับสู่ Auto Uploader</h1>
        <p>ทำตาม 3 ขั้นตอนเพื่อเริ่มต้น อัปโหลด TikTok → YouTube อัตโนมัติ 24/7</p>
      </div>

      <!-- Step 1: Google Credentials -->
      <div class="setup-card" id="step-credentials">
        <div class="setup-step-badge">1</div>
        <div class="setup-step-content">
          <h3>เชื่อมต่อ Google Cloud</h3>
          <p class="section-desc">ใส่ Client ID และ Client Secret จาก Google Cloud Console</p>

          <div class="tip-box" style="margin-bottom:16px">
            <strong>วิธีรับ Client ID/Secret:</strong><br>
            1. ไปที่ <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a><br>
            2. สร้าง Project → Enable <strong>YouTube Data API v3</strong><br>
            3. Credentials → Create → <strong>OAuth 2.0 Client ID</strong> → Web Application<br>
            4. Redirect URI: <code id="redirect-uri-display">http://localhost:3000/oauth2callback</code>
            <button class="btn btn-secondary btn-sm" onclick="copyRedirectUri()" style="margin-top:6px">Copy URI</button>
          </div>

          <form id="credentials-form">
            <div class="form-group">
              <label for="client-id">Client ID</label>
              <input type="text" id="client-id" placeholder="xxxxx.apps.googleusercontent.com" required>
            </div>
            <div class="form-group">
              <label for="client-secret">Client Secret</label>
              <input type="password" id="client-secret" placeholder="GOCSPX-xxxx" required>
            </div>
            <button type="submit" class="btn btn-primary" id="save-cred-btn">บันทึกและดำเนินการต่อ</button>
          </form>

          <div class="setup-divider">หรือถ้ามีไฟล์ JSON อยู่แล้ว</div>
          <p class="section-desc">วาง <code>client_secret.json</code> ในโฟลเดอร์โปรเจคแล้ว restart server</p>
        </div>
      </div>

      <!-- Step 2: Import Config (optional) -->
      <div class="setup-card" id="step-import">
        <div class="setup-step-badge">2</div>
        <div class="setup-step-content">
          <h3>Import Config <span class="badge badge-pending">ไม่บังคับ</span></h3>
          <p class="section-desc">ถ้ามี config จาก instance อื่น สามารถ import ได้เลย — keywords, settings, scheduler จะถูกคัดลอกมาทั้งหมด</p>
          <div class="btn-row">
            <label class="btn btn-secondary" style="cursor:pointer">
              เลือกไฟล์ config
              <input type="file" id="import-file" accept=".json" style="display:none">
            </label>
            <span id="import-filename" class="section-desc"></span>
          </div>
          <div id="import-result" style="margin-top:10px"></div>
        </div>
      </div>

      <!-- Step 3: Login YouTube -->
      <div class="setup-card" id="step-login">
        <div class="setup-step-badge">3</div>
        <div class="setup-step-content">
          <h3>Login YouTube</h3>
          <p class="section-desc">authorize ให้แอปอัปโหลดวิดีโอในนาม YouTube account ของคุณ</p>
          <button class="btn btn-primary" id="btn-yt-login" disabled>Login YouTube</button>
          <p class="section-desc" style="margin-top:8px" id="login-hint">ทำขั้นตอนที่ 1 ก่อน</p>
        </div>
      </div>
    </div>`;
}

export async function init() {
  // แสดง redirect URI จริง
  const origin = location.origin;
  const uriEl = document.getElementById('redirect-uri-display');
  if (uriEl) uriEl.textContent = `${origin}/oauth2callback`;

  // Credentials form
  document.getElementById('credentials-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-cred-btn');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
    try {
      const r = await fetch('/api/setup/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId:     document.getElementById('client-id').value.trim(),
          clientSecret: document.getElementById('client-secret').value.trim(),
          redirectUri:  `${origin}/oauth2callback`,
        })
      });
      const d = await r.json();
      if (d.success) {
        window.app.showToast('บันทึก credentials สำเร็จ', 'success');
        enableLoginButton();
      } else {
        window.app.showToast(d.error || 'เกิดข้อผิดพลาด', 'error');
      }
    } catch(err) {
      window.app.showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'บันทึกและดำเนินการต่อ';
    }
  });

  // Import file
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('import-filename').textContent = file.name;
    try {
      const text = await file.text();
      const config = JSON.parse(text);
      const r = await fetch('/api/setup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const d = await r.json();
      const el = document.getElementById('import-result');
      if (d.success) {
        el.innerHTML = `<div class="quota-alert" style="background:var(--success-bg);border-color:rgba(22,163,74,.2);color:var(--success)">${d.message}</div>`;
      } else {
        el.innerHTML = `<div class="quota-alert quota-alert-error">${d.error}</div>`;
      }
    } catch(err) {
      document.getElementById('import-result').innerHTML =
        `<div class="quota-alert quota-alert-error">ไฟล์ไม่ถูกต้อง: ${err.message}</div>`;
    }
  });

  // Check if credentials already exist
  try {
    const r = await fetch('/api/setup/status');
    const d = await r.json();
    if (d.hasCredentials) enableLoginButton();
  } catch(e) {}

  // Login button
  document.getElementById('btn-yt-login').addEventListener('click', async () => {
    const r = await fetch('/api/auth/login');
    const d = await r.json();
    if (d.url) window.location.href = d.url;
    else window.app.showToast(d.error || 'เกิดข้อผิดพลาด', 'error');
  });
}

function enableLoginButton() {
  const btn = document.getElementById('btn-yt-login');
  const hint = document.getElementById('login-hint');
  if (btn) btn.disabled = false;
  if (hint) hint.textContent = 'กด Login เพื่อ authorize YouTube';
}

window.copyRedirectUri = function() {
  const uri = document.getElementById('redirect-uri-display')?.textContent;
  if (uri) navigator.clipboard.writeText(uri).then(() => window.app.showToast('Copied!', 'success'));
};
