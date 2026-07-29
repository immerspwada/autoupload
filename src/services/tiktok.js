// TikTok Service - Search & Download without watermark
const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const http   = require('http');
const logger = require('../utils/logger');
const C      = require('../config/constants');
const diskGuard = require('../utils/diskGuard');
const { breaker } = require('../utils/resilience');

// ★ เพดานความปลอดภัยของ network layer
const MAX_REDIRECTS  = 5;
const MAX_JSON_BYTES = 8 * 1024 * 1024;    // response JSON ที่ใหญ่กว่านี้ = ผิดปกติ
const MAX_HTML_BYTES = 4 * 1024 * 1024;    // อ่าน HTML แค่พอ parse meta tag

const DOWNLOAD_DIR = path.join(__dirname, '../../downloads/tiktok');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

class TikTokService {
  constructor() {
    this.downloadDir         = DOWNLOAD_DIR;
    this._tikwmQueueTail     = Promise.resolve();
    this._tikwmMinIntervalMs = C.TIKTOK.THROTTLE_MS;
    this._tikwmLastCallAt    = 0;

    this._providerStats = {
      tikwm:       { success: 0, failure: 0 },
      ssstik:      { success: 0, failure: 0 },
      musicaldown: { success: 0, failure: 0 },
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
  async _paginatedSearch(keyword, count, maxPages = C.TIKTOK.MAX_SEARCH_PAGES) {
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
    // ★ Circuit breaker — เดิมเวลา tikwm ถูก Cloudflare บล็อก ทุก keyword
    //   ยังยิงคำขอเต็มรอบ (search 15 keyword = 15 × throttle 1.1s = เสียเวลาเปล่า 17s)
    //   ตอนนี้: ล้มติดกันครบเกณฑ์ → ตัดทันที แล้วลองใหม่อีก 2 นาที
    const cb = breaker('tikwm', { failureThreshold: 6, openMs: 2 * 60_000 });

    if (cb.state === 'open') {
      const waitSec = Math.ceil((cb.openMs - (Date.now() - cb.openedAt)) / 1000);
      logger.warn('[tikwm] circuit เปิดอยู่ — ข้ามคำขอ', { retryInSec: waitSec });
      return null;
    }

    let lastFailure = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response;
      try {
        response = await this._throttleTikwm(() => this._fetchJSON(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://www.tiktok.com/'
          }
        }));
      } catch (err) {
        // network error / timeout — นับเป็นความล้มเหลวของ upstream
        lastFailure = err;
        logger.warn('[tikwm] คำขอล้มเหลว', { attempt: attempt + 1, error: err.message });
        if (attempt < maxRetries) { await this._delay(1200 * (attempt + 1)); continue; }
        break;
      }

      // null = HTML response (CF challenge) or parse error — no point retrying
      if (response === null) {
        logger.warn('tikwm returned non-JSON (CF block?), skipping retries', { url: url.substring(0, 80) });
        cb._onFailure(new Error('tikwm ตอบไม่ใช่ JSON (อาจถูก Cloudflare บล็อก)'));
        return null;
      }

      const isRateLimited = response.code === -1;
      if (!isRateLimited) {
        cb._onSuccess();
        return response;
      }

      lastFailure = new Error('tikwm rate limit');
      logger.warn('tikwm rate limit hit, retrying', { attempt: attempt + 1, url: url.substring(0, 80) });
      await this._delay(1200 * (attempt + 1));
    }

