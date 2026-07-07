// ═══════════════════════════════════════════════════════════════════
// SEO Optimization Service — สร้าง Metadata ที่ดีสำหรับ YouTube Ad Revenue
//
// หน้าที่:
//   1. สร้าง title ที่ SEO-friendly จาก TikTok description
//   2. สร้าง description ที่มี keywords + CTA + timestamps
//   3. สร้าง tags ที่เกี่ยวข้องและ trending
//   4. เลือก YouTube category ที่เหมาะสม
//   5. ตั้งเวลา publish ที่ดีที่สุด (prime-time Thailand)
//   6. ตรวจสอบ content ว่าเหมาะกับ monetization หรือไม่
// ═══════════════════════════════════════════════════════════════════

const logger = require('../utils/logger');
const { settings } = require('../utils/store');

// YouTube Video Categories (ที่ใช้บ่อยในไทย)
const YOUTUBE_CATEGORIES = {
  1: 'Film & Animation',
  2: 'Autos & Vehicles',
  10: 'Music',
  15: 'Pets & Animals',
  17: 'Sports',
  19: 'Travel & Events',
  20: 'Gaming',
  22: 'People & Blogs',
  23: 'Comedy',
  24: 'Entertainment',
  25: 'News & Politics',
  26: 'Howto & Style',
  27: 'Education',
  28: 'Science & Technology',
  29: 'Nonprofits & Activism'
};

// Keyword → Category mapping
const CATEGORY_KEYWORDS = {
  10: ['เพลง', 'music', 'song', 'cover', 'mv', 'ร้องเพลง', 'lyrics', 'dance', 'เต้น', 'choreography'],
  15: ['แมว', 'หมา', 'cat', 'dog', 'pet', 'สัตว์', 'animal', 'น้องหมา', 'น้องแมว', 'puppy', 'kitten'],
  17: ['กีฬา', 'sport', 'football', 'boxing', 'มวย', 'ฟุตบอล', 'basketball', 'gym', 'workout', 'fitness'],
  19: ['เที่ยว', 'travel', 'ท่องเที่ยว', 'vlog', 'trip', 'ทะเล', 'ภูเขา', 'cafe', 'คาเฟ่', 'ร้านอาหาร'],
  20: ['game', 'เกม', 'gaming', 'gameplay', 'play', 'rov', 'pubg', 'valorant', 'minecraft', 'roblox'],
  22: ['daily', 'vlog', 'routine', 'ชีวิตประจำวัน', 'grwm', 'day in my life', 'lifestyle'],
  23: ['ตลก', 'comedy', 'funny', 'ขำ', 'หัวเราะ', 'prank', 'meme', 'โอ้โห'],
  24: ['entertainment', 'บันเทิง', 'drama', 'ละคร', 'react', 'review', 'reaction', 'ดารา', 'celebrity'],
  26: ['สอน', 'howto', 'tutorial', 'diy', 'tips', 'วิธี', 'แต่งหน้า', 'makeup', 'skincare', 'hair', 'fashion', 'ทำอาหาร', 'cooking', 'recipe', 'สูตร'],
  27: ['สอน', 'education', 'เรียน', 'ภาษา', 'english', 'study', 'knowledge', 'ความรู้', 'science'],
  28: ['tech', 'เทคโนโลยี', 'ai', 'phone', 'computer', 'review', 'gadget', 'app', 'iphone', 'android']
};

