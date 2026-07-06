// Page: TikTok (/tiktok)
export function render() {
  return `
    <div class="tiktok-section">
      <div class="tiktok-search">
        <h3>🎵 TikTok → YouTube</h3>
        <p class="section-desc">ค้นหา → ดาวน์โหลดไม่มีลายน้ำ → อัปโหลดไป YouTube อัตโนมัติ</p>
        <div class="search-box">
          <input type="text" id="tiktok-keyword" placeholder="ค้นหา เช่น: แมวน่ารัก, cooking tips..." class="search-input">
          <button id="btn-tiktok-search" class="btn btn-primary">🔍 ค้นหา</button>
        </div>
        <div class="tiktok-url-box">
          <p class="divider-text">หรือวาง URL TikTok โดยตรง</p>
          <div class="url-input-row">
            <input type="text" id="tiktok-url" placeholder="https://www.tiktok.com/@user/video/..." class="search-input">
            <button id="btn-tiktok-dl" class="btn btn-secondary btn-sm">⬇️ โหลด</button>
            <button id="btn-tiktok-dl-up" class="btn btn-primary btn-sm">🚀 โหลด+อัป</button>
          </div>
        </div>
      </div>
      <div id="tiktok-loading" class="loading-state" style="display:none;"><div class="spinner"></div><p>กำลังค้นหา...</p></div>
      <div id="tiktok-results" style="display:none;">
        <div class="tiktok-results-header">
          <h3>ผลลัพธ์: <span id="tiktok-result-keyword"></span></h3>
          <div class="tiktok-batch-actions">
            <button id="btn-tiktok-select-all" class="btn btn-secondary btn-sm">☑️ เลือกทั้งหมด</button>
            <button id="btn-tiktok-batch" class="btn btn-primary btn-sm">🚀 อัปที่เลือก</button>
          </div>
        </div>
        <div id="tiktok-video-list" class="tiktok-video-list"></div>
      </div>
      <div id="tiktok-progress" class="progress-container" style="display:none;">
        <div class="progress-info"><span id="tiktok-progress-text">...</span><span id="tiktok-progress-count">0/0</span></div>
        <div class="progress-bar"><div id="tiktok-progress-fill" class="progress-fill"></div></div>
        <p id="tiktok-progress-file" class="progress-file"></p>
      </div>
      <div id="tiktok-batch-results" class="drop-results" style="display:none;"></div>
    </div>`;
}

let results = [];

export function init() {
  document.getElementById('btn-tiktok-search').addEventListener('click', search);
  document.getElementById('tiktok-keyword').addEventListener('keypress', e => { if (e.key==='Enter') search(); });
  document.getElementById('btn-tiktok-dl').addEventListener('click', dlUrl);
  document.getElementById('btn-tiktok-dl-up').addEventListener('click', dlUpUrl);
  document.getElementById('btn-tiktok-select-all').addEventListener('click', toggleAll);
  document.getElementById('btn-tiktok-batch').addEventListener('click', batchUpload);
}

async function search() {
  const kw = document.getElementById('tiktok-keyword').value.trim();
  if (!kw) { window.app.showToast('ใส่คีย์เวิร์ด', 'error'); return; }
  document.getElementById('tiktok-loading').style.display = 'flex';
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetch('/api/tiktok/search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({keyword:kw,count:12}) });
    const data = await res.json();
    document.getElementById('tiktok-loading').style.display = 'none';
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];
    document.getElementById('tiktok-result-keyword').textContent = `"${kw}" (${results.length})`;
    renderResults();
    document.getElementById('tiktok-results').style.display = 'block';
  } catch(e) { document.getElementById('tiktok-loading').style.display='none'; window.app.showToast(e.message,'error'); }
}

function renderResults() {
  const el = document.getElementById('tiktok-video-list');
  if (results.length===0) { el.innerHTML='<p class="empty-state">ไม่พบวิดีโอ</p>'; return; }
  el.innerHTML = results.map((v,i) => `
    <div class="tiktok-video-item ${v.alreadyUploaded?'uploaded':''}">
      <div class="tiktok-select"><input type="checkbox" class="tiktok-cb" data-idx="${i}" ${v.alreadyUploaded?'disabled':''}></div>
      <div class="tiktok-thumb">${v.cover?`<img src="${v.cover}" loading="lazy">`:'<div class="thumb-placeholder">🎬</div>'}</div>
      <div class="tiktok-video-info">
        <div class="tiktok-video-title">${window.app.escapeHtml((v.desc||'').substring(0,100))}</div>
        <div class="tiktok-video-meta">
          <span>@${window.app.escapeHtml(v.author)}</span>
          <span>❤️ ${fmtCount(v.likeCount)}</span>
          <span>▶️ ${fmtCount(v.playCount)}</span>
          ${v.alreadyUploaded?`<span class="badge badge-success">อัปแล้ว</span>`:''}
        </div>
      </div>
      <div class="tiktok-video-actions">
        ${v.alreadyUploaded
          ?`<a href="${v.youtubeUrl}" target="_blank" class="btn btn-secondary btn-sm">🔗 YouTube</a>`
          :`<button class="btn btn-secondary btn-sm" onclick="window.tiktokPage.seoPreview(${i})">💎 SEO</button>
            <button class="btn btn-primary btn-sm" onclick="window.tiktokPage.dlUp(${i})">🚀 โหลด+อัป</button>`}
      </div>
    </div>`).join('');
}

async function dlUrl() {
  const url = document.getElementById('tiktok-url').value.trim();
  if (!url) { window.app.showToast('ใส่ลิงก์', 'error'); return; }
  window.app.showToast('กำลังดาวน์โหลด...', 'info');
  const res = await fetch('/api/tiktok/download', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({videoUrl:url}) });
  const d = await res.json();
  if (d.success) window.app.showToast(`ดาวน์โหลดสำเร็จ: ${d.filename}`, 'success');
  else window.app.showToast(d.error, 'error');
}

