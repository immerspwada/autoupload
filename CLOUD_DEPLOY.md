# 🚀 Cloud Deploy Guide — YouTube Auto Uploader v2

> ระบบต้องรัน **24/7** เพราะต้องดาวน์โหลด TikTok + อัป YouTube อัตโนมัติ  
> ❌ Vercel/Netlify ไม่ได้ (serverless timeout 60s)  
> ✅ Railway / Fly.io / Render / Docker VPS — ทำได้ทั้งหมด

---

## 📋 สิ่งที่ต้องเตรียมก่อน Deploy

### 1. Google OAuth Credentials
1. ไปที่ https://console.cloud.google.com
2. สร้าง/เลือก Project → Enable **YouTube Data API v3**
3. APIs & Services → Credentials → Create → **OAuth 2.0 Client ID** → Web Application
4. Authorized redirect URIs → เพิ่ม URL ของแต่ละ platform (ดูด้านล่าง)
5. Download JSON → บันทึกเป็น `client_secret.json`

### 2. GitHub Repository (ถ้าใช้ Railway/Render)
```bash
git init
git remote add origin https://github.com/YOUR_USERNAME/autoupload.git
git add .
git commit -m "initial"
git push -u origin main
```

> ✅ `client_secret.json` และ `data/*.json` อยู่ใน `.gitignore` — ไม่ถูก push

---

## ⚡ Option 1: Railway (แนะนำ — ง่ายที่สุด)

**ราคา:** $5 credit ฟรี (~1-2 เดือน) → $5-20/เดือน  
**Pros:** Auto-deploy จาก GitHub, Volume ง่าย, ไม่ sleep

### ขั้นตอน

```
1. https://railway.app → Login with GitHub
2. New Project → Deploy from GitHub Repo → เลือก repo
3. Railway detect Dockerfile อัตโนมัติ → รอ build 3-5 นาที
```

### Variables ที่ต้องตั้งใน Railway Dashboard

```
NODE_ENV=production
PORT=3000
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

> ✅ `RAILWAY_PUBLIC_DOMAIN` ถูกตั้งอัตโนมัติ — ระบบใช้สร้าง OAuth redirect URI เอง

### เพิ่ม Volume (สำคัญมาก — ป้องกันข้อมูลหาย)

Railway Dashboard → Service → Volumes:
```
Mount 1:  /app/data       (1 GB)   ← settings, tokens, uploads history
Mount 2:  /app/downloads  (5 GB)   ← TikTok downloads
Mount 3:  /app/uploads    (2 GB)   ← uploaded files
Mount 4:  /app/logs       (500 MB) ← logs
```

### เพิ่ม client_secret.json

**วิธี A — ผ่าน Variable (แนะนำสำหรับ Railway):**
```bash
# แปลง JSON เป็น single line แล้วใส่ใน Variable
GOOGLE_CREDENTIALS_JSON={"web":{"client_id":"...","client_secret":"...","redirect_uris":["..."]}}
```

**วิธี B — ผ่าน Volume:**
```bash
# หลัง deploy ครั้งแรก ใช้ Railway CLI อัป file
railway run --service autoupload -- bash
# แล้ว paste ไฟล์ผ่าน terminal
```

### แก้ OAuth Redirect URI
Google Cloud Console → Credentials → OAuth Client ID → เพิ่ม:
```
https://YOUR-APP.railway.app/oauth2callback
```

---

## 🪰 Option 2: Fly.io

**ราคา:** ฟรี 3 shared VM (256MB RAM ต่อตัว) → $1.94/เดือนสำหรับ 1 VM 512MB  
**Pros:** ราคาถูก, region Singapore ใกล้ไทย

### ติดตั้ง Fly CLI

```bash
# macOS
brew install flyctl

# หรือ
curl -L https://fly.io/install.sh | sh
```

### Deploy

```bash
fly auth login
fly launch --name autoupload --region sin --no-deploy
# แก้ fly.toml ถ้าต้องการ (มีให้แล้วในโปรเจค)

# สร้าง volumes
fly volumes create autoupload_data      --region sin --size 1
fly volumes create autoupload_downloads --region sin --size 5

# ตั้ง secrets (ปลอดภัยกว่า env var)
fly secrets set NODE_ENV=production
fly secrets set GOOGLE_CREDENTIALS_JSON='PASTE_YOUR_JSON_HERE'

# Deploy
fly deploy
```

### ดู logs
```bash
fly logs
fly status
```

### แก้ OAuth Redirect URI
```
https://autoupload.fly.dev/oauth2callback
```

---

## 🎨 Option 3: Render.com

**ราคา:** Free tier (sleep 15 นาที ❌) → Starter $7/เดือน (ไม่ sleep ✅)  
**Pros:** ง่าย, มี free tier ทดสอบ

### Deploy

1. https://render.com → New → Web Service
2. Connect GitHub repo
3. Runtime: **Docker**
4. Region: Singapore

### Environment Variables

```
NODE_ENV=production
PORT=3000
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
GOOGLE_CREDENTIALS_JSON={"web":{...}}
```

### Disk (Persistent Volume)
Add Disk → Mount Path: `/app/data` → Size: 2 GB

> ⚠️ Render รองรับ 1 volume ต่อ service — downloads จะอยู่ใน `/app/data/downloads`

### แก้ OAuth Redirect URI
```
https://autoupload.onrender.com/oauth2callback
```

---

## 🐳 Option 4: Docker บน VPS (DigitalOcean / AWS / Hostinger)

**ราคา:** $6/เดือน (DigitalOcean Droplet 1GB) ขึ้นไป  
**Pros:** ควบคุมได้ 100%, ข้อมูลปลอดภัย, persistent ไม่ต้อง volume แยก

### ขั้นตอน

```bash
# 1. SSH เข้า VPS
ssh root@YOUR_SERVER_IP

