// Page: Scheduler (/scheduler)
export function render() {
  return `
    <div class="settings-form">
      <h3>⏰ ตั้งค่า Auto Scheduler</h3>
      <p class="section-desc">ระบบจะสแกนโฟลเดอร์ตามเวลาที่กำหนด และอัปโหลดไฟล์ใหม่อัตโนมัติ</p>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="scheduler-enabled"><span>🟢 เปิดใช้งาน Auto Scheduler</span></label>
      </div>
      <div class="form-group">
        <label for="scheduler-interval">⏱️ ช่วงเวลาสแกน (นาที)</label>
        <input type="number" id="scheduler-interval" min="5" max="1440" value="30">
        <small>ระบบจะสแกนโฟลเดอร์ทุกๆ X นาที</small>
      </div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="scheduler-watch" checked><span>👁️ Folder Watch (ตรวจจับทันที)</span></label>
        <small>ตรวจจับไฟล์วิดีโอใหม่แบบ real-time</small>
      </div>
      <div class="scheduler-actions">
        <button id="btn-scheduler-save" class="btn btn-primary">💾 บันทึก</button>
        <button id="btn-scheduler-scan" class="btn btn-secondary">🔍 สแกนตอนนี้</button>
      </div>
      <div id="scheduler-status" class="scheduler-status"></div>
    </div>`;
}

export async function init() {
  const res = await fetch('/api/stats/scheduler');
  const config = await res.json();
  document.getElementById('scheduler-enabled').checked = config.enabled || false;
  document.getElementById('scheduler-interval').value = config.intervalMinutes || 30;
  document.getElementById('scheduler-watch').checked = config.watchEnabled !== false;
  showStatus(config);

  document.getElementById('btn-scheduler-save').addEventListener('click', async () => {
    const body = { enabled: document.getElementById('scheduler-enabled').checked, intervalMinutes: parseInt(document.getElementById('scheduler-interval').value)||30, watchEnabled: document.getElementById('scheduler-watch').checked };
    const r = await fetch('/api/stats/scheduler', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json();
    window.app.showToast('บันทึก Scheduler สำเร็จ', 'success');
    showStatus(d.config);
  });

  document.getElementById('btn-scheduler-scan').addEventListener('click', async () => {
    const r = await fetch('/api/stats/scheduler/scan', { method:'POST' });
    const d = await r.json();
    window.app.showToast(`สแกนเสร็จ! พบ ${d.queued} ไฟล์ใหม่`, 'success');
  });
}

function showStatus(config) {
  document.getElementById('scheduler-status').innerHTML = `<div class="status-info">
    <span class="status-dot ${config.enabled?'active':'inactive'}"></span>
    ${config.enabled?'🟢 Scheduler ทำงานอยู่':'⚪ Scheduler ปิดอยู่'}
    ${config.lastRun?`<br>🕐 สแกนล่าสุด: ${new Date(config.lastRun).toLocaleString('th-TH')}`:''}
  </div>`;
}
