// Page: TikTok (/tiktok)
export function render() {
  const recentKeywords = getRecentKeywords();
  return `
    <div class="tiktok-section">
      <div class="tiktok-smart-panel">
        <div>
          <div class="smart-panel-kicker">Smart discovery</div>
          <h3>หา TikTok ที่สร้างรายได้ ผู้ติดตาม และ SEO ได้จริง</h3>
          <p class="section-desc">ระบบจะให้คะแนนโอกาสจากรายได้โฆษณา, โอกาสเพิ่มผู้ติดตาม, search intent, engagement, duplicate และความเสี่ยง monetization</p>
        </div>
        <div class="smart-presets" id="smart-presets">
          ${renderKeywordChips(recentKeywords)}
        </div>
      </div>

      <div class="tiktok-tabs">
        <button class="tiktok-tab active" data-mode="search">ค้นหา</button>
        <button class="tiktok-tab" data-mode="trending">Trending</button>
        <button class="tiktok-tab" data-mode="creator">Creator</button>
      </div>

      <div class="tiktok-mode" id="mode-search">
        <h3>TikTok to YouTube</h3>
        <p class="section-desc">ค้นหา → ดาวน์โหลดไม่มีลายน้ำ → อัปโหลดไป YouTube อัตโนมัติ</p>
        <div class="search-box">
          <input type="text" id="tiktok-keyword" placeholder="ค้นหาได้หลายคำ คั่นด้วยคอมม่า เช่น: แมวน่ารัก, cooking tips, เต้น" class="search-input">
          <select id="tiktok-count" class="sort-select smart-count-select" title="จำนวนผลลัพธ์ต่อคำค้น">
            <option value="8">8/คำ</option>
            <option value="12" selected>12/คำ</option>
            <option value="18">18/คำ</option>
          </select>
          <button id="btn-tiktok-search" class="btn btn-primary">ค้นหา</button>
        </div>
        <small class="section-desc" style="margin:6px 0 0;">ใส่หลายคีย์เวิร์ดคั่นด้วยคอมม่า (,) เพื่อค้นหาทีเดียวหลายคำ ได้ปริมาณคลิปมากขึ้น (สูงสุด 15 คำ)</small>
        <div class="tiktok-url-box">
          <p class="divider-text">หรือวาง URL TikTok โดยตรง</p>
          <div class="url-input-row">
            <input type="text" id="tiktok-url" placeholder="https://www.tiktok.com/@user/video/..." class="search-input">
            <button id="btn-tiktok-save" class="btn btn-save btn-sm" title="ดาวน์โหลดไฟล์ .mp4 ลงเครื่องของคุณ">Save ลงเครื่อง</button>
            <button id="btn-tiktok-dl-up" class="btn btn-primary btn-sm">โหลดและอัป YouTube</button>
          </div>
          <div id="tiktok-url-insight" class="url-insight" style="display:none;"></div>
          <small class="section-desc" style="margin:4px 0 0;"><b>Save ลงเครื่อง</b> = โหลด MP4 ไม่มีลายน้ำไว้อัปเองทีหลัง &nbsp;|&nbsp; <b>โหลดและอัป</b> = อัปขึ้น YouTube ทันที</small>
        </div>
      </div>

      <div class="tiktok-mode" id="mode-trending" style="display:none;">
        <h3>คลิป Trending ตอนนี้</h3>
        <p class="section-desc">ค้นพบคลิปมาแรงโดยไม่ต้องใส่คีย์เวิร์ด — algorithm pick สำหรับคุณ</p>
        <div class="search-box">
          <select id="trending-region" class="search-input" style="max-width: 200px;">
            <option value="TH">ไทย</option>
            <option value="US">สหรัฐ</option>
            <option value="JP">ญี่ปุ่น</option>
            <option value="ID">อินโดนีเซีย</option>
            <option value="VN">เวียดนาม</option>
          </select>
          <button id="btn-trending" class="btn btn-primary">ดึงคลิป Trending</button>
        </div>
      </div>

      <div class="tiktok-mode" id="mode-creator" style="display:none;">
        <h3>ติดตามครีเอเตอร์</h3>
        <p class="section-desc">ดึงคลิปล่าสุดจากครีเอเตอร์ที่เลือก — เหมาะสำหรับ track ช่องที่ทำคอนเทนต์ดี</p>
        <div class="search-box">
          <input type="text" id="creator-username" placeholder="@username (เช่น @charliamelio)" class="search-input">
          <button id="btn-creator" class="btn btn-primary">ดึงคลิป</button>
        </div>
        <small class="section-desc" style="margin:6px 0 0;">ใส่ @ หรือไม่ก็ได้ ระบบจะปรับให้อัตโนมัติ</small>
      </div>

      <div id="tiktok-loading" class="loading-state" style="display:none;"><div class="spinner"></div><p>กำลังโหลด...</p></div>
      <div id="tiktok-results" style="display:none;">
        <div class="tiktok-results-header">
          <!-- แถว 1: ชื่อผลลัพธ์ + จำนวน -->
          <div class="results-title-row">
            <span class="results-title" id="tiktok-result-keyword"></span>
            <div id="tiktok-keyword-breakdown" class="keyword-breakdown"></div>
          </div>
          <!-- แถว 2: filter + action แยกฝั่ง -->
          <div class="results-controls-row">
            <div class="results-filters">
              <label class="filter-chip">
                <input type="checkbox" id="filter-hide-duplicates" checked>
                <span>ซ่อนที่อัปแล้ว</span>
              </label>
              <label class="filter-chip">
                <input type="checkbox" id="filter-hide-blocked">
                <span>ซ่อนที่บล็อก</span>
              </label>
              <select id="sort-by" class="sort-select">
                <option value="opportunity">มูลค่ารวม</option>
                <option value="revenue">รายได้</option>
                <option value="followers">ผู้ติดตาม</option>
                <option value="seo">SEO</option>
                <option value="virality">Virality</option>
                <option value="likes">Likes</option>
                <option value="views">Views</option>
                <option value="engagement">Engagement</option>
              </select>
              <select id="filter-min-score" class="sort-select">
                <option value="0">ทุกมูลค่า</option>
                <option value="52">52+ ทดสอบ</option>
                <option value="68">68+ โตช่อง</option>
                <option value="82">82+ พรีเมียม</option>
              </select>
            </div>
            <div class="results-actions">
              <button id="btn-tiktok-smart-select" class="btn btn-secondary btn-sm">เลือกแนะนำ</button>
              <button id="btn-tiktok-select-all" class="btn btn-secondary btn-sm">เลือกทั้งหมด</button>
              <button id="btn-tiktok-batch-save" class="btn btn-save btn-sm">Save</button>
              <button id="btn-tiktok-batch" class="btn btn-primary btn-sm">อัป YouTube</button>
            </div>
          </div>
        </div>
        <div id="tiktok-insights" class="tiktok-insights"></div>
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
let currentVisibleResults = [];
let currentFilters = { hideDuplicates: true, hideBlocked: false, sortBy: 'opportunity', minScore: 0 };
let currentMode = 'search'; // track which tab is active for post-batch refresh
let urlCheckTimer = null;

export function init() {
  // Mode tabs
  document.querySelectorAll('.tiktok-tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // Search panel
  document.getElementById('btn-tiktok-search').addEventListener('click', search);
  document.getElementById('tiktok-keyword').addEventListener('keypress', e => { if (e.key==='Enter') search(); });
  document.getElementById('btn-tiktok-save').addEventListener('click', saveUrlToComputer);
  document.getElementById('btn-tiktok-dl-up').addEventListener('click', dlUpUrl);
  document.getElementById('tiktok-url').addEventListener('input', handleUrlInput);
  document.getElementById('smart-presets')?.addEventListener('click', handlePresetClick);

  // Trending panel
  document.getElementById('btn-trending').addEventListener('click', fetchTrending);

  // Creator panel
  document.getElementById('btn-creator').addEventListener('click', fetchCreator);
  const creatorInput = document.getElementById('creator-username');
  if (creatorInput) {
    creatorInput.addEventListener('keypress', e => { if (e.key==='Enter') fetchCreator(); });
  }

  // Results controls — ใช้ flag เพื่อป้องกัน duplicate delegation listener
  if (!window._tiktokDelegationAttached) {
    window._tiktokDelegationAttached = true;
    document.addEventListener('click', (e) => {
      if (e.target.id === 'btn-tiktok-select-all') {
        toggleAll();
      } else if (e.target.id === 'btn-tiktok-smart-select') {
        selectRecommended();
      } else if (e.target.id === 'btn-tiktok-batch') {
        batchUpload();
      } else if (e.target.id === 'btn-tiktok-batch-save') {
        batchSaveToComputer();
      }
    });
  }

  const list = document.getElementById('tiktok-video-list');
  list?.addEventListener('change', e => {
    if (e.target.classList.contains('tiktok-cb')) updateSelectionSummary();
  });
  list?.addEventListener('click', e => {
    if (e.target.closest('button, a, input')) return;
    const item = e.target.closest('.tiktok-video-item');
    const cb = item?.querySelector('.tiktok-cb:not(:disabled)');
    if (!cb) return;
    cb.checked = !cb.checked;
    updateSelectionSummary();
  });
  
  // Filters
  attachFilterListeners();
}

function attachFilterListeners() {
  const filterDup = document.getElementById('filter-hide-duplicates');
  const filterBlock = document.getElementById('filter-hide-blocked');
  const sortBy = document.getElementById('sort-by');
  const minScore = document.getElementById('filter-min-score');
  
  // ใช้ onchange แทน addEventListener ป้องกัน stacking listener ทุกครั้งที่ search
  if (filterDup) filterDup.onchange = e => { currentFilters.hideDuplicates = e.target.checked; applyFilters(); };
  if (filterBlock) filterBlock.onchange = e => { currentFilters.hideBlocked = e.target.checked; applyFilters(); };
  if (sortBy) sortBy.onchange = e => { currentFilters.sortBy = e.target.value; applyFilters(); };
  if (minScore) minScore.onchange = e => { currentFilters.minScore = parseInt(e.target.value, 10) || 0; applyFilters(); };
}

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.tiktok-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tiktok-mode').forEach(p => p.style.display = 'none');
  document.querySelector(`.tiktok-tab[data-mode="${mode}"]`).classList.add('active');
  document.getElementById(`mode-${mode}`).style.display = 'block';
  document.getElementById('tiktok-results').style.display = 'none';
  document.getElementById('tiktok-batch-results').style.display = 'none';
}

async function search() {
  const raw = document.getElementById('tiktok-keyword').value.trim();
  if (!raw) { window.app.showToast('ใส่คีย์เวิร์ด', 'error'); return; }

  const keywordList = raw.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
  if (keywordList.length === 0) { window.app.showToast('ใส่คีย์เวิร์ด', 'error'); return; }

  const count = parseInt(document.getElementById('tiktok-count')?.value, 10) || 12;
  setLoading(true, `กำลังค้นหา ${keywordList.length} คำ และคัดผลลัพธ์ที่คุ้ม quota...`);
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetch('/api/tiktok/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: keywordList, count })
    });
    const data = await res.json();
    setLoading(false);
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];
    rememberKeywords(keywordList);
    refreshPresetChips();

    const label = keywordList.length > 1
      ? `${keywordList.length} คำ: ${keywordList.join(', ')} (${results.length} ผลลัพธ์ไม่ซ้ำ)`
      : `"${keywordList[0]}" (${results.length})`;
    document.getElementById('tiktok-result-keyword').textContent = label;

    renderKeywordBreakdown(data.perKeyword);
    applyFilters();
    document.getElementById('tiktok-results').style.display = 'block';
    attachFilterListeners();
  } catch(e) { setLoading(false); window.app.showToast(e.message,'error'); }
}

async function fetchTrending() {
  const region = document.getElementById('trending-region').value;
  setLoading(true, `กำลังดึงคลิป trending ${region} และตรวจ duplicate...`);
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetch(`/api/tiktok/trending?region=${region}&count=12`);
    const data = await res.json();
    setLoading(false);
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];
    document.getElementById('tiktok-result-keyword').textContent = `Trending ${data.region} (${results.length})`;
    document.getElementById('tiktok-keyword-breakdown').innerHTML = '';
    applyFilters();
    document.getElementById('tiktok-results').style.display = 'block';
    attachFilterListeners();
  } catch(e) { setLoading(false); window.app.showToast(e.message,'error'); }
}

async function fetchCreator() {
  let username = document.getElementById('creator-username').value.trim();
  if (!username) { window.app.showToast('ใส่ username', 'error'); return; }
  username = username.replace(/^@/, '');
  setLoading(true, `กำลังดึงคลิปล่าสุดจาก @${username}...`);
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetch(`/api/tiktok/creator/${encodeURIComponent(username)}?count=12`);
    const data = await res.json();
    setLoading(false);
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];
    document.getElementById('tiktok-result-keyword').textContent = `@${data.username} (${results.length})`;
    document.getElementById('tiktok-keyword-breakdown').innerHTML = '';
    applyFilters();
    document.getElementById('tiktok-results').style.display = 'block';
    attachFilterListeners();
  } catch(e) { setLoading(false); window.app.showToast(e.message,'error'); }
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

function setLoading(show, message = 'กำลังโหลด...') {
  const el = document.getElementById('tiktok-loading');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
  const text = el.querySelector('p');
  if (text) text.textContent = message;
}

function handlePresetClick(e) {
  const chip = e.target.closest('[data-keyword]');
  if (!chip) return;
  const input = document.getElementById('tiktok-keyword');
  input.value = chip.dataset.keyword;
  switchMode('search');
  search();
}

function getRecentKeywords() {
  try {
    const saved = JSON.parse(localStorage.getItem('tiktokRecentKeywords') || '[]');
    if (Array.isArray(saved) && saved.length) return saved.slice(0, 6);
  } catch (_) {}
  return ['แมวน่ารัก', 'street food thailand', 'cooking tips', 'travel thailand', 'แต่งบ้าน', 'fitness tips'];
}

function rememberKeywords(keywordList) {
  const current = getRecentKeywords();
  const merged = [...keywordList, ...current]
    .map(k => k.trim())
    .filter(Boolean)
    .filter((k, i, arr) => arr.findIndex(x => x.toLowerCase() === k.toLowerCase()) === i)
    .slice(0, 8);
  localStorage.setItem('tiktokRecentKeywords', JSON.stringify(merged));
}

function renderKeywordChips(keywords) {
  return keywords.map(k => `<button class="smart-preset-chip" data-keyword="${window.app.escapeHtml(k)}">${window.app.escapeHtml(k)}</button>`).join('');
}

function refreshPresetChips() {
  const el = document.getElementById('smart-presets');
  if (el) el.innerHTML = renderKeywordChips(getRecentKeywords());
}

function applyFilters() {
  let filtered = [...results];
  
  if (currentFilters.hideDuplicates) {
    filtered = filtered.filter(v => !v.alreadyUploaded);
  }
  
  if (currentFilters.hideBlocked) {
    filtered = filtered.filter(v => v.monetizationStatus !== 'blocked');
  }

  if (currentFilters.minScore > 0) {
    filtered = filtered.filter(v => getOpportunityScore(v) >= currentFilters.minScore);
  }

  // Sort
  if (currentFilters.sortBy === 'opportunity') {
    filtered.sort((a, b) => getOpportunityScore(b) - getOpportunityScore(a));
  } else if (currentFilters.sortBy === 'revenue') {
    filtered.sort((a, b) => getRevenueScore(b) - getRevenueScore(a));
  } else if (currentFilters.sortBy === 'followers') {
    filtered.sort((a, b) => getFollowerScore(b) - getFollowerScore(a));
  } else if (currentFilters.sortBy === 'seo') {
    filtered.sort((a, b) => getSeoScore(b) - getSeoScore(a));
  } else if (currentFilters.sortBy === 'virality') {
    filtered.sort((a, b) => (b.virality?.score || 0) - (a.virality?.score || 0));
  } else if (currentFilters.sortBy === 'likes') {
    filtered.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
  } else if (currentFilters.sortBy === 'views') {
    filtered.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
  } else if (currentFilters.sortBy === 'engagement') {
    filtered.sort((a, b) => getEngagementRate(b) - getEngagementRate(a));
  }

  currentVisibleResults = filtered;
  renderInsights(filtered);
  renderResults(filtered);
}

function getEngagementRate(v) {
  const reactions = (v.likeCount || 0) + (v.commentCount || 0) + (v.shareCount || 0);
  return reactions / Math.max(v.playCount || 1, 1);
}

function getOpportunityScore(v) {
  return v.opportunity?.score ?? v.virality?.score ?? 0;
}

function getRevenueScore(v) {
  return v.opportunity?.revenue ?? Math.round(getOpportunityScore(v) * 0.7);
}

function getFollowerScore(v) {
  return v.opportunity?.follower ?? Math.round(getOpportunityScore(v) * 0.75);
}

function getSeoScore(v) {
  return v.opportunity?.seo ?? Math.round(getOpportunityScore(v) * 0.65);
}

function getOpportunityClass(score) {
  if (score >= 82) return 'premium';
  if (score >= 68) return 'growth';
  if (score >= 52) return 'test';
  return 'skip';
}

function getReadyVideos(list = results) {
  return list.filter(v => !v.alreadyUploaded && v.monetizationStatus !== 'blocked');
}

function renderInsights(filtered) {
  const el = document.getElementById('tiktok-insights');
  if (!el) return;
  const ready = getReadyVideos(results).length;
  const blocked = results.filter(v => v.monetizationStatus === 'blocked').length;
  const duplicates = results.filter(v => v.alreadyUploaded).length;
  const avgScore = results.length
    ? Math.round(results.reduce((sum, v) => sum + getOpportunityScore(v), 0) / results.length)
    : 0;
  const premium = results.filter(v => getOpportunityScore(v) >= 82 && !v.alreadyUploaded && v.monetizationStatus !== 'blocked').length;
  const avgSeo = results.length
    ? Math.round(results.reduce((sum, v) => sum + getSeoScore(v), 0) / results.length)
    : 0;
  const top = filtered[0];
  const topText = top
    ? `แนะนำอันดับ 1: ${window.app.escapeHtml((top.desc || 'Untitled').substring(0, 54))} | ${top.opportunity?.recommendedAction || 'เลือกจากคะแนนมูลค่าสูงสุด'}`
    : 'ไม่มีคลิปที่ผ่านตัวกรองตอนนี้';

  el.innerHTML = `
    <div class="insight-card">
      <span class="insight-value">${filtered.length}</span>
      <span class="insight-label">แสดงผล</span>
    </div>
    <div class="insight-card success">
      <span class="insight-value">${ready}</span>
      <span class="insight-label">พร้อมอัป</span>
    </div>
    <div class="insight-card">
      <span class="insight-value">${avgScore}</span>
      <span class="insight-label">มูลค่าเฉลี่ย</span>
    </div>
    <div class="insight-card success">
      <span class="insight-value">${premium}</span>
      <span class="insight-label">พรีเมียม</span>
    </div>
    <div class="insight-card warning">
      <span class="insight-value">${avgSeo}</span>
      <span class="insight-label">SEO เฉลี่ย</span>
    </div>
    <div class="insight-card danger">
      <span class="insight-value">${duplicates + blocked}</span>
      <span class="insight-label">เสีย quota</span>
    </div>
    <div class="insight-recommendation" id="selection-summary">${topText}</div>`;
}

function renderResults(filtered = results) {
  const el = document.getElementById('tiktok-video-list');
  if (filtered.length===0) {
    el.innerHTML='<p class="empty-state">ไม่พบวิดีโอที่ตรงตามเงื่อนไข ลองลดคะแนนขั้นต่ำหรือปิดตัวกรองบางตัว</p>';
    updateSelectionSummary();
    return;
  }
  
  el.innerHTML = filtered.map((v,i) => {
    const realIdx = results.indexOf(v);
    const viralityBadge = getViralityBadge(v.virality);
    const monetizationBadge = getMonetizationBadge(v.monetizationStatus);
    const score = getOpportunityScore(v);
    const qualityClass = getOpportunityClass(score);
    const opportunity = v.opportunity || {};
    
    return `
    <div class="tiktok-video-item ${v.alreadyUploaded?'uploaded':''} ${v.monetizationStatus==='blocked'?'blocked':''}" data-idx="${realIdx}">
      <div class="tiktok-select"><input type="checkbox" class="tiktok-cb" data-idx="${realIdx}" ${v.monetizationStatus==='blocked'?'disabled':''}></div>
      <div class="tiktok-thumb">
        ${v.cover?`<img src="${v.cover}" loading="lazy">`:'<div class="thumb-placeholder">🎬</div>'}
        ${viralityBadge ? `<div class="virality-overlay">${viralityBadge}</div>` : ''}
      </div>
      <div class="tiktok-video-info">
        <div class="quality-row">
          <span class="quality-pill ${qualityClass}">Value ${score}</span>
          <span class="value-mini-pill">รายได้ ${getRevenueScore(v)}</span>
          <span class="value-mini-pill">ผู้ติดตาม ${getFollowerScore(v)}</span>
          <span class="value-mini-pill">SEO ${getSeoScore(v)}</span>
          ${opportunity.intent ? `<span class="intent-pill">${window.app.escapeHtml(opportunity.intent)}</span>` : ''}
          ${v.matchedKeywords?.length ? `<span class="matched-keywords">${v.matchedKeywords.map(k => window.app.escapeHtml(k)).join(', ')}</span>` : ''}
        </div>
        <div class="tiktok-video-title">${window.app.escapeHtml((v.desc||'').substring(0,100))}</div>
        ${opportunity.angle ? `<div class="opportunity-angle">${window.app.escapeHtml(opportunity.angle)}</div>` : ''}
        <div class="tiktok-video-meta">
          <span>@${window.app.escapeHtml(v.author)}</span>
          <span>Likes ${fmtCount(v.likeCount)} <small class="engagement-rate">(${(getEngagementRate(v)*100).toFixed(1)}%)</small></span>
          <span>Views ${fmtCount(v.playCount)}</span>
          ${v.duration ? `<span>${formatDuration(v.duration)}</span>` : ''}
          ${monetizationBadge}
          ${v.alreadyUploaded?`<span class="badge badge-success">อัปแล้ว</span>`:''}
        </div>
      </div>
      <div class="tiktok-video-actions">
        ${v.alreadyUploaded
          ?`<button class="btn btn-save btn-sm" onclick="window.tiktokPage.saveToComputer(${realIdx})" title="โหลดไฟล์ MP4 ลงเครื่อง">💾 Save</button>
            <a href="${v.youtubeUrl}" target="_blank" class="btn btn-secondary btn-sm">🔗 YouTube</a>`
          : v.monetizationStatus === 'blocked'
          ? `<button class="btn btn-save btn-sm" onclick="window.tiktokPage.saveToComputer(${realIdx})" title="โหลดไฟล์ MP4 ลงเครื่อง">💾 Save</button>
             <button class="btn btn-error btn-sm" disabled>❌ บล็อก</button>`
          :`<button class="btn btn-save btn-sm" onclick="window.tiktokPage.saveToComputer(${realIdx})" title="โหลดไฟล์ MP4 ลงเครื่อง">💾 Save</button>
            <button class="btn btn-secondary btn-sm" onclick="window.tiktokPage.seoPreview(${realIdx})">SEO Plan</button>
            <button class="btn btn-primary btn-sm" onclick="window.tiktokPage.dlUp(${realIdx})">🚀 อัป YouTube</button>`}
      </div>
    </div>`;
  }).join('');
  updateSelectionSummary();
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

function formatDuration(seconds) {
  const s = parseInt(seconds, 10);
  if (!s || s < 0) return '';
  const m = Math.floor(s / 60);
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

function updateSelectionSummary() {
  const checked = Array.from(document.querySelectorAll('.tiktok-cb:checked'));
  const selected = checked.map(c => results[c.dataset.idx]).filter(Boolean);
  const uploadable = selected.filter(v => !v.alreadyUploaded && v.monetizationStatus !== 'blocked');
  const saveBtn = document.getElementById('btn-tiktok-batch-save');
  const uploadBtn = document.getElementById('btn-tiktok-batch');
  const selectBtn = document.getElementById('btn-tiktok-select-all');
  const summary = document.getElementById('selection-summary');

  if (saveBtn) saveBtn.textContent = selected.length ? `Save ${selected.length}` : 'Save';
  if (uploadBtn) uploadBtn.textContent = uploadable.length ? `อัป ${uploadable.length} คลิป` : 'อัป YouTube';

  const selectable = Array.from(document.querySelectorAll('.tiktok-cb:not(:disabled)'));
  if (selectBtn) {
    const allChecked = selectable.length > 0 && selectable.every(c => c.checked);
    selectBtn.textContent = allChecked ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด';
  }

  if (summary && selected.length) {
    const avg = Math.round(uploadable.reduce((sum, v) => sum + getOpportunityScore(v), 0) / Math.max(uploadable.length, 1));
    const seoAvg = Math.round(uploadable.reduce((sum, v) => sum + getSeoScore(v), 0) / Math.max(uploadable.length, 1));
    summary.textContent = `เลือกแล้ว ${selected.length} คลิป | อัปได้ ${uploadable.length} คลิป | value เฉลี่ย ${avg} | SEO เฉลี่ย ${seoAvg}`;
  }
}

function selectRecommended() {
  const candidates = currentVisibleResults
    .filter(v => !v.alreadyUploaded && v.monetizationStatus !== 'blocked')
    .sort((a, b) => {
      const scoreDiff = getOpportunityScore(b) - getOpportunityScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      const seoDiff = getSeoScore(b) - getSeoScore(a);
      if (seoDiff !== 0) return seoDiff;
      return getRevenueScore(b) - getRevenueScore(a);
    });

  if (candidates.length === 0) {
    window.app.showToast('ไม่มีคลิปที่ระบบแนะนำในตัวกรองนี้', 'info');
    return;
  }

  const selected = [];
  const authorCount = new Map();
  for (const video of candidates) {
    const score = getOpportunityScore(video);
    const minScore = currentFilters.minScore || 52;
    if (score < Math.max(52, minScore)) continue;
    const author = video.author || 'unknown';
    if ((authorCount.get(author) || 0) >= 2) continue;
    selected.push(video);
    authorCount.set(author, (authorCount.get(author) || 0) + 1);
    if (selected.length >= 6) break;
  }

  if (selected.length === 0) selected.push(...candidates.slice(0, Math.min(3, candidates.length)));
  const selectedIdx = new Set(selected.map(v => String(results.indexOf(v))));
  document.querySelectorAll('.tiktok-cb').forEach(cb => {
    cb.checked = selectedIdx.has(cb.dataset.idx);
  });
  updateSelectionSummary();
  window.app.showToast(`เลือกคลิปมูลค่าสูง ${selected.length} รายการ`, 'success');
}

function handleUrlInput(e) {
  const url = e.target.value.trim();
  const el = document.getElementById('tiktok-url-insight');
  clearTimeout(urlCheckTimer);
  if (!el) return;
  if (!url) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  if (!/tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(url)) {
    el.style.display = 'block';
    el.className = 'url-insight warning';
    el.textContent = 'ลิงก์นี้ยังดูไม่เหมือน TikTok URL';
    return;
  }

  el.style.display = 'block';
  el.className = 'url-insight';
  el.textContent = 'กำลังตรวจว่าเคยอัปแล้วหรือยัง...';
  urlCheckTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/tiktok/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: url })
      });
      const data = await res.json();
      if (data.duplicate) {
        el.className = 'url-insight warning';
        el.innerHTML = `เคยอัปแล้ว${data.youtubeUrl ? ` | <a href="${data.youtubeUrl}" target="_blank">เปิด YouTube</a>` : ''}`;
      } else {
        el.className = 'url-insight success';
        el.textContent = 'ยังไม่พบประวัติซ้ำ พร้อม Save หรืออัป YouTube';
      }
    } catch (err) {
      el.className = 'url-insight warning';
      el.textContent = 'ตรวจประวัติซ้ำไม่ได้ แต่ยัง Save ได้';
    }
  }, 450);
}

// ==================== Save to Computer (Browser Download) ====================

/**
 * ดาวน์โหลด TikTok → ส่งไฟล์ MP4 ให้ browser save ลงเครื่อง
 * ใช้ <a download> trick เพื่อ trigger browser save dialog
 */
async function _downloadFileToBrowser(videoUrl, suggestedFilename, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '⏳ กำลังโหลด...';
  }

  try {
    // POST → server downloads no-watermark → streams back
    const res = await fetch('/api/tiktok/download-to-browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl, filename: suggestedFilename })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // Get filename from Content-Disposition header
    const disposition = res.headers.get('content-disposition') || '';
    const nameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = nameMatch ? nameMatch[1] : (suggestedFilename || 'tiktok-video.mp4');

    // Stream response → Blob → trigger browser download
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    window.app.showToast(`💾 บันทึก ${filename} สำเร็จ`, 'success');

  } catch (err) {
    window.app.showToast(`❌ Save ล้มเหลว: ${err.message}`, 'error');
    console.error('Save to computer error:', err);
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = '💾 Save';
    }
  }
}

/** ปุ่ม "💾 Save ลงเครื่อง" จาก URL input */
async function saveUrlToComputer() {
  const url = document.getElementById('tiktok-url').value.trim();
  if (!url) { window.app.showToast('ใส่ลิงก์ TikTok ก่อน', 'error'); return; }
  const btn = document.getElementById('btn-tiktok-save');
  await _downloadFileToBrowser(url, null, btn);
}

/** ปุ่ม "💾 Save" ใน video card */
async function saveToComputer(idx) {
  const v = results[idx];
  if (!v) return;

  // หา button ที่ถูกกด
  const btn = document.querySelector(`.tiktok-cb[data-idx="${idx}"]`)
    ?.closest('.tiktok-video-item')
    ?.querySelector('button[onclick*="saveToComputer"]');

  const suggested = (v.desc || `tiktok_${v.id || Date.now()}`).substring(0, 60).replace(/[^\w\s\-ก-๙]/g, '');
  await _downloadFileToBrowser(v.videoUrl, suggested, btn);
}

/** ปุ่ม "💾 Save ที่เลือก" — โหลดทีละไฟล์ พร้อม delay เพื่อไม่ให้ browser block popup */
async function batchSaveToComputer() {
  const selected = Array.from(document.querySelectorAll('.tiktok-cb:checked'))
    .map(c => results[c.dataset.idx])
    .filter(Boolean); // allow saving alreadyUploaded too (user may want to re-download)
  if (selected.length === 0) { window.app.showToast('เลือกวิดีโออย่างน้อย 1', 'error'); return; }
  if (selected.length > 10) {
    if (!confirm(`จะโหลด ${selected.length} ไฟล์ลงเครื่อง ใช้เวลานาน — ดำเนินการต่อ?`)) return;
  }

  const btn = document.getElementById('btn-tiktok-batch-save');
  if (btn) { btn.disabled = true; btn.textContent = `⏳ 0/${selected.length}`; }

  const resEl = document.getElementById('tiktok-batch-results');
  resEl.style.display = 'block';
  resEl.innerHTML = `<div style="padding:8px 0;font-weight:600;">💾 กำลัง Save ${selected.length} ไฟล์...</div>`;

  let done = 0, failed = 0;

  for (const v of selected) {
    const suggested = (v.desc || `tiktok_${v.id || Date.now()}`).substring(0, 60).replace(/[^\w\s\-ก-๙]/g, '');
    try {
      resEl.innerHTML += `<div class="drop-result-item" id="save-${v.id || done}">⏳ ${window.app.escapeHtml((v.desc||'').substring(0,50))}...</div>`;

      const res = await fetch('/api/tiktok/download-to-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: v.videoUrl, filename: suggested })
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }

      const disposition = res.headers.get('content-disposition') || '';
      const nameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = nameMatch ? nameMatch[1] : suggested + '.mp4';

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      done++;
      const el = document.getElementById(`save-${v.id || done - 1}`);
      if (el) el.innerHTML = `✅ ${window.app.escapeHtml((v.desc||'').substring(0,50))} — ${filename}`;

    } catch (err) {
      failed++;
      const el = document.getElementById(`save-${v.id || done}`);
      if (el) el.innerHTML = `<span class="error">❌ ${window.app.escapeHtml((v.desc||'').substring(0,50))} — ${err.message}</span>`;
    }

    if (btn) btn.textContent = `⏳ ${done + failed}/${selected.length}`;

    // delay ระหว่างไฟล์เพื่อให้ browser ตั้งตัวทัน
    if (done + failed < selected.length) await new Promise(r => setTimeout(r, 1500));
  }

  if (btn) { btn.disabled = false; btn.textContent = '💾 Save ที่เลือก'; }
  window.app.showToast(`💾 Save สำเร็จ ${done} ไฟล์${failed > 0 ? ` (ล้มเหลว ${failed})` : ''}`, done > 0 ? 'success' : 'error');
}

async function dlUpUrl() {
  const url = document.getElementById('tiktok-url').value.trim();
  if (!url) { window.app.showToast('ใส่ลิงก์', 'error'); return; }
  const btn = document.getElementById('btn-tiktok-dl-up');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    window.app.showToast('กำลังดาวน์โหลด+อัป...', 'info');
    const res = await fetch('/api/tiktok/download-and-upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({videoUrl:url}) });
    const d = await res.json();
    if (d.success) { window.app.showToast('อัปโหลดสำเร็จ!', 'success'); showResult(d); }
    else { window.app.showToast(d.error || 'เกิดข้อผิดพลาด', 'error'); }
  } catch(err) {
    window.app.showToast('Network error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 โหลด+อัป YouTube'; }
  }
}

async function dlUpSingle(idx) {
  const v = results[idx]; if (!v) return;
  // Find button and disable it
  const btn = document.querySelector(`.tiktok-cb[data-idx="${idx}"]`)
    ?.closest('.tiktok-video-item')
    ?.querySelector('button[onclick*="dlUp"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    window.app.showToast('กำลังดำเนินการ...', 'info');
    const res = await fetch('/api/tiktok/download-and-upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({videoUrl:v.videoUrl, title:(v.desc||'').substring(0,100), desc:v.desc, author:v.author, duration:v.duration}) });
    const d = await res.json();
    if (d.success) {
      window.app.showToast('สำเร็จ!', 'success');
      showResult(d);
      v.alreadyUploaded = true;
      v.youtubeUrl = d.youtubeUrl;
      applyFilters();
    } else {
      window.app.showToast(d.error || 'เกิดข้อผิดพลาด', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🚀 อัป YouTube'; }
    }
  } catch(err) {
    window.app.showToast('Network error: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🚀 อัป YouTube'; }
  }
}

function toggleAll() {
  const cbs = Array.from(document.querySelectorAll('.tiktok-cb:not(:disabled)'));
  if (cbs.length === 0) { window.app.showToast('ไม่มีวิดีโอที่เลือกได้', 'info'); return; }
  // ถ้ายังไม่ได้เลือกทั้งหมด → เลือกทั้งหมด, ถ้าเลือกหมดแล้ว → ยกเลิกทั้งหมด
  const allChecked = cbs.every(c => c.checked);
  cbs.forEach(c => { c.checked = !allChecked; });
  updateSelectionSummary();
}

async function batchUpload() {
  // filter out alreadyUploaded even if checkbox was checked
  const selected = Array.from(document.querySelectorAll('.tiktok-cb:checked'))
    .map(c => results[c.dataset.idx])
    .filter(v => v && !v.alreadyUploaded && v.monetizationStatus !== 'blocked')
    .map(v => ({
      videoUrl: v.videoUrl,
      id: v.videoUrl,
      title: (v.desc||'').substring(0,100),
      desc: v.desc,
      author: v.author,
      duration: v.duration,
      virality: v.virality || { score: 0 },
      viralityScore: v.virality?.score || 0,
      opportunity: v.opportunity || null,
      opportunityScore: getOpportunityScore(v),
      revenueScore: getRevenueScore(v),
      followerScore: getFollowerScore(v),
      seoScore: getSeoScore(v),
      monetizationStatus: v.monetizationStatus,
      playCount: v.playCount || 0,
      likeCount: v.likeCount || 0,
      commentCount: v.commentCount || 0,
      shareCount: v.shareCount || 0,
      createTime: v.createTime || null
    }));
  
  if (selected.length===0) { window.app.showToast('เลือกวิดีโออย่างน้อย 1', 'error'); return; }

  const preview = await previewSmartBatch(selected);
  if (preview && preview.success) {
    const allowed = preview.videos?.allowed || [];
    const rejected = preview.videos?.rejected || [];
    const top = allowed.slice(0, 5).map((v, i) => {
      const reasons = Array.isArray(v.reasons) && v.reasons.length ? ` - ${v.reasons.slice(0, 2).join(', ')}` : '';
      return `${i + 1}. ${(v.title || 'Untitled').slice(0, 46)} (${v.smartScore})${reasons}`;
    }).join('\n');
    const msg = `Smart Batch Preview\n\nเลือกได้ ${allowed.length}/${selected.length} คลิป\nตัดออก ${rejected.length} คลิป\n${preview.reason}\n\n${top ? `คลิปอันดับแรก:\n${top}\n\n` : ''}เริ่มอัปโหลดตามแผนนี้ไหม?`;
    if (!confirm(msg)) return;
  } else if (!confirm(`อัปโหลด ${selected.length} วิดีโอ?`)) {
    return;
  }
  
  try {
    const res = await fetch('/api/tiktok/batch-upload', { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body: JSON.stringify({videos:selected}) 
    });
    const d = await res.json();
    
    // Handle quota/duplicate errors
    if (res.status === 409) {
      window.app.showToast(d.error || 'Quota ไม่พอหรือมีวิดีโอซ้ำ', 'error');
      if (d.quotaStatus) {
        console.log('Quota status:', d.quotaStatus);
      }
      return;
    }
    
    // Handle Smart Upload response (filtered by quota)
    if (d.success && d.smartFiltered) {
      const allowed = d.videos?.allowed || [];
      const preview = allowed.slice(0, 5).map((v, i) => {
        const reasons = Array.isArray(v.reasons) && v.reasons.length ? ` - ${v.reasons.slice(0, 2).join(', ')}` : '';
        return `${i + 1}. ${(v.title || 'Untitled').slice(0, 46)} (${v.smartScore ?? v.viralityScore})${reasons}`;
      }).join('\n');
      const msg = `Smart Upload จะอัปเฉพาะ ${d.total}/${selected.length} คลิปที่คุ้ม quota ที่สุด\n\n${d.reason}\n\n${preview ? `คลิปที่จะเลือก:\n${preview}\n\n` : ''}ดำเนินการต่อไหม?`;
      if (!confirm(msg)) return;

      // Re-send only the allowed videos with force=true to skip re-filtering
      const allowedIds = new Set(allowed.map(v => v.id || v.videoUrl || v.title));
      const filteredVideos = selected
        .filter(v => allowedIds.has(v.id || v.videoUrl || v.title))
        .slice(0, d.total);
      try {
        const res2 = await fetch('/api/tiktok/batch-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videos: filteredVideos, force: true })
        });
        const d2 = await res2.json();
        if (d2.success) {
          window.app.showToast(`เริ่มอัปโหลด ${d2.total} วิดีโอ`, 'info');
          trackProgress();
        } else {
          window.app.showToast(d2.error || 'เกิดข้อผิดพลาด', 'error');
        }
      } catch (err2) {
        window.app.showToast('Network error: ' + err2.message, 'error');
      }
      return;
    }
    
    if (d.success) { 
      window.app.showToast(`เริ่มอัปโหลด ${d.total} วิดีโอ`, 'info'); 
      trackProgress(); 
    } else {
      window.app.showToast(d.error || 'เกิดข้อผิดพลาด', 'error');
    }
  } catch (err) {
    window.app.showToast('Network error: ' + err.message, 'error');
  }
}

async function previewSmartBatch(selected) {
  try {
    const res = await fetch('/api/tiktok/batch-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos: selected })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('Smart batch preview failed:', err);
    return null;
  }
}

function trackProgress() {
  const el = document.getElementById('tiktok-progress'); el.style.display='block';
  const resEl = document.getElementById('tiktok-batch-results'); resEl.style.display='block'; resEl.innerHTML='';
  const es = new EventSource('/api/tiktok/progress');
  es.onmessage = (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch (_) { return; } // skip malformed frames
    document.getElementById('tiktok-progress-text').textContent = d.status==='done'?'🎉 เสร็จ!':d.phase==='downloading'?'⬇️ ดาวน์โหลด':'⬆️ อัปโหลด';
    document.getElementById('tiktok-progress-count').textContent = `${d.current}/${d.total}`;
    document.getElementById('tiktok-progress-file').textContent = d.currentFile||'';
    document.getElementById('tiktok-progress-fill').style.width = (d.total>0?(d.current/d.total)*100:0)+'%';
    if (d.results) resEl.innerHTML = d.results.map(r => {
      if (r.skipped && r.blocked) return `<div class="drop-result-item error">🚫 ${window.app.escapeHtml(r.title.substring(0,50))} — ${window.app.escapeHtml(r.error)}</div>`;
      if (r.skipped) return `<div class="drop-result-item">⏭️ ${window.app.escapeHtml(r.title.substring(0,50))} — ${window.app.escapeHtml(r.error)}</div>`;
      if (r.success) return `<div class="drop-result-item">✅ ${window.app.escapeHtml(r.title.substring(0,50))} → <a href="${r.youtubeUrl}" target="_blank">YouTube</a></div>`;
      return `<div class="drop-result-item error">❌ ${window.app.escapeHtml(r.title.substring(0,50))} — ${window.app.escapeHtml(r.error||'')}</div>`;
    }).join('');
    if (d.status==='done') { 
      es.close(); 
      document.getElementById('tiktok-progress').style.display = 'none';
      // Refresh current mode to show updated upload status
      if (currentMode === 'trending') fetchTrending();
      else if (currentMode === 'creator') fetchCreator();
      else search();
    }
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
    // Find the item that owns this index via data attribute
    const el = document.querySelector(`.tiktok-video-item .tiktok-cb[data-idx="${idx}"]`)?.closest('.tiktok-video-item');
    if (!el) return;
    let panel = el.querySelector('.seo-mini-preview');
    if (panel) { panel.remove(); return; } // toggle off if already shown

    panel = document.createElement('div');
    panel.className = 'seo-mini-preview';
    const tags = (data.metadata.tags || []).slice(0, 8);
    const status = data.metadata.validation.status;
    const opportunity = v.opportunity || {};
    const checks = data.metadata.quality?.checks || [];
    const reasons = opportunity.reasons || [];
    const warnings = opportunity.warnings || [];
    panel.innerHTML = `
      <div class="seo-plan-grid">
        <div class="seo-plan-score ${getOpportunityClass(getOpportunityScore(v))}">
          <strong>${getOpportunityScore(v)}</strong>
          <span>Value</span>
        </div>
        <div class="seo-plan-metrics">
          <span>รายได้ ${getRevenueScore(v)}</span>
          <span>ผู้ติดตาม ${getFollowerScore(v)}</span>
          <span>SEO ${getSeoScore(v)}</span>
        </div>
      </div>
      <div class="seo-mini-title">📌 ${window.app.escapeHtml(data.metadata.title)}</div>
      <div class="seo-mini-tags">${tags.map(t => `<span class="tag-chip-sm">${window.app.escapeHtml(t)}</span>`).join('')}</div>
      <div class="seo-mini-cat">📂 ${window.app.escapeHtml(data.categoryName)} &nbsp; <span class="badge badge-${status==='ok'?'success':status==='warning'?'pending':'error'}">${status==='ok'?'✓ พร้อม monetize':status==='warning'?'⚠️ ควรปรับปรุง':'❌ มีปัญหา'}</span></div>
      ${opportunity.angle ? `<div class="seo-plan-angle">${window.app.escapeHtml(opportunity.angle)}</div>` : ''}
      ${opportunity.recommendedAction ? `<div class="seo-plan-action">${window.app.escapeHtml(opportunity.recommendedAction)}</div>` : ''}
      <div class="seo-plan-lists">
        ${reasons.length ? `<div><strong>เหตุผลที่คุ้ม</strong>${reasons.map(r => `<span>${window.app.escapeHtml(r)}</span>`).join('')}</div>` : ''}
        ${warnings.length ? `<div><strong>ต้องระวัง</strong>${warnings.map(w => `<span>${window.app.escapeHtml(w)}</span>`).join('')}</div>` : ''}
        ${checks.length ? `<div><strong>SEO checks</strong>${checks.slice(0, 3).map(c => `<span>${window.app.escapeHtml(c.message)}</span>`).join('')}</div>` : ''}
      </div>`;
    el.appendChild(panel);
  } catch (err) {
    window.app.showToast('SEO preview error: ' + err.message, 'error');
  }
}

window.tiktokPage = { dlUp: dlUpSingle, seoPreview, saveToComputer };
