// Page: SEO Optimization (/seo)
// ควบคุมการสร้าง title/description/tags/category อัตโนมัติสำหรับ TikTok → YouTube

export function render() {
  return `
    <div class="settings-form">
      <h3>SEO Auto-Optimization</h3>
      <p class="section-desc">ตั้งค่าการสร้าง title, description, tags, category อัตโนมัติ เพื่อเพิ่มยอดดูและรายได้จากโฆษณา YouTube</p>

      <div class="form-group">
        <label for="seo-mode">โหมด SEO</label>
        <select id="seo-mode">
          <option value="auto">อัตโนมัติ (สร้าง SEO metadata ให้ทุกครั้ง)</option>
          <option value="manual">Manual (ใช้ค่าที่ผู้ใช้กรอกเอง)</option>
        </select>
        <small>โหมดอัตโนมัติจะวิเคราะห์คำอธิบาย TikTok เพื่อสร้าง title/tags/category ที่เหมาะกับ YouTube SEO</small>
      </div>

      <div class="form-group">
        <label for="seo-title-template">Title Template (ไม่บังคับ)</label>
        <input type="text" id="seo-title-template" placeholder="{title} | ช่องของฉัน">
        <small>ใช้ {title}, {author}, {date} แทนค่าที่จะแทรกอัตโนมัติ</small>
      </div>

      <div class="form-group">
        <label for="seo-channel-desc">คำอธิบายท้ายวิดีโอ (Channel Branding)</label>
        <textarea id="seo-channel-desc" rows="3" placeholder="ติดตามช่องของเราเพื่อดูคลิปสนุกๆทุกวัน..."></textarea>
        <small>จะแนบไว้ท้าย description ของทุกวิดีโอที่อัปโหลด</small>
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="seo-auto-schedule">
          ตั้งเวลาเผยแพร่อัตโนมัติ (Prime-Time)
        </label>
        <small>ระบบจะเลือกเวลาเผยแพร่ที่คนไทยดู YouTube มากที่สุด (19:00-21:00) แทนการอัปโหลดทันที</small>
      </div>

      <div class="form-group">
        <label for="seo-preferred-hour">ชั่วโมงที่ต้องการ (ไม่บังคับ, 0-23)</label>
        <input type="number" id="seo-preferred-hour" min="0" max="23" placeholder="เช่น 19">
        <small>ถ้าไม่ระบุ ระบบจะเลือกช่วง prime-time ที่ดีที่สุดให้อัตโนมัติ</small>
      </div>

      <button id="btn-seo-save" type="button" class="btn btn-primary">บันทึก SEO Settings</button>
    </div>

    <div class="settings-form" style="margin-top:20px;">
      <h3>ทดสอบ SEO Preview</h3>
      <p class="section-desc">ลองใส่คำอธิบายวิดีโอ TikTok เพื่อดูตัวอย่าง title/tags/category ที่ระบบจะสร้างให้</p>

      <div class="form-group">
        <label for="seo-preview-desc">คำอธิบายวิดีโอ (TikTok caption)</label>
        <textarea id="seo-preview-desc" rows="2" placeholder="เช่น: แมวน่ารักมากกกก #cat #แมว #viral"></textarea>
      </div>
      <div class="form-group">
        <label for="seo-preview-author">Author (ไม่บังคับ)</label>
        <input type="text" id="seo-preview-author" placeholder="tiktok_username">
      </div>
      <div class="form-group">
        <label for="seo-preview-duration">ความยาววิดีโอ (วินาที, ไม่บังคับ)</label>
        <input type="number" id="seo-preview-duration" placeholder="เช่น 45">
      </div>
      <button id="btn-seo-preview" type="button" class="btn btn-secondary">พรีวิว SEO</button>

      <div id="seo-preview-result" style="display:none; margin-top:16px;"></div>
    </div>`;
}

export async function init() {
  await loadSettings();
  document.getElementById('btn-seo-save').addEventListener('click', saveSettings);
  document.getElementById('btn-seo-preview').addEventListener('click', preview);
}

async function loadSettings() {
  try {
    const res = await fetch('/api/seo/settings');
    const s = await res.json();
    document.getElementById('seo-mode').value = s.seoMode || 'auto';
    document.getElementById('seo-title-template').value = s.titleTemplate || '';
    document.getElementById('seo-channel-desc').value = s.channelDescription || '';
    document.getElementById('seo-auto-schedule').checked = s.autoSchedule || false;
    document.getElementById('seo-preferred-hour').value = s.preferredPublishHour ?? '';
  } catch (err) {
    console.error('Failed to load SEO settings:', err);
  }
}

