// PM2 Ecosystem Config — YouTube Auto Uploader 24/7
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 startup   → ตั้งให้บูตพร้อมเครื่อง
//   pm2 save      → บันทึก process list
//   pm2 logs autoupload
//   pm2 monit

module.exports = {
  apps: [{
    name: 'autoupload',
    script: 'server.js',
    cwd: __dirname,

    // Auto-restart
    autorestart: true,
    watch: false,
    max_restarts: 50,
    restart_delay: 5000,

    // Memory limit — restart if exceeds (ffmpeg can spike)
    max_memory_restart: '1G',

    // Environment
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },

    // Logging
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true,
    log_type: 'json',

    // Graceful shutdown
    kill_timeout: 10000,
    listen_timeout: 8000,

    // Cron restart — restart at 6 AM Bangkok time daily
    // เพื่อ clear memory leaks และ refresh connections
    cron_restart: '0 6 * * *',
  }]
};
