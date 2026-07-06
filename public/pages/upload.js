// Page: Drop Upload (/upload)
export function render() {
  return `
    <div id="drop-zone" class="drop-zone">
      <div class="drop-zone-content">
        <div class="drop-icon">📤</div>
        <h2>ลากไฟล์วิดีโอวางที่นี่</h2>
        <p>หรือคลิกเพื่อเลือกไฟล์</p>
        <p class="drop-formats">รองรับ: MP4, AVI, MOV, MKV, WMV, FLV, WEBM</p>
        <input type="file" id="file-input" multiple accept="video/*" style="display:none">
      </div>
    </div>
    <div id="drop-queue" class="drop-queue" style="display:none;">
      <h3>📋 คิวอัปโหลด</h3>
      <div id="drop-queue-list"></div>
      <div class="drop-queue-actions">
        <button id="btn-upload-queue" class="btn btn-primary">🚀 อัปโหลดทั้งหมดไป YouTube</button>
        <button id="btn-clear-queue" class="btn btn-secondary">🗑️ ล้างคิว</button>
      </div>
    </div>
    <div id="drop-progress" class="progress-container" style="display:none;">
      <div class="progress-info">
        <span id="drop-progress-text">กำลังอัปโหลด...</span>
        <span id="drop-progress-count">0/0</span>
      </div>
      <div class="progress-bar"><div id="drop-progress-fill" class="progress-fill"></div></div>
      <p id="drop-progress-file" class="progress-file"></p>
    </div>
    <div id="drop-results" class="drop-results" style="display:none;"></div>`;
}

let dropQueue = [];

export function init() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { addFiles(Array.from(e.target.files)); fileInput.value = ''; });

  dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['mp4','avi','mov','mkv','wmv','flv','webm','m4v','mpeg','mpg'].includes(ext);
    });
    if (files.length === 0) { window.app.showToast('ไม่มีไฟล์วิดีโอที่รองรับ', 'error'); return; }
    addFiles(files);
  });

  document.getElementById('btn-upload-queue').addEventListener('click', uploadAll);
  document.getElementById('btn-clear-queue').addEventListener('click', () => { dropQueue = []; renderQueue(); document.getElementById('drop-results').style.display = 'none'; });
}

function addFiles(files) {
  files.forEach(f => { if (!dropQueue.find(q => q.file.name === f.name && q.file.size === f.size)) dropQueue.push({ file: f, status: 'pending' }); });
  renderQueue();
}

function renderQueue() {
  const container = document.getElementById('drop-queue');
  const list = document.getElementById('drop-queue-list');
  if (dropQueue.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  list.innerHTML = dropQueue.map((item, idx) => `
    <div class="queue-item">
      <div class="queue-icon">🎬</div>
      <div class="queue-info"><div class="queue-name">${window.app.escapeHtml(item.file.name)}</div><div class="queue-size">${window.app.formatFileSize(item.file.size)}</div></div>
      <span class="queue-status ${item.status}">${{pending:'⏳ รอ',uploading:'⬆️ อัปโหลด...',done:'✅ สำเร็จ',error:'❌ ล้มเหลว'}[item.status]||''}</span>
      ${item.status==='pending'?`<button class="btn-remove" onclick="window.uploadPage.remove(${idx})">✕</button>`:''}
    </div>`).join('');
}

async function uploadAll() {
  const pending = dropQueue.filter(q => q.status === 'pending');
  if (pending.length === 0) { window.app.showToast('ไม่มีไฟล์ที่ต้องอัปโหลด', 'info'); return; }
  const progressEl = document.getElementById('drop-progress');
  const resultsEl = document.getElementById('drop-results');
  progressEl.style.display = 'block'; resultsEl.style.display = 'block'; resultsEl.innerHTML = '';
  document.getElementById('btn-upload-queue').disabled = true;
  let ok = 0, fail = 0;
  for (let i = 0; i < dropQueue.length; i++) {
    const item = dropQueue[i]; if (item.status !== 'pending') continue;
    item.status = 'uploading'; renderQueue();
    document.getElementById('drop-progress-text').textContent = 'กำลังอัปโหลด...';
    document.getElementById('drop-progress-count').textContent = `${ok+fail+1}/${pending.length}`;
    document.getElementById('drop-progress-file').textContent = item.file.name;
    document.getElementById('drop-progress-fill').style.width = ((ok+fail+1)/pending.length)*100+'%';
    try {
      const fd = new FormData(); fd.append('video', item.file); fd.append('title', item.file.name.replace(/\.[^.]+$/,''));
      const res = await fetch('/api/drop-and-upload-youtube', { method:'POST', body: fd });
      const data = await res.json();
      if (data.success) { item.status='done'; ok++; resultsEl.innerHTML+=`<div class="drop-result-item">✅ <strong>${window.app.escapeHtml(item.file.name)}</strong> → <a href="${data.youtubeUrl}" target="_blank">${data.youtubeUrl}</a></div>`; }
      else { item.status='error'; fail++; resultsEl.innerHTML+=`<div class="drop-result-item error">❌ <strong>${window.app.escapeHtml(item.file.name)}</strong> — ${window.app.escapeHtml(data.error)}</div>`; }
    } catch(e) { item.status='error'; fail++; resultsEl.innerHTML+=`<div class="drop-result-item error">❌ ${window.app.escapeHtml(item.file.name)} — ${e.message}</div>`; }
    renderQueue();
    if (i < dropQueue.length-1) await new Promise(r=>setTimeout(r,1500));
  }
  document.getElementById('drop-progress-text').textContent = 'เสร็จสิ้น!';
  document.getElementById('btn-upload-queue').disabled = false;
  window.app.showToast(`สำเร็จ ${ok}, ล้มเหลว ${fail}`, ok>0?'success':'error');
}

// Expose for inline onclick
window.uploadPage = { remove: (idx) => { dropQueue.splice(idx,1); renderQueue(); } };