// Thailand Prime-Time hours (GMT+7) — ช่วงเวลาที่คนไทยดู YouTube มากที่สุด
const PRIME_TIME_HOURS = {
  weekday: [
    { hour: 7, weight: 6 },   // เช้าก่อนไปทำงาน
    { hour: 8, weight: 5 },
    { hour: 12, weight: 7 },  // พักเที่ยง
    { hour: 13, weight: 6 },
    { hour: 17, weight: 5 },  // เลิกงาน
    { hour: 18, weight: 8 },  // หลังเลิกงาน
    { hour: 19, weight: 10 }, // ★ Prime time
    { hour: 20, weight: 10 }, // ★ Prime time
    { hour: 21, weight: 9 },  // ★ Prime time
    { hour: 22, weight: 7 },
    { hour: 23, weight: 4 }
  ],
  weekend: [
    { hour: 9, weight: 5 },
    { hour: 10, weight: 7 },
    { hour: 11, weight: 8 },
    { hour: 12, weight: 8 },
    { hour: 13, weight: 7 },
    { hour: 14, weight: 8 },
    { hour: 15, weight: 8 },
    { hour: 16, weight: 7 },
    { hour: 17, weight: 6 },
    { hour: 18, weight: 8 },
    { hour: 19, weight: 10 }, // ★ Prime time
    { hour: 20, weight: 10 }, // ★ Prime time
    { hour: 21, weight: 9 },
    { hour: 22, weight: 7 }
  ]
};

// Banned/risky keywords that may prevent monetization.
// level 'block' → hard block (clear policy violation, e.g. gambling/drugs/violence).
// level 'warn'  → borderline / suggestive content that risks demonetization
//                 (sexualized/thirst-trap content, reused-content bait) but
//                 isn't automatically illegal — flagged for human review.
const MONETIZATION_RISK_KEYWORDS = {
  block: [
    'เซ็กส์', 'เซ็กซ์', 'sex', 'porn', 'xxx', 'nude', 'oyt',
    'ยาเสพติด', 'drug', 'weed', 'กัญชา', 'ยาบ้า', 'ยาไอซ์',
    'ฆ่า', 'kill', 'murder', 'suicide', 'ฆ่าตัวตาย', 'ทำร้ายตัวเอง',
    'ระเบิด', 'bomb', 'weapon', 'อาวุธ', 'ปืน',
    'พนัน', 'gambling', 'casino', 'แทงบอล', 'หวย', 'สล็อต', 'บาคาร่า'
  ],
  warn: [
    'เซ๊กซี่', 'เซ็กซี่', 'sexy', 'ยั่ว', 'ขย่ม', 'ยั่วยวน', 'เงี่ยน',
    'thirst', 'onlyfans', 'ขายตัว', 'นวดแผ่น', 'ชุดชั้นใน', 'บิกินี่',
    'โป๊', 'วาบหวาม', 'โชว์เนื้อหนัง'
  ]
};

