/**
 * ★ Advanced Logger with file rotation and levels
 *
 * แก้ไขจาก original:
 * 1. [MEDIUM] แทน magic numbers ด้วย constants
 * 2. [LOW] ปรับ _saveHashes ใช้ atomic write เหมือนกัน
 */
const fs   = require('fs');
const path = require('path');
const C    = require('../config/constants');

const LOG_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = {
  error: '\x1b[31m',
  warn:  '\x1b[33m',
  info:  '\x1b[36m',
  debug: '\x1b[90m',
  reset: '\x1b[0m',
};

class Logger {
  constructor(options = {}) {
    this.level       = options.level       || C.LOGGER.LEVEL;
    this.maxFileSize = options.maxFileSize || C.LOGGER.MAX_FILE_SIZE_BYTES;
    this.maxFiles    = options.maxFiles    || C.LOGGER.MAX_FILES;
  }

  _shouldLog(level) {
    return LEVELS[level] <= LEVELS[this.level];
  }

  _formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr   = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  _writeToFile(formatted) {
    const today   = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `app-${today}.log`);

    try {
      if (fs.existsSync(logFile)) {
        const s = fs.statSync(logFile);
        if (s.size >= this.maxFileSize) {
          this._rotateFile(logFile);
        }
      }
      fs.appendFileSync(logFile, formatted + '\n');
    } catch (err) {
      // Log write ล้มเหลว — แสดง stderr เท่านั้น ไม่โยน error ออก
      process.stderr.write(`[Logger] Write error: ${err.message}\n`);
    }
  }

  _rotateFile(filePath) {
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src  = `${filePath}.${i}`;
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
    const color     = COLORS[level] || '';
    console.log(`${color}${formatted}${COLORS.reset}`);
    this._writeToFile(formatted);
  }

  error(message, meta = {}) { this.log('error', message, meta); }
  warn( message, meta = {}) { this.log('warn',  message, meta); }
  info( message, meta = {}) { this.log('info',  message, meta); }
  debug(message, meta = {}) { this.log('debug', message, meta); }

  /** Get recent logs for dashboard — newest first */
  getRecentLogs(limit = 50, filterLevel = null) {
    const today   = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `app-${today}.log`);
    if (!fs.existsSync(logFile)) return [];

    const content = fs.readFileSync(logFile, 'utf8');
    let lines     = content.trim().split('\n').filter(l => l.length > 0);

    // Optional level filter (e.g. 'error' only)
    if (filterLevel) {
      const tag = `[${filterLevel.toUpperCase()}]`;
      lines = lines.filter(l => l.includes(tag));
    }

    return lines.slice(-limit).reverse();
  }
}

module.exports = new Logger({ level: process.env.LOG_LEVEL || C.LOGGER.LEVEL });
