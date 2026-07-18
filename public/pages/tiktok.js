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
        <button class="tiktok-tab" data-mode="watchlist">Watchlist ⚡</button>
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

      <!-- ══ Watchlist Mode ══════════════════════════════════════ -->
      <div class="tiktok-mode" id="mode-watchlist" style="display:none;">
        <div class="watchlist-header">
          <div>
            <h3>Keyword Watchlist</h3>
            <p class="section-desc">Scheduler จะค้นหาและอัปโหลดตาม keywords เหล่านี้ทุกรอบโดยอัตโนมัติ</p>
          </div>
          <div class="btn-row">
            <button class="btn btn-secondary btn-sm" id="btn-watchlist-run">รันตอนนี้</button>
            <button class="btn btn-primary btn-sm" id="btn-watchlist-add-open">+ เพิ่ม Keyword</button>
          </div>
        </div>

        <!-- Stats bar -->
        <div id="watchlist-stats" class="watchlist-stats"></div>

        <!-- Add keyword form (hidden by default) -->
        <div id="watchlist-add-form" class="watchlist-add-form" style="display:none;">
          <div class="watchlist-form-grid">
            <div class="form-group">
              <label>Keyword</label>
              <input type="text" id="wl-keyword" placeholder="เช่น แมวน่ารัก, cooking tips" class="search-input">
            </div>
            <div class="form-group">
              <label>คลิปต่อรอบ</label>
              <select id="wl-count" class="sort-select">
                <option value="4">4</option>
                <option value="6">6</option>
                <option value="8" selected>8</option>
                <option value="12">12</option>
              </select>
            </div>
            <div class="form-group">
              <label>คะแนนขั้นต่ำ</label>
              <select id="wl-minscore" class="sort-select">
                <option value="0">ทั้งหมด</option>
                <option value="52" selected>52+ ทดสอบ</option>
                <option value="68">68+ ดี</option>
                <option value="82">82+ พรีเมียม</option>
              </select>
            </div>
          </div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn btn-primary btn-sm" id="btn-watchlist-save">บันทึก</button>
            <button class="btn btn-secondary btn-sm" id="btn-watchlist-cancel">ยกเลิก</button>
          </div>
        </div>

        <!-- Keyword list -->
        <div id="watchlist-list" class="watchlist-list">
          <p class="empty-state">กำลังโหลด...</p>
        </div>

        <!-- Provider reliability stats -->
        <div id="watchlist-provider-stats" class="watchlist-provider-stats" style="display:none;"></div>

        <!-- Live run status panel -->
        <div id="watchlist-run-panel" class="watchlist-run-panel" style="display:none">
          <div class="watchlist-run-header">
            <div class="watchlist-run-title">
              <span class="watchlist-run-spinner" id="wl-spinner"></span>
              <span id="wl-run-title">กำลังรัน Watchlist...</span>
            </div>
            <span id="wl-run-progress-text" class="watchlist-run-progress-text"></span>
          </div>
          <div class="watchlist-run-progress-bar">
            <div id="wl-run-bar" class="watchlist-run-bar"></div>
          </div>
          <div id="wl-run-log" class="watchlist-run-log"></div>
        </div>
      </div>

      <div id="tiktok-batch-results" class="drop-results" style="display:none;"></div>
      <div id="tiktok-progress" class="progress-container" style="display:none;">
        <div class="progress-info"><span id="tiktok-progress-text">...</span><span id="tiktok-progress-count">0/0</span></div>
        <div class="progress-bar"><div id="tiktok-progress-fill" class="progress-fill"></div></div>
        <p id="tiktok-progress-file" class="progress-file"></p>
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
                <option value="watchtime">⏱ Watch Time</option>
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
    </div>`;
}

let results = [];
let currentVisibleResults = [];
let currentFilters = { hideDuplicates: true, hideBlocked: false, sortBy: 'opportunity', minScore: 0 };
let currentMode = 'search';
let urlCheckTimer = null;
let _activeBatchSSE = null;

// ★ แก้: ย้ายจาก window._ globals มาเป็น module-level flags
// cleanup() จะ reset ทุกครั้งที่ navigate ออก ทำให้ init ทำงานซ้ำได้ถูกต้อง
let _watchlistInited    = false;
let _delegationAttached = false;

// Delegation handler ที่ named function เพื่อให้ removeEventListener ได้
function _delegationHandler(e) {
  if (e.target.id === 'btn-tiktok-select-all')   toggleAll();
  else if (e.target.id === 'btn-tiktok-smart-select') selectRecommended();
  else if (e.target.id === 'btn-tiktok-batch')        batchUpload();
  else if (e.target.id === 'btn-tiktok-batch-save')   batchSaveToComputer();
}

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

  // Watchlist panel — ใช้ instance-level flag แทน window global
  // ★ แก้: window._watchlistInited รั่วข้ามหน้า → ย้ายเป็น module-level flag
  //   ที่ cleanup() จะ reset ให้ทุกครั้งที่ navigate ออก
  if (!_watchlistInited) {
    _watchlistInited = true;
    initWatchlistPanel();
  }
  // Results controls — ใช้ instance-level flag แทน window global
  // ★ แก้: window._tiktokDelegationAttached รั่วข้ามหน้า → ย้ายเป็น module-level
  if (!_delegationAttached) {
    _delegationAttached = true;
    document.addEventListener('click', _delegationHandler);
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
  // reload watchlist data when switching to that tab
  if (mode === 'watchlist') loadWatchlist();
}

// ★ Helper — fetch with frontend timeout + clean abort handling
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
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
    const res = await fetchWithTimeout('/api/tiktok/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: keywordList, count })
    }, 35000);
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
  } catch(e) {
    setLoading(false);
    if (e.name === 'AbortError') window.app.showToast('ค้นหาใช้เวลานานเกินไป กรุณาลองใหม่', 'error');
    else window.app.showToast(e.message, 'error');
  }
}

async function fetchTrending() {
  const region = document.getElementById('trending-region').value;
  setLoading(true, `กำลังดึงคลิป trending ${region} และตรวจ duplicate...`);
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetchWithTimeout(`/api/tiktok/trending?region=${region}&count=12`, {}, 20000);
    const data = await res.json();
    setLoading(false);
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];
    if (results.length === 0) {
      window.app.showToast(`ไม่มีข้อมูล trending ${region} ในขณะนี้ ลองใหม่ภายหลัง`, 'info');
    }
    document.getElementById('tiktok-result-keyword').textContent = `Trending ${data.region} (${results.length})`;
    document.getElementById('tiktok-keyword-breakdown').innerHTML = '';
    applyFilters();
    document.getElementById('tiktok-results').style.display = 'block';
    attachFilterListeners();
  } catch(e) {
    setLoading(false);
    if (e.name === 'AbortError') window.app.showToast('Trending timeout — ลองเปลี่ยนภูมิภาคหรือลองใหม่', 'error');
    else window.app.showToast(e.message, 'error');
  }
}

async function fetchCreator() {
  let username = document.getElementById('creator-username').value.trim();
  if (!username) { window.app.showToast('ใส่ username', 'error'); return; }
  username = username.replace(/^@/, '');
  setLoading(true, `กำลังดึงคลิปล่าสุดจาก @${username}...`);
  document.getElementById('tiktok-results').style.display = 'none';
  try {
    const res = await fetchWithTimeout(`/api/tiktok/creator/${encodeURIComponent(username)}?count=12`, {}, 25000);
    const data = await res.json();
    setLoading(false);
    if (data.error) { window.app.showToast(data.error, 'error'); return; }
    results = data.videos || [];
    if (results.length === 0) {
      window.app.showToast(`ไม่พบคลิปจาก @${username} — อาจเป็น private account หรือ username ไม่ถูกต้อง`, 'error');
      return;
    }
    const strategyNote = data.strategy === 'search_fallback' ? ' (search fallback)' : '';
    document.getElementById('tiktok-result-keyword').textContent = `@${data.username} (${results.length})${strategyNote}`;
    document.getElementById('tiktok-keyword-breakdown').innerHTML = '';
    applyFilters();
    document.getElementById('tiktok-results').style.display = 'block';
    attachFilterListeners();
    if (data.strategy === 'search_fallback') {
      window.app.showToast(`ใช้ search fallback — แสดงคลิปที่เกี่ยวกับ @${username}`, 'info');
    }
  } catch(e) {
    setLoading(false);
    if (e.name === 'AbortError') window.app.showToast('Creator timeout — ลองใหม่', 'error');
    else window.app.showToast(e.message, 'error');
  }
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
  } else if (currentFilters.sortBy === 'watchtime') {
    filtered.sort((a, b) => getWatchTimeScore(b) - getWatchTimeScore(a));
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

function getWatchTimeScore(v) {
  return v.opportunity?.watchTime ?? Math.round(getOpportunityScore(v) * 0.6);
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

  const stageLabel = results[0]?.opportunity?.stageLabel || '';
  const avgWT = results.length
    ? Math.round(results.reduce((sum, v) => sum + getWatchTimeScore(v), 0) / results.length)
    : 0;

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
    <div class="insight-card" title="Watch Time potential เฉลี่ย">
      <span class="insight-value">${avgWT}</span>
      <span class="insight-label">⏱ Watch Time</span>
    </div>
    <div class="insight-card danger">
      <span class="insight-value">${duplicates + blocked}</span>
      <span class="insight-label">เสีย quota</span>
    </div>
    <div class="insight-recommendation" id="selection-summary">${stageLabel ? `<span class="stage-pill" style="margin-right:6px">${window.app.escapeHtml(stageLabel)}</span>` : ''}${topText}</div>`;
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
          <span class="value-mini-pill wt-pill" title="Watch Time potential">⏱ ${getWatchTimeScore(v)}</span>
          ${opportunity.stageLabel ? `<span class="stage-pill">${window.app.escapeHtml(opportunity.stageLabel)}</span>` : ''}
          ${opportunity.intent ? `<span class="intent-pill">${window.app.escapeHtml(opportunity.intent)}</span>` : ''}
          ${v.matchedKeywords?.length ? `<span class="matched-keywords">${v.matchedKeywords.map(k => window.app.escapeHtml(k)).join(', ')}</span>` : ''}
        </div>
        <div class="tiktok-video-title">
          <a href="${window.app.escapeHtml(v.videoUrl)}" target="_blank" rel="noopener" class="tiktok-source-link" title="ดูต้นทางบน TikTok">${window.app.escapeHtml((v.desc||'').substring(0,100))}</a>
        </div>
        ${v.videoUrl ? `
        <div class="tiktok-source-url">
          <a href="${window.app.escapeHtml(v.videoUrl)}" target="_blank" rel="noopener" class="url-text" title="${window.app.escapeHtml(v.videoUrl)}">${truncateUrl(v.videoUrl)}</a>
          <button class="copy-url-btn" title="คัดลอก URL" onclick="event.stopPropagation();navigator.clipboard.writeText('${window.app.escapeHtml(v.videoUrl)}').then(()=>window.app.showToast('คัดลอก URL แล้ว','success'))">📋</button>
        </div>` : ''}
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
          ? `<button class="btn btn-save btn-sm" onclick="window.tiktokPage.saveToComputer(${realIdx})" title="โหลดไฟล์ MP4 ลงเครื่อง">Save</button>
             <a href="${v.youtubeUrl}" target="_blank" class="btn btn-secondary btn-sm">ดู YouTube</a>`
          : v.monetizationStatus === 'blocked'
          ? `<button class="btn btn-save btn-sm" onclick="window.tiktokPage.saveToComputer(${realIdx})" title="โหลดไฟล์ MP4 ลงเครื่อง">Save</button>
             <button class="btn btn-error btn-sm" disabled>บล็อก</button>`
          : `<button class="btn btn-save btn-sm" onclick="window.tiktokPage.saveToComputer(${realIdx})" title="โหลดไฟล์ MP4 ลงเครื่อง">Save</button>
             <button class="btn btn-secondary btn-sm" onclick="window.tiktokPage.seoPreview(${realIdx})">SEO Plan</button>
             <button class="btn btn-primary btn-sm" onclick="window.tiktokPage.dlUp(${realIdx})">อัป YouTube</button>`}
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
      // ★ เรียงตาม stageLabel — early_stage เน้น follower+watchTime, อื่นๆ เน้น opportunity
      const aScore = (getOpportunityScore(a) * 0.5) + (getFollowerScore(a) * 0.25) + (getWatchTimeScore(a) * 0.25);
      const bScore = (getOpportunityScore(b) * 0.5) + (getFollowerScore(b) * 0.25) + (getWatchTimeScore(b) * 0.25);
      const scoreDiff = bScore - aScore;
      if (scoreDiff !== 0) return scoreDiff;
      return getWatchTimeScore(b) - getWatchTimeScore(a);
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
    const res = await fetchWithTimeout('/api/tiktok/download-to-browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl, filename: suggestedFilename })
    }, 90000); // 90 วิ — DL + stream

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
    if (err.name === 'AbortError') window.app.showToast('❌ Save timeout — ลองใหม่', 'error');
    else window.app.showToast(`❌ Save ล้มเหลว: ${err.message}`, 'error');
    console.error('Save to computer error:', err);
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = 'Save';
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
  resEl.innerHTML = `<div class="batch-save-header">💾 กำลัง Save ${selected.length} ไฟล์...</div>`;

  let done = 0, failed = 0;

  for (const v of selected) {
    const suggested = (v.desc || `tiktok_${v.id || Date.now()}`).substring(0, 60).replace(/[^\w\s\-ก-๙]/g, '');
    try {
      resEl.innerHTML += `<div class="drop-result-item" style="background:#fafafa;border-color:#e4e7ec;color:var(--text-secondary);" id="save-${v.id || done}">⏳ ${window.app.escapeHtml((v.desc||'').substring(0,55))}...</div>`;

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
      if (el) {
        el.style.cssText = '';
        el.innerHTML = `✅ ${window.app.escapeHtml((v.desc||'').substring(0,55))} — ${filename}`;
      }

    } catch (err) {
      failed++;
      const el = document.getElementById(`save-${v.id || done}`);
      if (el) {
        el.classList.add('error');
        el.style.cssText = '';
        el.innerHTML = `❌ ${window.app.escapeHtml((v.desc||'').substring(0,55))} — ${err.message}`;
      }
    }

    if (btn) btn.textContent = `⏳ ${done + failed}/${selected.length}`;

    // delay ระหว่างไฟล์เพื่อให้ browser ตั้งตัวทัน
    if (done + failed < selected.length) await new Promise(r => setTimeout(r, 1500));
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Save ที่เลือก'; }
  window.app.showToast(`Save สำเร็จ ${done} ไฟล์${failed > 0 ? ` (ล้มเหลว ${failed})` : ''}`, done > 0 ? 'success' : 'error');
}

