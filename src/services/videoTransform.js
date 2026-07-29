// ═══════════════════════════════════════════════════════════════════
// Video Transform Service — แปลง TikTok → YouTube Original Content
//
// ★ วัตถุประสงค์หลัก: หลีกเลี่ยง "Reused Content" flag จาก YouTube
// โดยการ add value ให้กับวิดีโอก่อนอัปโหลด:
//   1. Intro/Outro — แบรนด์ช่องของเรา (ทำให้ดูเป็นงานของเรา)
//   2. Text Overlay — ชื่อเรื่อง, commentary, watermark
//   3. Compilation — รวมหลายคลิปเป็น 1 วิดีโอยาว (เพิ่ม watch time)
//   4. Audio Mixing — เพิ่ม background music, lower original audio
//   5. Visual Transform — zoom, speed change, color filter (anti-fingerprint)
//
// ★ ทำไมต้องมี:
// - YouTube ตรวจจับ reused content ด้วย Content ID + visual fingerprint
// - คลิปที่ copy ตรงจาก TikTok → ถูก demonetize 100%
// - การเพิ่ม intro/outro/overlay ทำให้เป็น "transformative content"
// - Compilation ยาว 8-15 นาที = watch time สูง = revenue สูง
// ═══════════════════════════════════════════════════════════════════

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const { settings } = require('../utils/store');
const C = require('../config/constants');
const diskGuard = require('../utils/diskGuard');
const { Semaphore } = require('../utils/resilience');

ffmpeg.setFfmpegPath(ffmpegPath);

// ─── Directories ────────────────────────────────────────────────────
const ASSETS_DIR = path.join(__dirname, '../../assets');
const TRANSFORM_DIR = path.join(__dirname, '../../downloads/transformed');
const TEMP_DIR = path.join(__dirname, '../../downloads/temp');

[ASSETS_DIR, TRANSFORM_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/**
 * ★ แปลง frame rate ของ ffprobe ("30000/1001") เป็นตัวเลข — แทน eval()
 * รับค่าแปลกๆ ได้ทุกแบบโดยไม่ crash และไม่รันโค้ด
 */
function parseFrameRate(raw, fallback = 30) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw !== 'string') return fallback;

  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/);
  if (!m) return fallback;

  const num = parseFloat(m[1]);
  const den = m[2] !== undefined ? parseFloat(m[2]) : 1;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return fallback;

  const fps = num / den;
  // ค่าที่สมเหตุสมผลเท่านั้น (ffprobe คืน 0/0 ได้เมื่ออ่านไม่ออก)
  return fps > 0 && fps <= 480 ? Math.round(fps * 1000) / 1000 : fallback;
}

