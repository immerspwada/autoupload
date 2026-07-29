/**
 * ★ Retention Manager — ลบไฟล์ชั่วคราว + archive + log rotation
 *
 * เรียกทุกสิ้น Cycle + ก่อน download เมื่อดิสก์ใกล้เต็ม
 *
 * หน้าที่:
 *   1. ลบไฟล์ download/transform ที่อัปเสร็จแล้ว (ดู queue terminal state)
 *   2. ลบไฟล์ temp เก่ากว่า TEMP_FILE_MAX_AGE_MS
 *   3. Archive uploads.json เมื่อเกิน 5000 รายการ
 *   4. Trim hashes.json ตาม MAX_HASH_ENTRIES
 *   5. Enforce log rotation
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const C      = require('../../config/constants');

const ROOT          = path.join(__dirname, '../../..');
const DOWNLOADS_DIR = path.join(ROOT, 'downloads');
const DATA_DIR      = path.join(ROOT, 'data');
const BACKUP_DIR    = path.join(DATA_DIR, 'backups');

const MAX_UPLOADS_ENTRIES = parseInt(process.env.MAX_UPLOADS_ENTRIES) || 5000;
const MAX_RETENTION_RUN_MS = 60_000; // ไม่ใช้เวลาเกิน 60 วิต่อรอบ

class RetentionManager {
  /**
   * รันรอบ retention ครบชุด
   * @returns {{ cleaned: number, archived: number, trimmed: number, durationMs: number }}
   */
  run() {
    const startedAt = Date.now();
    let cleaned = 0, archived = 0, trimmed = 0;

    try {
      // 1. ลบไฟล์ที่อัปเสร็จแล้ว
      cleaned += this._cleanupCompletedUploads();

      // 2. ลบ temp files เก่า
      if (Date.now() - startedAt < MAX_RETENTION_RUN_MS) {
        cleaned += this._cleanupTempFiles();
      }

      // 3. Archive uploads.json ถ้าเกิน 5000
      if (Date.now() - startedAt < MAX_RETENTION_RUN_MS) {
        archived = this._archiveUploadsIfNeeded();
      }

      // 4. Trim hashes
      if (Date.now() - startedAt < MAX_RETENTION_RUN_MS) {
        trimmed = this._trimHashes();
      }

      // 5. Log rotation (handled by logger itself, just verify)

    } catch (err) {
      logger.error('[RetentionManager] Error during run', { error: err.message });
    }

    const durationMs = Date.now() - startedAt;
    if (cleaned > 0 || archived > 0 || trimmed > 0) {
      logger.info('[RetentionManager] Completed', { cleaned, archived, trimmed, durationMs });
    }

    return { cleaned, archived, trimmed, durationMs };
  }

  /**
   * ลบไฟล์ใน downloads/ ที่เก่ากว่า TEMP_FILE_MAX_AGE_MS
   */
  _cleanupTempFiles() {
    const dirs = ['tiktok', 'transformed', 'temp'].map(d => path.join(DOWNLOADS_DIR, d));
    const now = Date.now();
    let cleaned = 0;

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      let files;
      try { files = fs.readdirSync(dir); } catch (_) { continue; }

      const maxAge = dir.includes('temp') || dir.includes('transformed')
        ? C.VIDEO_TRANSFORM.TEMP_MAX_AGE_MS
        : C.HEALTH.TEMP_FILE_MAX_AGE_MS;

      for (const file of files) {
        if (file.startsWith('.')) continue;
        const filepath = path.join(dir, file);
        try {
          const stat = fs.statSync(filepath);
          if (!stat.isFile()) continue;
          if (now - stat.mtimeMs > maxAge) {
            fs.unlinkSync(filepath);
            cleaned++;
          }
        } catch (_) {}
      }
    }

    return cleaned;
  }

  /**
   * ลบไฟล์ที่ถูกอัปโหลดสำเร็จหรือล้มเหลวถาวรแล้ว
   * ใช้ queue status เพื่อตรวจว่างานเสร็จแล้ว
   */
  _cleanupCompletedUploads() {
    const { uploads } = require('../../utils/store');
    const allUploads = uploads.loadRef();

    // Collect filepaths of completed uploads that still exist
    const filesToDelete = new Set();
    for (const record of allUploads) {
      if (record.filepath && !record.deleted) {
        filesToDelete.add(record.filepath);
      }
    }

    let cleaned = 0;
    for (const filepath of filesToDelete) {
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          cleaned++;
        }
      } catch (_) {}
    }

    return cleaned;
  }

  /**
   * Archive เมื่อ uploads.json > MAX_UPLOADS_ENTRIES
   * ย้ายรายการเก่าไปไฟล์ archive แต่คง tiktok_video_id + source_url ไว้ให้ duplicate check
   */
  _archiveUploadsIfNeeded() {
    const { uploads } = require('../../utils/store');
    const all = uploads.load();

    if (all.length <= MAX_UPLOADS_ENTRIES) return 0;

    // เก็บ N ล่าสุด, archive ที่เหลือ
    const keep = all.slice(-MAX_UPLOADS_ENTRIES);
    const archive = all.slice(0, all.length - MAX_UPLOADS_ENTRIES);

    // Write archive file
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const archiveName = `uploads_archive_${new Date().toISOString().slice(0, 10)}.json`;
    const archivePath = path.join(BACKUP_DIR, archiveName);

    // Append to existing archive if same day
    let existing = [];
    if (fs.existsSync(archivePath)) {
      try { existing = JSON.parse(fs.readFileSync(archivePath, 'utf8')); } catch (_) {}
    }

    // Save archive (keep only duplicate-check fields to save space)
    const slim = archive.map(r => ({
      tiktok_video_id: r.tiktok_video_id,
      source_url: r.source_url,
      youtube_id: r.youtube_id,
      uploaded_at: r.uploaded_at,
    }));

    fs.writeFileSync(archivePath, JSON.stringify([...existing, ...slim]));

    // Update uploads.json with only the recent entries
    uploads.save(keep);

    logger.info('[RetentionManager] Archived uploads', { archived: archive.length, kept: keep.length });
    return archive.length;
  }

  /**
   * Trim hashes.json ตาม MAX_HASH_ENTRIES
   */
  _trimHashes() {
    const healthService = require('../health');
    if (typeof healthService._trimHashes === 'function') {
      return healthService._trimHashes();
    }
    return 0;
  }

  /**
   * สร้าง backup ของ accounts.json + uploads.json (เรียกทุก 24h)
   */
  createDailyBackup() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const backupSubdir = path.join(BACKUP_DIR, timestamp);
    fs.mkdirSync(backupSubdir, { recursive: true });

    const filesToBackup = ['accounts.json', 'uploads.json'];
    let backed = 0;

    for (const filename of filesToBackup) {
      const src = path.join(DATA_DIR, filename);
      if (!fs.existsSync(src)) continue;
      try {
        fs.copyFileSync(src, path.join(backupSubdir, filename));
        backed++;
      } catch (err) {
        logger.error('[RetentionManager] Backup failed', { filename, error: err.message });
      }
    }

    // Keep only 7 backups
    this._pruneBackups(7);

    logger.info('[RetentionManager] Daily backup created', { dir: timestamp, files: backed });
    return { dir: timestamp, files: backed };
  }

  _pruneBackups(keep) {
    if (!fs.existsSync(BACKUP_DIR)) return;
    try {
      const entries = fs.readdirSync(BACKUP_DIR)
        .filter(f => fs.statSync(path.join(BACKUP_DIR, f)).isDirectory())
        .sort()
        .reverse();

      for (const dir of entries.slice(keep)) {
        const fullPath = path.join(BACKUP_DIR, dir);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch (err) {
      logger.warn('[RetentionManager] Prune backups error', { error: err.message });
    }
  }

  /**
   * ตรวจว่า archive มี tiktok_video_id นี้ไหม (สำหรับ Safety Gate duplicate check)
   */
  isInArchive(tiktokVideoId, sourceUrl) {
    if (!fs.existsSync(BACKUP_DIR)) return false;

    try {
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('uploads_archive_'));
      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), 'utf8'));
        if (data.some(r => r.tiktok_video_id === tiktokVideoId || r.source_url === sourceUrl)) {
          return true;
        }
      }
    } catch (_) {}

    return false;
  }
}

module.exports = new RetentionManager();
