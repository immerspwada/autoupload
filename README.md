# 🎬 YouTube Auto Uploader v2.1

## ⚡ ระบบอัปโหลด YouTube อัตโนมัติ พร้อม TikTok Integration

**เป้าหมาย:** สร้างรายได้จาก YouTube Ad Revenue (Monetization) 💰

### 🚀 ฟีเจอร์หลัก

1. **📤 Upload YouTube** - อัปโหลดวิดีโอแบบเดี่ยว/แบบ batch พร้อม queue
2. **🎵 TikTok Downloader** - ดาวน์โหลด TikTok (no watermark) + virality scoring
3. **👥 Multi-Account** - จัดการหลาย YouTube accounts พร้อม quota tracking แยกกัน
4. **💎 Auto SEO** - สร้าง title/tags/category อัตโนมัติเพื่อเพิ่มยอดดู
5. **⏰ Scheduler** - ตั้งเวลาอัปโหลดอัตโนมัติ
6. **📊 Dashboard** - ติดตามสถิติและ quota real-time
7. **🎯 Smart Quota** - จัดการ YouTube API quota อัจฉริยะ

---

## 📦 Installation

```bash
npm install
npm start
# เปิด http://localhost:3000
```

---

## 🎯 ฟีเจอร์ทั้งหมด (11 ฟีเจอร์)

### Core Features
- ✅ **Dashboard** - ภาพรวมระบบ + สถิติ
- ✅ **Upload** - อัปโหลดวิดีโอ (single/batch)
- ✅ **TikTok** - ดาวน์โหลด + อัปโหลด TikTok → YouTube
- ✅ **Accounts** - จัดการหลาย YouTube accounts
- ✅ **Files** - ดูไฟล์ที่ดาวน์โหลด
- ✅ **Queue** - ระบบคิวอัปโหลด + retry
- ✅ **Scheduler** - ตั้งเวลาอัปโหลดอัตโนมัติ
- ✅ **SEO** - ตั้งค่า SEO automation
- ✅ **Activity** - Real-time event log
- ✅ **History** - ประวัติการอัปโหลด
- ✅ **Settings** - ตั้งค่าระบบ

---

## 🔥 ฟีเจอร์เด่น

### 1. TikTok Integration 🎵
```
- ค้นหา TikTok ด้วย keyword
- ดาวน์โหลด no watermark
- Virality scoring (🔥/📈/👍/📉)
- Monetization check (✓/⚠️/🚫)
- Auto SEO (title/tags/category)
- Batch download + upload
```

### 2. Multi-Account System 👥
```
- เพิ่มได้ไม่จำกัด YouTube accounts
- Quota tracking แยกต่าง account (10,000 units each)
- สลับ account คลิกเดียว
- OAuth per account
- Channel info display
```

### 3. Smart Quota Management 🎯
```
- Real-time quota tracking
- Auto-reset เที่ยงคืน PST
- Smart filtering (อัปคลิปดีเมื่อ quota น้อย)
- Extended quota support (1M+ units/day)
- 6 videos/day per account (default)
```

### 4. SEO Automation 💎
```
- Auto-generate title/description/tags
- Category detection (26 YouTube categories)
- Prime-time scheduling (19:00-21:00)
- Monetization optimization
- Viral content prioritization
```

---

## 🚀 Quick Start

### 1. เริ่มต้นใช้งาน
```bash
npm start
# เปิด http://localhost:3000
```

### 2. Login YouTube
```
1. เปิดหน้า Dashboard
2. กด "เข้าสู่ระบบ"
3. เลือก Google Account
4. อนุญาต YouTube access
```

### 3. อัปโหลดวิดีโอ
```
1. ไปหน้า "📤 อัปโหลด"
2. เลือกไฟล์
3. กรอก title/description
4. กดอัปโหลด
```

### 4. ดาวน์โหลด TikTok
```
1. ไปหน้า "🎵 TikTok"
2. ใส่ keyword (เช่น "แมว")
3. เลือกคลิปที่ต้องการ
4. กด "Download & Upload"
```

---

## 👥 Multi-Account Setup

### เพิ่ม YouTube Account
```
1. ไปหน้า "👥 Accounts"
2. กด "➕ เพิ่ม Account"
3. กรอก:
   - ชื่อ Account
   - Client ID (จาก Google Cloud Console)
   - Client Secret
4. กด "บันทึก"
5. กด "🔐 Login YouTube"
6. กด "✅ ใช้ Account นี้" (เป็น active account)
```

### ประโยชน์
```
- หลาย YouTube channels → จัดการในที่เดียว
- แต่ละ account มี quota 10,000 units แยกกัน
- 2 accounts = 12 videos/day
- 10 accounts = 60 videos/day
```

