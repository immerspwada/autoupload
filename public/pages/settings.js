// Page: Settings (/settings)
export function render() {
  return `
    <form id="settings-form" class="settings-form">
      <div class="form-group">
        <label for="folder">📁 โฟลเดอร์วิดีโอ (path เต็ม)</label>
        <input type="text" id="folder" name="folder" placeholder="/Users/you/Videos/youtube" required>
        <small>ระบุ path ของโฟลเดอร์ที่เก็บวิดีโอ</small>
      </div>
      <div class="form-group">
        <label for="privacy">🔒 ระดับความเป็นส่วนตัว</label>
        <select id="privacy" name="privacy">
          <option value="public">🌐 สาธารณะ (Public)</option>
          <option value="unlisted">🔗 ไม่แสดงในรายการ (Unlisted)</option>
          <option value="private">🔒 ส่วนตัว (Private)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="deleteAfterUpload"> 🗑️ ลบไฟล์หลังอัปโหลดสำเร็จ</label>
        <small>ไฟล์วิดีโอจะถูกลบหลังอัปโหลดขึ้น YouTube สำเร็จ</small>
      </div>
      <div class="form-group">
        <label for="defaultDescription">📝 คำอธิบายเริ่มต้น</label>
        <textarea id="defaultDescription" rows="3" placeholder="คำอธิบายวิดีโอ..."></textarea>
      </div>
      <div class="form-group">
        <label for="defaultTags">🏷️ แท็กเริ่มต้น (คั่นด้วยคอมม่า)</label>
        <input type="text" id="defaultTags" placeholder="vlog, thailand, daily">
      </div>
      <button type="submit" class="btn btn-primary">💾 บันทึกการตั้งค่า</button>
    </form>`;
}

export async function init() {
  const res = await fetch('/api/settings');
  const s = await res.json();
  if (s.folder) document.getElementById('folder').value = s.folder;
  if (s.privacy) document.getElementById('privacy').value = s.privacy;
  if (s.deleteAfterUpload) document.getElementById('deleteAfterUpload').checked = s.deleteAfterUpload === 'true' || s.deleteAfterUpload === true;
  if (s.defaultDescription) document.getElementById('defaultDescription').value = s.defaultDescription;
  if (s.defaultTags) document.getElementById('defaultTags').value = s.defaultTags;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      folder: document.getElementById('folder').value,
      privacy: document.getElementById('privacy').value,
      deleteAfterUpload: document.getElementById('deleteAfterUpload').checked,
      defaultDescription: document.getElementById('defaultDescription').value,
      defaultTags: document.getElementById('defaultTags').value
    };
    const r = await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
    if (r.ok) window.app.showToast('บันทึกสำเร็จ!', 'success');
    else window.app.showToast('เกิดข้อผิดพลาด', 'error');
  });
}
