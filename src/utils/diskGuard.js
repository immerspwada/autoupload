/**
 * ★ Disk guard — เช็คพื้นที่ว่างก่อนงานที่กินดิสก์ (download / transform / upload)
 *
 * ปัญหาเดิม: health.js คำนวณ % ดิสก์ไว้แต่ไม่มีใครเอาไปบล็อกงานจริง
 * → ดิสก์เต็มกลางทาง = ไฟล์เสีย, JSON store เขียนไม่ได้, ข้อมูลหาย
 */
const fs   = require('fs');
const path = require('path');
const logger = require('./logger');

const ROOT = path.join(__dirname, '../..');

// ต้องเหลือขั้นต่ำเท่าไรถึงจะยอมเริ่มงานใหม่
const MIN_FREE_BYTES = parseInt(process.env.DISK_MIN_FREE_BYTES) || 2 * 1024 * 1024 * 1024; // 2GB
// เผื่อสำหรับ transform: output อาจใหญ่กว่า input ได้ถึง ~2.5 เท่า
const TRANSFORM_MULTIPLIER = 2.5;

class DiskFullError extends Error {
  constructor(freeBytes, needBytes) {
    super(`พื้นที่ดิสก์ไม่พอ — เหลือ ${fmt(freeBytes)} ต้องการ ${fmt(needBytes)}`);
    this.name = 'DiskFullError';
    this.code = 'ENOSPC_GUARD';
    this.statusCode = 507;
    this.freeBytes = freeBytes;
    this.needBytes = needBytes;
  }
}

function fmt(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(1)} ${u[i]}`;
}

/**
 * อ่านพื้นที่ว่างจริง (Node 18+ statfsSync, fallback = ไม่รู้)
 */
function getDiskInfo(targetPath = ROOT) {
  try {
    if (typeof fs.statfsSync !== 'function') return { available: false };
    const st = fs.statfsSync(targetPath);
    const total = st.blocks * st.bsize;
    const free  = st.bavail * st.bsize;
    return {
      available: true,
      totalBytes: total,
      freeBytes:  free,
      usedBytes:  total - free,
      percentUsed: total > 0 ? Math.round(((total - free) / total) * 100) : 0,
      totalFormatted: fmt(total),
      freeFormatted:  fmt(free),
    };
  } catch (err) {
    logger.debug('[DiskGuard] statfs ไม่สำเร็จ', { error: err.message });
    return { available: false };
  }
}

/**
 * ★ เช็คว่ามีที่พอสำหรับงานนี้ไหม
 * @param {number} needBytes ขนาดที่คาดว่าจะใช้
 * @param {object} opts { label, minFree }
 * @returns {{ok:boolean, freeBytes:number, needBytes:number, reason?:string}}
 */
function check(needBytes = 0, opts = {}) {
  const { label = 'งาน', minFree = MIN_FREE_BYTES, targetPath = ROOT } = opts;
  const info = getDiskInfo(targetPath);

  // อ่านไม่ได้ → ไม่บล็อก (fail-open) แต่ log ไว้
  if (!info.available) return { ok: true, unknown: true, freeBytes: 0, needBytes };

  const required = needBytes + minFree;
  if (info.freeBytes < required) {
    logger.warn(`[DiskGuard] ปฏิเสธ ${label} — พื้นที่ไม่พอ`, {
      free: info.freeFormatted, need: fmt(required),
    });
    return {
      ok: false,
      freeBytes: info.freeBytes,
      needBytes: required,
      percentUsed: info.percentUsed,
      reason: `เหลือ ${info.freeFormatted} ต้องการ ${fmt(required)}`,
    };
  }

  return { ok: true, freeBytes: info.freeBytes, needBytes: required, percentUsed: info.percentUsed };
}

/**
 * เช็คแล้ว throw ถ้าไม่พอ — ใช้ใน service
 */
function assertSpace(needBytes = 0, opts = {}) {
  const r = check(needBytes, opts);
  if (!r.ok) throw new DiskFullError(r.freeBytes, r.needBytes);
  return r;
}

/**
 * เช็คสำหรับ transform — คิดเผื่อ output ใหญ่กว่า input
 */
function assertSpaceForTransform(inputPath, opts = {}) {
  let inputSize = 0;
  try { inputSize = fs.statSync(inputPath).size; } catch (_) {}
  return assertSpace(Math.round(inputSize * TRANSFORM_MULTIPLIER), { label: 'transform', ...opts });
}

/**
 * Express middleware — บล็อก request ถ้าดิสก์ใกล้เต็ม
 */
function requireDiskSpace(needBytes = 0, label = 'คำสั่งนี้') {
  return (req, res, next) => {
    const r = check(needBytes, { label });
    if (r.ok) return next();
    res.status(507).json({
      error: `พื้นที่ดิสก์ไม่พอสำหรับ${label}`,
      code: 'DISK_FULL',
      detail: r.reason,
      hint: 'เรียก POST /api/health/cleanup เพื่อล้างไฟล์ชั่วคราว',
    });
  };
}

module.exports = {
  getDiskInfo, check, assertSpace, assertSpaceForTransform, requireDiskSpace,
  DiskFullError, MIN_FREE_BYTES, TRANSFORM_MULTIPLIER, fmt,
};