async function dlUpUrl() {
  const url = document.getElementById('tiktok-url').value.trim();
  if (!url) { window.app.showToast('ใส่ลิงก์', 'error'); return; }
  window.app.showToast('กำลังดาวน์โหลด+อัป...', 'info');
  const res = await fetch('/api/tiktok/download-and-upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({videoUrl:url}) });
  const d = await res.json();
  if (d.success) { window.app.showToast('อัปโหลดสำเร็จ!', 'success'); showResult(d); }
  else window.app.showToast(d.error, 'error');
}

async function dlUpSingle(idx) {
  const v = results[idx]; if (!v) return;
  window.app.showToast('กำลังดำเนินการ...', 'info');
  const res = await fetch('/api/tiktok/download-and-upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({videoUrl:v.videoUrl, title:(v.desc||'').substring(0,100)}) });
  const d = await res.json();
  if (d.success) { window.app.showToast('สำเร็จ!', 'success'); showResult(d); v.alreadyUploaded=true; v.youtubeUrl=d.youtubeUrl; renderResults(); }
  else window.app.showToast(d.error, 'error');
}

function toggleAll() {
  const cbs = document.querySelectorAll('.tiktok-cb:not(:disabled)');
  const allChecked = Array.from(cbs).every(c=>c.checked);
  cbs.forEach(c=>c.checked=!allChecked);
}

async function batchUpload() {
  const selected = Array.from(document.querySelectorAll('.tiktok-cb:checked')).map(c => {
    const v = results[c.dataset.idx];
    return { videoUrl: v.videoUrl, title: (v.desc||'').substring(0,100) };
  });
  if (selected.length===0) { window.app.showToast('เลือกวิดีโออย่างน้อย 1', 'error'); return; }
  if (!confirm(`อัปโหลด ${selected.length} วิดีโอ?`)) return;
  const res = await fetch('/api/tiktok/batch-upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({videos:selected}) });
  const d = await res.json();
  if (d.success) { window.app.showToast(`เริ่มอัปโหลด ${d.total} วิดีโอ`, 'info'); trackProgress(); }
}

function trackProgress() {
  const el = document.getElementById('tiktok-progress'); el.style.display='block';
  const resEl = document.getElementById('tiktok-batch-results'); resEl.style.display='block'; resEl.innerHTML='';
  const es = new EventSource('/api/tiktok/progress');
  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    document.getElementById('tiktok-progress-text').textContent = d.status==='done'?'🎉 เสร็จ!':d.phase==='downloading'?'⬇️ ดาวน์โหลด':'⬆️ อัปโหลด';
    document.getElementById('tiktok-progress-count').textContent = `${d.current}/${d.total}`;
    document.getElementById('tiktok-progress-file').textContent = d.currentFile||'';
    document.getElementById('tiktok-progress-fill').style.width = (d.total>0?(d.current/d.total)*100:0)+'%';
    if (d.results) resEl.innerHTML = d.results.map(r => r.success
      ? `<div class="drop-result-item">✅ ${window.app.escapeHtml(r.title.substring(0,50))} → <a href="${r.youtubeUrl}" target="_blank">YouTube</a></div>`
      : `<div class="drop-result-item error">❌ ${window.app.escapeHtml(r.title.substring(0,50))} — ${r.error}</div>`
    ).join('');
    if (d.status==='done') { es.close(); search(); }
  };
  es.onerror = () => { es.close(); el.style.display='none'; };
}

function showResult(d) {
  const el = document.getElementById('tiktok-batch-results'); el.style.display='block';
  el.innerHTML += `<div class="drop-result-item">✅ ${window.app.escapeHtml(d.filename||'')} → <a href="${d.youtubeUrl}" target="_blank">${d.youtubeUrl}</a></div>`;
}

function fmtCount(n) { if (!n) return '0'; if (n>=1e6) return (n/1e6).toFixed(1)+'M'; if (n>=1e3) return (n/1e3).toFixed(1)+'K'; return n.toString(); }

async function seoPreview(idx) {
  const v = results[idx]; if (!v) return;
  try {
    const res = await fetch('/api/seo/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desc: v.desc, author: v.author, duration: v.duration || 0 })
    });
    const data = await res.json();
    if (!data.success) { window.app.showToast('SEO preview ล้มเหลว', 'error'); return; }

    const items = document.querySelectorAll('.tiktok-video-item');
    const el = items[idx];
    if (!el) return;
    let panel = el.querySelector('.seo-mini-preview');
    if (panel) { panel.remove(); return; } // toggle off if already shown

    panel = document.createElement('div');
    panel.className = 'seo-mini-preview';
    const tags = (data.metadata.tags || []).slice(0, 8);
    const status = data.metadata.validation.status;
    panel.innerHTML = `
      <div class="seo-mini-title">📌 ${window.app.escapeHtml(data.metadata.title)}</div>
      <div class="seo-mini-tags">${tags.map(t => `<span class="tag-chip-sm">${window.app.escapeHtml(t)}</span>`).join('')}</div>
      <div class="seo-mini-cat">📂 ${window.app.escapeHtml(data.categoryName)} &nbsp; <span class="badge badge-${status==='ok'?'success':status==='warning'?'pending':'error'}">${status==='ok'?'✓ พร้อม monetize':status==='warning'?'⚠️ ควรปรับปรุง':'❌ มีปัญหา'}</span></div>`;
    el.appendChild(panel);
  } catch (err) {
    window.app.showToast('SEO preview error: ' + err.message, 'error');
  }
}

window.tiktokPage = { dlUp: dlUpSingle, seoPreview };