async function dlUpUrl() {
  const url = document.getElementById('tiktok-url').value.trim();
  if (!url) { window.app.showToast('ใส่ลิงก์', 'error'); return; }
  const btn = document.getElementById('btn-tiktok-dl-up');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    window.app.showToast('กำลังดาวน์โหลด+อัป...', 'info');
    const res = await fetchWithTimeout('/api/tiktok/download-and-upload',
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({videoUrl:url}) },
      120000); // 2 นาที — DL + upload
    const d = await res.json();
    if (d.success) { window.app.showToast('อัปโหลดสำเร็จ!', 'success'); showResult(d); }
    else { window.app.showToast(d.error || 'เกิดข้อผิดพลาด', 'error'); }
  } catch(err) {
    if (err.name === 'AbortError') window.app.showToast('Timeout — ดาวน์โหลด/อัปใช้เวลานานเกินไป', 'error');
    else window.app.showToast('Network error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'โหลด+อัป YouTube'; }
  }
}

async function dlUpSingle(idx) {
  const v = results[idx]; if (!v) return;
  const btn = document.querySelector(`.tiktok-cb[data-idx="${idx}"]`)
    ?.closest('.tiktok-video-item')
    ?.querySelector('button[onclick*="dlUp"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    window.app.showToast('กำลังดำเนินการ...', 'info');
    const res = await fetchWithTimeout('/api/tiktok/download-and-upload',
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({videoUrl:v.videoUrl, title:(v.desc||'').substring(0,100), desc:v.desc, author:v.author, duration:v.duration, viralityScore: v.virality?.score ?? null}) },
      120000);
    const d = await res.json();
    if (d.success) {
      window.app.showToast('สำเร็จ!', 'success');
      showResult(d);
      v.alreadyUploaded = true;
      v.youtubeUrl = d.youtubeUrl;
      applyFilters();
    } else {
      window.app.showToast(d.error || 'เกิดข้อผิดพลาด', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'อัป YouTube'; }
    }
  } catch(err) {
    if (err.name === 'AbortError') window.app.showToast('Timeout — ลองใหม่', 'error');
    else window.app.showToast('Network error: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'อัป YouTube'; }
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
  // ★ ปิด SSE เก่าก่อนเปิดใหม่ ป้องกัน duplicate connections
  if (_activeBatchSSE) { try { _activeBatchSSE.close(); } catch(_) {} }
  const es = new EventSource('/api/tiktok/progress');
  _activeBatchSSE = es;
  es.onmessage = (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch (_) { return; } // skip malformed frames
    document.getElementById('tiktok-progress-text').textContent = d.status==='done'?'🎉 เสร็จ!':d.phase==='downloading'?'⬇️ ดาวน์โหลด':'⬆️ อัปโหลด';
    document.getElementById('tiktok-progress-count').textContent = `${d.current}/${d.total}`;
    document.getElementById('tiktok-progress-file').textContent = d.currentFile||'';
    document.getElementById('tiktok-progress-fill').style.width = (d.total>0?(d.current/d.total)*100:0)+'%';
    if (d.results) resEl.innerHTML = d.results.map(r => {
      if (r.skipped && r.blocked) return `<div class="drop-result-item error">🚫 ${window.app.escapeHtml(r.title.substring(0,55))} — ${window.app.escapeHtml(r.error)}</div>`;
      if (r.skipped) return `<div class="drop-result-item" style="background:#fafafa;border-color:#e4e7ec;color:var(--text-muted);">⏭️ ${window.app.escapeHtml(r.title.substring(0,55))} — ข้ามแล้ว</div>`;
      if (r.success) return `<div class="drop-result-item">✅ ${window.app.escapeHtml(r.title.substring(0,55))} → <a href="${r.youtubeUrl}" target="_blank">YouTube ↗</a></div>`;
      return `<div class="drop-result-item error">❌ ${window.app.escapeHtml(r.title.substring(0,55))} — ${window.app.escapeHtml(r.error||'')}</div>`;
    }).join('');
    if (d.status==='done') { 
      es.close();
      _activeBatchSSE = null;
      document.getElementById('tiktok-progress').style.display = 'none';
      // Refresh current mode to show updated upload status
      if (currentMode === 'trending') fetchTrending();
      else if (currentMode === 'creator') fetchCreator();
      else search();
    }
  };
  es.onerror = () => { es.close(); _activeBatchSSE = null; el.style.display='none'; };
}

function showResult(d) {
  const el = document.getElementById('tiktok-batch-results'); el.style.display='block';
  el.innerHTML += `<div class="drop-result-item">✅ ${window.app.escapeHtml(d.filename||'')} → <a href="${d.youtubeUrl}" target="_blank">YouTube ↗</a></div>`;
}

function truncateUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    // แสดง: tiktok.com/@user/video/12345
    const parts = u.pathname.split('/').filter(Boolean);
    const short = parts.length >= 3
      ? `${parts[0]}/${parts[1]}/${parts[2]}`  // @user/video/id
      : u.pathname;
    return `${u.hostname}/${short}`;
  } catch {
    return url.length > 45 ? url.substring(0, 42) + '…' : url;
  }
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
    // ใส่ panel ใน tiktok-video-info เพื่อให้ span ถูก column ใน grid
    const infoEl = el.querySelector('.tiktok-video-info');
    (infoEl || el).appendChild(panel);
  } catch (err) {
    window.app.showToast('SEO preview error: ' + err.message, 'error');
  }
}

