/**
 * ★ Security middleware — auth + rate limit + security headers
 *
 * ปัญหาเดิม: server bind 0.0.0.0 แต่ไม่มี auth เลย → ใครในเน็ตเวิร์กเดียวกันก็
 * ลบวิดีโอบนช่อง YouTube / เพิ่ม-ลบ OAuth account / ล้างประวัติได้
 *
 * วิธีเปิดใช้: ตั้ง DASHBOARD_PASSWORD ใน .env แล้ว restart
 *   - ไม่ตั้ง → auth ปิด (โหมด localhost) แต่ route อันตรายจะถูกล็อกไว้ถ้า bind 0.0.0.0
 *   - ตั้งแล้ว → ต้อง login ก่อนเรียก API ทุกตัว
 */
const crypto = require('crypto');
const logger = require('../utils/logger');

const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const AUTH_ENABLED = PASSWORD.length > 0;
const COOKIE_NAME = 'au_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน

// secret สำหรับเซ็น session — สุ่มใหม่ทุกครั้งที่ restart (ปลอดภัยกว่า hardcode)
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// ── path ที่ไม่ต้อง auth ────────────────────────────────────────────
const PUBLIC_PATHS = new Set([
  '/api/health/live',
  '/api/health/ready',
  '/api/security/status',
  '/api/security/login',
  '/api/security/logout',
]);

// ══════════════════════════════════════════════════════════════════
//  Session token (HMAC — ไม่ต้องเก็บ state)
// ══════════════════════════════════════════════════════════════════
function signToken(expiresAt) {
  const payload = String(expiresAt);
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const idx = token.lastIndexOf('.');
  if (idx < 1) return false;
  const payload = token.slice(0, idx);
  const sig     = token.slice(idx + 1);

  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  if (!timingSafeEqual(sig, expected)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // เทียบกับตัวเองเพื่อให้เวลาคงที่ แล้วคืน false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  Login throttle — กัน brute force รหัสผ่าน
// ══════════════════════════════════════════════════════════════════
const loginAttempts = new Map(); // ip → { count, firstAt, blockedUntil }
const LOGIN_MAX = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_BLOCK_MS  = 15 * 60 * 1000;

function checkLoginThrottle(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return { allowed: true };
  if (rec.blockedUntil && Date.now() < rec.blockedUntil) {
    return { allowed: false, retryAfterMs: rec.blockedUntil - Date.now() };
  }
  return { allowed: true };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
    rec = { count: 0, firstAt: now, blockedUntil: 0 };
  }
  rec.count++;
  if (rec.count >= LOGIN_MAX) {
    rec.blockedUntil = now + LOGIN_BLOCK_MS;
    logger.warn('[Security] บล็อก IP ชั่วคราวจากการ login ผิดซ้ำ', { ip, minutes: LOGIN_BLOCK_MS / 60000 });
  }
  loginAttempts.set(ip, rec);
}

function clearLoginFailures(ip) { loginAttempts.delete(ip); }

// ══════════════════════════════════════════════════════════════════
//  Auth middleware
// ══════════════════════════════════════════════════════════════════
function isLocalRequest(req) {
  const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function authMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (!req.path.startsWith('/api/')) return next();   // static ปล่อยผ่าน (หน้า login ต้องโหลดได้)

  // 1) session cookie
  const cookies = parseCookies(req.headers.cookie || '');
  if (verifyToken(cookies[COOKIE_NAME])) return next();

  // 2) header (สำหรับ script/curl)
  const headerPw = req.headers['x-dashboard-password'];
  if (headerPw && timingSafeEqual(headerPw, PASSWORD)) return next();

  // 3) Basic auth
  const authz = req.headers.authorization || '';
  if (authz.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authz.slice(6), 'base64').toString('utf8');
      const pw = decoded.slice(decoded.indexOf(':') + 1);
      if (timingSafeEqual(pw, PASSWORD)) return next();
    } catch (_) {}
  }

  logger.warn('[Security] ปฏิเสธการเข้าถึง', { path: req.path, ip: req.ip });
  return res.status(401).json({
    error: 'ต้อง login ก่อน',
    code: 'UNAUTHORIZED',
    hint: 'POST /api/security/login ด้วย { password } หรือส่ง header x-dashboard-password',
  });
}

/**
 * ★ Guard สำหรับ route ที่ทำลายข้อมูล/แตะ YouTube ได้
 * ถ้าไม่ได้ตั้งรหัสผ่าน + request มาจากนอกเครื่อง → บล็อก
 * (ไม่ตั้งรหัสแล้วเปิด LAN = ห้ามลบวิดีโอคนอื่นได้)
 */
function requireAuthForDestructive(req, res, next) {
  if (AUTH_ENABLED) return next();       // authMiddleware ตรวจไปแล้ว
  if (isLocalRequest(req)) return next();

  logger.warn('[Security] บล็อก destructive route จากเครื่องภายนอก (ไม่ได้ตั้ง DASHBOARD_PASSWORD)', {
    path: req.path, ip: req.ip,
  });
  return res.status(403).json({
    error: 'คำสั่งนี้ทำได้จากเครื่องที่รันระบบเท่านั้น — ตั้ง DASHBOARD_PASSWORD ใน .env เพื่อเปิดใช้จากเน็ตเวิร์ก',
    code: 'LOCAL_ONLY',
  });
}

// ══════════════════════════════════════════════════════════════════
//  Rate limiter (in-memory, sliding window)
// ══════════════════════════════════════════════════════════════════
function rateLimit(opts = {}) {
  const {
    windowMs = 60_000,
    max = 300,
    name = 'default',
    message = 'ส่งคำขอถี่เกินไป — รอสักครู่แล้วลองใหม่',
    skip = null,
  } = opts;

  const hits = new Map(); // key → number[] timestamps

  // กวาด entry เก่าทุก windowMs เพื่อไม่ให้ Map โตไม่จำกัด
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, arr] of hits) {
      const kept = arr.filter(t => t > cutoff);
      if (kept.length === 0) hits.delete(key); else hits.set(key, kept);
    }
  }, windowMs);
  if (sweeper.unref) sweeper.unref();

  const mw = (req, res, next) => {
    if (typeof skip === 'function' && skip(req)) return next();

    const key = (req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    const cutoff = now - windowMs;

    const arr = (hits.get(key) || []).filter(t => t > cutoff);
    if (arr.length >= max) {
      const retryAfter = Math.ceil((arr[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      mw.stats.blocked++;
      return res.status(429).json({ error: message, code: 'RATE_LIMITED', retryAfterSeconds: retryAfter });
    }

    arr.push(now);
    hits.set(key, arr);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - arr.length));
    next();
  };

  mw.stats = { name, blocked: 0 };
  mw._hits = hits;
  mw._sweeper = sweeper;
  return mw;
}

// ══════════════════════════════════════════════════════════════════
//  Security headers (แทน helmet — ไม่ต้องเพิ่ม dependency)
// ══════════════════════════════════════════════════════════════════
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // ปิด API ไม่ให้ถูก cache โดย proxy
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

module.exports = {
  AUTH_ENABLED,
  COOKIE_NAME,
  SESSION_TTL_MS,
  authMiddleware,
  requireAuthForDestructive,
  rateLimit,
  securityHeaders,
  signToken,
  verifyToken,
  timingSafeEqual,
  isLocalRequest,
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginFailures,
  PASSWORD,
};
