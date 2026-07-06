// Page: Files (/files)
export function render() {
  return `
    <div class="toolbar">
      <button id="btn-refresh" class="btn btn-secondary">🔄 รีเฟรช</button>
      <button id="btn-upload-all" class="btn btn-primary">🚀 อัปโหลดทั้งหมด</button>
      <span id="files-total-size" class="toolbar-info"></span>
    </div>
    <div id="file-list" class="file-list">
      <p class="empty-state">กำลังโหลด...</p>
    </div>`;
}

export function init() {
  document.getElementById('btn-refresh').addEventListener('click', () => { load(); window.app.showToast('รีเฟรชแล้ว', 'info'); });
  document.getElementById('btn-upload-all').addEventListener('click', uploadAll);
  load();
}

async function load() {
  const res = await fetch('/api/files');
  const data = await res.json();
  const list = document.getElementById('file-list');

  if (data.error) { list.innerHTML = `<p class="empty-state">❌ ${data.error}</p>`; return; }
  if (!data.folder) { list.innerHTML = '<p class="empty-state">⚙️ กรุณาตั้งค่าโฟลเดอร์ก่อน</p>'; return; }
  if (data.files.length === 0) { list.innerHTML = '<p class="empty-state">📭 ไม่พบไฟล์วิดีโอ</p>'; return; }

  const sizeEl = document.getElementById('files-total-size');
  if (sizeEl && data.totalSize) sizeEl.textContent = `💾 ${data.totalSize}`;

  list.innerHTML = data.files.map(file => `
    <div class="file-item ${file.uploaded?'uploaded':''}">
      <div class="file-icon">🎬</div>
      <div class="file-info">
        <div class="file-name">${window.app.escapeHtml(file.filename)}</div>
        <div class="file-meta">${file.sizeFormatted} • ${new Date(file.modified).toLocaleString('th-TH')}</div>
      </div>
      <div class="file-actions">
        ${file.uploaded
          ? `<span class="badge badge-success">✅ อัปโหลดแล้ว</span><a href="${file.youtubeUrl}" target="_blank" class="btn btn-secondary btn-sm">🔗 YouTube</a>`
          : `<span class="badge badge-pending">⏳ รอ</span><button class="btn btn-primary btn-sm" onclick="window.filesPage.upload('${window.app.escapeHtml(file.filename)}')">📤 อัปโหลด</button>`}
      </div>
    </div>`).join('');
}

async function uploadAll() {
  if (!confirm('อัปโหลดไฟล์ทั้งหมดที่ยังไม่ได้อัปโหลด?')) return;
  const res = await fetch('/api/upload-all', { method: 'POST' });
  const data = await res.json();
  if (data.error) { window.app.showToast(data.error, 'error'); return; }
  if (data.totalFiles === 0) { window.app.showToast('ไม่มีไฟล์ที่ต้องอัปโหลด', 'info'); return; }
  window.app.showToast(`เพิ่ม ${data.totalFiles} ไฟล์ลงคิว`, 'info');
}

window.filesPage = {
  upload: (filename) => window.app.openUploadModal(filename),
  reload: load
};