// Common filler words to clean from titles
const FILLER_WORDS = ['fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'xyzbca', 'tiktok', '#'];

class SEOService {
  constructor() {
    this.seoSettings = null;
  }

  /**
   * Generate optimized metadata for a TikTok video being uploaded to YouTube
   * Main entry point for SEO optimization
   */
  generateMetadata(tiktokData, options = {}) {
    const config = this._getConfig();
    
    const title = this.generateTitle(tiktokData, config);
    const description = this.generateDescription(tiktokData, config);
    const tags = this.generateTags(tiktokData, config);
    const categoryId = this.detectCategory(tiktokData);
    const publishAt = options.schedulePublish ? this.getOptimalPublishTime() : null;
    const validation = this.validateForMonetization(tiktokData, title);
    const virality = this.calculateViralityScore(tiktokData);

    return {
      title,
      description,
      tags,
      categoryId,
      publishAt,
      validation,
      virality,
      privacy: publishAt ? 'private' : (config.privacy || 'public') // Private if scheduled
    };
  }

  /**
   * Calculate a 0-100 "virality score" for a TikTok video based on
   * engagement ratios (not raw counts — a 10k-view clip with 20% like
   * rate beats a 1M-view clip with 0.1% like rate for predicting how
   * it'll perform once re-uploaded). Combines:
   *   - like rate     (likes / views)      — strongest signal of quality
   *   - comment rate  (comments / views)   — signals discussion/hook
   *   - share rate    (shares / views)      — strongest signal of reach potential
   *   - recency       (newer = more likely still riding algorithm momentum)
   *   - absolute views (log-scaled, small boost — avoids over-rewarding tiny sample sizes)
   */
  calculateViralityScore(tiktokData) {
    const views = tiktokData.playCount || 0;
    const likes = tiktokData.likeCount || 0;
    const comments = tiktokData.commentCount || 0;
    const shares = tiktokData.shareCount || 0;
    const createTime = tiktokData.createTime; // unix seconds

    if (views < 50) {
      // Not enough data to score meaningfully
      return { score: 0, tier: 'unknown', breakdown: { reason: 'ยอดดูน้อยเกินไป (ต่ำกว่า 50) ยังไม่มีข้อมูลพอประเมิน' } };
    }

    const likeRate = likes / views;       // typically 0.02–0.25 for good content
    const commentRate = comments / views; // typically 0.0005–0.01
    const shareRate = shares / views;     // typically 0.001–0.05, strongest viral signal

    // Normalize each ratio against realistic "great content" ceilings, cap at 1
    const likeScore = Math.min(likeRate / 0.15, 1) * 40;      // up to 40 pts
    const commentScore = Math.min(commentRate / 0.008, 1) * 15; // up to 15 pts
    const shareScore = Math.min(shareRate / 0.03, 1) * 30;     // up to 30 pts (shares matter most for re-upload virality)

    // Recency bonus: fresher clips are more likely still trending / less saturated
    let recencyScore = 5; // default small bonus if unknown
    if (createTime) {
      const ageDays = (Date.now() / 1000 - createTime) / 86400;
      if (ageDays <= 2) recencyScore = 15;
      else if (ageDays <= 7) recencyScore = 12;
      else if (ageDays <= 30) recencyScore = 8;
      else if (ageDays <= 90) recencyScore = 4;
      else recencyScore = 1;
    }

    // Small log-scaled absolute-views bonus (up to 10pts) — separates a
    // viral clip with 5M views from one with 5K views at similar ratios
    const viewsScore = Math.min(Math.log10(views + 1) / 7, 1) * 10;

    const rawScore = likeScore + commentScore + shareScore + recencyScore + viewsScore;
    const score = Math.round(Math.min(rawScore, 100));

    let tier;
    if (score >= 75) tier = 'viral';       // 🔥 rework immediately
    else if (score >= 55) tier = 'hot';    // 📈 strong candidate
    else if (score >= 35) tier = 'decent'; // 👍 worth trying
    else tier = 'low';                     // 📉 low potential

    return {
      score,
      tier,
      breakdown: {
        likeRate: +(likeRate * 100).toFixed(2),
        commentRate: +(commentRate * 100).toFixed(3),
        shareRate: +(shareRate * 100).toFixed(3),
        ageDays: createTime ? Math.round((Date.now() / 1000 - createTime) / 86400) : null
      }
    };
  }

  /**
   * Generate SEO-optimized title from TikTok description
   * Rules:
   *   - Max 100 chars (YouTube limit)
   *   - Remove hashtags and filler words
   *   - Capitalize first letter
   *   - Add engaging prefix/suffix if too short
   */
  generateTitle(tiktokData, config = null) {
    config = config || this._getConfig();
    let rawTitle = tiktokData.desc || tiktokData.title || '';

    // Clean up TikTok-specific junk
    rawTitle = this._cleanTikTokText(rawTitle);

    // If title is too short, enhance it
    if (rawTitle.length < 10) {
      rawTitle = this._enhanceShortTitle(rawTitle, tiktokData);
    }

    // Truncate to YouTube limit
    if (rawTitle.length > 95) {
      rawTitle = rawTitle.substring(0, 92) + '...';
    }

    // Apply title template if configured
    if (config.titleTemplate) {
      rawTitle = config.titleTemplate
        .replace('{title}', rawTitle)
        .replace('{author}', tiktokData.author || '')
        .replace('{date}', new Date().toLocaleDateString('th-TH'));
    }

    return rawTitle || 'Video Clip';
  }

  /**
   * Generate SEO-rich description
   * Includes: summary, hashtags as text, source credit, CTA
   */
  generateDescription(tiktokData, config = null) {
    config = config || this._getConfig();
    const parts = [];

    // Main description
    const cleanDesc = this._cleanTikTokText(tiktokData.desc || '');
    if (cleanDesc) {
      parts.push(cleanDesc);
    }

    // Add separator
    parts.push('');
    parts.push('━━━━━━━━━━━━━━━━━━━━━━━━');

    // Add custom description template
    if (config.defaultDescription) {
      parts.push(config.defaultDescription);
      parts.push('');
    }

    // Add engagement CTA
    parts.push('📌 กดไลค์ กดแชร์ กดติดตาม เพื่อไม่พลาดคลิปใหม่ทุกวัน!');
    parts.push('🔔 กดกระดิ่งเพื่อรับการแจ้งเตือนวิดีโอใหม่');
    parts.push('');

    // Add hashtags as keywords in description (YouTube indexes these)
    const hashtags = this._extractHashtags(tiktokData.desc || '');
    if (hashtags.length > 0) {
      parts.push('🏷️ ' + hashtags.slice(0, 15).map(h => `#${h}`).join(' '));
      parts.push('');
    }

    // Add source metadata
    if (tiktokData.author) {
      parts.push(`📱 Original: @${tiktokData.author}`);
    }

    // Add disclaimer for re-upload (helps avoid copyright issues)
    parts.push('');
    parts.push('━━━━━━━━━━━━━━━━━━━━━━━━');
    if (config.channelDescription) {
      parts.push(config.channelDescription);
    }

    return parts.join('\n');
  }

  /**
   * Generate relevant tags for YouTube SEO
   * Combines: extracted hashtags + category keywords + trending terms
   */
  generateTags(tiktokData, config = null) {
    config = config || this._getConfig();
    const allTags = new Set();

    // 1. Extract hashtags from TikTok description
    const hashtags = this._extractHashtags(tiktokData.desc || '');
    hashtags.forEach(h => {
      if (h.length > 1 && h.length < 30) allTags.add(h);
    });

    // 2. Add words from title/description as tags
    const titleWords = this._extractKeywords(tiktokData.desc || '');
    titleWords.forEach(w => allTags.add(w));

    // 3. Add category-related tags
    const categoryId = this.detectCategory(tiktokData);
    const categoryTags = this._getCategoryTags(categoryId);
    categoryTags.forEach(t => allTags.add(t));

    // 4. Add default tags from settings
    if (config.defaultTags) {
      config.defaultTags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => allTags.add(t));
    }

    // 5. Add common engagement tags
    const engagementTags = ['shorts', 'viral', 'trending'];
    engagementTags.forEach(t => allTags.add(t));

    // YouTube allows up to 500 chars total in tags
    const tags = Array.from(allTags).filter(t => t && t.length > 1 && t.length < 30);
    
    // Limit total tag length to ~450 chars
    let totalLength = 0;
    const finalTags = [];
    for (const tag of tags) {
      if (totalLength + tag.length + 1 > 450) break;
      finalTags.push(tag);
      totalLength += tag.length + 1;
    }

    return finalTags;
  }

  /**
   * Auto-detect YouTube category based on content
   */
  detectCategory(tiktokData) {
    const text = ((tiktokData.desc || '') + ' ' + (tiktokData.title || '')).toLowerCase();
    
    let bestCategory = 22; // Default: People & Blogs
    let bestScore = 0;

    for (const [catId, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += keyword.length; // Longer keyword = more specific = higher score
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = parseInt(catId);
      }
    }

    return bestCategory;
  }

  /**
   * Get the optimal publish time for maximum reach in Thailand
   * Returns ISO string of the next prime-time slot
   */
  getOptimalPublishTime(preferredHour = null) {
    const now = new Date();
    // Convert to Thailand time (GMT+7)
    const thaiOffset = 7 * 60; // minutes
    const utcOffset = now.getTimezoneOffset(); // minutes (negative for ahead of UTC)
    const thaiTime = new Date(now.getTime() + (thaiOffset + utcOffset) * 60000);
    
    const currentHour = thaiTime.getHours();
    const dayOfWeek = thaiTime.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    const schedule = isWeekend ? PRIME_TIME_HOURS.weekend : PRIME_TIME_HOURS.weekday;
    
    // Find next available prime-time slot
    let targetSlot = null;

    if (preferredHour !== null) {
      targetSlot = schedule.find(s => s.hour === preferredHour);
    }

    if (!targetSlot) {
      // Find next slot with highest weight that's still in the future
      const futureSlots = schedule.filter(s => s.hour > currentHour);
      
      if (futureSlots.length > 0) {
        // Pick the highest weight future slot
        targetSlot = futureSlots.sort((a, b) => b.weight - a.weight)[0];
      } else {
        // All today's prime time has passed → schedule for tomorrow's best slot
        const tomorrowIsWeekend = (dayOfWeek + 1) % 7 === 0 || (dayOfWeek + 1) % 7 === 6;
        const tomorrowSchedule = tomorrowIsWeekend ? PRIME_TIME_HOURS.weekend : PRIME_TIME_HOURS.weekday;
        targetSlot = tomorrowSchedule.sort((a, b) => b.weight - a.weight)[0];
        
        // Move to tomorrow
        thaiTime.setDate(thaiTime.getDate() + 1);
      }
    }

    // Set the publish time
    thaiTime.setHours(targetSlot.hour, 0, 0, 0);
    
    // Convert back to UTC for YouTube API
    const publishTime = new Date(thaiTime.getTime() - (thaiOffset + utcOffset) * 60000);
    
    return publishTime.toISOString();
  }

  /**
   * Validate content for monetization eligibility
   * Returns warnings/blocks if content may be demonetized
   */
  validateForMonetization(tiktokData, title = '') {
    const issues = [];
    const text = ((tiktokData.desc || '') + ' ' + title).toLowerCase();
    const duration = tiktokData.duration || 0;

    // Check 1: Duration (YouTube prefers >1 min for mid-roll ads, >8 min ideal)
    if (duration > 0 && duration < 30) {
      issues.push({
        level: 'warning',
        code: 'SHORT_VIDEO',
        message: `วิดีโอสั้นมาก (${duration}s) — YouTube ชอบวิดีโอ >60 วินาที สำหรับ ad revenue`
      });
    } else if (duration >= 30 && duration < 60) {
      issues.push({
        level: 'info',
        code: 'MEDIUM_VIDEO',
        message: `วิดีโอ ${duration}s — เหมาะกับ YouTube Shorts (เข้า Shorts feed)`
      });
    }

    // Check 2: Risky keywords — hard blocks (illegal/policy violation) first
    let blocked = false;
    for (const keyword of MONETIZATION_RISK_KEYWORDS.block) {
      if (text.includes(keyword)) {
        issues.push({
          level: 'error',
          code: 'RISKY_CONTENT',
          message: `พบคำที่ผิดนโยบาย YouTube ชัดเจน: "${keyword}" — ห้ามอัปโหลด`
        });
        blocked = true;
        break;
      }
    }
    // Borderline/suggestive content — warn but don't hard-block (needs review)
    if (!blocked) {
      for (const keyword of MONETIZATION_RISK_KEYWORDS.warn) {
        if (text.includes(keyword)) {
          issues.push({
            level: 'warning',
            code: 'SUGGESTIVE_CONTENT',
            message: `พบคำที่เสี่ยง demonetize/reused-content policy: "${keyword}" — ควรตรวจสอบก่อนอัปโหลด`
          });
          break;
        }
      }
    }

    // Check 3: Title quality
    if (title.length < 10) {
      issues.push({
        level: 'warning',
        code: 'SHORT_TITLE',
        message: 'ชื่อวิดีโอสั้นเกินไป — YouTube SEO ต้องการ title ที่มีคำสำคัญ'
      });
    }

    // Check 4: No description
    if (!tiktokData.desc || tiktokData.desc.length < 10) {
      issues.push({
        level: 'info',
        code: 'NO_DESCRIPTION',
        message: 'ไม่มี description จาก TikTok — จะใช้ template แทน'
      });
    }

    // Overall verdict
    const hasErrors = issues.some(i => i.level === 'error');
    const hasWarnings = issues.some(i => i.level === 'warning');

    return {
      eligible: !hasErrors,
      status: hasErrors ? 'blocked' : hasWarnings ? 'warning' : 'ok',
      issues,
      recommendation: hasErrors
        ? 'ไม่แนะนำให้อัปโหลด — อาจถูก demonetize หรือ strike'
        : hasWarnings
          ? 'อัปโหลดได้ แต่ควรปรับปรุง metadata'
          : 'พร้อมอัปโหลด ✓'
    };
  }

  /**
   * Get category name by ID
   */
  getCategoryName(categoryId) {
    return YOUTUBE_CATEGORIES[categoryId] || 'People & Blogs';
  }

  /**
   * Get all available categories
   */
  getCategories() {
    return YOUTUBE_CATEGORIES;
  }

  // ==================== PRIVATE HELPERS ====================

  _getConfig() {
    const config = settings.load();
    return {
      privacy: config.privacy || 'public',
      defaultDescription: config.defaultDescription || '',
      defaultTags: config.defaultTags || '',
      titleTemplate: config.titleTemplate || '',
      channelDescription: config.channelDescription || '',
      seoMode: config.seoMode || 'auto' // auto, manual, disabled
    };
  }

  _cleanTikTokText(text) {
    if (!text) return '';

    // Remove hashtags (but keep for tag extraction)
    let cleaned = text.replace(/#[\w\u0E00-\u0E7Fа-яА-Я]+/g, '').trim();

    // Remove @mentions
    cleaned = cleaned.replace(/@[\w.]+/g, '').trim();

    // Remove filler words
    for (const filler of FILLER_WORDS) {
      const regex = new RegExp(`\\b${filler}\\b`, 'gi');
      cleaned = cleaned.replace(regex, '').trim();
    }

    // Remove multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Remove emoji clusters at start/end (keep in middle)
    cleaned = cleaned.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+/u, '');
    cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+$/u, '');

    return cleaned.trim();
  }

  _enhanceShortTitle(title, tiktokData) {
    // If title is too short, try to make it more descriptive
    const author = tiktokData.author || '';
    const category = this.detectCategory(tiktokData);
    
    if (!title && author) {
      return `คลิปจาก @${author}`;
    }

    if (title.length < 5) {
      const prefixes = ['ดูจบแล้วจะ...', 'ชอบมาก!', 'ว้าว!', 'เจ๋งมาก!'];
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      return title ? `${prefix} ${title}` : prefix;
    }

    return title;
  }

  _extractHashtags(text) {
    const matches = text.match(/#([\w\u0E00-\u0E7Fа-яА-Я]+)/g);
    if (!matches) return [];
    return matches
      .map(h => h.replace('#', '').toLowerCase())
      .filter(h => !FILLER_WORDS.includes(h) && h.length > 1);
  }

  _extractKeywords(text) {
    if (!text) return [];
    
    // Clean and split into words
    const cleaned = text
      .replace(/#[\w\u0E00-\u0E7Fа-яА-Я]+/g, '')
      .replace(/@[\w.]+/g, '')
      .replace(/[^\w\s\u0E00-\u0E7F]/g, ' ')
      .toLowerCase();

    const words = cleaned.split(/\s+/).filter(w => w.length > 2 && w.length < 25);
    
    // Remove common stop words
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'with', 'this', 'that', 'from', 'have', 'was', 'were', 'been', 'being']);
    return words.filter(w => !stopWords.has(w)).slice(0, 20);
  }

  _getCategoryTags(categoryId) {
    const keywords = CATEGORY_KEYWORDS[categoryId] || [];
    // Return a subset of category keywords as tags
    return keywords.slice(0, 5);
  }
}

module.exports = new SEOService();