window.tiktokPage = { dlUp: dlUpSingle, seoPreview, saveToComputer };

// ★ Cleanup — ปิด SSE connections ทั้งหมดและ reset flags เมื่อ navigate ออกจากหน้า
export function cleanup() {
  // ปิด batch upload SSE
  if (_activeBatchSSE) {
    try { _activeBatchSSE.close(); } catch (_) {}
    _activeBatchSSE = null;
  }
  // ปิด watchlist SSE
  if (_wlSSE) {
    try { _wlSSE.close(); } catch (_) {}
    _wlSSE = null;
  }
  // ล้าง URL check timer
  if (urlCheckTimer) {
    clearTimeout(urlCheckTimer);
    urlCheckTimer = null;
  }
  // ★ Reset module-level flags เพื่อให้ init ทำงานใหม่ถูกต้องเมื่อ navigate กลับมา
  if (_delegationAttached) {
    document.removeEventListener('click', _delegationHandler);
    _delegationAttached = false;
  }
  _watchlistInited = false;
}

// ══════════════════════════════════════════════════════════════
// WATCHLIST PANEL
// ══════════════════════════════════════════════════════════════

function initWatchlistPanel() {
  document.getElementById('btn-watchlist-add-open')?.addEventListener('click', () => {
    const form = document.getElementById('watchlist-add-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') document.getElementById('wl-keyword')?.focus();
  });

  document.getElementById('btn-watchlist-cancel')?.addEventListener('click', () => {
    document.getElementById('watchlist-add-form').style.display = 'none';
    document.getElementById('wl-keyword').value = '';
  });

  document.getElementById('btn-watchlist-save')?.addEventListener('click', addWatchlistKeyword);
  document.getElementById('wl-keyword')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') addWatchlistKeyword();
  });

  document.getElementById('btn-watchlist-run')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-watchlist-run');
    btn.disabled = true; btn.textContent = 'กำลังรัน...';
    try {
      const r = await fetch('/api/watchlist/run', { method: 'POST' });
      const d = await r.json();
      window.app.showToast(d.message || 'เริ่ม watchlist run แล้ว', d.success ? 'success' : 'error');
      if (d.success) startWatchlistSSE();
    } catch(e) {
      window.app.showToast('เกิดข้อผิดพลาด', 'error');
      btn.disabled = false; btn.textContent = 'รันตอนนี้';
    }
  });

  loadWatchlist();

  // Connect SSE if a run is already in progress
  fetch('/api/watchlist/state').then(r => r.json()).then(state => {
    if (state.running) startWatchlistSSE();
    else if (state.phase !== 'idle') renderRunPanel(state);
  }).catch(() => {});
}

