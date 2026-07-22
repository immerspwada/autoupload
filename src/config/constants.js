/**
 * ★ Central Configuration & Constants
 * แหล่งรวม magic numbers และ config ทั้งระบบ
 * แก้ค่าที่นี่ที่เดียว — ทุกส่วนของระบบอ่านจากที่นี่
 */

module.exports = {
  // ── YouTube API ──────────────────────────────────────────────────
  YOUTUBE: {
    UPLOAD_COST:       parseInt(process.env.YT_UPLOAD_COST)   || 1600,
    DAILY_QUOTA_LIMIT: parseInt(process.env.YT_DAILY_LIMIT)   || 10000,
    MAX_UPLOAD_RETRIES: parseInt(process.env.YT_MAX_RETRIES)  || 3,
    // Retry delays: 2s → 4s (exponential)
    RETRY_BASE_DELAY_MS: parseInt(process.env.YT_RETRY_DELAY) || 2000,
    // Upload timeout per file (15 minutes)
    UPLOAD_TIMEOUT_MS: parseInt(process.env.YT_UPLOAD_TIMEOUT) || 15 * 60 * 1000,
    // PST offset in hours (UTC-8)
    PST_UTC_OFFSET_HOURS: -8,
    // Buffer minutes after quota reset before resuming
    QUOTA_RESET_BUFFER_MINUTES: 2,
  },

  // ── Queue ─────────────────────────────────────────────────────────
  QUEUE: {
    CONCURRENCY:       parseInt(process.env.QUEUE_CONCURRENCY)  || 1,
    MAX_RETRIES:       parseInt(process.env.QUEUE_MAX_RETRIES)  || 3,
    RETRY_DELAY_MS:    parseInt(process.env.QUEUE_RETRY_DELAY)  || 5000,
    DELAY_BETWEEN_MS:  parseInt(process.env.QUEUE_DELAY_BETWEEN) || 2000,
    TASK_TIMEOUT_MS:   parseInt(process.env.QUEUE_TASK_TIMEOUT)  || 15 * 60 * 1000,
    MAX_COMPLETED_ITEMS: parseInt(process.env.QUEUE_MAX_ITEMS)  || 50,
  },

  // ── Scheduler ─────────────────────────────────────────────────────
  SCHEDULER: {
    DEFAULT_INTERVAL_MINUTES: parseInt(process.env.SCHEDULER_INTERVAL) || 30,
    // Cooldown ถ้า watchlist ไม่มีคลิปใหม่ (5 นาที)
    LOOP_COOLDOWN_MS: parseInt(process.env.SCHEDULER_COOLDOWN_MS) || 5 * 60 * 1000,
    // Poll interval รอ queue ว่าง (10 วินาที)
    QUEUE_POLL_MS: parseInt(process.env.SCHEDULER_QUEUE_POLL_MS) || 10 * 1000,
    // Delay หลัง file watcher ตรวจพบไฟล์ใหม่
    WATCHER_DEBOUNCE_MS: parseInt(process.env.SCHEDULER_WATCHER_DEBOUNCE) || 3000,
  },

  // ── TikTok / tikwm ────────────────────────────────────────────────
  TIKTOK: {
    // Rate limit: 1 request/second (tikwm free tier)
    THROTTLE_MS: parseInt(process.env.TIKWM_THROTTLE_MS) || 1100,
    // Max pages per paginated search
    MAX_SEARCH_PAGES: parseInt(process.env.TIKWM_MAX_PAGES) || 6,
    // Delay ระหว่าง keyword batches
    BATCH_DELAY_MS: parseInt(process.env.TIKWM_BATCH_DELAY) || 500,
    // Download timeout per file (60 วินาที)
    DOWNLOAD_TIMEOUT_MS: parseInt(process.env.TIKWM_DL_TIMEOUT) || 60 * 1000,
    // Max concurrent keyword searches
    SEARCH_CONCURRENCY: parseInt(process.env.TIKWM_CONCURRENCY) || 3,
    // Delay between batch upload items
    BATCH_UPLOAD_DELAY_MS: parseInt(process.env.TIKWM_BATCH_UPLOAD_DELAY) || 3000,
  },

  // ── Health & Cleanup ──────────────────────────────────────────────
  HEALTH: {
    // Temp file max age before cleanup (24 ชั่วโมง)
    TEMP_FILE_MAX_AGE_MS: parseInt(process.env.HEALTH_TEMP_MAX_AGE) || 24 * 60 * 60 * 1000,
    // Auto-cleanup interval (6 ชั่วโมง)
    CLEANUP_INTERVAL_MS: parseInt(process.env.HEALTH_CLEANUP_INTERVAL) || 6 * 60 * 60 * 1000,
    // System status broadcast interval (30 วินาที)
    STATUS_BROADCAST_MS: parseInt(process.env.HEALTH_STATUS_INTERVAL) || 30 * 1000,
    // Hash file read: first 1MB only for speed
    HASH_READ_BYTES: parseInt(process.env.HEALTH_HASH_BYTES) || 1 * 1024 * 1024,
  },

  // ── Activity Log ──────────────────────────────────────────────────
  ACTIVITY: {
    MAX_ENTRIES: parseInt(process.env.ACTIVITY_MAX_ENTRIES) || 500,
  },

  // ── Logger ────────────────────────────────────────────────────────
  LOGGER: {
    MAX_FILE_SIZE_BYTES: parseInt(process.env.LOG_MAX_SIZE) || 5 * 1024 * 1024,
    MAX_FILES: parseInt(process.env.LOG_MAX_FILES) || 5,
    LEVEL: process.env.LOG_LEVEL || 'info',
  },

  // ── Watchlist ─────────────────────────────────────────────────────
  WATCHLIST: {
    MAX_ENTRIES: parseInt(process.env.WATCHLIST_MAX_ENTRIES) || 500,
    // DL error backoff window (10 นาที)
    DL_ERROR_WINDOW_MS: parseInt(process.env.WATCHLIST_DL_ERROR_WINDOW) || 10 * 60 * 1000,
    // Max DL errors before backoff
    DL_ERROR_MAX: parseInt(process.env.WATCHLIST_DL_ERROR_MAX) || 5,
    // Max backoff duration (5 นาที)
    DL_BACKOFF_MAX_MS: parseInt(process.env.WATCHLIST_DL_BACKOFF_MAX) || 5 * 60 * 1000,
    // Session seen IDs max size per keyword
    SEEN_IDS_MAX: parseInt(process.env.WATCHLIST_SEEN_MAX) || 500,
  },

  // ── QuotaRotator ──────────────────────────────────────────────────
  QUOTA_ROTATOR: {
    // Prefer active account ถ้า score ต่างไม่เกิน STICKINESS units
    ACTIVE_ACCOUNT_STICKINESS: parseInt(process.env.ROTATOR_STICKINESS) || 250,
    MAX_LOG_ENTRIES: parseInt(process.env.ROTATOR_MAX_LOG) || 100,
  },

  // ── SEO ───────────────────────────────────────────────────────────
  SEO: {
    TITLE_MAX_LENGTH: 100,
    TAGS_MAX_TOTAL_CHARS: 450,
    DESCRIPTION_MIN_LENGTH: 180,
    TAGS_IDEAL_MIN: 8,
    TAGS_IDEAL_MAX: 25,
    // Virality score minimum views before scoring
    MIN_VIEWS_FOR_SCORE: 50,
    // Engagement ratio ceilings for normalization
    LIKE_RATE_CEILING:    0.15,
    COMMENT_RATE_CEILING: 0.008,
    SHARE_RATE_CEILING:   0.03,
  },

  // ── Video Transform (anti-reused-content) ─────────────────────────
  VIDEO_TRANSFORM: {
    // Max processing time before timeout (3 minutes)
    PROCESS_TIMEOUT_MS: parseInt(process.env.VT_TIMEOUT) || 3 * 60 * 1000,
    // Max file size to transform (500MB)
    MAX_INPUT_SIZE_BYTES: parseInt(process.env.VT_MAX_SIZE) || 500 * 1024 * 1024,
    // Cleanup transformed files older than this (2 hours)
    TEMP_MAX_AGE_MS: parseInt(process.env.VT_TEMP_AGE) || 2 * 60 * 60 * 1000,
  },

  // ── API Routes ────────────────────────────────────────────────────
  API: {
    // Route timeouts
    TIKTOK_SEARCH_TIMEOUT_MS:  parseInt(process.env.API_SEARCH_TIMEOUT)  || 32000,
    TIKTOK_TRENDING_TIMEOUT_MS: parseInt(process.env.API_TRENDING_TIMEOUT) || 18000,
    TIKTOK_CREATOR_TIMEOUT_MS: parseInt(process.env.API_CREATOR_TIMEOUT) || 22000,
    TIKTOK_DL_UP_TIMEOUT_MS:   parseInt(process.env.API_DLUP_TIMEOUT)    || 115000,
    TIKTOK_DL_BROWSER_TIMEOUT_MS: parseInt(process.env.API_DLBROWSER_TIMEOUT) || 85000,
    // Max keywords per search request
    MAX_KEYWORDS_PER_SEARCH: parseInt(process.env.API_MAX_KEYWORDS) || 15,
  },
};
