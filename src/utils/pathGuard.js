/**
 * ★ Path guard — บังคับให้ทุก filepath ที่มาจาก request อยู่ในโฟลเดอร์ที่อนุญาตเท่านั้น
 *
 * ปัญหาเดิม: /api/transform/preview|single|compile รับ filepath ตรงจาก body
 * แล้วเช็คแค่ fs.existsSync → เรียก ffprobe/ffmpeg กับไฟล์ไหนก็ได้บนเครื่อง
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

// โฟลเดอร์ที่อนุญาตให้อ่าน/ประมวลผลไฟล์วิดีโอ
const ALLOWED_DIRS = [
  path.join(ROOT, 'uploads'),
  path.join(ROOT, 'downloads'),
  path.join(ROOT, 'downloads/tiktok'),
  path.join(ROOT, 'downloads/transformed'),
  path.join(ROOT, 'downloads/temp'),
  path.join(ROOT, 'assets'),
];

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.m4v', '.mpg', '.mpeg', '.wmv']);

class PathGuardError extends Error {
  constructor(message, code = 'PATH_FORBIDDEN') {
    super(message);
    this.name = 'PathGuardError';
    this.code = code;
    this.statusCode = code === 'PATH_NOT_FOUND' ? 404 : 400;
  }
}

/**
 * เพิ่มโฟลเดอร์ที่ user ตั้งเองใน settings (watch folder) เข้า allow-list
 */
function extraAllowedDirs() {
  try {
    const { settings } = require('./store');
    const folder = settings.loadRef()?.folder;
    return folder ? [path.resolve(folder)] : [];
  } catch (_) {
    return [];
  }
}

function allowedRoots() {
  return [...ALLOWED_DIRS, ...extraAllowedDirs()].map(d => path.resolve(d));
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * ตรวจ + normalize filepath จาก request
 * @param {string} input
 * @param {object} opts { mustExist=true, videoOnly=true, maxBytes=0 }
 * @returns {string} absolute path ที่ปลอดภัย
 * @throws {PathGuardError}
 */
function resolveSafe(input, opts = {}) {
  const { mustExist = true, videoOnly = true, maxBytes = 0 } = opts;

  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathGuardError('ต้องระบุ filepath', 'PATH_INVALID');
  }
  if (input.includes('\0')) {
    throw new PathGuardError('filepath ไม่ถูกต้อง', 'PATH_INVALID');
  }

  // relative path → อ้างจาก project root
  const abs = path.resolve(path.isAbsolute(input) ? input : path.join(ROOT, input));

  // ★ resolve symlink ก่อนเทียบ — กัน symlink ชี้ออกนอก allow-list
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch (_) {
    if (mustExist) throw new PathGuardError(`ไม่พบไฟล์: ${path.basename(abs)}`, 'PATH_NOT_FOUND');
  }

  const roots = allowedRoots();
  if (!roots.some(root => isInside(real, root))) {
    throw new PathGuardError(
      `ไม่อนุญาตให้เข้าถึงไฟล์นอกโฟลเดอร์ของระบบ (${path.basename(real)})`,
      'PATH_FORBIDDEN'
    );
  }

  if (videoOnly && !VIDEO_EXTS.has(path.extname(real).toLowerCase())) {
    throw new PathGuardError('รองรับเฉพาะไฟล์วิดีโอ', 'PATH_NOT_VIDEO');
  }

  if (mustExist) {
    let stat;
    try { stat = fs.statSync(real); } catch (_) {
      throw new PathGuardError(`ไม่พบไฟล์: ${path.basename(real)}`, 'PATH_NOT_FOUND');
    }
    if (!stat.isFile()) throw new PathGuardError('ต้องเป็นไฟล์ ไม่ใช่โฟลเดอร์', 'PATH_NOT_FILE');
    if (stat.size === 0) throw new PathGuardError('ไฟล์ว่างเปล่า', 'PATH_EMPTY');
    if (maxBytes > 0 && stat.size > maxBytes) {
      throw new PathGuardError(
        `ไฟล์ใหญ่เกินกำหนด (${(stat.size / 1048576).toFixed(0)}MB > ${(maxBytes / 1048576).toFixed(0)}MB)`,
        'PATH_TOO_LARGE'
      );
    }
  }

  return real;
}

/**
 * ตรวจหลายไฟล์พร้อมกัน
 */
function resolveSafeMany(inputs, opts = {}) {
  if (!Array.isArray(inputs)) throw new PathGuardError('ต้องเป็น array ของ filepath', 'PATH_INVALID');
  const max = opts.maxCount || 50;
  if (inputs.length > max) {
    throw new PathGuardError(`ไฟล์เยอะเกินไป (สูงสุด ${max})`, 'PATH_TOO_MANY');
  }
  return inputs.map(f => resolveSafe(f, opts));
}

module.exports = { resolveSafe, resolveSafeMany, PathGuardError, allowedRoots, ROOT, VIDEO_EXTS };