async function loadWatchlist() {
  try {
    const r = await fetch('/api/watchlist');
    const d = await r.json();
    renderWatchlistStats(d.stats);
    renderWatchlistList(d.keywords);
    renderProviderStats();
  } catch(e) {
    document.getElementById('watchlist-list').innerHTML = '<p class="empty-state">โหลดไม่ได้</p>';
  }
}

function renderWatchlistStats(stats) {
  const el = document.getElementById('watchlist-stats');
  if (!el || !stats) return;
  el.innerHTML = `
    <div class="watchlist-stat">
      <span class="watchlist-stat-value">${stats.total}</span>
      <span class="watchlist-stat-label">keywords</span>
    </div>
    <div class="watchlist-stat">
      <span class="watchlist-stat-value">${stats.enabled}</span>
      <span class="watchlist-stat-label">เปิดใช้งาน</span>
    </div>
    <div class="watchlist-stat">
      <span class="watchlist-stat-value">${stats.totalAutoUploaded}</span>
      <span class="watchlist-stat-label">auto-uploaded ทั้งหมด</span>
    </div>
    <div class="watchlist-stat">
      <span class="watchlist-stat-label" style="grid-column:span 1">
        รันล่าสุด: ${stats.lastRunAt ? window.app.timeAgo(stats.lastRunAt) : 'ยังไม่เคยรัน'}
      </span>
    </div>`;
}

