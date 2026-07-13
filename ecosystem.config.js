// PM2 Ecosystem Config — 24/7 Auto-restart
// 
// ติดตั้ง PM2: npm install -g pm2
// เริ่มต้น:    pm2 start ecosystem.config.js
// บู๊ตอัตโนมัติ: pm2 startup  (ทำตามคำสั่งที่ปรากฏ)
// บันทึก process: pm2 save
// ดู logs:    pm2 logs autoupload
// สถานะ:      pm2 status

module.exports = {
  apps: [
    {
      name: 'autoupload',
      script: 'server.js',
      cwd: __dirname,

      // ── Auto-restart ────────────────────────────────────────────
      // รีสตาร์ทเมื่อ crash — ไม่ต้องมีคนคอยดู
      autorestart: true,

      // Exponential backoff restart delay: 100ms → 200ms → 400ms → max 5000ms
      restart_delay: 1000,
      max_restarts: 50,       // ถ้า crash > 50 ครั้งภายใน watch_delay → stop
      min_uptime: '10s',      // ถ้าอยู่ได้ < 10s ถือว่า crash
      exp_backoff_restart_delay: 100,

      // ── Memory / CPU ─────────────────────────────────────────────
      // Restart ถ้า memory เกิน 1.5 GB (puppeteer อาจกินมาก)
      max_memory_restart: '1500M',

      // ── Environment ─────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001
      },

      // ── Logs ────────────────────────────────────────────────────
      // PM2 จะ rotate logs อัตโนมัติ (ติดตั้ง pm2-logrotate)
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',

      // ── Cluster / instances ──────────────────────────────────────
      // ใช้ 1 instance เพราะ WebSocket + state ต้องอยู่ใน process เดียว
      instances: 1,
      exec_mode: 'fork',

      // ── Watch (dev only — disable in production) ─────────────────
      watch: false,

      // ── Graceful shutdown ────────────────────────────────────────
      kill_timeout: 5000,     // รอ 5s ให้ SIGTERM ทำงานก่อน SIGKILL
      wait_ready: false,      // ไม่รอ process.send('ready')
      listen_timeout: 15000,  // รอ port bind ไม่เกิน 15s

      // ── Cron restart (optional) ──────────────────────────────────
      // Restart ทุกเช้า 8:00 น. ไทย (UTC+7 → 01:00 UTC) เพื่อ clear memory
      // uncomment บรรทัดนี้ถ้าต้องการ:
      // cron_restart: '0 1 * * *'
    }
  ]
};
