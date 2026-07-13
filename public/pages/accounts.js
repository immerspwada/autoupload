/**
 * Accounts Management Page
 * จัดการหลาย YouTube accounts + Auto-Rotation
 */

let accounts = [];
let activeAccountId = null;
let rotationStatus = null;

export function render() {
  return `
    <div class="accounts-page">
      <div class="page-header">
        <h2>Account Management</h2>
        <p>จัดการหลาย YouTube accounts พร้อมสลับกันใช้งานอัตโนมัติ</p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3>Quota Rotation Status</h3>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-secondary" onclick="refreshRotationStatus()">รีเฟรช</button>
            <button class="btn btn-sm btn-primary" onclick="forceRotate()">Force Rotate</button>
          </div>
        </div>
        <div class="card-body">
          <div id="rotation-summary">${renderRotationSummary()}</div>
          <div id="rotation-log" style="margin-top:16px">${renderRotationLog()}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3>Accounts (${accounts.length})</h3>
          <button class="btn btn-primary btn-sm" onclick="showAddAccountModal()">+ เพิ่ม Account</button>
        </div>
        <div class="card-body">
          <div id="accounts-list">${renderAccountsList()}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>วิธีเพิ่ม Quota — สร้าง Google Cloud Project ใหม่</h3>
        </div>
        <div class="card-body">
          <div class="tip-box success">
            <strong>แต่ละ Google Cloud Project = 10,000 units/day = 6 uploads/day</strong><br>
            สร้าง 3 Projects = 18 uploads/day &nbsp;|&nbsp; สร้าง 10 Projects = 60 uploads/day
          </div>
          <ol class="howto-list">
            <li>ไปที่ <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a> → สร้าง <strong>New Project</strong></li>
            <li>เปิดใช้ <strong>YouTube Data API v3</strong> (APIs & Services → Enable APIs)</li>
            <li>สร้าง <strong>OAuth 2.0 Client ID</strong> (Credentials → Create Credentials)</li>
            <li>เพิ่ม Redirect URI: <code>http://localhost:3000/oauth2callback</code></li>
            <li>คัดลอก <strong>Client ID</strong> และ <strong>Client Secret</strong></li>
            <li>กด "+ เพิ่ม Account" ด้านบน แล้ววางข้อมูล</li>
            <li>กด "Login" เพื่อ authorize กับ YouTube</li>
            <li>ระบบจะ <strong>rotate อัตโนมัติ</strong> เมื่อ quota account ปัจจุบันหมด</li>
          </ol>
        </div>
      </div>
    </div>

    <!-- Add Account Modal -->
    <div id="add-account-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <h3>เพิ่ม YouTube Account (Google Cloud Project ใหม่)</h3>
        <form id="add-account-form">
          <div class="form-group">
            <label>ชื่อ Account:</label>
            <input type="text" id="account-name" class="form-control" placeholder="เช่น Project-A, Backup-1" required />
          </div>
          <div class="form-group">
            <label>Client ID:</label>
            <input type="text" id="account-client-id" class="form-control" placeholder="xxxxx.apps.googleusercontent.com" required />
          </div>
          <div class="form-group">
            <label>Client Secret:</label>
            <input type="text" id="account-client-secret" class="form-control" placeholder="GOCSPX-xxxx" required />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeAddAccountModal()">ยกเลิก</button>
            <button type="submit" class="btn btn-primary">บันทึกและ Login</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderRotationSummary() {
  if (!rotationStatus) {
    return '<p style="color:var(--text-secondary);">กำลังโหลด...</p>';
  }

  const { summary, accounts: accs } = rotationStatus;
  const totalUsed = accs.filter(a => a.isAuthenticated).reduce((s, a) => s + a.quotaUsed, 0);
  const totalLimit = accs.filter(a => a.isAuthenticated).reduce((s, a) => s + a.quotaLimit, 0);
  const totalPct = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0;
  const ready = summary.totalUploadsLeft > 0;

  return `
    <div class="smart-recommendation ${ready ? 'ready' : 'critical'}">
      <div class="smart-recommendation-icon">${ready ? '✓' : '!'}</div>
      <div>
        <div class="smart-recommendation-text">${window.app.escapeHtml(summary.recommendation || 'กำลังประเมิน quota...')}</div>
        <div class="smart-recommendation-sub">
          ${ready
            ? 'ระบบจะเลือก account ที่คุ้ม quota ที่สุดให้อัตโนมัติก่อน upload ถัดไป'
            : 'Smart Upload จะหยุดก่อนดาวน์โหลด/อัปโหลด เพื่อไม่เสียเวลาและไม่ชน quota error'}
        </div>
      </div>
    </div>

    <div class="stat-mini-grid">
      <div class="stat-mini">
        <div class="stat-mini-value">${summary.totalUploadsLeft}</div>
        <div class="stat-mini-label">Uploads Left</div>
      </div>
      <div class="stat-mini">
        <div class="stat-mini-value">${summary.authenticatedAccounts}</div>
        <div class="stat-mini-label">Active Accounts</div>
      </div>
      <div class="stat-mini">
        <div class="stat-mini-value">${summary.totalQuotaRemaining.toLocaleString()}</div>
        <div class="stat-mini-label">Units Remaining</div>
      </div>
      <div class="stat-mini">
        <div class="stat-mini-value">${totalPct}%</div>
        <div class="stat-mini-label">Total Used</div>
      </div>
    </div>

    <p class="section-desc" style="margin-bottom:6px">Quota รวมทุก account</p>
    <div class="total-quota-bar">
      <div class="total-quota-fill" style="width:${100 - totalPct}%"></div>
    </div>
    <p class="section-desc" style="margin-top:4px;margin-bottom:16px">${totalUsed.toLocaleString()} / ${totalLimit.toLocaleString()} units used</p>

    <p style="font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Per-Account Status</p>
    <div class="rotation-accounts">
      ${accs.map(acc => `
        <div class="rotation-account-badge ${acc.status} ${acc.isActive ? 'active-now' : ''}"
             title="${acc.quotaUsed}/${acc.quotaLimit} units used — ${acc.uploadsLeft} uploads left">
          ${acc.isActive ? '<strong>Active</strong> · ' : ''}${window.app.escapeHtml(acc.name)}
          <br><small>${acc.isAuthenticated ? `${acc.uploadsLeft} uploads` : 'not logged in'}</small>
        </div>
      `).join('')}
    </div>
    <p class="section-desc" style="margin-top:6px">Active = account ปัจจุบัน · ok / warning / critical แสดงตาม quota usage</p>
  `;
}

function renderRotationLog() {
  if (!rotationStatus || !rotationStatus.recentRotations?.length) {
    return '<p class="section-desc">ยังไม่มีประวัติการ rotate</p>';
  }
  return `
    <p style="font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:8px">ประวัติการ Rotate ล่าสุด</p>
    ${rotationStatus.recentRotations.slice(0, 5).map(r => `
      <div class="rotation-log-item">
        <strong>${window.app.escapeHtml(r.fromAccount)}</strong> → <strong>${window.app.escapeHtml(r.toAccount)}</strong>
        <span class="section-desc" style="margin-left:8px">${window.app.escapeHtml(r.reason)}</span>
        <span class="section-desc" style="float:right">${new Date(r.timestamp).toLocaleTimeString('th-TH')}</span>
      </div>
    `).join('')}
  `;
}

function renderAccountsList() {
  if (accounts.length === 0) {
    return `
      <div class="empty-state" style="text-align: center; padding: 40px;">
        <p>ยังไม่มี account</p>
        <p style="margin-top: 10px; color: var(--text-secondary);">กด "➕ เพิ่ม Account" เพื่อเริ่มต้น</p>
      </div>
    `;
  }

  return `
    <div class="accounts-list">
      ${accounts.map(acc => `
        <div class="account-card ${acc.isActive ? 'active' : ''}">
          <div class="account-header">
            <div class="account-name">
              <span>${acc.name}</span>
              ${!acc.hasToken ? '<span style="color: var(--warning); font-size: 0.875rem;">(ยังไม่ login)</span>' : ''}
            </div>
            <button class="btn btn-sm btn-danger" onclick="deleteAccount('${acc.id}')">ลบ</button>
          </div>

          <div class="account-info">
            <div class="info-item">
              <span class="info-label">Client ID:</span>
              <span class="info-value" style="font-size: 0.875rem;">${acc.clientId.slice(0, 20)}...</span>
            </div>
            ${acc.channelInfo ? `
              <div class="info-item">
                <span class="info-label">Channel:</span>
                <span class="info-value">${acc.channelInfo.title || 'N/A'}</span>
              </div>
            ` : ''}
            <div class="info-item">
              <span class="info-label">Quota:</span>
              <span class="info-value">${acc.quotaUsed} / ${acc.quotaLimit} units</span>
              <div class="quota-bar">
                <div class="quota-fill ${getQuotaClass(acc)}" style="width: ${(acc.quotaUsed / acc.quotaLimit * 100)}%"></div>
              </div>
            </div>
            <div class="info-item">
              <span class="info-label">Remaining:</span>
              <span class="info-value">${acc.quotaRemaining} units (${Math.floor(acc.quotaRemaining / 1600)} videos)</span>
            </div>
            <div class="info-item">
              <span class="info-label">Smart Status:</span>
              <span class="info-value">${getSmartAccountStatus(acc)}</span>
            </div>
          </div>

          <div class="account-actions">
            ${!acc.isActive ? `
              <button class="btn btn-success btn-sm" onclick="activateAccount('${acc.id}')">
                ใช้ Account นี้
              </button>
            ` : '<span class="badge badge-success">Active</span>'}
            ${!acc.hasToken ? `
              <button class="btn btn-primary btn-sm" onclick="loginAccount('${acc.id}')">
                Login YouTube
              </button>
            ` : `
              <button class="btn btn-secondary btn-sm" onclick="loginAccount('${acc.id}')">
                Re-login
              </button>
            `}
            <button class="btn btn-secondary btn-sm" onclick="resetQuota('${acc.id}')">
              Reset Quota
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function getQuotaClass(account) {
  const usage = account.quotaUsed / account.quotaLimit;
  if (usage >= 0.9) return 'critical';
  if (usage >= 0.7) return 'high';
  return '';
}

function getSmartAccountStatus(account) {
  if (!account.hasToken) return 'ต้อง login ก่อนใช้งาน';
  if (account.quotaRemaining < 1600) return 'พักไว้ก่อน - quota ไม่พอ 1 upload';
  const uploadsLeft = Math.floor(account.quotaRemaining / 1600);
  if (account.isActive) return `พร้อมใช้ตอนนี้ (${uploadsLeft} uploads)`;
  return `พร้อมเป็น backup (${uploadsLeft} uploads)`;
}

export async function init() {
  await Promise.all([loadAccounts(), loadRotationStatus()]);

  // Check if just logged in
  const params = new URLSearchParams(location.search);
  if (params.get('auth') === 'success' && params.get('account') === 'true') {
    const accountId = sessionStorage.getItem('loginAccountId');
    if (accountId) {
      sessionStorage.removeItem('loginAccountId');
      const account = accounts.find(a => a.id === accountId);
      if (account) {
        window.app.showToast(`✅ เชื่อมต่อ YouTube สำเร็จ: ${account.name}`, 'success');
      }
    }
  }

  // Event listeners — ใช้ onsubmit แทน addEventListener ป้องกัน duplicate
  const form = document.getElementById('add-account-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      await addAccount();
    };
  }
}

async function loadAccounts() {
  try {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    
    if (data.success) {
      accounts = data.accounts;
      activeAccountId = data.activeAccountId;
      updateUI();
    }
  } catch (error) {
    console.error('Failed to load accounts:', error);
  }
}

async function loadRotationStatus() {
  try {
    const res = await fetch('/api/stats/quota/rotation');
    if (res.ok) {
      rotationStatus = await res.json();
      const summaryEl = document.getElementById('rotation-summary');
      const logEl = document.getElementById('rotation-log');
      if (summaryEl) summaryEl.innerHTML = renderRotationSummary();
      if (logEl) logEl.innerHTML = renderRotationLog();
    }
  } catch (error) {
    console.error('Failed to load rotation status:', error);
  }
}

async function refreshRotationStatus() {
  window.app.showToast('🔃 Refreshing...', 'info');
  await Promise.all([loadAccounts(), loadRotationStatus()]);
  window.app.showToast('✅ Updated', 'success');
}

async function forceRotate() {
  try {
    const res = await fetch('/api/stats/quota/rotate', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const msg = data.wasRotated
        ? `✅ Rotated → ${data.accountName} (${data.uploadsLeft} uploads left)`
        : `✅ Already on best account: ${data.accountName}`;
      window.app.showToast(msg, 'success');
      await Promise.all([loadAccounts(), loadRotationStatus()]);
    } else {
      window.app.showToast(`⚠️ ${data.reason || 'All accounts quota exhausted'}`, 'warning');
    }
  } catch (error) {
    window.app.showToast(`❌ Error: ${error.message}`, 'error');
  }
}

async function addAccount() {
  const name = document.getElementById('account-name').value;
  const clientId = document.getElementById('account-client-id').value;
  const clientSecret = document.getElementById('account-client-secret').value;

  try {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, clientId, clientSecret }),
    });

    const data = await res.json();

    if (data.success) {
      window.app.showToast(`✅ เพิ่ม account "${name}" สำเร็จ!`, 'success');
      closeAddAccountModal();
      await loadAccounts();
    } else {
      window.app.showToast(`❌ ${data.error}`, 'error');
    }
  } catch (error) {
    window.app.showToast(`❌ Error: ${error.message}`, 'error');
  }
}

async function deleteAccount(accountId) {
  if (!confirm('ต้องการลบ account นี้?')) return;

  try {
    const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
    const data = await res.json();

    if (data.success) {
      window.app.showToast('✅ ลบ account สำเร็จ', 'success');
      await loadAccounts();
    } else {
      window.app.showToast(`❌ ${data.error}`, 'error');
    }
  } catch (error) {
    window.app.showToast(`❌ Error: ${error.message}`, 'error');
  }
}

async function activateAccount(accountId) {
  try {
    const res = await fetch(`/api/accounts/${accountId}/activate`, { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      window.app.showToast(`✅ ${data.message}`, 'success');
      await loadAccounts();
    } else {
      window.app.showToast(`❌ ${data.error}`, 'error');
    }
  } catch (error) {
    window.app.showToast(`❌ Error: ${error.message}`, 'error');
  }
}

async function loginAccount(accountId) {
  try {
    window.app.showToast('🔐 Redirecting to YouTube login...', 'info');
    
    // Get OAuth URL for this specific account
    const res = await fetch(`/api/auth/login?accountId=${accountId}`);
    const data = await res.json();
    
    if (data.url) {
      // Store accountId in sessionStorage to show success message later
      sessionStorage.setItem('loginAccountId', accountId);
      window.location.href = data.url;
    } else {
      window.app.showToast(`❌ ${data.error}`, 'error');
    }
  } catch (error) {
    window.app.showToast(`❌ Error: ${error.message}`, 'error');
  }
}

async function resetQuota(accountId) {
  try {
    const res = await fetch(`/api/accounts/${accountId}/reset-quota`, { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      window.app.showToast('✅ Reset quota สำเร็จ', 'success');
      await loadAccounts();
    } else {
      window.app.showToast(`❌ ${data.error}`, 'error');
    }
  } catch (error) {
    window.app.showToast(`❌ Error: ${error.message}`, 'error');
  }
}

function showAddAccountModal() {
  document.getElementById('add-account-modal').style.display = 'flex';
  // Re-attach form listener ทุกครั้งที่เปิด modal (เผื่อถูก re-render)
  const form = document.getElementById('add-account-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      await addAccount();
    };
  }
}

function closeAddAccountModal() {
  document.getElementById('add-account-modal').style.display = 'none';
  document.getElementById('add-account-form').reset();
}

function updateUI() {
  // อัปเดตเฉพาะส่วนที่จำเป็น ไม่ re-render ทั้งหน้า (ป้องกัน modal หาย)
  const accountsList = document.getElementById('accounts-list');
  if (accountsList) {
    accountsList.innerHTML = renderAccountsList();
  }

  const header = document.querySelector('.accounts-page .card .card-header h3');
  if (header && header.textContent.includes('Accounts')) {
    header.textContent = `📋 Accounts (${accounts.length})`;
  }

  // Update rotation sections ด้วย
  const summaryEl = document.getElementById('rotation-summary');
  const logEl = document.getElementById('rotation-log');
  if (summaryEl) summaryEl.innerHTML = renderRotationSummary();
  if (logEl) logEl.innerHTML = renderRotationLog();
}

// Export to global for onclick handlers
window.showAddAccountModal = showAddAccountModal;
window.closeAddAccountModal = closeAddAccountModal;
window.deleteAccount = deleteAccount;
window.activateAccount = activateAccount;
window.loginAccount = loginAccount;
window.resetQuota = resetQuota;
window.refreshRotationStatus = refreshRotationStatus;
window.forceRotate = forceRotate;