function renderWatchlistList(keywords) {
  const el = document.getElementById('watchlist-list');
  if (!keywords || keywords.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <p>ยังไม่มี keyword</p>
        <p style="font-size:0.8rem;margin-top:4px">กด "+ เพิ่ม Keyword" เพื่อเริ่มต้น</p>
      </div>`;
    return;
  }

  el.innerHTML = keywords.map(kw => `
    <div class="watchlist-item ${kw.enabled ? '' : 'disabled'}" data-id="${kw.id}">
      <div class="watchlist-item-main">
        <label class="toggle-switch" title="เปิด/ปิด">
          <input type="checkbox" class="wl-toggle" data-id="${kw.id}" ${kw.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <div class="watchlist-item-info">
          <span class="watchlist-keyword">${window.app.escapeHtml(kw.keyword)}</span>
          <div class="watchlist-meta-row">
            <span class="watchlist-meta-pill" title="คลิปต่อรอบ">
              📦
              <select class="wl-inline-select wl-count-select" data-id="${kw.id}" data-field="countPerRun">
                ${[4,6,8,12,18].map(n => `<option value="${n}" ${kw.countPerRun==n?'selected':''}>${n}/รอบ</option>`).join('')}
              </select>
            </span>
            <span class="watchlist-meta-pill" title="คะแนนขั้นต่ำ">
              🎯
              <select class="wl-inline-select wl-score-select" data-id="${kw.id}" data-field="minScore">
                <option value="0" ${kw.minScore==0?'selected':''}>ทั้งหมด</option>
                <option value="52" ${kw.minScore==52?'selected':''}>52+</option>
                <option value="68" ${kw.minScore==68?'selected':''}>68+</option>
                <option value="82" ${kw.minScore==82?'selected':''}>82+</option>
              </select>
            </span>
            <span class="watchlist-meta">
              อัปแล้ว <strong>${kw.totalUploaded || 0}</strong>
              ${(kw.totalFound || 0) > 0 ? `· พบ ${kw.totalFound} · pass ${kw.totalFound > 0 ? Math.round((kw.totalUploaded||0)/kw.totalFound*100) : 0}%` : ''}
              ${kw.lastRunAt ? `· ${window.app.timeAgo(kw.lastRunAt)}` : '· ยังไม่รัน'}
            </span>
          </div>
        </div>
      </div>
      <button class="btn btn-danger btn-sm wl-delete" data-id="${kw.id}">ลบ</button>
    </div>`).join('');

  // Toggle enable/disable
  el.querySelectorAll('.wl-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      await fetch(`/api/watchlist/${cb.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: cb.checked })
      });
      window.app.showToast(cb.checked ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว', 'success');
      loadWatchlist();
    });
  });

  // Inline edit — countPerRun & minScore
  el.querySelectorAll('.wl-inline-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const field = sel.dataset.field;
      const val = parseInt(sel.value);
      await fetch(`/api/watchlist/${sel.dataset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: val })
      });
      window.app.showToast('อัปเดตแล้ว', 'success');
    });
  });

  // Delete
  el.querySelectorAll('.wl-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('ลบ keyword นี้?')) return;
      await fetch(`/api/watchlist/${btn.dataset.id}`, { method: 'DELETE' });
      window.app.showToast('ลบแล้ว', 'success');
      loadWatchlist();
    });
  });
}

async function renderProviderStats() {
  const el = document.getElementById('watchlist-provider-stats');
  if (!el) return;
  try {
    const r = await fetch('/api/tiktok/provider-stats');
    const data = await r.json();
    const providers = Object.entries(data);
    if (!providers.length) return;
    el.style.display = 'block';
    el.innerHTML = `
      <div class="provider-stats-header">
        <span>Download Provider Reliability</span>
        <button class="provider-stats-refresh" onclick="renderProviderStats()" title="รีเฟรช">↻</button>
      </div>
      <div class="provider-stats-grid">
        ${providers.map(([name, s]) => {
          const rate = s.successRate ?? 0;
          const cls = rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : s.total === 0 ? 'unknown' : 'bad';
          const bar = s.total > 0 ? Math.round(rate) : 0;
          return `
          <div class="provider-stat-card provider-${cls}">
            <div class="provider-stat-name">${name}</div>
            <div class="provider-stat-rate">${s.total > 0 ? rate.toFixed(0) + '%' : '—'}</div>
            <div class="provider-stat-bar-track">
              <div class="provider-stat-bar-fill" style="width:${bar}%"></div>
            </div>
            <div class="provider-stat-detail">${s.success}✓ ${s.failure}✗</div>
          </div>`;
        }).join('')}
      </div>`;
  } catch(_) {}
}

async function addWatchlistKeyword() {
  const keyword  = document.getElementById('wl-keyword').value.trim();
  const count    = document.getElementById('wl-count').value;
  const minScore = document.getElementById('wl-minscore').value;

  if (!keyword) { window.app.showToast('ใส่ keyword ก่อน', 'error'); return; }

  try {
    const r = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, countPerRun: parseInt(count), minScore: parseInt(minScore) })
    });
    const d = await r.json();
    if (d.success) {
      window.app.showToast(`เพิ่ม "${keyword}" สำเร็จ`, 'success');
      document.getElementById('wl-keyword').value = '';
      document.getElementById('watchlist-add-form').style.display = 'none';
      loadWatchlist();
    } else {
      window.app.showToast(d.error || 'เกิดข้อผิดพลาด', 'error');
    }
  } catch(e) {
    window.app.showToast('เกิดข้อผิดพลาด', 'error');
  }
}

// Reload watchlist when switching to that tab
const _origSwitchMode = window._switchModeRef;
window._watchlistTabCallback = () => loadWatchlist();

// ── SSE Progress ─────────────────────────────────────────────────
let _wlSSE = null;

function startWatchlistSSE() {
  if (_wlSSE) { _wlSSE.close(); _wlSSE = null; }

  _wlSSE = new EventSource('/api/watchlist/progress');

  _wlSSE.onmessage = (e) => {
    try {
      const state = JSON.parse(e.data);
      renderRunPanel(state);
      if (!state.running && state.phase === 'done') {
        // Re-enable run button + refresh keyword stats
        const btn = document.getElementById('btn-watchlist-run');
        if (btn) { btn.disabled = false; btn.textContent = 'รันตอนนี้'; }
        loadWatchlist();
        setTimeout(() => { if (_wlSSE) { _wlSSE.close(); _wlSSE = null; } }, 2000);
      }
    } catch(_) {}
  };

  _wlSSE.onerror = () => {
    if (_wlSSE) { _wlSSE.close(); _wlSSE = null; }
    const btn = document.getElementById('btn-watchlist-run');
    if (btn) { btn.disabled = false; btn.textContent = 'รันตอนนี้'; }
  };
}

function renderRunPanel(state) {
  const panel = document.getElementById('watchlist-run-panel');
  if (!panel) return;
  panel.style.display = 'block';

  // Title + spinner
  const titleEl = document.getElementById('wl-run-title');
  const spinner = document.getElementById('wl-spinner');
  const progText = document.getElementById('wl-run-progress-text');
  const bar = document.getElementById('wl-run-bar');

  if (state.running) {
    spinner.className = 'watchlist-run-spinner spinning';
    const phaseLabel = {
      starting:   'กำลังเริ่มต้น...',
      searching:  `กำลังค้นหา "${state.currentKeyword}"...`,
      filtering:  `กำลัง filter คลิปจาก "${state.currentKeyword}"...`,
      uploading:  `กำลังเพิ่มคิวอัปโหลด...`,
    }[state.phase] || 'กำลังดำเนินการ...';
    titleEl.textContent = phaseLabel;
    // Progress bar
    const pct = state.keywordTotal > 0
      ? Math.round(((state.keywordIndex - 1) / state.keywordTotal) * 100)
      : 0;
    bar.style.width = `${pct}%`;
    progText.textContent = state.keywordTotal > 0
      ? `${state.keywordIndex}/${state.keywordTotal} keywords`
      : '';
  } else if (state.phase === 'done' && state.summary) {
    spinner.className = 'watchlist-run-spinner done';
    titleEl.textContent = `เสร็จแล้ว — เพิ่มคิว ${state.summary.totalQueued} คลิป`;
    bar.style.width = '100%';
    bar.classList.add('done');
    progText.textContent = `ข้าม ${state.summary.totalSkipped} คลิป`;
  }

  // Live log — show last 12 steps
  const logEl = document.getElementById('wl-run-log');
  const steps = (state.steps || []).slice(-12);
  logEl.innerHTML = steps.map(s => {
    const cls = {
      error:     'log-error',
      skip:      'log-skip',
      queue:     'log-queue',
      complete:  'log-done',
      done_kw:   'log-done',
      search:    'log-search',
      found:     'log-found',
      start:     'log-info',
      info:      'log-info',
    }[s.type] || 'log-info';
    const time = new Date(s.ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="wl-log-line ${cls}">
      <span class="wl-log-time">${time}</span>
      <span class="wl-log-msg">${window.app.escapeHtml(s.message)}</span>
    </div>`;
  }).join('');
  // Auto-scroll to bottom
  logEl.scrollTop = logEl.scrollHeight;
}
