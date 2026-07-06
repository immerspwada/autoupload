// Page: History (/history)
export function render() {
  return `
    <div class="toolbar">
      <button id="btn-clear-history" class="btn btn-danger">🗑️ ล้างประวัติ</button>
      <span id="history-count" class="toolbar-info"></span>
    </div>
    <div id="history-list" class="history-list"><p class="empty-state">กำลังโหลด...</p></div>`;
}

export async function init() {
  document.getElementById('btn-clear-history').addEventListener('click', async () => {
    if (!confirm('ล้างประวัติทั้งหมด?')) return;
    await fetch('/api/history', { method: 'DELETE' });
    load();
    window.app.showToast('ล้างประวัติแล้ว', 'info');
  });
  load();
}

async function load() {
  const res = await fetch('/api/history');
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.items || []);
  const total = Array.isArray(data) ? data.length : (data.total || 0);
  const list = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');
  if (countEl) countEl.textContent = `${total} รายการ`;

  if (items.length === 0) { list.innerHTML = '<p class="empty-state">ยังไม่มีประวัติ</p>'; return; }
  list.innerHTML = items.map(item => `
    <div class="history-item">
      <div class="file-icon">${item.deleted?'🗑️':'✅'}</div>
      <div class="file-info">
        <div class="file-name">${window.app.escapeHtml(item.filename)}</div>
        <div class="file-meta">
          ${new Date(item.uploaded_at).toLocaleString('th-TH')}
          ${item.deleted?' • ลบแล้ว':''}
          ${item.source?' • '+item.source:''}
          ${item.youtube_url?` • <a href="${item.youtube_url}" target="_blank">YouTube ↗</a>`:''}
        </div>
      </div>
    </div>`).join('');
}