# 2. ติดตั้ง Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# 3. Clone repo
git clone https://github.com/YOUR_USERNAME/autoupload.git
cd autoupload

# 4. วาง client_secret.json
nano client_secret.json   # paste JSON แล้ว Ctrl+X, Y

# 5. (Optional) ตั้ง APP_URL ถ้ามี domain
echo "APP_URL=https://yourdomain.com" > .env

# 6. Run
docker compose up -d

# 7. ดู logs
docker compose logs -f

# 8. เปิด port (ถ้าใช้ firewall)
ufw allow 3000/tcp
```

### ใช้ Nginx reverse proxy + SSL (แนะนำสำหรับ domain จริง)

```bash
# ติดตั้ง Nginx + Certbot
apt install nginx certbot python3-certbot-nginx -y

# สร้าง config
cat > /etc/nginx/sites-available/autoupload << 'EOF'
server {
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600;
    }
}
EOF

ln -s /etc/nginx/sites-available/autoupload /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# ติดตั้ง SSL
certbot --nginx -d yourdomain.com
```

แก้ OAuth Redirect URI:
```
https://yourdomain.com/oauth2callback
```

---

## 🔄 Auto-Update (Optional)

### Watchtower — อัป Docker image อัตโนมัติ

```bash
docker run -d \
  --name watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --interval 86400 \
  autoupload
```

---

## 📱 หลัง Deploy — ขั้นตอน Login YouTube

1. เปิด `https://YOUR_DOMAIN`
2. กด **เชื่อมต่อ YouTube**
3. ทำ OAuth flow → อนุญาต
4. Token จะถูกเก็บใน Volume `/app/data/` → ไม่หายเมื่อ restart/redeploy
5. ไปที่ Settings → Scheduler → เปิดใช้งาน
6. ตั้ง Keywords สำหรับค้นหา TikTok
7. ตั้ง Interval (แนะนำ 30-60 นาที)
8. กด Save → ระบบจะทำงานเอง 24/7

---

## 🔑 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | Yes | production | Environment |
| `APP_URL` | No* | auto-detect | Full URL ของ app (สำหรับ OAuth) |
| `RAILWAY_PUBLIC_DOMAIN` | No | - | ตั้งอัตโนมัติโดย Railway |
| `GOOGLE_CREDENTIALS_JSON` | No** | - | JSON string ของ client_secret |
| `GOOGLE_CLIENT_ID` | No** | - | Client ID (ถ้าไม่ใช้ JSON) |
| `GOOGLE_CLIENT_SECRET` | No** | - | Client Secret |
| `YOUTUBE_QUOTA_LIMIT` | No | 10000 | Override quota limit |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Yes | true | ใช้ system chromium |
| `PUPPETEER_EXECUTABLE_PATH` | Yes | /usr/bin/chromium | Path ของ chromium |

> *`APP_URL` ไม่จำเป็นบน Railway (ใช้ `RAILWAY_PUBLIC_DOMAIN` แทน)  
> **ถ้าไม่มี env var เหล่านี้ ระบบจะอ่านจากไฟล์ `client_secret.json` แทน

---

## 🐛 Troubleshooting

### Puppeteer / Chromium crash
```bash
# เช็คว่า chromium ทำงานได้
docker exec autoupload /usr/bin/chromium --version

# ถ้า OOM → เพิ่ม RAM (ต้องการอย่างน้อย 512MB)
```

### OAuth error หลัง deploy
- ตรวจว่า Redirect URI ใน Google Cloud ตรงกับ URL จริง
- ตรวจว่า `APP_URL` หรือ `RAILWAY_PUBLIC_DOMAIN` ถูกต้อง

### ข้อมูลหายหลัง restart
- ตรวจว่า Volume ถูก mount ที่ `/app/data`
- Railway: ดูที่ Volumes tab ใน service

### Quota หมด
- ดูสถานะที่ Dashboard → Quota widget
- Reset เที่ยงคืน PST (07:00 น. ไทย)
- เพิ่ม account ได้ที่ Settings → Accounts

### TikTok download ล้มเหลว
```bash
# เช็ค yt-dlp version
docker exec autoupload yt-dlp --version

# อัป yt-dlp
docker exec autoupload pip3 install --upgrade yt-dlp
```

---

## 💰 ค่าใช้จ่ายเปรียบเทียบ

| Platform | ราคา/เดือน | RAM | Disk | หมายเหตุ |
|----------|-----------|-----|------|----------|
| Railway | ~$5-10 | 512MB-1GB | Volume แยก | แนะนำ — ง่ายที่สุด |
| Fly.io | ~$2-5 | 256-512MB | Volume แยก | ถูกที่สุด |
| Render | $7+ | 512MB | Disk $0.25/GB | ง่าย |
| DigitalOcean | $6+ | 1GB | 25GB included | ควบคุมได้มากที่สุด |
| AWS EC2 t3.micro | ~$8 | 1GB | EBS แยก | Free tier 1 ปีแรก |