    cb._onFailure(lastFailure || new Error('tikwm ไม่ตอบสนองหลังลองครบจำนวน'));
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
  async searchMultipleKeywords(keywords, countPerKeyword = 12, concurrency = C.TIKTOK.SEARCH_CONCURRENCY) {
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
        await this._delay(C.TIKTOK.BATCH_DELAY_MS);
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
    if (redirectDepth > MAX_REDIRECTS) {
      return Promise.reject(new Error(`redirect วนเกิน ${MAX_REDIRECTS} ครั้ง`));
    }

    // ★ เช็คพื้นที่ดิสก์ก่อนเริ่มโหลด — เดิมโหลดจนดิสก์เต็มแล้วไฟล์เสีย
    const space = diskGuard.check(C.TIKTOK.MAX_DOWNLOAD_BYTES, { label: 'ดาวน์โหลด TikTok' });
    if (!space.ok) {
      return Promise.reject(Object.assign(
        new Error(`พื้นที่ดิสก์ไม่พอ — ${space.reason}`), { code: 'ENOSPC_GUARD' }
      ));
    }

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(filepath);

      let settled = false;
      let bytesWritten = 0;

      const cleanup = () => {
        try { file.destroy(); } catch (_) {}
        try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (_) {}
      };
      const fail = (err) => {
        if (settled) return; settled = true;
        clearTimeout(hardTimer);
        cleanup();
        reject(err);
      };
      const succeed = () => {
        if (settled) return; settled = true;
        clearTimeout(hardTimer);
        resolve();
      };

      // ★ total-duration timeout — request.setTimeout เป็น inactivity เท่านั้น
      //   server ที่ส่งข้อมูลทีละหยดจะไม่ trigger เลย = ค้างตลอดกาล
      const hardTimer = setTimeout(() => {
        try { request.destroy(); } catch (_) {}
        fail(new Error(`ดาวน์โหลดใช้เวลาเกิน ${C.TIKTOK.DOWNLOAD_TOTAL_TIMEOUT_MS / 1000}s — ยกเลิก`));
      }, C.TIKTOK.DOWNLOAD_TOTAL_TIMEOUT_MS);
      if (hardTimer.unref) hardTimer.unref();

      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.tiktok.com/'
        }
      }, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          try { file.destroy(); } catch (_) {}
          try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (_) {}
          if (settled) return; settled = true;
          clearTimeout(hardTimer);
          const next = new URL(response.headers.location, url).toString();
          return this._downloadFile(next, filepath, redirectDepth + 1).then(resolve, reject);
        }

        if (response.statusCode !== 200) {
          response.resume();
          return fail(new Error(`HTTP ${response.statusCode}`));
        }

        // ★ ปฏิเสธไฟล์ใหญ่เกินก่อนโหลด (ถ้า server บอก content-length)
        const declared = parseInt(response.headers['content-length'] || '0', 10);
        if (declared > C.TIKTOK.MAX_DOWNLOAD_BYTES) {
          response.resume();
          return fail(new Error(`ไฟล์ใหญ่เกินกำหนด (${Math.round(declared / 1048576)}MB)`));
        }

        response.on('data', (chunk) => {
          bytesWritten += chunk.length;
          // ★ กันกรณี server ไม่บอก content-length แล้วส่งไม่จบ
          if (bytesWritten > C.TIKTOK.MAX_DOWNLOAD_BYTES) {
            try { request.destroy(); } catch (_) {}
            fail(new Error('ไฟล์ใหญ่เกินกำหนดระหว่างดาวน์โหลด'));
          }
        });

        response.on('error', (err) => fail(new Error(`อ่านข้อมูลไม่สำเร็จ: ${err.message}`)));

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            // ★ ตรวจว่าไฟล์ไม่ว่าง — เดิมไฟล์ 0 byte ผ่านไปถึงขั้น upload
            try {
              const size = fs.statSync(filepath).size;
              if (size === 0) return fail(new Error('ไฟล์ที่ดาวน์โหลดว่างเปล่า'));
              if (size < 1024) return fail(new Error(`ไฟล์เล็กผิดปกติ (${size} bytes) — อาจเป็นหน้า error`));
            } catch (err) {
              return fail(new Error(`ตรวจไฟล์ไม่สำเร็จ: ${err.message}`));
            }
            succeed();
          });
        });

        file.on('error', (err) => fail(new Error(`เขียนดิสก์ไม่สำเร็จ: ${err.message}`)));
      });

      request.on('error', (err) => fail(err));

      request.setTimeout(C.TIKTOK.DOWNLOAD_TIMEOUT_MS, () => {
        try { request.destroy(); } catch (_) {}
        fail(new Error('ดาวน์โหลดไม่มีการตอบสนอง (timeout)'));
      });
    });
  }

  /**
   * Fetch JSON from URL
   */
  _fetchJSON(url, options = {}, redirectDepth = 0) {
    // ★ เดิม redirect วนซ้ำแบบไม่จำกัด → redirect loop = infinite recursion + hang ตลอดกาล
    if (redirectDepth > MAX_REDIRECTS) {
      return Promise.reject(new Error(`redirect วนเกิน ${MAX_REDIRECTS} ครั้ง — ยกเลิก`));
    }

    return new Promise((resolve, reject) => {
      let urlObj;
      try { urlObj = new URL(url); } catch (_) { return reject(new Error(`URL ไม่ถูกต้อง: ${String(url).slice(0, 80)}`)); }
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return reject(new Error(`protocol ไม่รองรับ: ${urlObj.protocol}`));
      }
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: urlObj.hostname,
        port:     urlObj.port || undefined,
        path:     urlObj.pathname + urlObj.search,
        method:   options.method || 'GET',
        headers:  options.headers || {},
      };

      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; clearTimeout(hardTimer); fn(arg); } };

      // ★ total-duration timeout — setTimeout ของ request เป็น inactivity timeout
      //   ตอบทีละ byte ช้าๆ จะไม่โดน trigger เลย
      const hardTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { req.destroy(); } catch (_) {}
        reject(new Error(`คำขอใช้เวลาเกิน ${C.TIKTOK.JSON_TOTAL_TIMEOUT_MS / 1000}s`));
      }, C.TIKTOK.JSON_TOTAL_TIMEOUT_MS);
      if (hardTimer.unref) hardTimer.unref();

      const req = protocol.request(reqOptions, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // ★ ต้อง drain ไม่งั้น socket ค้าง
          const next = new URL(res.headers.location, urlObj).toString();
          clearTimeout(hardTimer);
          settled = true;
          return this._fetchJSON(next, options, redirectDepth + 1).then(resolve, reject);
        }

        let data = '';
        let bytes = 0;
        res.on('data', chunk => {
          bytes += chunk.length;
          // ★ จำกัดขนาด response — กัน endpoint ที่ตอบไม่จบทำ memory ระเบิด
          if (bytes > MAX_JSON_BYTES) {
            try { req.destroy(); } catch (_) {}
            return done(reject, new Error('ข้อมูลตอบกลับใหญ่เกินกำหนด'));
          }
          data += chunk;
        });
        res.on('end', () => {
          try { done(resolve, JSON.parse(data)); }
          catch (_) { done(resolve, null); }
        });
        res.on('error', (err) => done(reject, err));
      });

      req.on('error', (err) => done(reject, err));
      req.setTimeout(C.TIKTOK.JSON_IDLE_TIMEOUT_MS, () => {
        try { req.destroy(); } catch (_) {}
        done(reject, new Error('คำขอไม่มีการตอบสนอง (timeout)'));
      });

      if (options.body) req.write(options.body);
      req.end();
    });
  }

  /**
   * Fetch text/HTML from URL
   */
  _fetchText(url, options = {}, redirectDepth = 0) {
    // ★ redirect depth limit เหมือน _fetchJSON — ตัวนี้คืน null แทน reject ตามพฤติกรรมเดิม
    if (redirectDepth > MAX_REDIRECTS) return Promise.resolve(null);

    return new Promise((resolve) => {
      let urlObj;
      try { urlObj = new URL(url); } catch (_) { return resolve(null); }
      if (!['http:', 'https:'].includes(urlObj.protocol)) return resolve(null);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: urlObj.hostname,
        port:     urlObj.port || undefined,
        path:     urlObj.pathname + urlObj.search,
        method:   options.method || 'GET',
        headers:  options.headers || {},
      };

      let settled = false;
      const done = (val) => { if (!settled) { settled = true; clearTimeout(hardTimer); resolve(val); } };

      const hardTimer = setTimeout(() => {
        if (settled) return;
        try { req.destroy(); } catch (_) {}
        done(null);
      }, C.TIKTOK.TEXT_TOTAL_TIMEOUT_MS);
      if (hardTimer.unref) hardTimer.unref();

      const req = protocol.request(reqOptions, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, urlObj).toString();
          clearTimeout(hardTimer);
          settled = true;
          return this._fetchText(next, options, redirectDepth + 1).then(resolve, () => resolve(null));
        }

        let data = '';
        let bytes = 0;
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > MAX_HTML_BYTES) {
            try { req.destroy(); } catch (_) {}
            return done(data);   // ตัดแค่ที่ได้มา — พอสำหรับ parse meta tag
          }
          data += chunk;
        });
        res.on('end', () => done(data));
        res.on('error', () => done(null));
      });

      req.on('error', () => done(null));
      req.setTimeout(C.TIKTOK.TEXT_IDLE_TIMEOUT_MS, () => {
        try { req.destroy(); } catch (_) {}
        done(null);
      });

      if (options.body) req.write(options.body);
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
