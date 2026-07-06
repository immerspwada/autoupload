// Page: Queue (/queue)
export function render() {
  return `
    <div class="toolbar">
      <button id="btn-queue-pause" class="btn btn-secondary">⏸️ หยุดคิว</button>
      <button id="btn-queue-resume" class="btn btn-primary">▶️ เริ่มคิว</button>
      <button id="btn-queue-clear" class="btn btn-danger">🗑️ ล้างคิว</button>
    </div>
    <div id="queue-stats" class="queue-stats"></div>
    <div id="queue-list" class="queue-list"><p class="empty-state">กำลังโหลด...</p></div>`;
}

export function init() {
  document.getElementById('btn-queue-pause').addEventListener('click', async () => {
    await fetch('/api/upload/queue/pause', { method: 'POST' });
    window.app.showToast('หยุดคิวแล้ว', 'info'); load();
  });
  document.getElementById('btn-queue-resume').addEventListener('click', async () => {
    await fetch('/api/upload/queue/resume', { method: 'POST' });
    window.app.showToast('เริ่มคิวอีกครั้ง', 'success'); load();
  });
  document.getElementById('btn-queue-clear').addEventListener('click', async () => {
    if (!confirm('ล้างคิวทั้งหมด?')) return;
    window.app.showToast('ล้างคิวแล้ว', 'info');
  });
  load();
}

async function load() {
  const res = await fetch('/api/upload/queue');
  const data = await res.json();
  update(data);
}

export function update(queue) {
  const statsEl = document.getElementById('queue-stats');
  const listEl = document.getElementById('queue-list');
  if (!statsEl) return;

  statsEl.innerHTML = `<div class="queue-summary-bar">
    <div class="qs-item"><span class="qs-num">${queue.pending}</span> รอ</div>
    <div class="qs-item active"><span class="qs-num">${queue.processing}</span> กำลังอัปโหลด</div>
    <div class="qs-item success"><span class="qs-num">${queue.done}</span> สำเร็จ</div>
    <div class="qs-item error"><span class="qs-num">${queue.failed}</span> ล้มเหลว</div>
    ${queue.paused?'<div class="qs-item paused">⏸️ หยุดชั่วคราว</div>':''}
  </div>`;

  if (!queue.items || queue.items.length === 0) { listEl.innerHTML = '<p class="empty-state">ไม่มีรายการในคิว</p>'; return; }
  const icons = { pending:'⏳', processing:'⚡', done:'✅', failed:'❌', cancelled:'🚫' };
  const texts = { pending:'รอ', processing:'อัปโหลด...', done:'สำเร็จ', failed:'ล้มเหลว', cancelled:'ยกเลิก' };
  listEl.innerHTML = queue.items.map(item => `
    <div class="queue-row ${item.status}">
      <div class="queue-row-icon">${icons[item.status]||'❓'}</div>
      <div class="queue-row-info">
        <div class="queue-row-name">${window.app.escapeHtml(item.filename)}</div>
        ${item.error?`<div class="queue-row-error">${window.app.escapeHtml(item.error)}</div>`:''}
        ${item.retries>0?`<div class="queue-row-retry">retry: ${item.retries}</div>`:''}
      </div>
      <span class="queue-row-status">${texts[item.status]||item.status}</span>
    </div>`).join('');
}
