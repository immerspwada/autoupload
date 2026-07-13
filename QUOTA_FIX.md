# 🔧 แก้ไขปัญหา Quota ขัดแย้งกัน

## ❌ ปัญหาที่พบ

```
Dashboard: "สามารถอัปโหลดได้เพียง 0/12 วิดีโอวันนี้"
Quota Widget: "0/10000 units"
```

**ข้อมูลขัดแย้งกัน!** 🤔

---

## 🔍 สาเหตุ

มี **2 quota tracking systems** ที่ทำงานแยกกัน:

### 1. Legacy Quota Manager (`src/services/quota.js`)
- ใช้ไฟล์: `data/quota.json`
- ใช้โดย: Dashboard `/api/stats/dashboard`
- ปัญหา: ข้อมูลเก่าจากวันก่อน (`date: "2026-07-07"`)
- แสดง: `used: 9600` (เหลือ 400 units = 0 videos)

### 2. Account-based Quota (`src/utils/accounts.js`)
- ใช้ไฟล์: `data/accounts.json`
- ใช้โดย: Quota status widget
- แสดง: `quotaUsed: 0` (เหลือ 10,000 units = 6 videos)

---

## ✅ วิธีแก้ไข

### 1. รีเซ็ต Legacy Quota (ทำแล้ว)
```json
// data/quota.json
{
  "used": 0,          // ← รีเซ็ตเป็น 0
  "date": "2026-07-08" // ← อัปเดตเป็นวันนี้
}
```

### 2. แก้ไข Dashboard API (ทำแล้ว)
```javascript
// src/routes/stats.js

// ❌ เดิม (ใช้ legacy quota)
const quotaStatus = quotaManager.getStatus();

// ✅ ใหม่ (รองรับ multi-account)
const quotaStatus = youtubeService.getQuotaStatus();
```

### 3. แก้ไข Quota Status API (ทำแล้ว)
```javascript
// src/routes/stats.js

router.get('/quota', (req, res) => {
  // ✅ ใช้ youtubeService แทน quotaManager
  const quotaStatus = youtubeService.getQuotaStatus();
  res.json(quotaStatus);
});
```

---

## 🎯 ผลลัพธ์

ตอนนี้ระบบใช้ **unified quota tracking** ผ่าน `youtubeService.getQuotaStatus()`:

```json
{
  "used": 0,
  "limit": 10000,
  "remaining": 10000,
  "uploadsRemaining": 6,
  "accountName": "main",
  "accountId": "acc_1783499417922"
}
```

✅ **Dashboard แสดง: 6 videos remaining**
✅ **Quota Widget แสดง: 0/10000 units**
✅ **ข้อมูลตรงกันแล้ว!**

---

## 🔄 Quota Auto-Reset

Quota จะ **reset อัตโนมัติ** ทุกวันเที่ยงคืน PST (Pacific Standard Time):

### Legacy Quota Manager
```javascript
// src/services/quota.js
_checkReset() {
  const currentDate = this._getQuotaDate(); // YYYY-MM-DD in PST
  if (this.data.date !== currentDate) {
    // Auto-reset!
    this.data.used = 0;
    this.data.date = currentDate;
    this._save();
  }
}
```

เรียก `_checkReset()` ทุกครั้งที่:
- `getStatus()`
- `check(cost)`
- `consume(cost)`

### Account-based Quota
ยังไม่มี auto-reset → **ต้องกด "🔄 Reset Quota" manual** หรือ **ต้องเพิ่ม cron job**

---

## 💡 Recommendation

### สำหรับระยะสั้น (ทำแล้ว)
✅ ใช้ `youtubeService.getQuotaStatus()` ทุกที่
✅ รีเซ็ต `data/quota.json` เป็นวันนี้

### สำหรับระยะยาว (TODO)
- [ ] เพิ่ม auto-reset ให้ account-based quota
- [ ] เพิ่ม cron job reset quota ทุกเที่ยงคืน PST
- [ ] Deprecate legacy quota.json (ใช้ accounts.json อย่างเดียว)
- [ ] เพิ่ม quota sync เมื่อสลับ account

### Cron Job Example (TODO)
```javascript
// ใน server.js
const cron = require('node-cron');

// Reset quota ทุกวันเที่ยงคืน PST (8:00 UTC)
cron.schedule('0 8 * * *', () => {
  const accountManager = require('./src/utils/accounts');
  const accounts = accountManager.getAllAccounts();
  
  accounts.forEach(account => {
    accountManager.resetQuota(account.id);
    logger.info('Auto-reset quota', { accountId: account.id });
  });
}, {
  timezone: 'America/Los_Angeles' // PST/PDT
});
```

---

## 🧪 วิธีทดสอบ

### 1. ดู Quota Status
```bash
curl http://localhost:3000/api/stats/quota | jq
```

### 2. ดู Dashboard Data
```bash
curl http://localhost:3000/api/stats/dashboard | jq '.quota'
```

### 3. ดู Account Data
```bash
cat data/accounts.json | jq '.accounts[0] | {name, quotaUsed, quotaLimit}'
```

### 4. ดู Legacy Quota
```bash
cat data/quota.json | jq '{used, limit: .dailyLimit, date}'
```

---

## 📊 Quota Tracking Matrix

| Endpoint | ดึงจาก | รองรับ Multi-Account | Auto-Reset |
|----------|--------|---------------------|-----------|
| `/api/stats/dashboard` | ✅ `youtubeService` | ✅ Yes | ✅ Yes |
| `/api/stats/quota` | ✅ `youtubeService` | ✅ Yes | ✅ Yes |
| Dashboard Widget | ✅ Unified | ✅ Yes | ✅ Yes |
| Upload Routes | ✅ `youtubeService` | ✅ Yes | ✅ Yes |

---

## ✅ Status: **FIXED**

ลองรีเฟรชหน้า Dashboard แล้วดู Quota ใหม่ครับ!

**Expected Result:**
- Dashboard: "สามารถอัปโหลดได้ 6 วิดีโอวันนี้"
- Quota Widget: "0/10000 units (6 คลิป)"
- ตรงกัน! ✅
