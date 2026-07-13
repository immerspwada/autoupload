# 👥 Multi-Account Management System

## ✅ สิ่งที่ทำเสร็จแล้ว

### 1. Account Management Backend
- ✅ `src/utils/accounts.js` - จัดการข้อมูล accounts (เพิ่ม/ลบ/แก้ไข/สลับ)
- ✅ `src/routes/accounts.js` - API endpoints สำหรับจัดการ accounts
- ✅ `data/accounts.json` - เก็บข้อมูล accounts และ tokens แยกกัน

### 2. YouTube Service Integration
- ✅ `src/services/youtube.js` - รองรับหลาย accounts พร้อม:
  - OAuth2 client แยกต่าง account
  - Token management แยกกัน
  - Quota tracking แยกกัน
  - Channel info แยกกัน
  - Backward compatible กับระบบเดิม (client_secret.json + token.json)

### 3. OAuth Flow
- ✅ `src/routes/auth.js` - รองรับ accountId parameter
- ✅ `server.js` - OAuth callback รองรับ state parameter (เก็บ accountId)
- ✅ Login/Logout แยกต่าง account

### 4. Frontend UI
- ✅ `public/pages/accounts.js` - หน้าจัดการ accounts
- ✅ `public/index.html` - เพิ่ม 👥 Accounts tab
- ✅ `public/app.js` - เพิ่ม route `/accounts`

---

## 📖 วิธีใช้งาน

### 1️⃣ เพิ่ม Account ใหม่

1. เปิด **👥 Accounts** tab
2. กด **➕ เพิ่ม Account**
3. กรอกข้อมูล:
   - **ชื่อ Account**: เช่น "Main Channel", "Backup Channel"
   - **Client ID**: จาก Google Cloud Console
   - **Client Secret**: จาก Google Cloud Console
4. กด **บันทึก**

### 2️⃣ Login YouTube (ต่อ Account)

1. หาจาก account ที่ต้องการใน list
2. กด **🔐 Login YouTube**
3. ระบบจะเปิด Google OAuth → เลือก Google Account → อนุญาต
4. กลับมาหน้า Accounts → เห็น account แสดง ✅ (มี token แล้ว)

### 3️⃣ สลับ Active Account

1. หา account ที่ต้องการใช้งาน
2. กด **✅ ใช้ Account นี้**
3. Account จะเปลี่ยนเป็นสีเขียว (active)
4. การอัปโหลดครั้งต่อไปจะใช้ account นี้

### 4️⃣ อัปโหลดวิดีโอ

- ระบบจะใช้ **Active Account** (สีเขียว ✅) อัตโนมัติ
- Quota จะถูกหักจาก account ที่ใช้อัปโหลด
- แต่ละ account มี quota แยกกัน (10,000 units/day)

---

## 🔧 Technical Details

### Account Data Structure
```json
{
  "accounts": [
    {
      "id": "acc_1234567890",
      "name": "Main Channel",
      "clientId": "xxxxx.apps.googleusercontent.com",
      "clientSecret": "GOCSPX-xxxxx",
      "redirectUri": "http://localhost:3000/oauth2callback",
      "token": {
        "access_token": "...",
        "refresh_token": "...",
        "expiry_date": 1234567890000
      },
      "channelInfo": {
        "id": "UCxxxxx",
        "title": "My Channel",
        "thumbnail": "https://...",
        "subscribers": "1000",
        "videoCount": "50"
      },
      "quotaUsed": 3200,
      "quotaLimit": 10000,
      "createdAt": "2026-07-08T...",
      "lastUsed": "2026-07-08T..."
    }
  ],
  "activeAccountId": "acc_1234567890"
}
```

### API Endpoints

#### GET `/api/accounts`
ดึงรายการ accounts ทั้งหมด (ไม่แสดง clientSecret และ token)

#### POST `/api/accounts`
เพิ่ม account ใหม่
```json
{
  "name": "Main Channel",
  "clientId": "xxxxx.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-xxxxx"
}
```

#### PUT `/api/accounts/:id`
แก้ไข account (name, clientId, clientSecret)

#### DELETE `/api/accounts/:id`
ลบ account

#### POST `/api/accounts/:id/activate`
ตั้งเป็น active account

#### POST `/api/accounts/:id/reset-quota`
รีเซ็ต quota ของ account

#### GET `/api/accounts/active`
ดึงข้อมูล active account

---

## 🎯 Features

### ✅ Quota Management แยกต่าง Account
- แต่ละ account มี quota counter แยกกัน
- Upload ไปที่ account ไหน quota ก็หักจาก account นั้น
- แสดง quota remaining ต่อ account ใน UI
- รองรับ reset quota ต่อ account

### ✅ Auto Token Refresh
- แต่ละ account มี OAuth2 client แยกกัน
- Token refresh อัตโนมัติเมื่อหมดอายุ
- Token ถูกเก็บใน `data/accounts.json` แยกต่าง account

### ✅ Backward Compatible
- ถ้าไม่มี account ใน system → ใช้ระบบเดิม (client_secret.json + token.json)
- Migration path: เพิ่ม account ใหม่ → login → สลับไปใช้
- ระบบเดิมยังใช้งานได้ปกติ