/** ★ clamp ค่า config ตัวเลข — กัน settings ที่ผิดทำให้ ffmpeg filter พัง (เช่น speed=0) */
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ─── Default Config ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  // Transform modes
  enabled: true,
  mode: 'standard',  // 'minimal' | 'standard' | 'compilation' | 'custom'
  
  // Intro/Outro
  intro: {
    enabled: true,
    duration: 3,        // seconds — short branded intro
    style: 'fade',      // 'fade' | 'slide' | 'zoom'
    text: '',           // channel name (auto from settings)
    backgroundColor: '#000000',
    textColor: '#ffffff',
    fontSize: 48,
  },
  outro: {
    enabled: true,
    duration: 4,        // seconds — CTA outro
    style: 'fade',
    text: 'Subscribe & Like 👆',
    backgroundColor: '#1a1a2e',
    textColor: '#ffffff',
    fontSize: 36,
  },
  
  // Text Overlay
  overlay: {
    enabled: true,
    position: 'top',    // 'top' | 'bottom' | 'center'
    style: 'subtitle',  // 'subtitle' | 'title_card' | 'watermark'
    fontFamily: 'Arial',
    fontSize: 24,
    textColor: '#ffffff',
    bgColor: '#00000080', // semi-transparent
    showDuration: 5,    // seconds to show title overlay (0 = whole video)
  },
  
  // Watermark
  watermark: {
    enabled: true,
    text: '',           // channel name (auto)
    position: 'bottom-right',
    opacity: 0.4,
    fontSize: 16,
  },
  
  // Audio
  audio: {
    backgroundMusic: null,    // path to bg music file
    bgMusicVolume: 0.15,      // 0.0 - 1.0
    originalVolume: 0.85,     // slightly lower original
    fadeInDuration: 1,        // seconds
    fadeOutDuration: 2,       // seconds
  },
  
  // Visual transforms (anti-fingerprint)
  visual: {
    enabled: true,
    zoom: 1.02,           // slight zoom to crop TikTok edges
    brightness: 0.02,     // slight brightness bump
    contrast: 1.02,       // slight contrast
    saturation: 1.05,     // slightly more vivid
    speed: 1.0,           // 1.0 = normal
    mirror: false,        // horizontal flip (strong anti-fingerprint)
  },
  
  // Compilation settings
  compilation: {
    maxClips: 10,
    transitionDuration: 0.5,  // seconds between clips
    transitionStyle: 'fade',  // 'fade' | 'dissolve' | 'wipe'
    targetDuration: 480,      // 8 minutes target = good watch time
    titleCardDuration: 2,     // per-clip title card
  },
  
  // Output
  output: {
    resolution: '1080p',   // '720p' | '1080p' | '4k'
    fps: 30,
    videoBitrate: '4000k',
    audioBitrate: '192k',
    format: 'mp4',
  },
};