---

## 📊 Technology Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla JS (SPA)
- **Database:** JSON files
- **APIs:** YouTube Data API v3, TikTok scraping
- **Real-time:** WebSocket
- **Architecture:** Event-driven (EventBus pattern)

---

## 📂 Project Structure

```
autoupload/
├── server.js                 # Entry point
├── src/
│   ├── services/            # Business logic
│   │   ├── youtube.js       # YouTube API (multi-account)
│   │   ├── tiktok.js        # TikTok downloader
│   │   ├── queue.js         # Upload queue
│   │   ├── scheduler.js     # Auto scheduler
│   │   ├── eventbus.js      # Event bus + rules
│   │   └── orchestrator.js  # Service orchestration
│   ├── routes/              # API routes
│   │   ├── upload.js        # Upload endpoints
│   │   ├── tiktok.js        # TikTok endpoints
│   │   ├── accounts.js      # Account management
│   │   └── ...
│   └── utils/
│       ├── accounts.js      # Account manager
│       ├── logger.js        # Logging
│       └── store.js         # JSON data store
├── public/
│   ├── index.html           # SPA shell
│   ├── app.js               # Frontend router
│   └── pages/               # Page modules
│       ├── dashboard.js
│       ├── upload.js
│       ├── tiktok.js
│       ├── accounts.js
│       └── ...
└── data/
    ├── accounts.json        # Multi-account data
    ├── uploads.json         # Upload history
    ├── settings.json        # User settings
    └── ...
```

---

## 🎯 Monetization Strategy

### เป้าหมาย: ผ่าน YouTube Partner Program (YPP)
```
✅ 1,000 subscribers
✅ 4,000 watch hours (12 months)
```

### กลยุทธ์
1. **เลือกคลิปดี** → Virality score 75+ (🔥)
2. **SEO Optimization** → เพิ่มโอกาสโผล่ search/recommended
3. **Prime-time Upload** → 19:00-21:00 (คนดูมาก)
4. **Avoid Demonetization** → บล็อกคลิปเสี่ยง (⚠️/🚫)
5. **Multi-Account** → กระจาย quota หลาย channels

---

## ⚠️ YouTube API Quota

### Default (Free Tier)
```
10,000 units/day per account
= 6 uploads/day (1,600 units/upload)
Reset: Midnight PST daily
```

### Extended Quota (ขอได้ฟรี)
```
1M+ units/day
= 600+ uploads/day
ขอที่: Google Cloud Console → YouTube Data API v3 → Quotas
```

---

## 📚 Documentation

- **FEATURES.md** - รายละเอียดฟีเจอร์ทั้งหมด
- **MULTI_ACCOUNT_GUIDE.md** - คู่มือ Multi-Account ฉบับเต็ม
- **QUICK_START_ACCOUNTS.md** - เริ่มต้นใช้ Multi-Account
- **QUOTA_FIX.md** - แก้ไขปัญหา Quota
- **TIKTOK_FEATURES.md** - ฟีเจอร์ TikTok ละเอียด

---

## 🛠️ Configuration

### Google Cloud Console
```
1. สร้าง Project
2. เปิด YouTube Data API v3
3. สร้าง OAuth 2.0 Client ID
4. ดาวน์โหลด client_secret.json
5. วางไฟล์ในโฟลเดอร์โปรเจค
```

### Multi-Account (แนะนำ)
```
1. ไปหน้า "👥 Accounts"
2. เพิ่ม account ด้วย Client ID & Secret
3. Login per account
4. สลับ active account เมื่อต้องการอัป
```

---

## 🔧 Troubleshooting

### Quota หมด?
```
✅ สลับไปใช้ account อื่น
✅ รอ reset เที่ยงคืน PST
✅ ขอ Extended Quota (1M+ units/day)
```

### อัปโหลดล้มเหลว?
```
✅ ดูที่ "📋 Activity" → เช็ค error log
✅ ดูที่ "🔄 คิว" → ลองใหม่
✅ เช็ค quota remaining
```

### TikTok ดาวน์โหลดไม่ได้?
```
✅ เช็คว่า URL ถูกต้อง
✅ ลอง provider อื่น (ระบบมี 3 providers)
✅ ดู error log ใน Activity
```

---

## 📝 License

MIT License

---

## 🎉 Credits

Built with ❤️ for YouTube content creators

**Version:** 2.1.0
**Last Updated:** July 8, 2026

---

✅ **Ready to use!** เปิด http://localhost:3000 เริ่มอัปโหลดได้เลย! 🚀