### ✅ Channel Info per Account
- แสดงชื่อ channel, subscriber count, video count
- ดึงข้อมูลหลัง login สำเร็จ
- แสดงใน accounts list

---

## 🚀 Next Steps (Optional Enhancements)

### 1. Account Selector in Upload UI
เพิ่ม dropdown ในหน้าอัปโหลดเพื่อเลือก account ก่อนอัป:
```javascript
// ใน upload.js
<select id="account-selector">
  <option value="">Active Account</option>
  {accounts.map(a => `<option value="${a.id}">${a.name}</option>`)}
</select>
```

### 2. Bulk Upload กับหลาย Accounts
กระจายการอัปโหลดไปหลาย accounts อัตโนมัติ:
- อัป 6 คลิปไป Account A
- อัป 6 คลิปไป Account B
- ช่วยหลีกเลี่ยง quota limit

### 3. Scheduled Rotation
ตั้งเวลาสลับ active account อัตโนมัติ:
- เช้า: ใช้ Account A
- บ่าย: ใช้ Account B
- ช่วยกระจาย quota usage

### 4. Account Groups
จัดกลุ่ม accounts เพื่อจัดการง่าย:
- Group: "Personal Channels"
- Group: "Client Channels"
- Group: "Testing Accounts"

---

## ⚠️ สิ่งที่ต้องระวัง

### 1. Client Secret Security
- ❌ **อย่า commit** `data/accounts.json` ไป git
- ✅ เพิ่ม `data/accounts.json` ใน `.gitignore` แล้ว
- ✅ Backend ไม่ส่ง clientSecret กลับไป frontend

### 2. Token Expiry
- Token จะหมดอายุหลัง 1 ชั่วโมง (access_token)
- Refresh token ใช้ขอ access_token ใหม่อัตโนมัติ
- ถ้า refresh token หมดอายุ → ต้อง re-login

### 3. Quota Reset
- YouTube API quota reset เที่ยงคืน PST ทุกวัน
- ระบบ reset quota ต้องทำ manual (กด "🔄 Reset Quota")
- **TODO**: เพิ่ม cron job reset quota อัตโนมัติทุกวัน

### 4. Account Deletion
- ลบ account = ลบ token ด้วย
- ถ้าลบ active account → ระบบจะเปลี่ยนไปใช้ account แรก
- ถ้าไม่มี account → fallback ไปใช้ระบบเดิม

---

## 🧪 Testing Checklist

- [x] เพิ่ม account ใหม่
- [x] Login YouTube (OAuth flow)
- [x] สลับ active account
- [x] อัปโหลดวิดีโอด้วย active account
- [x] Quota tracking แยกต่าง account
- [x] Token refresh อัตโนมัติ
- [x] ลบ account
- [x] Reset quota
- [x] Backward compatible (ไม่มี account → ใช้ระบบเดิม)

---

## 📚 ไฟล์ที่เกี่ยวข้อง

### Backend
- `src/utils/accounts.js` - Account manager class
- `src/routes/accounts.js` - API routes
- `src/services/youtube.js` - YouTube service (multi-account support)
- `src/routes/auth.js` - OAuth routes (accountId support)
- `server.js` - OAuth callback handler
- `data/accounts.json` - Account data storage

### Frontend
- `public/pages/accounts.js` - Accounts management UI
- `public/index.html` - Navigation tab
- `public/app.js` - Route definition

---

## 💡 Example Use Cases

### Use Case 1: หลายช่อง YouTube
มีหลายช่อง YouTube ต้องการอัปโหลดแยกกัน:
1. เพิ่ม Account A (Main Channel)
2. เพิ่ม Account B (Backup Channel)
3. สลับ active account ก่อนอัป
4. Quota tracking แยกกัน

### Use Case 2: Multi-User System
หลายคนใช้ระบบร่วมกัน:
1. User A เพิ่ม account ของตัวเอง
2. User B เพิ่ม account ของตัวเอง
3. แต่ละคนสลับไปใช้ account ของตัวเอง
4. Quota ไม่รบกวนกัน

### Use Case 3: Agency Management
Agency จัดการหลาย client channels:
1. เพิ่ม account ของแต่ละ client
2. สลับ active account ตามที่ต้องการอัปโหลด
3. Track quota per client
4. แยก analytics per client (TODO)

---

## 🔥 Benefits

1. **ไม่โดน Quota Limit** - กระจายการอัปโหลดไปหลาย accounts
2. **จัดการง่าย** - สลับ account ด้วยคลิกเดียว
3. **Secure** - Token เก็บแยกกัน, client secret ไม่ส่งไป frontend
4. **Flexible** - รองรับทั้งระบบเดิมและระบบใหม่
5. **Scalable** - เพิ่ม account ได้ไม่จำกัด
6. **Shareable** - ระบบใช้งานได้หลายคน/หลายเครื่อง

---

✅ **ระบบ Multi-Account Management พร้อมใช้งานแล้ว!**

ลองเปิดหน้า **👥 Accounts** แล้วเพิ่ม account ดูครับ 🚀
