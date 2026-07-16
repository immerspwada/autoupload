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
    // tikwm.com (free tier) hard-limits to 1 request/second across the WHOLE
    // service — even for unrelated keywords fired in parallel. We serialize
    // every call through this queue so pagination + multi-keyword search
    // never exceed that limit, no matter how many requests are in flight.
    this._tikwmQueueTail = Promise.resolve();
    this._tikwmMinIntervalMs = 1100;
    this._tikwmLastCallAt = 0;

    // Track success/failure per download provider so we can automatically
    // try the most reliable provider first instead of a fixed order.
    this._providerStats = {
      tikwm: { success: 0, failure: 0 },
      ssstik: { success: 0, failure: 0 },
      musicaldown: { success: 0, failure: 0 }
    };
  }

  /**
   * Run `fn` after ensuring at least `_tikwmMinIntervalMs` has passed since
   * the previous tikwm call. Serializes all callers via a promise chain so
   * concurrent callers (parallel keyword searches, pagination, etc.) queue
   * up instead of firing at once.
   */
  _throttleTikwm(fn) {
    const run = () => {
      const wait = Math.max(0, this._tikwmLastCallAt + this._tikwmMinIntervalMs - Date.now());
      return this._delay(wait).then(() => {
        this._tikwmLastCallAt = Date.now();
        return fn();
      });
    };
    const scheduled = this._tikwmQueueTail.then(run, run);
    // Keep the tail alive even if this call fails, so later callers still run
    this._tikwmQueueTail = scheduled.catch(() => {});
    return scheduled;
  }

  /**
   * Search TikTok videos by keyword using tikwm feed/search API
   * Paginates via cursor because tikwm often returns FEWER videos than
   * requested in a single call (e.g. asked for 12, got 6) even though
   * hasMore=true. We keep fetching pages until we hit `count`, run out
   * of results, or hit a safety page limit.
   */
  async searchVideos(keyword, count = 10) {
    logger.info('Searching TikTok videos', { keyword, count });

    try {
      const videos = await this._paginatedSearch(keyword, count);
      if (videos.length > 0) {
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
   * Fetch pages from tikwm feed/search until we have `count` videos,
   * the API says hasMore=false, or we hit maxPages (safety limit).
   * Every HTTP call goes through _throttleTikwm so we never exceed
   * tikwm's free-tier limit of 1 request/second, and rate-limit
   * responses (code:-1) are retried instead of silently dropped.
   */
  async _paginatedSearch(keyword, count, maxPages = 6) {
    const collected = [];
    const seenIds = new Set();
    let cursor = 0;
    let page = 0;

    while (collected.length < count && page < maxPages) {
      const searchUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(keyword)}&count=${count}&cursor=${cursor}&HD=1`;

      const response = await this._fetchTikwmWithRetry(searchUrl);

      if (!response || response.code !== 0 || !response.data || !Array.isArray(response.data.videos)) {
        break;
      }

      for (const video of response.data.videos) {
        const id = video.video_id || video.id;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(this._mapVideo(video));
      }

      page++;

      const hasMore = response.data.hasMore;
      const nextCursor = response.data.cursor;

      // Stop if API says no more results, or cursor isn't advancing (avoid infinite loop)
      if (!hasMore || nextCursor === undefined || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    return collected.slice(0, count);
  }

  /**
   * Fetch a tikwm URL through the shared throttle, retrying on the
   * "Free Api Limit: 1 request/second" response (code: -1) with
   * exponential backoff instead of treating it as "no results".
   * 
   * ★ CF-block detection: if response is null (HTML/non-JSON) on first
   * attempt, bail immediately instead of wasting 3 retry rounds.
   */
  async _fetchTikwmWithRetry(url, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this._throttleTikwm(() => this._fetchJSON(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.tiktok.com/'
        }
      }));

      // null = HTML response (CF challenge) or parse error — no point retrying
      if (response === null) {
        logger.warn('tikwm returned non-JSON (CF block?), skipping retries', { url: url.substring(0, 80) });
        return null;
      }

      const isRateLimited = response.code === -1;
      if (!isRateLimited) return response;

      logger.warn('tikwm rate limit hit, retrying', { attempt: attempt + 1, url: url.substring(0, 80) });
      await this._delay(1200 * (attempt + 1));
    }
    return null;
  }

  /**
   * Search TikTok videos using MULTIPLE keywords at once.
   * Runs searches in parallel (limited concurrency), merges results,
   * dedupes by video id, and tags each video with the keyword that found it.
   *
   * @param {string[]} keywords - list of search keywords
   * @param {number} countPerKeyword - how many results to fetch per keyword
   * @param {number} concurrency - how many keyword searches to run at once
   */
  async searchMultipleKeywords(keywords, countPerKeyword = 12, concurrency = 3) {
    const uniqueKeywords = [...new Set(
      keywords.map(k => (k || '').trim()).filter(Boolean)
    )];

    if (uniqueKeywords.length === 0) return { videos: [], perKeyword: [] };

    logger.info('Multi-keyword TikTok search started', {
      keywords: uniqueKeywords, countPerKeyword
    });

    const perKeyword = [];
    const videoMap = new Map(); // dedupe by video id

    // Process keywords in batches to avoid hammering the upstream API
    for (let i = 0; i < uniqueKeywords.length; i += concurrency) {
      const batch = uniqueKeywords.slice(i, i + concurrency);

      const batchResults = await Promise.all(batch.map(async (kw) => {
        try {
          const videos = await this.searchVideos(kw, countPerKeyword);
          return { keyword: kw, videos, error: null };
        } catch (error) {
          logger.warn('Keyword search failed, skipping', { keyword: kw, error: error.message });
          return { keyword: kw, videos: [], error: error.message };
        }
      }));

      for (const result of batchResults) {
        perKeyword.push({
          keyword: result.keyword,
          found: result.videos.length,
          error: result.error
        });

        for (const video of result.videos) {
          const key = video.id || video.videoUrl;
          if (!key) continue;
          if (!videoMap.has(key)) {
            videoMap.set(key, { ...video, matchedKeywords: [result.keyword] });
          } else {
            // Video found by multiple keywords — track all of them
            const existing = videoMap.get(key);
            if (!existing.matchedKeywords.includes(result.keyword)) {
              existing.matchedKeywords.push(result.keyword);
            }
          }
        }
      }

      // Small delay between batches to be nice to the upstream API
      if (i + concurrency < uniqueKeywords.length) {
        await this._delay(500);
      }
    }

    const videos = Array.from(videoMap.values());
    logger.info('Multi-keyword search completed', {
      keywordCount: uniqueKeywords.length,
      totalUnique: videos.length
    });

    return { videos, perKeyword };
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        return response.data.videos.map(video => this._mapVideo(video));
      }

      return [];
    } catch (error) {
      logger.error('Fallback search error', { error: error.message });
      return [];
    }
  }

  /**
   * Discover trending TikTok videos WITHOUT a keyword — uses tikwm's
   * regional feed endpoint. Useful for "what's hot right now" browsing
   * instead of only reactive keyword search.
   */
  async getTrending(region = 'TH', count = 12) {
    logger.info('Fetching TikTok trending feed', { region, count });
    try {
      const collected = [];
      const seenIds = new Set();
      const url = `https://www.tikwm.com/api/feed/list?region=${encodeURIComponent(region)}&count=${count}`;
      const response = await this._fetchTikwmWithRetry(url);

      if (response && response.code === 0) {
        // tikwm feed/list returns data[] directly (not data.videos[])
        const videoList = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.videos)
            ? response.data.videos
            : [];

        for (const video of videoList) {
          const id = video.video_id || video.id;
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          collected.push(this._mapVideo(video));
        }
      }

      logger.info('Trending fetch completed', { region, found: collected.length });
      return collected.slice(0, count);
    } catch (error) {
      logger.error('TikTok trending fetch error', { error: error.message });
      return [];
    }
  }

  /**
   * Fetch the most recent videos posted by a specific creator (by
   * @username). Uses tikwm user/posts endpoint with fallback to
   * feed/search by username if Cloudflare blocks the direct call.
   */
  async getCreatorVideos(username, count = 12) {
    const handle = (username || '').replace(/^@/, '').trim();
    if (!handle) return [];

    logger.info('Fetching TikTok creator videos', { username: handle, count });

    // Strategy 1: tikwm user/posts (may be CF-blocked)
    try {
      const result = await this._fetchCreatorViaUserPosts(handle, count);
      if (result.length > 0) {
        logger.info('Creator fetch via user/posts completed', { username: handle, found: result.length });
        return result;
      }
    } catch (error) {
      logger.warn('Creator user/posts failed, trying search fallback', { username: handle, error: error.message });
    }

    // Strategy 2: feed/search by @username (more resilient, tikwm throttled path)
    logger.info('Creator fetch fallback: using feed/search', { username: handle });
    try {
      const searchQuery = `@${handle}`;
      const videos = await this._paginatedSearch(searchQuery, count);
      // Filter to only videos from this creator
      const filtered = videos.filter(v =>
        (v.author || '').toLowerCase() === handle.toLowerCase()
      );
      const result = filtered.length > 0 ? filtered : videos.slice(0, count);
      logger.info('Creator fetch via search fallback completed', { username: handle, found: result.length });
      return result;
    } catch (err) {
      logger.error('TikTok creator fetch error (all strategies failed)', { username: handle, error: err.message });
      return [];
    }
  }

  async _fetchCreatorViaUserPosts(handle, count) {
    const collected = [];
    const seenIds = new Set();
    let cursor = 0;
    let page = 0;
    const maxPages = 4;

    while (collected.length < count && page < maxPages) {
      const url = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(handle)}&count=${count}&cursor=${cursor}`;
      const response = await this._fetchTikwmWithRetry(url);

      if (!response || response.code !== 0) {
        // code -1 or HTML (CF block) — throw to trigger fallback
        throw new Error(`tikwm user/posts returned code ${response?.code ?? 'non-JSON'}`);
      }

      // tikwm user/posts may return data as array OR as { videos: [] }
      const videoList = Array.isArray(response.data)
        ? response.data
        : Array.isArray(response.data?.videos)
          ? response.data.videos
          : [];

      if (videoList.length === 0) break;

      for (const video of videoList) {
        const id = video.video_id || video.id;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(this._mapVideo(video));
      }

      page++;
      const hasMore = response.data?.hasMore;
      const nextCursor = response.data?.cursor;
      if (!hasMore || nextCursor === undefined || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    return collected.slice(0, count);
  }

  /**
   * Map a raw tikwm video object into our normalized video shape.
   * Shared by search, trending, and creator-feed paths so downstream
   * code (SEO scoring, duplicate detection, UI) always gets the same shape.
   */
  _mapVideo(video) {
    const id = video.video_id || video.id;
    return {
      id,
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
      videoUrl: `https://www.tiktok.com/@${video.author?.unique_id || 'user'}/video/${id}`
    };
  }

  /**
   * Report which providers currently look most reliable, ordered best-first.
   * Providers with fewer than 3 total attempts are treated as unproven and
   * kept in their original default order (tikwm first — it's generally the
   * most stable) rather than penalized for lack of data.
   */
  _rankedProviders() {
    const defaultOrder = ['tikwm', 'ssstik', 'musicaldown'];
    return [...defaultOrder].sort((a, b) => {
      const sa = this._providerStats[a], sb = this._providerStats[b];
      const totalA = sa.success + sa.failure, totalB = sb.success + sb.failure;
      // Not enough data yet — preserve default order
      if (totalA < 3 && totalB < 3) return defaultOrder.indexOf(a) - defaultOrder.indexOf(b);
      const rateA = totalA > 0 ? sa.success / totalA : 0.5;
      const rateB = totalB > 0 ? sb.success / totalB : 0.5;
      return rateB - rateA;
    });
  }

  getProviderStats() {
    const stats = {};
    for (const [name, s] of Object.entries(this._providerStats)) {
      const total = s.success + s.failure;
      stats[name] = {
        ...s,
        total,
        successRate: total > 0 ? +((s.success / total) * 100).toFixed(1) : null
      };
    }
    return stats;
  }

  /**
   * Download TikTok video without watermark.
   * Tries providers in order of measured reliability (see _rankedProviders)
   * instead of a fixed sequence, and records success/failure so the
   * ranking improves over the life of the process.
   */
  async downloadNoWatermark(videoUrl, customFilename = null) {
    logger.info('Downloading TikTok video (no watermark)', { videoUrl });

    const providerFns = {
      tikwm: () => this._downloadViaTikwm(videoUrl),
      ssstik: () => this._downloadViaSsstik(videoUrl),
      musicaldown: () => this._downloadViaMusicaldown(videoUrl)
    };

    let downloadUrl = null;
    let providerName = '';

    for (const name of this._rankedProviders()) {
      try {
        const result = await providerFns[name]();
        if (result && result.url) {
          downloadUrl = result.url;
          providerName = result.provider;
          this._providerStats[name].success++;
          break;
        }
        this._providerStats[name].failure++;
      } catch (error) {
        this._providerStats[name].failure++;
        logger.warn('Provider failed, trying next', { provider: name, error: error.message });
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
  _downloadFile(url, filepath, redirectDepth = 0) {
    if (redirectDepth > 5) {
      return Promise.reject(new Error('Too many redirects (max 5)'));
    }
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
          try { file.close(); } catch (_) {}
          try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (_) {}
          return this._downloadFile(response.headers.location, filepath, redirectDepth + 1).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          try { file.close(); } catch (_) {}
          try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (_) {}
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
        // ★ Handle disk I/O errors — ป้องกัน silent hang และ partial file
        file.on('error', (err) => {
          try { file.close(); } catch (_) {}
          try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (_) {}
          reject(new Error(`Disk write error: ${err.message}`));
        });
      });

      request.on('error', (err) => {
        try { file.close(); } catch (_) {}
        try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (_) {}
        reject(err);
      });

      // Timeout after 60 seconds
      request.setTimeout(60000, () => {
        request.destroy();
        try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (_) {}
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
      req.setTimeout(8000, () => {
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
        try {
          const stats = fs.statSync(filepath);
          return {
            filename: f,
            filepath,
            size: stats.size,
            sizeFormatted: this._formatSize(stats.size),
            modified: stats.mtime
          };
        } catch (_) {
          // File was deleted between readdir and stat — skip it
          return null;
        }
      })
      .filter(Boolean)
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