// Resolution presets
const RESOLUTIONS = {
  '720p':  { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k':    { width: 3840, height: 2160 },
};

class VideoTransformService extends EventEmitter {
  constructor() {
    super();
    this._processing = false;
    this._queue = [];
    this._stats = { processed: 0, failed: 0, totalTimeMs: 0, timeouts: 0, killed: 0 };

    // ★ จำกัดงาน ffmpeg พร้อมกัน — เดิมไม่จำกัด รันหลายตัวพร้อมกันทำให้เครื่องค้าง
    this._sem = new Semaphore(C.VIDEO_TRANSFORM.MAX_CONCURRENT, 'ffmpeg');

    // ★ ทะเบียน ffmpeg process ที่กำลังวิ่ง — ใช้ kill ตอน timeout / shutdown
    //   เดิมไม่มี → ffmpeg ค้างเป็น zombie กิน CPU ต่อไปเรื่อยๆ
    this._running = new Map(); // id → { command, startedAt, label }
    this._runId = 0;
  }

  // ── Process registry ──────────────────────────────────────────────

  _track(command, label) {
    const id = ++this._runId;
    this._running.set(id, { command, startedAt: Date.now(), label });
    return id;
  }

  _untrack(id) { this._running.delete(id); }

  _kill(id, reason = 'timeout') {
    const entry = this._running.get(id);
    if (!entry) return false;
    try {
      entry.command.kill('SIGKILL');
      this._stats.killed++;
      logger.warn('[VideoTransform] ยุติ ffmpeg', { label: entry.label, reason,
        ranMs: Date.now() - entry.startedAt });
    } catch (err) {
      logger.error('[VideoTransform] kill ffmpeg ไม่สำเร็จ', { error: err.message });
    }
    this._running.delete(id);
    return true;
  }

  /** ★ ฆ่างาน ffmpeg ทั้งหมด — เรียกตอน graceful shutdown */
  killAll(reason = 'shutdown') {
    const ids = Array.from(this._running.keys());
    for (const id of ids) this._kill(id, reason);
    return { killed: ids.length };
  }

  getRunning() {
    return Array.from(this._running.entries()).map(([id, e]) => ({
      id, label: e.label, runningMs: Date.now() - e.startedAt,
    }));
  }

  /**
   * ★ ห่อ ffmpeg command ด้วย timeout ที่ kill process จริง
   * เดิม ffmpeg ไม่มี timeout เลย — งานค้าง = request ค้าง = queue slot ค้างตลอดไป
   */
  _runFfmpeg(command, { label, timeoutMs, onEnd }) {
    return new Promise((resolve, reject) => {
      const id = this._track(command, label);
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._stats.timeouts++;
        this._kill(id, 'timeout');
        reject(new Error(`ffmpeg ใช้เวลาเกิน ${Math.round(timeoutMs / 1000)}s (${label}) — ยกเลิก`));
      }, timeoutMs);
      if (timer.unref) timer.unref();

      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._untrack(id);
        if (err) reject(err); else resolve(result);
      };

      command
        .on('start', (cmd) => {
          logger.debug('[VideoTransform] ffmpeg start', { label, cmd: String(cmd).substring(0, 220) });
        })
        .on('stderr', (line) => {
          // เก็บ stderr บรรทัดล่าสุดไว้ประกอบ error message (ffmpeg error จริงอยู่ที่นี่)
          this._lastStderr = String(line).slice(0, 300);
        })
        .on('end', () => { if (onEnd) { try { onEnd(); } catch (_) {} } finish(null, true); })
        .on('error', (err) => {
          const detail = this._lastStderr ? ` — ${this._lastStderr}` : '';
          finish(new Error(`${err.message}${detail}`));
        })
        .run();
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Transform a single video with configured options.
   * Returns path to transformed video file.
   *
   * ★ ทุกงานผ่าน semaphore (ffmpeg กิน CPU หนัก — รันพร้อมกันหลายตัวทำให้ทั้งเครื่องช้า)
   * ★ เช็คขนาด input + พื้นที่ดิสก์ก่อนเริ่ม
   */
  async transformSingle(inputPath, options = {}) {
    return this._sem.run(() => this._transformSingleGuarded(inputPath, options));
  }

  async _transformSingleGuarded(inputPath, options = {}) {
    const config = this._getConfig(options);
    if (!config.enabled) {
      logger.info('[VideoTransform] Transform disabled, returning original');
      return { filepath: inputPath, transformed: false };
    }

    // ★ Guard 1: ไฟล์ใหญ่เกินไป → ข้าม transform ดีกว่ากิน CPU เป็นชั่วโมง
    try {
      const inStat = fs.statSync(inputPath);
      if (inStat.size > C.VIDEO_TRANSFORM.MAX_INPUT_SIZE_BYTES) {
        logger.warn('[VideoTransform] ไฟล์ใหญ่เกินกำหนด — ข้าม transform', {
          input: path.basename(inputPath),
          sizeMB: Math.round(inStat.size / 1048576),
          limitMB: Math.round(C.VIDEO_TRANSFORM.MAX_INPUT_SIZE_BYTES / 1048576),
        });
        return { filepath: inputPath, transformed: false, skipped: 'file_too_large' };
      }
    } catch (err) {
      return { filepath: inputPath, transformed: false, error: `อ่านไฟล์ไม่ได้: ${err.message}` };
    }

    // ★ Guard 2: พื้นที่ดิสก์ — transform เขียน output ใหญ่กว่า input ได้ถึง 2.5 เท่า
    try {
      diskGuard.assertSpaceForTransform(inputPath);
    } catch (err) {
      logger.error('[VideoTransform] พื้นที่ไม่พอ — ข้าม transform', { error: err.message });
      return { filepath: inputPath, transformed: false, error: err.message };
    }

    const startTime = Date.now();
    const outputFilename = `transformed_${Date.now()}_${path.basename(inputPath)}`;
    const outputPath = path.join(TRANSFORM_DIR, outputFilename);

    try {
      logger.info('[VideoTransform] Starting transform', { input: path.basename(inputPath), mode: config.mode });
      this.emit('transform:start', { input: inputPath, mode: config.mode });

      // Get input video info
      const probe = await this._probeVideo(inputPath);
      
      // Build the ffmpeg filter chain based on config
      await this._executeTransform(inputPath, outputPath, config, probe);

      const duration = Date.now() - startTime;
      this._stats.processed++;
      this._stats.totalTimeMs += duration;

      const outputStats = fs.statSync(outputPath);
      
      logger.info('[VideoTransform] Transform complete', {
        input: path.basename(inputPath),
        output: outputFilename,
        duration: `${(duration / 1000).toFixed(1)}s`,
        inputSize: `${(fs.statSync(inputPath).size / 1024 / 1024).toFixed(1)}MB`,
        outputSize: `${(outputStats.size / 1024 / 1024).toFixed(1)}MB`,
      });

      this.emit('transform:complete', { 
        input: inputPath, output: outputPath, 
        duration, mode: config.mode 
      });

      return { 
        filepath: outputPath, 
        transformed: true, 
        outputSize: outputStats.size,
        processingTime: duration,
        mode: config.mode 
      };
    } catch (error) {
      this._stats.failed++;
      logger.error('[VideoTransform] Transform failed', { error: error.message, input: inputPath });
      this.emit('transform:failed', { input: inputPath, error: error.message });
      
      // Cleanup failed output
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      
      // Fallback: return original file (upload still works, just without transform)
      return { filepath: inputPath, transformed: false, error: error.message };
    }
  }

  /**
   * Create a compilation from multiple clips.
   * Merges N videos into one long-form video with transitions.
   */
  async createCompilation(inputPaths, options = {}) {
    return this._sem.run(() => this._createCompilationGuarded(inputPaths, options));
  }

  async _createCompilationGuarded(inputPaths, options = {}) {
    const config = this._getConfig(options);
    const compilationConfig = { ...DEFAULT_CONFIG.compilation, ...config.compilation };

    if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
      throw new Error('Compilation ต้องมีอย่างน้อย 2 คลิป');
    }

    // ★ พื้นที่ดิสก์: compilation เขียน normalized clip ทุกไฟล์ + output อีกก้อน
    const totalInput = inputPaths.reduce((sum, p) => {
      try { return sum + fs.statSync(p).size; } catch (_) { return sum; }
    }, 0);
    diskGuard.assertSpace(Math.round(totalInput * 3), { label: 'compilation' });

    const startTime = Date.now();
    const outputFilename = `compilation_${Date.now()}.mp4`;
    const outputPath = path.join(TRANSFORM_DIR, outputFilename);
    // ★ ติดตาม temp file ทุกไฟล์ — เดิมลบเฉพาะตอนสำเร็จ ทำให้ล้มเหลว = ขยะค้างดิสก์
    const tempFiles = [];

    try {
      logger.info('[VideoTransform] Creating compilation', { 
        clips: inputPaths.length, 
        targetDuration: compilationConfig.targetDuration 
      });
      this.emit('compilation:start', { clips: inputPaths.length });

      // Probe all clips
      const probes = await Promise.all(inputPaths.map(p => this._probeVideo(p).catch(() => null)));
      const validPaths = inputPaths.filter((_, i) => probes[i] !== null);
      const validProbes = probes.filter(p => p !== null);

      if (validPaths.length < 2) {
        throw new Error('ไม่มีวิดีโอที่ใช้ได้พอ (ต้องอย่างน้อย 2 คลิป)');
      }

      // Step 1: Normalize all clips (same resolution, fps, audio)
      const normalizedPaths = [];
      for (let i = 0; i < validPaths.length; i++) {
        const normPath = path.join(TEMP_DIR, `norm_${i}_${Date.now()}.mp4`);
        tempFiles.push(normPath);   // ★ ลงทะเบียนก่อนสร้าง — ล้มกลางทางก็ยังลบได้
        await this._normalizeClip(validPaths[i], normPath, config);
        normalizedPaths.push(normPath);
        this.emit('compilation:progress', {
          phase: 'normalize',
          percent: Math.round(((i + 1) / validPaths.length) * 50),
        });
      }

      // Step 2: Concatenate with transitions
      await this._concatenateWithTransitions(normalizedPaths, outputPath, compilationConfig, config);

      const duration = Date.now() - startTime;
      const outputStats = fs.statSync(outputPath);
      const outputProbe = await this._probeVideo(outputPath);

      logger.info('[VideoTransform] Compilation complete', {
        clips: validPaths.length,
        outputDuration: `${outputProbe.duration.toFixed(0)}s`,
        outputSize: `${(outputStats.size / 1024 / 1024).toFixed(1)}MB`,
        processingTime: `${(duration / 1000).toFixed(1)}s`,
      });

      this.emit('compilation:complete', {
        clips: validPaths.length,
        output: outputPath,
        duration,
        videoDuration: outputProbe.duration,
      });

      return {
        filepath: outputPath,
        transformed: true,
        mode: 'compilation',
        clips: validPaths.length,
        videoDuration: outputProbe.duration,
        outputSize: outputStats.size,
        processingTime: duration,
      };
    } catch (error) {
      logger.error('[VideoTransform] Compilation failed', { error: error.message });
      this.emit('compilation:failed', { error: error.message });
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
      throw error;
    } finally {
      // ★ ลบ normalized clip ทุกกรณี (สำเร็จ/ล้มเหลว/timeout)
      let leaked = 0;
      for (const f of tempFiles) {
        try { if (fs.existsSync(f)) { fs.unlinkSync(f); leaked++; } } catch (_) {}
      }
      if (leaked > 0) logger.debug('[VideoTransform] ลบไฟล์ชั่วคราว', { count: leaked });
    }
  }

  /**
   * Get service stats
   */
  getStats() {
    return {
      ...this._stats,
      avgProcessingTime: this._stats.processed > 0 
        ? Math.round(this._stats.totalTimeMs / this._stats.processed) 
        : 0,
    };
  }

  /**
   * Get current config merged with user settings
   */
  getConfig() {
    return this._getConfig();
  }

  /**
   * Check if ffmpeg is available and working
   */
  async checkHealth() {
    return new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          resolve({ available: false, error: err.message });
        } else {
          resolve({ 
            available: true, 
            formats: Object.keys(formats).length,
            ffmpegPath: ffmpegPath 
          });
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // PRIVATE — Core Transform Logic
  // ════════════════════════════════════════════════════════════════════

  _getConfig(overrides = {}) {
    const userConfig = settings.loadRef();
    const transformConfig = userConfig.videoTransform || {};
    const merged = this._deepMerge(DEFAULT_CONFIG, transformConfig, overrides);
    return this._sanitizeConfig(merged);
  }

  /**
   * ★ Clamp ค่าตัวเลขให้อยู่ในช่วงที่ ffmpeg รับได้
   * เดิม settings.json ยอมรับค่าอะไรก็ได้ → speed=0 ทำให้ filter เป็น
   *   setpts=Infinity*PTS / atempo=0 → ffmpeg พังทุกครั้งแบบหาสาเหตุยาก
   */
  _sanitizeConfig(cfg) {
    const v = cfg.visual || {};
    cfg.visual = {
      ...v,
      // atempo รับ 0.5–100 ส่วน setpts ต้องไม่เป็น 0
      speed:      clampNum(v.speed,      0.5,  2.0, 1.0),
      zoom:       clampNum(v.zoom,       1.0,  2.0, 1.0),
      brightness: clampNum(v.brightness, -1,   1,   0),
      contrast:   clampNum(v.contrast,   0,    4,   1),
      saturation: clampNum(v.saturation, 0,    3,   1),
    };

    const a = cfg.audio || {};
    cfg.audio = {
      ...a,
      originalVolume:  clampNum(a.originalVolume,  0, 4,  1),
      fadeInDuration:  clampNum(a.fadeInDuration,  0, 10, 0),
      fadeOutDuration: clampNum(a.fadeOutDuration, 0, 10, 0),
    };

    const o = cfg.output || {};
    cfg.output = {
      ...o,
      fps: Math.round(clampNum(o.fps, 15, 60, 30)),
      resolution: RESOLUTIONS[o.resolution] ? o.resolution : '1080p',
    };

    if (cfg.intro)  cfg.intro.duration  = clampNum(cfg.intro.duration,  0, 15, 3);
    if (cfg.outro)  cfg.outro.duration  = clampNum(cfg.outro.duration,  0, 15, 3);

    return cfg;
  }

  /**
   * Probe video for duration, resolution, fps, etc.
   */
  _probeVideo(filepath) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`ffprobe ค้างเกิน ${C.VIDEO_TRANSFORM.PROBE_TIMEOUT_MS / 1000}s — ไฟล์อาจเสีย`));
      }, C.VIDEO_TRANSFORM.PROBE_TIMEOUT_MS);
      if (timer.unref) timer.unref();

      ffmpeg.ffprobe(filepath, (err, metadata) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (err) return reject(new Error(`อ่านข้อมูลวิดีโอไม่ได้: ${err.message}`));
        if (!metadata || !metadata.format) return reject(new Error('ไฟล์วิดีโอไม่มี metadata — อาจเสียหาย'));

        const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
        const video = streams.find(s => s.codec_type === 'video');
        const audio = streams.find(s => s.codec_type === 'audio');

        if (!video) return reject(new Error('ไฟล์นี้ไม่มี video stream'));

        resolve({
          duration: parseFloat(metadata.format.duration) || 0,
          width:  video.width  || 0,
          height: video.height || 0,
          // ★ เดิมใช้ eval() กับสตริงจาก ffprobe ของไฟล์ที่โหลดมาจากเน็ต — code injection
          fps: parseFrameRate(video.r_frame_rate ?? video.avg_frame_rate),
          hasAudio: !!audio,
          codec: video.codec_name || 'unknown',
          bitrate: parseInt(metadata.format.bit_rate) || 0,
          size: parseInt(metadata.format.size) || 0,
        });
      });
    });
  }

  /**
   * Execute the full transform pipeline
   */
  _executeTransform(inputPath, outputPath, config, probe) {
    return new Promise((resolve, reject) => {
      const resolution = RESOLUTIONS[config.output.resolution] || RESOLUTIONS['1080p'];
      
      // Build complex filter chain
      const filters = this._buildFilterChain(config, probe, resolution);
      
      let command = ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-preset fast',
          '-crf 20',
          `-b:v ${config.output.videoBitrate}`,
          `-r ${config.output.fps}`,
          '-c:a aac',
          `-b:a ${config.output.audioBitrate}`,
          '-movflags +faststart',
          '-y',
        ]);

      // Apply filter complex if we have filters
      if (filters.length > 0) {
        command = command.complexFilter(filters.join(';'), ['vout', 'aout'])
          .outputOptions(['-map [vout]', '-map [aout]']);
      } else {
        // Minimal transform: just re-encode with slight visual changes
        command = command
          .size(`${resolution.width}x${resolution.height}`)
          .autopad();
      }

      command
        .output(outputPath)
        .on('progress', (progress) => {
          this.emit('transform:progress', {
            percent: Math.min(100, Math.max(0, progress.percent || 0)),
            input: path.basename(inputPath),
          });
        });

      // ★ ห่อด้วย timeout ที่ kill ffmpeg จริง
      this._runFfmpeg(command, {
        label: `transform:${path.basename(inputPath)}`,
        timeoutMs: C.VIDEO_TRANSFORM.PROCESS_TIMEOUT_MS,
      }).then(resolve, reject);
    });
  }

  /**
   * Build ffmpeg filter chain based on config
   */
  _buildFilterChain(config, probe, resolution) {
    const filters = [];
    let videoLabel = '0:v';
    let audioLabel = '0:a';
    let filterIndex = 0;

    // ─── Visual Transforms (anti-fingerprint) ────────────────────
    if (config.visual.enabled) {
      const vf = [];
      
      // Zoom/crop (removes TikTok UI artifacts on edges)
      if (config.visual.zoom > 1.0) {
        const z = config.visual.zoom;
        vf.push(`scale=${Math.round(resolution.width * z)}:${Math.round(resolution.height * z)}`);
        vf.push(`crop=${resolution.width}:${resolution.height}`);
      } else {
        vf.push(`scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease`);
        vf.push(`pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:black`);
      }

      // Color adjustments
      const eq = [];
      if (config.visual.brightness !== 0) eq.push(`brightness=${config.visual.brightness}`);
      if (config.visual.contrast !== 1.0) eq.push(`contrast=${config.visual.contrast}`);
      if (config.visual.saturation !== 1.0) eq.push(`saturation=${config.visual.saturation}`);
      if (eq.length > 0) vf.push(`eq=${eq.join(':')}`);

      // Mirror (strong anti-fingerprint)
      if (config.visual.mirror) vf.push('hflip');

      // Speed change
      if (config.visual.speed !== 1.0) {
        vf.push(`setpts=${(1 / config.visual.speed).toFixed(4)}*PTS`);
      }

      const newLabel = `v${filterIndex++}`;
      filters.push(`[${videoLabel}]${vf.join(',')}[${newLabel}]`);
      videoLabel = newLabel;
    } else {
      // Still need to scale
      const newLabel = `v${filterIndex++}`;
      filters.push(`[${videoLabel}]scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:black[${newLabel}]`);
      videoLabel = newLabel;
    }

    // ─── Text Overlay (title) ────────────────────────────────────
    if (config.overlay.enabled && config.overlay.style !== 'watermark') {
      const overlayText = this._escapeFFmpegText(config.overlay.text || 'Video');
      const pos = config.overlay.position;
      const yPos = pos === 'top' ? '30' : pos === 'bottom' ? 'h-th-30' : '(h-th)/2';
      const showDur = config.overlay.showDuration;
      
      let drawtext = `drawtext=text='${overlayText}'` +
        `:fontsize=${config.overlay.fontSize}` +
        `:fontcolor=${config.overlay.textColor}` +
        `:box=1:boxcolor=${config.overlay.bgColor}:boxborderw=8` +
        `:x=(w-tw)/2:y=${yPos}`;
      
      if (showDur > 0) {
        drawtext += `:enable='between(t,0.5,${showDur})'`;
      }

      const newLabel = `v${filterIndex++}`;
      filters.push(`[${videoLabel}]${drawtext}[${newLabel}]`);
      videoLabel = newLabel;
    }

    // ─── Watermark (persistent small text) ───────────────────────
    if (config.watermark.enabled && config.watermark.text) {
      const wmText = this._escapeFFmpegText(config.watermark.text);
      const wp = config.watermark.position;
      let x = '10', y = '10';
      if (wp.includes('right')) x = 'w-tw-10';
      if (wp.includes('bottom')) y = 'h-th-10';

      const drawtext = `drawtext=text='${wmText}'` +
        `:fontsize=${config.watermark.fontSize}` +
        `:fontcolor=white@${config.watermark.opacity}` +
        `:x=${x}:y=${y}`;

      const newLabel = `v${filterIndex++}`;
      filters.push(`[${videoLabel}]${drawtext}[${newLabel}]`);
      videoLabel = newLabel;
    }

    // ─── Fade in/out ─────────────────────────────────────────────
    if (config.audio.fadeInDuration > 0 || config.audio.fadeOutDuration > 0) {
      const fadeFilters = [];
      const videoDuration = probe.duration || 30;
      
      // Video fade
      if (config.audio.fadeInDuration > 0) {
        fadeFilters.push(`fade=in:0:${Math.round(config.audio.fadeInDuration * config.output.fps)}`);
      }
      if (config.audio.fadeOutDuration > 0) {
        const fadeOutStart = Math.max(0, videoDuration - config.audio.fadeOutDuration);
        fadeFilters.push(`fade=out:st=${fadeOutStart}:d=${config.audio.fadeOutDuration}`);
      }

      if (fadeFilters.length > 0) {
        const newLabel = `v${filterIndex++}`;
        filters.push(`[${videoLabel}]${fadeFilters.join(',')}[${newLabel}]`);
        videoLabel = newLabel;
      }
    }

    // Final video output
    filters.push(`[${videoLabel}]null[vout]`);

    // ─── Audio processing ────────────────────────────────────────
    if (probe.hasAudio) {
      const audioFilters = [];
      
      // Volume adjustment
      if (config.audio.originalVolume !== 1.0) {
        audioFilters.push(`volume=${config.audio.originalVolume}`);
      }

      // Audio fade
      const videoDuration = probe.duration || 30;
      if (config.audio.fadeInDuration > 0) {
        audioFilters.push(`afade=in:0:${config.audio.fadeInDuration}`);
      }
      if (config.audio.fadeOutDuration > 0) {
        const fadeOutStart = Math.max(0, videoDuration - config.audio.fadeOutDuration);
        audioFilters.push(`afade=out:st=${fadeOutStart}:d=${config.audio.fadeOutDuration}`);
      }

      // Speed change for audio too
      if (config.visual.speed !== 1.0) {
        audioFilters.push(`atempo=${config.visual.speed}`);
      }

      if (audioFilters.length > 0) {
        filters.push(`[${audioLabel}]${audioFilters.join(',')}[aout]`);
      } else {
        filters.push(`[${audioLabel}]anull[aout]`);
      }
    } else {
      // Generate silent audio if no audio stream
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100[aout]`);
    }

    return filters;
  }

  /**
   * Normalize a clip to consistent format for compilation
   */
  _normalizeClip(inputPath, outputPath, config) {
    const resolution = RESOLUTIONS[config.output.resolution] || RESOLUTIONS['1080p'];

    const command = ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-crf 22',
        `-r ${config.output.fps}`,
        '-c:a aac',
        '-ar 44100',
        '-ac 2',
        `-b:a ${config.output.audioBitrate}`,
        '-y',
      ])
      .size(`${resolution.width}x${resolution.height}`)
      .autopad()
      .output(outputPath);

    return this._runFfmpeg(command, {
      label: `normalize:${path.basename(inputPath)}`,
      timeoutMs: C.VIDEO_TRANSFORM.PROCESS_TIMEOUT_MS,
    });
  }

  /**
   * Concatenate normalized clips with crossfade transitions
   */
  async _concatenateWithTransitions(inputPaths, outputPath, compilationConfig, config) {
    // For simplicity + reliability, use concat demuxer (no transitions)
    // which is much faster and more stable than complex filter chains
    const listFile = path.join(TEMP_DIR, `concat_${Date.now()}.txt`);
    const entries = inputPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`);
    fs.writeFileSync(listFile, entries.join('\n'));

    const command = ffmpeg()
      .input(listFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-crf 20',
        `-b:v ${config.output.videoBitrate}`,
        '-c:a aac',
        `-b:a ${config.output.audioBitrate}`,
        '-movflags +faststart',
        '-y',
      ])
      .output(outputPath)
      .on('progress', (p) => {
        this.emit('compilation:progress', { percent: Math.min(100, Math.max(0, p.percent || 0)) });
      });

    try {
      // ★ compilation ใช้เวลานานกว่า single — ใช้ timeout แยก
      await this._runFfmpeg(command, {
        label: `concat:${inputPaths.length}clips`,
        timeoutMs: C.VIDEO_TRANSFORM.COMPILE_TIMEOUT_MS,
      });
    } finally {
      // ★ ลบ list file ทุกกรณี รวม timeout (เดิม timeout ไม่ลบเพราะไม่มี handler)
      try { fs.unlinkSync(listFile); } catch (_) {}
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════

  _escapeFFmpegText(text) {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/%/g, '%%');
  }

  _deepMerge(...objects) {
    const result = {};
    for (const obj of objects) {
      if (!obj) continue;
      for (const key of Object.keys(obj)) {
        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          result[key] = this._deepMerge(result[key] || {}, obj[key]);
        } else {
          result[key] = obj[key];
        }
      }
    }
    return result;
  }
}

const service = new VideoTransformService();

// ★ expose helper สำหรับ test (ไม่ใช่ public API)
service._parseFrameRate = parseFrameRate;
service._clampNum = clampNum;

module.exports = service;
