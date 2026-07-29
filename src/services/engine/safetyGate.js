/**
 * ★ Safety Gate — ด่านตรวจก่อนอัปโหลดทุกคลิปในโหมดไม่มีคนคุม
 *
 * ตรวจ 3 อย่าง:
 *   1. Monetization validation (block / warning / ok)
 *   2. Duplicate check (source_url + tiktok_video_id)
 *   3. Virality score threshold
 *
 * กฎพิเศษ:
 *   - ห้ามใช้ force flag ในเส้นทาง autonomous
 *   - Transform mandatory: ถ้า transform ไม่ผ่าน ห้ามอัป
 *   - Circuit breaker: ≥40% blocked จาก ≥10 คลิป → หยุดรอบ
 */
'use strict';

const logger = require('../../utils/logger');

// Skip reasons enum (closed set ตาม Requirement 6.7)
const SKIP_REASONS = Object.freeze([
  'duplicate', 'blocked', 'warning', 'low_score',
  'validation_error', 'transform_failed', 'disk_full', 'quota_exhausted',
]);

class SafetyGate {
  constructor() {
    this._cycleStats = { evaluated: 0, blocked: 0 };
  }

  /**
   * เริ่มรอบใหม่ — reset counters
   */
  resetCycleStats() {
    this._cycleStats = { evaluated: 0, blocked: 0 };
  }

  /**
   * ตรวจคลิป 1 ตัว
   * @param {object} video ข้อมูลคลิปจาก TikTok search
   * @param {object} options { minScore, autonomousAllowWarned, uploadsJson }
   * @returns {{ pass: boolean, reason?: string, score?: number, validation?: object }}
   */
  check(video, options = {}) {
    const {
      minScore = 35,
      autonomousAllowWarned = true,
    } = options;

    const seoService = require('../seo');

    // 1. Monetization validation
    let validation;
    try {
      validation = seoService.validateForMonetization(video, video.desc || '');
    } catch (err) {
      logger.error('[SafetyGate] validateForMonetization threw error', { error: err.message });
      this._cycleStats.evaluated++;
      return { pass: false, reason: 'validation_error' };
    }

    // ★ Unrecognized status = fail-closed
    if (!validation || !['ok', 'warning', 'blocked'].includes(validation.status)) {
      logger.warn('[SafetyGate] Unrecognized validation status', { status: validation?.status });
      this._cycleStats.evaluated++;
      return { pass: false, reason: 'validation_error' };
    }

    this._cycleStats.evaluated++;

    if (validation.status === 'blocked') {
      this._cycleStats.blocked++;
      return { pass: false, reason: 'blocked', validation };
    }

    if (validation.status === 'warning' && !autonomousAllowWarned) {
      return { pass: false, reason: 'warning', validation };
    }

    // 2. Duplicate check
    const dup = this._checkDuplicate(video);
    if (dup.duplicate) {
      return { pass: false, reason: 'duplicate', existingUrl: dup.youtubeUrl };
    }

    // 3. Virality score threshold
    let score = 0;
    try {
      const result = seoService.calculateViralityScore(video);
      score = result?.score ?? 0;
    } catch (_) {
      score = 0;
    }

    if (score < minScore) {
      return { pass: false, reason: 'low_score', score, threshold: minScore };
    }

    return { pass: true, score, validation };
  }

  /**
   * ตรวจ circuit breaker: ≥40% blocked จาก ≥10 คลิป
   * @returns {boolean} true ถ้าควรหยุดรอบ
   */
  shouldPauseCycle() {
    const { evaluated, blocked } = this._cycleStats;
    if (evaluated < 10) return false;
    return (blocked / evaluated) >= 0.40;
  }

  /**
   * Get skip statistics for Engine_Status
   */
  getCycleStats() {
    return { ...this._cycleStats };
  }

  // ── Private ───────────────────────────────────────────────────

  _checkDuplicate(video) {
    try {
      const { uploads } = require('../../utils/store');
      const allUploads = uploads.loadRef();

      const videoUrl = video.videoUrl;
      const videoId  = video.id;

      for (const record of allUploads) {
        if (record.source_url && record.source_url === videoUrl) {
          return { duplicate: true, youtubeUrl: record.youtube_url };
        }
        if (record.tiktok_video_id && record.tiktok_video_id === videoId) {
          return { duplicate: true, youtubeUrl: record.youtube_url };
        }
      }

      return { duplicate: false };
    } catch (_) {
      return { duplicate: false };
    }
  }
}

module.exports = new SafetyGate();
module.exports.SKIP_REASONS = SKIP_REASONS;
