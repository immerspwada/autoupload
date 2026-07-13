# 🚀 Deploy — ให้โปรแกรมทำงานเอง 24/7

## ✅ สิ่งที่ระบบทำเองอัตโนมัติ

| ระบบ | การทำงาน |
|------|----------|
| **PM2** | restart อัตโนมัติถ้า crash, รอด reboot เครื่อง |
| **Quota wait** | ตรวจ quota ก่อน scan — ถ้าหมดรอจนถึงเที่ยงคืน PST แล้วเริ่มใหม่ |
| **Folder watcher** | จับไฟล์ใหม่ใน watch folder แล้ว queue ทันที |
| **Scheduler** | scan folder ทุก N นาที (ตั้งค่าได้ใน settings) |
| **Auto cleanup** | ทำความสะอาด temp files ทุก 6 ชั่วโมง |

---

## 🛠️ ติดตั้ง PM2 (ครั้งแรกครั้งเดียว)

```bash
# 1. ติดตั้ง PM2 globally
npm install -g pm2

# 2. เข้าโฟลเดอร์โปรเจค
cd /Users/luckybear/autoupload

# 3. ติดตั้ง dependencies (ถ้ายังไม่ได้ทำ)
npm install

# 4. เริ่มต้นด้วย PM2
pm2 start ecosystem.config.js

# 5. ตั้งให้ PM2 บูตพร้อมเครื่องอัตโนมัติ
pm2 startup
# → PM2 จะแสดงคำสั่ง sudo ให้ copy แล้วรัน (รันด้วย)

# 6. บันทึก process list
pm2 save
```

---

## 📋 คำสั่ง PM2 ที่ใช้บ่อย

```bash
pm2 status                  # ดูสถานะทุก process
pm2 logs autoupload         # ดู logs real-time
pm2 logs autoupload --lines 100   # ดู 100 บรรทัดล่าสุด
pm2 restart autoupload      # restart
pm2 stop autoupload         # หยุด
pm2 delete autoupload       # ลบออกจาก PM2
pm2 monit                   # dashboard CPU/memory
```

---

## 🔑 ขั้นตอนหลังติดตั้ง (ทำครั้งแรก)

1. เปิด browser ไปที่ **http://localhost:3000**
2. คลิก **"เชื่อมต่อ YouTube"** → OAuth login
3. ตั้ง **Settings** → กำหนด watch folder + keywords
4. เปิด **Scheduler** → enabled = true, กำหนด interval

ระบบจะ:
- ดาวน์โหลดวิดีโอ TikTok ตาม keywords
- อัปโหลด YouTube ทันที (smart quota filter)
- ถ้า quota หมด → รอถึงเที่ยงคืน PST → เริ่มใหม่เอง
- ถ้า crash → PM2 restart เองภายใน 1-5 วินาที

---

## 🌐 Deploy บน VPS / Cloud (ให้รันตลอด 24/7 ไม่ต้องเปิด Mac)

### Option 1: DigitalOcean / Linode / Vultr (แนะนำ)
```bash
# บน VPS (Ubuntu 22.04)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
npm install -g pm2

git clone https://github.com/immerspwada/autoupload.git
cd autoupload
npm install
pm2 start ecosystem.config.js
pm2 startup systemd
pm2 save
```

### Option 2: Railway / Render (free tier)
- Push ไป GitHub แล้วเชื่อม Railway/Render
- ตั้ง env `PORT=3000` ใน dashboard
- ⚠️ Free tier อาจ sleep หลัง 15 นาที — ใช้ paid plan สำหรับ 24/7

### Option 3: รันบน Mac ตลอด
- ใช้ PM2 + `pm2 startup` ตามขั้นตอนด้านบน
- ตั้ง Mac ให้ไม่ sleep: System Settings → Battery → Prevent sleep

---

## 📊 ดู Quota Status

```bash
# ดูผ่าน API
curl http://localhost:3000/api/quota/status

# ดูใน logs
pm2 logs autoupload | grep -i quota
```

เมื่อ quota หมด จะเห็น log:
```
⏸️  Quota หมดวันนี้ — หยุดรอจนถึง quota reset { resetAt: ..., waitHours: ... }
```
และเมื่อ reset:
```
✅ Quota reset แล้ว — เริ่ม scan อัตโนมัติ
```

---

## 🔧 Extended Quota (อัปมากกว่า 6 คลิป/วัน)

1. ไปที่ https://console.cloud.google.com
2. APIs & Services → YouTube Data API v3 → Quotas → Edit Quotas
3. ขอเพิ่มเป็น 1,000,000 units/day
4. หลังได้รับอนุมัติ:
```bash
curl -X POST http://localhost:3000/api/quota/extend \
  -H "Content-Type: application/json" \
  -d '{"newLimit": 1000000, "confirm": true}'
```