async function saveSettings() {
  const data = {
    seoMode: document.getElementById('seo-mode').value,
    titleTemplate: document.getElementById('seo-title-template').value,
    channelDescription: document.getElementById('seo-channel-desc').value,
    autoSchedule: document.getElementById('seo-auto-schedule').checked,
    preferredPublishHour: document.getElementById('seo-preferred-hour').value
      ? parseInt(document.getElementById('seo-preferred-hour').value) : null
  };

  try {
    const res = await fetch('/api/seo/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (result.success) window.app.showToast('💎 บันทึก SEO Settings สำเร็จ', 'success');
  } catch (err) {
    window.app.showToast('บันทึกล้มเหลว: ' + err.message, 'error');
  }
}

async function preview() {
  const desc = document.getElementById('seo-preview-desc').value.trim();
  const author = document.getElementById('seo-preview-author').value.trim();
  const duration = parseInt(document.getElementById('seo-preview-duration').value) || 0;

  if (!desc) {
    window.app.showToast('กรุณาใส่คำอธิบายวิดีโอ', 'error');
    return;
  }

  try {
    const res = await fetch('/api/seo/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        desc, author, duration,
        schedulePublish: document.getElementById('seo-auto-schedule').checked
      })
    });
    const data = await res.json();
    if (data.success) renderPreview(data.metadata, data.categoryName);
    else window.app.showToast('พรีวิวล้มเหลว: ' + data.error, 'error');
  } catch (err) {
    window.app.showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function renderPreview(metadata, categoryName) {
  const container = document.getElementById('seo-preview-result');
  container.style.display = 'block';

  const statusClass = metadata.validation.status === 'ok' ? 'success'
    : metadata.validation.status === 'warning' ? 'pending' : 'error';

  const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
  const quality = metadata.quality || { score: 0, grade: 'needs_work', checks: [], recommendation: '' };
  const qualityClass = quality.grade === 'excellent' ? 'success'
    : quality.grade === 'good' ? 'pending'
    : quality.grade === 'needs_work' ? 'pending'
    : 'error';

  container.innerHTML = `
    <div class="seo-preview-card">
      <div class="seo-preview-header">
        <strong>📊 ผลลัพธ์ SEO</strong>
        <span class="badge badge-${statusClass}">${window.app.escapeHtml(metadata.validation.recommendation)}</span>
      </div>

      <div class="seo-preview-field">
        <label>🧠 Smart SEO Score</label>
        <div class="seo-score-row">
          <div class="seo-score-circle badge-${qualityClass}">${quality.score}</div>
          <div>
            <div class="seo-preview-value">${window.app.escapeHtml(quality.recommendation)}</div>
            <small>Grade: ${window.app.escapeHtml(quality.grade)}</small>
          </div>
        </div>
      </div>

      <div class="seo-preview-field">
        <label>📌 Title (${metadata.title.length}/100)</label>
        <div class="seo-preview-value">${window.app.escapeHtml(metadata.title)}</div>
      </div>

      <div class="seo-preview-field">
        <label>📝 Description (ตัวอย่าง)</label>
        <div class="seo-preview-value small">${window.app.escapeHtml(metadata.description.substring(0, 250))}...</div>
      </div>

      <div class="seo-preview-field">
        <label>🏷️ Tags (${tags.length})</label>
        <div class="seo-preview-tags">
          ${tags.slice(0, 20).map(t => `<span class="tag-chip">${window.app.escapeHtml(t)}</span>`).join('')}
        </div>
      </div>

      <div class="seo-preview-meta">
        <span>📂 ${categoryName} (ID: ${metadata.categoryId})</span>
        <span>🔒 ${metadata.privacy}</span>
        ${metadata.publishAt ? `<span>📅 ${new Date(metadata.publishAt).toLocaleString('th-TH')}</span>` : ''}
      </div>

      ${metadata.validation.issues.length > 0 ? `
        <div class="seo-preview-issues">
          ${metadata.validation.issues.map(issue => `
            <div class="seo-issue ${issue.level}">
              ${issue.level === 'error' ? '❌' : issue.level === 'warning' ? '⚠️' : 'ℹ️'}
              ${window.app.escapeHtml(issue.message)}
            </div>`).join('')}
        </div>` : ''}

      ${quality.checks?.length ? `
        <div class="seo-preview-issues">
          ${quality.checks.map(check => `
            <div class="seo-issue ${check.level}">
              ${check.level === 'error' ? '❌' : check.level === 'warning' ? '⚠️' : check.level === 'success' ? '✅' : 'ℹ️'}
              ${window.app.escapeHtml(check.message)}
            </div>`).join('')}
        </div>` : ''}
    </div>`;
}
