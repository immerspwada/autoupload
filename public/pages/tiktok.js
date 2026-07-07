// Page: TikTok (/tiktok)
export function render() {
  return `
    <div class="tiktok-section">
      <div class="tiktok-tabs">
        <button class="tiktok-tab active" data-mode="search">🔍 ค้นหา</button>
        <button class="tiktok-tab" data-mode="trending">🔥 Trending</button>
        <button class="tiktok-tab" data-mode="creator">👤 ติดตามครีเอเตอร์</button>
      </div>

      <div class="tiktok-mode" id="mode-search">
        <h3>🎵 TikTok → YouTube</h3>
        <p class="section-desc">ค้นหา → ดาวน์โหลดไม่มีลายน้ำ → อัปโหลดไป YouTube อัตโนมัติ</p>
        <div class="search-box">
          <input type="text" id="tiktok-keyword" placeholder="ค้นหาได้หลายคำ คั่นด้วยคอมม่า เช่น: แมวน่ารัก, cooking tips, เต้น" class="search-input">
          <button id="btn-tiktok-search" class="btn btn-primary">🔍 ค้นหา</button>
        </div>
        <small class="section-desc" style="margin:6px 0 0;">💡 ใส่หลายคีย์เวิร์ดคั่นด้วยคอมม่า (,) เพื่อค้นหาทีเดียวหลายคำ ได้ปริมาณคลิปมากขึ้น (สูงสุด 15 คำ)</small>
        <div class="tiktok-url-box">
          <p class="divider-text">หรือวาง URL TikTok โดยตรง</p>
          <div class="url-input-row">
            <input type="text" id="tiktok-url" placeholder="https://www.tiktok.com/@user/video/..." class="search-input">
            <button id="btn-tiktok-dl" class="btn btn-secondary btn-sm">⬇️ โหลด</button>
            <button id="btn-tiktok-dl-up" class="btn btn-primary btn-sm">🚀 โหลด+อัป</button>
          </div>
        </div>
      </div>

      <div class="tiktok-mode" id="mode-trending" style="display:none;">
        <h3>🔥 คลิป Trending ตอนนี้</h3>
        <p class="section-desc">ค้นพบคลิปมาแรงโดยไม่ต้องใส่คีย์เวิร์ด — algorithm pick สำหรับคุณ</p>
        <div class="search-box">
          <select id="trending-region" class="search-input" style="max-width: 200px;">
            <option value="TH">🇹🇭 ไทย</option>
            <option value="US">🇺🇸 สหรัฐ</option>
            <option value="JP">🇯🇵 ญี่ปุ่น</option>
            <option value="ID">🇮🇩 อินโดนีเซีย</option>
            <option value="VN">🇻🇳 เวียดนาม</option>
          </select>
          <button id="btn-trending" class="btn btn-primary">🔥 ดึงคลิป Trending</button>
        </div>
      </div>

      <div class="tiktok-mode" id="mode-creator" style="display:none;">
        <h3>👤 ติดตามครีเอเตอร์</h3>
        <p class="section-desc">ดึงคลิปล่าสุดจากครีเอเตอร์ที่เลือก — เหมาะสำหรับ track ช่องที่ทำคอนเทนต์ดี</p>
        <div class="search-box">
          <input type="text" id="creator-username" placeholder="@username (เช่น @charliamelio)" class="search-input">
          <button id="btn-creator" class="btn btn-primary">👤 ดึงคลิป</button>
        </div>
        <small class="section-desc" style="margin:6px 0 0;">💡 ใส่ @ หรือไม่ก็ได้ — ระบบจะปรับให้อัตโนมัติ</small>
      </div>

      <div id="tiktok-loading" class="loading-state" style="display:none;"><div class="spinner"></div><p>กำลังโหลด...</p></div>
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
let currentFilters = { hideDuplicates: true, hideBlocked: false, sortBy: 'virality' };

export function init() {
  // Discovery tabs
  document.querySelectorAll('.discovery-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.mode));
  });

  // Search panel
  document.getElementById('btn-tiktok-search').addEventListener('click', search);
  document.getElementById('tiktok-keyword').addEventListener('keypress', e => { if (e.key==='Enter') search(); });
  document.getElementById('btn-tiktok-dl').addEventListener('click', dlUrl);
  document.getElementById('btn-tiktok-dl-up').addEventListener('click', dlUpUrl);

  // Trending panel
  document.getElementById('btn-trending-fetch').addEventListener('click', fetchTrending);

  // Creator panel
  document.getElementById('btn-creator-fetch').addEventListener('click', fetchCreator);
  document.getElementById('creator-username').addEventListener('keypress', e => { if (e.key==='Enter') fetchCreator(); });

  // Results controls
  document.getElementById('btn-tiktok-select-all').addEventListener('click', toggleAll);
  document.getElementById('btn-tiktok-batch').addEventListener('click', batchUpload);
  document.getElementById('filter-hide-duplicates').addEventListener('change', e => { currentFilters.hideDuplicates = e.target.checked; applyFilters(); });
  document.getElementById('filter-hide-blocked').addEventListener('change', e => { currentFilters.hideBlocked = e.target.checked; applyFilters(); });
  document.getElementById('sort-by').addEventListener('change', e => { currentFilters.sortBy = e.target.value; applyFilters(); });
}

function switchTab(mode) {
  document.querySelectorAll('.discovery-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.discovery-panel').forEach(p => p.style.display = 'none');
  document.querySelector(`.discovery-tab[data-mode="${mode}"]`).classList.add('active');
  document.querySelector(`.discovery-panel[data-panel="${mode}"]`).style.display = 'block';
  document.getElementById('tiktok-results').style.display = 'none';
}

async function search() {
  const raw = document.getElementById('tiktok-keyword').value.trim();
  if (!raw) { window.app.showToast('ใส่คีย์เวิร์ด', 'error'); return; }

  const keywordList = raw.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
  if (keywordList.length === 0) { window.app.showToast('ใส่คีย์เวิร์ด', 'error'); return; }

  document.getElementById('tiktok-loading').style.display = 'flex';
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetch('/api/tiktok/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: keywordList, count: 12 })
    });
    const data = await res.json();
    document.getElementById('tiktok-loading').style.display = 'none';
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];

    const label = keywordList.length > 1
      ? `${keywordList.length} คำ: ${keywordList.join(', ')} (${results.length} ผลลัพธ์ไม่ซ้ำ)`
      : `"${keywordList[0]}" (${results.length})`;
    document.getElementById('tiktok-result-keyword').textContent = label;

    renderKeywordBreakdown(data.perKeyword);
    applyFilters();
    document.getElementById('tiktok-results').style.display = 'block';
  } catch(e) { document.getElementById('tiktok-loading').style.display='none'; window.app.showToast(e.message,'error'); }
}

async function fetchTrending() {
  const region = document.getElementById('trending-region').value;
  document.getElementById('tiktok-loading').style.display = 'flex';
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetch(`/api/tiktok/trending?region=${region}&count=12`);
    const data = await res.json();
    document.getElementById('tiktok-loading').style.display = 'none';
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];
    document.getElementById('tiktok-result-keyword').textContent = `🔥 Trending ${data.region} (${results.length})`;
    document.getElementById('tiktok-keyword-breakdown').innerHTML = '';
    applyFilters();
    document.getElementById('tiktok-results').style.display = 'block';
  } catch(e) { document.getElementById('tiktok-loading').style.display='none'; window.app.showToast(e.message,'error'); }
}

async function fetchCreator() {
  let username = document.getElementById('creator-username').value.trim();
  if (!username) { window.app.showToast('ใส่ username', 'error'); return; }
  username = username.replace(/^@/, '');
  document.getElementById('tiktok-loading').style.display = 'flex';
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetch(`/api/tiktok/creator/${encodeURIComponent(username)}?count=12`);
    const data = await res.json();
    document.getElementById('tiktok-loading').style.display = 'none';
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];
    document.getElementById('tiktok-result-keyword').textContent = `👤 @${data.username} (${results.length})`;
    document.getElementById('tiktok-keyword-breakdown').innerHTML = '';
    applyFilters();
    document.getElementById('tiktok-results').style.display = 'block';
  } catch(e) { document.getElementById('tiktok-loading').style.display='none'; window.app.showToast(e.message,'error'); }
}

function renderKeywordBreakdown(perKeyword) {
  const el = document.getElementById('tiktok-keyword-breakdown');
  if (!el) return;
  if (!perKeyword || perKeyword.length <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = perKeyword.map(k => {
    if (k.error) return `<span class="keyword-chip keyword-chip-error" title="${window.app.escapeHtml(k.error)}">❌ ${window.app.escapeHtml(k.keyword)}</span>`;
    return `<span class="keyword-chip">${window.app.escapeHtml(k.keyword)}: ${k.found}</span>`;
  }).join('');
}

function applyFilters() {
  let filtered = [...results];
  
  if (currentFilters.hideDuplicates) {
    filtered = filtered.filter(v => !v.alreadyUploaded);
  }
  
  if (currentFilters.hideBlocked) {
    filtered = filtered.filter(v => v.monetizationStatus !== 'blocked');
  }

  // Sort
  if (currentFilters.sortBy === 'virality') {
    filtered.sort((a, b) => (b.virality?.score || 0) - (a.virality?.score || 0));
  } else if (currentFilters.sortBy === 'likes') {
    filtered.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
  } else if (currentFilters.sortBy === 'views') {
    filtered.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
  }

  renderResults(filtered);
}

function renderResults(filtered = results) {
  const el = document.getElementById('tiktok-video-list');
  if (filtered.length===0) { el.innerHTML='<p class="empty-state">ไม่พบวิดีโอที่ตรงตามเงื่อนไข</p>'; return; }
  
  el.innerHTML = filtered.map((v,i) => {
    const realIdx = results.indexOf(v);
    const viralityBadge = getViralityBadge(v.virality);
    const monetizationBadge = getMonetizationBadge(v.monetizationStatus);
    
    return `
    <div class="tiktok-video-item ${v.alreadyUploaded?'uploaded':''} ${v.monetizationStatus==='blocked'?'blocked':''}">
      <div class="tiktok-select"><input type="checkbox" class="tiktok-cb" data-idx="${realIdx}" ${v.alreadyUploaded || v.monetizationStatus==='blocked'?'disabled':''}></div>
      <div class="tiktok-thumb">
        ${v.cover?`<img src="${v.cover}" loading="lazy">`:'<div class="thumb-placeholder">🎬</div>'}
        ${viralityBadge ? `<div class="virality-overlay">${viralityBadge}</div>` : ''}
      </div>
      <div class="tiktok-video-info">
        <div class="tiktok-video-title">${window.app.escapeHtml((v.desc||'').substring(0,100))}</div>
        <div class="tiktok-video-meta">
          <span>@${window.app.escapeHtml(v.author)}</span>
          <span>❤️ ${fmtCount(v.likeCount)} <small class="engagement-rate">(${((v.likeCount/(v.playCount||1))*100).toFixed(1)}%)</small></span>
          <span>▶️ ${fmtCount(v.playCount)}</span>
          ${v.virality ? `<span class="virality-score" title="Virality Score: ${v.virality.tier}">🔥 ${v.virality.score}</span>` : ''}
          ${monetizationBadge}
          ${v.alreadyUploaded?`<span class="badge badge-success">อัปแล้ว</span>`:''}
        </div>
      </div>
      <div class="tiktok-video-actions">
        ${v.alreadyUploaded
          ?`<a href="${v.youtubeUrl}" target="_blank" class="btn btn-secondary btn-sm">🔗 YouTube</a>`
          : v.monetizationStatus === 'blocked'
          ? `<button class="btn btn-error btn-sm" disabled>❌ บล็อก</button>`
          :`<button class="btn btn-secondary btn-sm" onclick="window.tiktokPage.seoPreview(${realIdx})">💎 SEO</button>
            <button class="btn btn-primary btn-sm" onclick="window.tiktokPage.dlUp(${realIdx})">🚀 โหลด+อัป</button>`}
      </div>
    </div>`;
  }).join('');
}

function getViralityBadge(virality) {
  if (!virality || !virality.tier) return null;
  const badges = {
    viral: '🔥🔥🔥',
    hot: '🔥🔥',
    decent: '🔥',
    low: null
  };
  return badges[virality.tier];
}

function getMonetizationBadge(status) {
  const badges = {
    ok: '<span class="badge badge-success" title="พร้อม monetize">✓</span>',
    warning: '<span class="badge badge-pending" title="ควรปรับปรุง">⚠️</span>',
    blocked: '<span class="badge badge-error" title="ผิดนโยบาย">❌</span>'
  };
  return badges[status] || '';
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
  else if (d.blocked) { window.app.showToast(d.error, 'error'); }
  else window.app.showToast(d.error, 'error');
}

async function dlUpSingle(idx) {
  const v = results[idx]; if (!v) return;
  window.app.showToast('กำลังดำเนินการ...', 'info');
  const res = await fetch('/api/tiktok/download-and-upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({videoUrl:v.videoUrl, title:(v.desc||'').substring(0,100), desc:v.desc, author:v.author, duration:v.duration}) });
  const d = await res.json();
  if (d.success) { window.app.showToast('สำเร็จ!', 'success'); showResult(d); v.alreadyUploaded=true; v.youtubeUrl=d.youtubeUrl; applyFilters(); }
  else if (d.blocked) { window.app.showToast(d.error, 'error'); }
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
    return { videoUrl: v.videoUrl, title: (v.desc||'').substring(0,100), desc: v.desc, author: v.author, duration: v.duration };
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
    if (d.results) resEl.innerHTML = d.results.map(r => {
      if (r.skipped && r.blocked) return `<div class="drop-result-item error">🚫 ${window.app.escapeHtml(r.title.substring(0,50))} — ${r.error}</div>`;
      if (r.skipped) return `<div class="drop-result-item">⏭️ ${window.app.escapeHtml(r.title.substring(0,50))} — ${r.error}</div>`;
      if (r.success) return `<div class="drop-result-item">✅ ${window.app.escapeHtml(r.title.substring(0,50))} → <a href="${r.youtubeUrl}" target="_blank">YouTube</a></div>`;
      return `<div class="drop-result-item error">❌ ${window.app.escapeHtml(r.title.substring(0,50))} — ${r.error}</div>`;
    }).join('');
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
