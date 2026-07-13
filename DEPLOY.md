# 🚀 Deploy Guide — YouTube Auto Uploader 24/7

## ⚠️ ทำไมถึงไม่ใช้ Vercel

Vercel เป็น Serverless — timeout 60 วินาที, ไม่มี persistent process, ไม่มี file system  
การดาวน์โหลด TikTok + อัป YouTube ใช้เวลา 2–10 นาที → ใช้ไม่ได้

## ✅ แนะนำ: Railway (ง่ายที่สุด, $5 credit ฟรี)

### ขั้นตอนที่ 1 — Push code ไป GitHub (เสร็จแล้ว)
```
https://github.com/immerspwada/autoupload
```

### ขั้นตอน 2 — สร้าง Railway project
1. ไปที่ https://railway.app → Login ด้วย GitHub
2. **New Project** → **Deploy from GitHub repo** → เลือก `autoupload`
3. Railway จะ detect `Dockerfile` และ build อัตโนมัติ
4. รอ build เสร็จ (3–5 นาที)

### ขั้นตอน 3 — ตั้ง Environment Variables
ใน Railway dashboard → Settings → Variables:
```
PORT=3000
NODE_ENV=production
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### ขั้นตอน 4 — เพิ่ม Volume (สำหรับ data persistent)
1. Railway dashboard → Add Volume
2. Mount path: `/app/data`  ← เก็บ settings, quota, uploads history, OAuth tokens
3. Add Volume อีก → Mount path: `/app/downloads`

### ขั้นตอน 5 — Generate Domain
Settings → Networking → Generate Domain  
จะได้ URL เช่น `autoupload.railway.app`

### ขั้นตอน 6 — แก้ OAuth Redirect URI
เพราะ URL เปลี่ยนจาก localhost ไปเป็น domain จริง:
1. ไปที่ https://console.cloud.google.com
2. APIs & Services → Credentials → OAuth 2.0 Client ID ของคุณ
3. Authorized redirect URIs → เพิ่ม: `https://autoupload.railway.app/oauth2callback`
4. Save

### ขั้นตอน 7 — Login YouTube
1. เปิด `https://autoupload.railway.app`
2. กด **เชื่อมต่อ YouTube** → OAuth login
3. Token จะถูกเก็บใน Volume → ไม่หายเมื่อ redeploy

### ขั้นตอน 8 — เปิด Scheduler
1. Settings → Scheduler → เปิด toggle
2. ตั้ง interval (แนะนำ 30 นาที)
3. บันทึก

**ระบบจะทำงานเอง:**
- ค้นหา TikTok ตาม keywords ที่ตั้งไว้
- อัปโหลด YouTube อัตโนมัติ
- ถ้า quota หมด → รอถึงเที่ยงคืน PST → เริ่มใหม่เอง
- ถ้า crash → Railway restart เองทันที

---

## 🐳 Deploy ด้วย Docker (VPS / DigitalOcean / ทุกที่)

```bash
# Clone
git clone https://github.com/immerspwada/autoupload.git
cd autoupload

# วาง client_secret.json ที่ได้จาก Google Cloud Console
cp /path/to/your/client_secret.json ./client_secret.json

# Run
docker compose up -d

# ดู logs
docker compose logs -f

# เปิด browser
open http://YOUR_SERVER_IP:3000
```

Volume `data/`, `downloads/`, `uploads/`, `logs/` จะ mount ไปที่โฟลเดอร์ local  
ข้อมูลไม่หายเมื่อ restart/update

---

## 💻 Deploy บน Mac (รันตลอด 24/7)

```bash
cd /Users/luckybear/autoupload

# ติดตั้ง PM2 (ถ้ายังไม่มี)
npm install -g pm2

# Start
pm2 start ecosystem.config.js

# ตั้งให้บูตพร้อมเครื่อง
pm2 startup        # copy คำสั่งที่ได้มา แล้วรัน
pm2 save

# ดู status
pm2 status
pm2 logs autoupload
```

---

## 🔑 Google OAuth Setup (ทำครั้งแรกครั้งเดียว)

1. ไปที่ https://console.cloud.google.com
2. สร้าง Project ใหม่ (หรือใช้ของเดิม)
3. Enable **YouTube Data API v3**
4. Credentials → Create → OAuth 2.0 Client ID → Web Application
5. Authorized redirect URIs:
   - `http://localhost:3000/oauth2callback` (local)
   - `https://YOUR_DOMAIN/oauth2callback` (cloud)
6. Download JSON → บันทึกเป็น `client_secret.json` ในโฟลเดอร์โปรเจค

---

## 📊 Quota ที่ต้องรู้

| Operation | Units |
|-----------|-------|
| Upload video | 1,600 |
| Search | 100 |
| List videos | 1 |
| **Max uploads/day** | **6 คลิป** (free tier) |

**Reset:** เที่ยงคืน PST ทุกวัน (07:00 น. ไทย)

ระบบจะ:
- ตรวจ quota ก่อนอัปทุกครั้ง
- ถ้าหมด → หยุด + ตั้ง timer รอ reset → เริ่มสแกนใหม่อัตโนมัติ
- Dashboard แสดง quota real-time

ขอ Extended Quota (สูงสุด 1M units = 600 uploads/day):  
Settings → Quota → ขอ Extended Quota → ทำตามขั้นตอน
