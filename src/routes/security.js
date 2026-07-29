/**
 * Security routes — login / logout / status
 * ไม่ต้องผ่าน auth (อยู่ใน PUBLIC_PATHS) แต่มี throttle กัน brute force
 */
const express = require('express');
const logger  = require('../utils/logger');
const sec     = require('../middleware/security');

const router = express.Router();

// ─── GET /status — frontend ใช้เช็คว่าต้อง login ไหม ────────────────
router.get('/status', (req, res) => {
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, p) => {
    const i = p.indexOf('=');
    if (i > 0) acc[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    return acc;
  }, {});

  res.json({
    authEnabled:   sec.AUTH_ENABLED,
    authenticated: !sec.AUTH_ENABLED || sec.verifyToken(cookies[sec.COOKIE_NAME]),
    localRequest:  sec.isLocalRequest(req),
    hint: sec.AUTH_ENABLED
      ? 'ตั้งรหัสผ่านไว้แล้ว — ต้อง login ก่อนใช้งาน'
      : 'ยังไม่ได้ตั้ง DASHBOARD_PASSWORD — คำสั่งอันตรายใช้ได้จากเครื่องที่รันระบบเท่านั้น',
  });
});

// ─── POST /login ───────────────────────────────────────────────────
router.post('/login', (req, res) => {
  if (!sec.AUTH_ENABLED) {
    return res.json({ success: true, authEnabled: false, message: 'ระบบไม่ได้เปิด auth' });
  }

  const ip = req.ip || 'unknown';
  const throttle = sec.checkLoginThrottle(ip);
  if (!throttle.allowed) {
    return res.status(429).json({
      error: `ลองผิดหลายครั้งเกินไป — รออีก ${Math.ceil(throttle.retryAfterMs / 60000)} นาที`,
      code: 'LOGIN_BLOCKED',
    });
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !sec.timingSafeEqual(password, sec.PASSWORD)) {
    sec.recordLoginFailure(ip);
    logger.warn('[Security] login ผิด', { ip });
    return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง', code: 'BAD_PASSWORD' });
  }

  sec.clearLoginFailures(ip);
  const expiresAt = Date.now() + sec.SESSION_TTL_MS;
  const token = sec.signToken(expiresAt);

  const secureFlag = req.secure || req.headers['x-forwarded-proto'] === 'https' ? ' Secure;' : '';
  res.setHeader('Set-Cookie',
    `${sec.COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax;${secureFlag} Max-Age=${Math.floor(sec.SESSION_TTL_MS / 1000)}`
  );

  logger.info('[Security] login สำเร็จ', { ip });
  res.json({ success: true, expiresAt: new Date(expiresAt).toISOString() });
});

// ─── POST /logout ──────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${sec.COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ success: true });
});

module.exports = router;
