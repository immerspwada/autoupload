#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# Cloud Setup Script — YouTube Auto Uploader
# รัน: bash scripts/setup-cloud.sh
# ─────────────────────────────────────────────────────────────────

set -e

echo ""
echo "🚀 YouTube Auto Uploader — Cloud Setup"
echo "══════════════════════════════════════"
echo ""

# ── ตรวจ dependencies ──────────────────────────────────────────────
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "❌ ต้องติดตั้ง $1 ก่อน"
    exit 1
  fi
}

check_cmd git
check_cmd node
check_cmd docker

echo "✅ Dependencies OK"
echo ""

# ── เลือก platform ─────────────────────────────────────────────────
echo "เลือก platform:"
echo "  1) Railway (แนะนำ)"
echo "  2) Fly.io"
echo "  3) Render"
echo "  4) Docker (VPS)"
echo "  5) Local (PM2)"
echo ""
read -p "เลือก [1-5]: " PLATFORM

echo ""

case $PLATFORM in
  1)
    echo "📦 Railway Deploy"
    echo ""
    echo "1. Push code ไป GitHub:"
    echo "   git add ."
    echo "   git commit -m 'deploy'"
    echo "   git push"
    echo ""
    echo "2. ไปที่ https://railway.app → New Project → Deploy from GitHub"
    echo "   เลือก repo → รอ build"
    echo ""
    echo "3. ตั้ง Environment Variables ใน Railway Dashboard:"
    echo "   NODE_ENV=production"
    echo "   PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true"
    echo "   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium"
    echo ""
    echo "4. เพิ่ม Volumes:"
    echo "   /app/data       (1GB)"
    echo "   /app/downloads  (5GB)"
    echo ""
    echo "5. Generate Domain → Settings → Networking"
    echo ""
    echo "6. เพิ่ม OAuth Redirect URI ใน Google Cloud:"
    echo "   https://YOUR-APP.railway.app/oauth2callback"
    ;;

  2)
    echo "🪰 Fly.io Deploy"
    echo ""
    check_cmd fly || { echo "ติดตั้ง fly CLI: brew install flyctl"; exit 1; }
    
    fly auth login
    
    APP_NAME="autoupload-$(date +%s | tail -c5)"
    echo "App name: $APP_NAME"
    
    fly launch --name "$APP_NAME" --region sin --no-deploy
    
    echo "สร้าง volumes..."
    fly volumes create autoupload_data      --region sin --size 1
    fly volumes create autoupload_downloads --region sin --size 5
    
    echo ""
    echo "ตั้ง Google credentials:"
    read -p "Paste GOOGLE_CREDENTIALS_JSON: " GOOGLE_CREDS
    fly secrets set "GOOGLE_CREDENTIALS_JSON=$GOOGLE_CREDS"
    
    fly secrets set NODE_ENV=production
    
    echo ""
    echo "🚀 Deploying..."
    fly deploy
    
    echo ""
    echo "✅ Deploy สำเร็จ!"
    echo "เพิ่ม OAuth Redirect URI:"
    echo "https://$APP_NAME.fly.dev/oauth2callback"
    ;;

  3)
    echo "🎨 Render Deploy"
    echo ""
    echo "1. Push code ไป GitHub"
    echo "2. ไปที่ https://render.com → New → Web Service"
    echo "3. Connect GitHub → Runtime: Docker"
    echo "4. ตั้ง Environment Variables ดูใน CLOUD_DEPLOY.md"
    echo "5. Add Disk → /app/data → 2GB"
    ;;

  4)
    echo "🐳 Docker VPS Deploy"
    echo ""
    
    # Check client_secret.json
    if [ ! -f "client_secret.json" ]; then
      echo "⚠️  ไม่พบ client_secret.json"
      echo "   Download จาก Google Cloud Console แล้ววางในโฟลเดอร์นี้"
      read -p "กด Enter เมื่อพร้อม..."
    fi
    
    echo "Building Docker image..."
    docker build -t autoupload:latest .
    
    echo ""
    echo "Starting containers..."
    docker compose up -d
    
    echo ""
    echo "✅ Started!"
    echo "เปิด: http://localhost:3000"
    echo "ดู logs: docker compose logs -f"
    ;;

  5)
    echo "💻 Local PM2"
    echo ""
    
    check_cmd pm2 || { npm install -g pm2; }
    
    npm install
    pm2 start ecosystem.config.js
    pm2 startup
    pm2 save
    
    echo ""
    echo "✅ Started with PM2!"
    echo "เปิด: http://localhost:3000"
    echo "ดู status: pm2 status"
    echo "ดู logs: pm2 logs autoupload"
    ;;

  *)
    echo "❌ ตัวเลือกไม่ถูกต้อง"
    exit 1
    ;;
esac

echo ""
echo "📖 อ่านคู่มือเพิ่มเติม: cat CLOUD_DEPLOY.md"
echo ""
