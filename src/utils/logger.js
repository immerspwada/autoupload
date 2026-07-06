// Advanced Logger with file rotation and levels
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  reset: '\x1b[0m'
};

class Logger {
  constructor(options = {}) {
    this.level = options.level || 'info';
    this.maxFileSize = options.maxFileSize || 5 * 1024 * 1024; // 5MB
    this.maxFiles = options.maxFiles || 5;
  }

  _shouldLog(level) {
    return LEVELS[level] <= LEVELS[this.level];
  }

  _formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  _writeToFile(formatted) {
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `app-${today}.log`);

    try {
      // Rotate if file too large
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size >= this.maxFileSize) {
          this._rotateFile(logFile);
        }
      }
      fs.appendFileSync(logFile, formatted + '\n');
    } catch (err) {
      console.error('Logger write error:', err.message);
    }
  }

  _rotateFile(filePath) {
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = `${filePath}.${i}`;
      const dest = `${filePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        if (i + 1 >= this.maxFiles) {
          fs.unlinkSync(src);
        } else {
          fs.renameSync(src, dest);
        }
      }
    }
    fs.renameSync(filePath, `${filePath}.1`);
  }

  log(level, message, meta = {}) {
    if (!this._shouldLog(level)) return;
    const formatted = this._formatMessage(level, message, meta);
    const color = COLORS[level] || '';
    console.log(`${color}${formatted}${COLORS.reset}`);
    this._writeToFile(formatted);
  }

  error(message, meta = {}) { this.log('error', message, meta); }
  warn(message, meta = {}) { this.log('warn', message, meta); }
  info(message, meta = {}) { this.log('info', message, meta); }
  debug(message, meta = {}) { this.log('debug', message, meta); }

  // Get recent logs for dashboard
  getRecentLogs(limit = 50) {
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `app-${today}.log`);
    if (!fs.existsSync(logFile)) return [];

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);
    return lines.slice(-limit).reverse();
  }
}

module.exports = new Logger({ level: process.env.LOG_LEVEL || 'info' });
