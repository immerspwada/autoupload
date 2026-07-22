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

ffmpeg.setFfmpegPath(ffmpegPath);

// ─── Directories ────────────────────────────────────────────────────
const ASSETS_DIR = path.join(__dirname, '../../assets');
const TRANSFORM_DIR = path.join(__dirname, '../../downloads/transformed');
const TEMP_DIR = path.join(__dirname, '../../downloads/temp');

[ASSETS_DIR, TRANSFORM_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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
    this._stats = { processed: 0, failed: 0, totalTimeMs: 0 };
  }

  // ════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Transform a single video with configured options.
   * Returns path to transformed video file.
   */
  async transformSingle(inputPath, options = {}) {
    const config = this._getConfig(options);
    if (!config.enabled) {
      logger.info('[VideoTransform] Transform disabled, returning original');
      return { filepath: inputPath, transformed: false };
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
    const config = this._getConfig(options);
    const compilationConfig = { ...DEFAULT_CONFIG.compilation, ...config.compilation };
    
    if (inputPaths.length < 2) {
      throw new Error('Compilation ต้องมีอย่างน้อย 2 คลิป');
    }

    const startTime = Date.now();
    const outputFilename = `compilation_${Date.now()}.mp4`;
    const outputPath = path.join(TRANSFORM_DIR, outputFilename);

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
        await this._normalizeClip(validPaths[i], normPath, config);
        normalizedPaths.push(normPath);
      }

      // Step 2: Concatenate with transitions
      await this._concatenateWithTransitions(normalizedPaths, outputPath, compilationConfig, config);

      // Step 3: Cleanup temp files
      normalizedPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });

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
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      throw error;
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
    const userConfig = settings.load();
    const transformConfig = userConfig.videoTransform || {};
    return this._deepMerge(DEFAULT_CONFIG, transformConfig, overrides);
  }

  /**
   * Probe video for duration, resolution, fps, etc.
   */
  _probeVideo(filepath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filepath, (err, metadata) => {
        if (err) return reject(err);
        const video = metadata.streams.find(s => s.codec_type === 'video');
        const audio = metadata.streams.find(s => s.codec_type === 'audio');
        resolve({
          duration: parseFloat(metadata.format.duration) || 0,
          width: video ? video.width : 0,
          height: video ? video.height : 0,
          fps: video ? eval(video.r_frame_rate) : 30,
          hasAudio: !!audio,
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
        .on('start', (cmd) => {
          logger.debug('[VideoTransform] ffmpeg command', { cmd: cmd.substring(0, 200) });
        })
        .on('progress', (progress) => {
          this.emit('transform:progress', { percent: progress.percent || 0 });
        })
        .on('end', resolve)
        .on('error', reject)
        .run();
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
    return new Promise((resolve, reject) => {
      const resolution = RESOLUTIONS[config.output.resolution] || RESOLUTIONS['1080p'];
      
      ffmpeg(inputPath)
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
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  /**
   * Concatenate normalized clips with crossfade transitions
   */
  _concatenateWithTransitions(inputPaths, outputPath, compilationConfig, config) {
    return new Promise((resolve, reject) => {
      // For simplicity + reliability, use concat demuxer (no transitions)
      // which is much faster and more stable than complex filter chains
      const listFile = path.join(TEMP_DIR, `concat_${Date.now()}.txt`);
      const entries = inputPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`);
      fs.writeFileSync(listFile, entries.join('\n'));

      ffmpeg()
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
        .on('end', () => {
          try { fs.unlinkSync(listFile); } catch {}
          resolve();
        })
        .on('error', (err) => {
          try { fs.unlinkSync(listFile); } catch {}
          reject(err);
        })
        .run();
    });
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

module.exports = new VideoTransformService();
