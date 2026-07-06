// TikTok Service - Search & Download without watermark
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const logger = require('../utils/logger');

const DOWNLOAD_DIR = path.join(__dirname, '../../downloads/tiktok');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

class TikTokService {
  constructor() {
    this.downloadDir = DOWNLOAD_DIR;
  }

  /**
   * Search TikTok videos by keyword using tikwm feed/search API
   * Returns list of video metadata
   */
  async searchVideos(keyword, count = 10) {
    logger.info('Searching TikTok videos', { keyword, count });

    try {
      // Use tikwm's feed search endpoint
      const searchUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(keyword)}&count=${count}&cursor=0&HD=1`;

      const response = await this._fetchJSON(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (response && response.code === 0 && response.data && response.data.videos) {
        const videos = response.data.videos.map(video => ({
          id: video.video_id || video.id,
          desc: video.title || video.desc || 'No description',
          author: video.author?.unique_id || 'unknown',
          authorNickname: video.author?.nickname || 'Unknown',
          duration: video.duration || 0,
          playCount: video.play_count || 0,
          likeCount: video.digg_count || 0,
          commentCount: video.comment_count || 0,
          shareCount: video.share_count || 0,
          createTime: video.create_time,
          cover: video.origin_cover || video.cover || '',
          videoUrl: `https://www.tiktok.com/@${video.author?.unique_id || 'user'}/video/${video.video_id || video.id}`
        }));

        logger.info('Search completed', { keyword, found: videos.length });
        return videos;
      }

      // Fallback: try alternative search endpoint
      return await this._searchFallback(keyword, count);
    } catch (error) {
      logger.error('TikTok search error', { error: error.message });
      return await this._searchFallback(keyword, count);
    }
  }

  /**
   * Fallback search using tikwm user feed or hashtag endpoint
   */
  async _searchFallback(keyword, count) {
    try {
      // Try tikwm hashtag feed
      const url = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(keyword)}&count=${count}&cursor=0`;

      const response = await this._fetchJSON(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (response && response.code === 0 && response.data && response.data.videos) {
        return response.data.videos.map(video => ({
          id: video.video_id || video.id,
          desc: video.title || 'No description',
          author: video.author?.unique_id || 'unknown',
          authorNickname: video.author?.nickname || 'Unknown',
          duration: video.duration || 0,
          playCount: video.play_count || 0,
          likeCount: video.digg_count || 0,
          commentCount: video.comment_count || 0,
          shareCount: video.share_count || 0,
          createTime: video.create_time,
          cover: video.origin_cover || video.cover || '',
          videoUrl: `https://www.tiktok.com/@${video.author?.unique_id || 'user'}/video/${video.video_id || video.id}`
        }));
      }

      return [];
    } catch (error) {
      logger.error('Fallback search error', { error: error.message });
      return [];
    }
  }

  /**
   * Download TikTok video without watermark
   * Uses multiple providers for reliability
   */
  async downloadNoWatermark(videoUrl, customFilename = null) {
    logger.info('Downloading TikTok video (no watermark)', { videoUrl });

    const providers = [
      () => this._downloadViaTikwm(videoUrl),
      () => this._downloadViaSsstik(videoUrl),
      () => this._downloadViaMusicaldown(videoUrl)
    ];

    let downloadUrl = null;
    let providerName = '';

    for (const provider of providers) {
      try {
        const result = await provider();
        if (result && result.url) {
          downloadUrl = result.url;
          providerName = result.provider;
          break;
        }
      } catch (error) {
        logger.warn('Provider failed, trying next', { error: error.message });
        continue;
      }
    }

    if (!downloadUrl) {
      throw new Error('ไม่สามารถดาวน์โหลดวิดีโอได้ ลองใหม่อีกครั้ง');
    }

    // Generate filename
    const videoId = this._extractVideoId(videoUrl);
    const filename = customFilename
      ? customFilename.replace(/[^\w\s\-ก-๙]/g, '').substring(0, 100) + '.mp4'
      : `tiktok_${videoId}_${Date.now()}.mp4`;

    const filepath = path.join(this.downloadDir, filename);

    // Download the file
    await this._downloadFile(downloadUrl, filepath);

    const stats = fs.statSync(filepath);
    logger.info('Download completed', {
      filename,
      size: stats.size,
      provider: providerName
    });

    return {
      filename,
      filepath,
      size: stats.size,
      provider: providerName,
      videoId
    };
  }

  /**
   * Provider 1: tikwm.com API (most reliable)
   */
  async _downloadViaTikwm(videoUrl) {
    // Use GET method with query params - more reliable than POST
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`;

    const response = await this._fetchJSON(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (response && response.code === 0 && response.data && response.data.play) {
      return {
        url: response.data.hdplay || response.data.play,
        provider: 'tikwm',
        title: response.data.title || '',
        author: response.data.author?.unique_id || ''
      };
    }

    return null;
  }

  /**
   * Provider 2: ssstik.io API
   */
  async _downloadViaSsstik(videoUrl) {
    const apiUrl = 'https://ssstik.io/abc?url=dl';

    const postData = `id=${encodeURIComponent(videoUrl)}&locale=en&tt=`;

    const html = await this._fetchText(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://ssstik.io',
        'Referer': 'https://ssstik.io/'
      },
      body: postData
    });

    if (html) {
      // Extract download link from response
      const match = html.match(/href="(https?:\/\/[^"]+)"\s*[^>]*>.*?Without watermark/i);
      if (match) {
        return { url: match[1], provider: 'ssstik' };
      }
    }

    return null;
  }

  /**
   * Provider 3: musicaldown.com
   */
  async _downloadViaMusicaldown(videoUrl) {
    // First get the page and extract token
    const pageHtml = await this._fetchText('https://musicaldown.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!pageHtml) return null;

    // Extract hidden input tokens
    const tokenMatch = pageHtml.match(/name="([^"]+)"\s+type="hidden"\s+value="([^"]+)"/g);
    if (!tokenMatch) return null;

    const formData = new URLSearchParams();
    formData.append('url', videoUrl);

    for (const match of tokenMatch) {
      const nameMatch = match.match(/name="([^"]+)"/);
      const valueMatch = match.match(/value="([^"]+)"/);
      if (nameMatch && valueMatch) {
        formData.append(nameMatch[1], valueMatch[1]);
      }
    }

    const resultHtml = await this._fetchText('https://musicaldown.com/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://musicaldown.com',
        'Referer': 'https://musicaldown.com/'
      },
      body: formData.toString()
    });

    if (resultHtml) {
      const linkMatch = resultHtml.match(/href="(https?:\/\/[^"]+)"[^>]*>.*?Download MP4/i);
      if (linkMatch) {
        return { url: linkMatch[1], provider: 'musicaldown' };
      }
    }

    return null;
  }

  /**
   * Extract video ID from TikTok URL
   */
  _extractVideoId(url) {
    const match = url.match(/\/video\/(\d+)/);
    if (match) return match[1];

    const shortMatch = url.match(/\/(\w+)\/?$/);
    if (shortMatch) return shortMatch[1];

    return Date.now().toString();
  }

  /**
   * Download file from URL
   */
  _downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(filepath);

      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.tiktok.com/'
        }
      }, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(filepath);
          return this._downloadFile(response.headers.location, filepath).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(filepath);
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        reject(err);
      });

      // Timeout after 60 seconds
      request.setTimeout(60000, () => {
        request.destroy();
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Fetch JSON from URL
   */
  _fetchJSON(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      const req = protocol.request(reqOptions, (res) => {
        let data = '';

        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._fetchJSON(res.headers.location, options).then(resolve).catch(reject);
        }

        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Fetch text/HTML from URL
   */
  _fetchText(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      const req = protocol.request(reqOptions, (res) => {
        let data = '';

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._fetchText(res.headers.location, options).then(resolve).catch(reject);
        }

        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', () => resolve(null));
      req.setTimeout(15000, () => {
        req.destroy();
        resolve(null);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Get list of downloaded files
   */
  getDownloadedFiles() {
    if (!fs.existsSync(this.downloadDir)) return [];

    return fs.readdirSync(this.downloadDir)
      .filter(f => f.endsWith('.mp4'))
      .map(f => {
        const filepath = path.join(this.downloadDir, f);
        const stats = fs.statSync(filepath);
        return {
          filename: f,
          filepath,
          size: stats.size,
          sizeFormatted: this._formatSize(stats.size),
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified);
  }

  /**
   * Delete a downloaded file
   */
  deleteFile(filename) {
    const filepath = path.join(this.downloadDir, filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      return true;
    }
    return false;
  }

  _formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = new TikTokService();
