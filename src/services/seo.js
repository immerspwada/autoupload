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
const C      = require('../config/constants');
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

// ── Channel Growth Stages ──────────────────────────────────────────
// ระยะของช่อง กำหนด weight ในการคำนวณ opportunity score
// early_stage: <1000 subs → เน้น subscriber + watch time
// pre_ypp:     1000+ subs → เน้น watch hours ให้ครบ 4000
// monetized:   ผ่าน YPP แล้ว → เน้นรายได้ (default เดิม)
const CHANNEL_STAGES = {
  early_stage: { revenue: 0.15, follower: 0.50, watchTime: 0.35, label: 'เน้นผู้ติดตาม' },
  pre_ypp:     { revenue: 0.20, follower: 0.35, watchTime: 0.45, label: 'เน้น Watch Hours' },
  monetized:   { revenue: 0.36, follower: 0.32, watchTime: 0.32, label: 'เน้นรายได้' },
};

// Content types ที่ดีสำหรับ watch time สูง (คนดูจนจบ)
const WATCH_TIME_SIGNALS = {
  boost: [
    // Tutorial/How-to — คนดูจนจบเพราะรอคำตอบ
    'วิธี', 'สอน', 'tutorial', 'howto', 'how to', 'tips', 'เทคนิค', 'สูตร', 'recipe',
    // Story-driven — มี narrative ทำให้ดูจนจบ
    'เรื่องราว', 'ประสบการณ์', 'เล่า', 'เปิดเผย', 'ความจริง',
    // Series / episodic
    'ตอนที่', 'ep', 'part', 'series',
    // Challenge / transformation — รอดูผล
    'before after', 'challenge', 'transformation', 'เปลี่ยน',
    // List content — คนดูจนครบ list
    'อันดับ', 'top', 'ranking', '10 อย่าง', '5 วิธี',
  ],
  penalty: [
    // Dance-only ไม่มีเนื้อหา — คนออกเร็ว
    'lip sync', 'lipstick',
  ]
};

// VALUE_INTENTS + watch time weight
const FILLER_WORDS = ['fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'xyzbca', 'tiktok', '#'];

const VALUE_INTENTS = [
  {
    id: 'high_rpm',
    label: 'รายได้โฆษณาสูง',
    keywords: ['finance', 'ลงทุน', 'ประหยัดเงิน', 'ธุรกิจ', 'business', 'ai', 'tech', 'software', 'iphone', 'gadget', 'review', 'อสังหา', 'real estate', 'ประกัน', 'credit', 'บัตรเครดิต'],
    revenue: 30,
    follower: 8,
    seo: 18,
    angle: 'ทำเป็นคลิปให้ความรู้/รีวิวที่ตอบคำถามชัดเจน จะมีโอกาส RPM สูงกว่า entertainment ทั่วไป'
  },
  {
    id: 'howto',
    label: 'ค้นหาเจอระยะยาว',
    keywords: ['how to', 'howto', 'วิธี', 'สอน', 'tutorial', 'tips', 'เทคนิค', 'สูตร', 'recipe', 'ทำอาหาร', 'แก้ปัญหา', 'diy', 'learn', 'เรียน'],
    revenue: 18,
    follower: 16,
    seo: 30,
    angle: 'ตั้ง title แบบตอบปัญหา เช่น วิธี..., เทคนิค..., สูตร... เพื่อเก็บ search traffic ระยะยาว'
  },
  {
    id: 'trust_builder',
    label: 'สร้างผู้ติดตาม',
    keywords: ['routine', 'daily', 'vlog', 'review', 'before after', 'รีวิว', 'ลองใช้', 'เปรียบเทียบ', 'challenge', 'fitness', 'workout', 'skincare', 'makeup'],
    revenue: 12,
    follower: 28,
    seo: 12,
    angle: 'ใช้ CTA ให้ติดตามเพื่อดูตอนต่อไป/ผลลัพธ์จริง จะช่วยเปลี่ยน viewer เป็น subscriber'
  },
  {
    id: 'broad_viral',
    label: 'ไวรัลกว้าง',
    keywords: ['funny', 'ตลก', 'แมว', 'หมา', 'pet', 'animal', 'cute', 'น่ารัก', 'comedy', 'meme', 'travel', 'เที่ยว', 'street food'],
    revenue: 8,
    follower: 18,
    seo: 8,
    angle: 'เหมาะกับเพิ่ม reach และผู้ติดตาม แต่ควรเพิ่มบริบท/keyword เพื่อไม่ให้เป็น reused-content บางเกินไป'
  },
  {
    id: 'watch_time_builder',
    label: 'สะสม Watch Time',
    keywords: [
      // narrative / story — คนดูจนจบรอตอนจบ
      'เรื่องราว', 'เล่า', 'ประสบการณ์', 'ความจริง', 'เปิดเผย', 'เซอร์ไพรส์',
      // list / countdown — คนดูเพราะอยากรู้ครบ list
      'อันดับ', 'top', 'ranking', '10 อย่าง', '5 วิธี', '3 เหตุผล',
      // transformation / before-after — รอดูผล
      'transformation', 'before after', 'เปลี่ยน', 'ผลลัพธ์', 'กี่วัน',
      // series / episodic — ติดตามตอนต่อไป
      'ตอนที่', 'ep', 'part 1', 'part 2', 'series',
      // challenge — รอดูว่าทำได้ไหม
      'challenge', 'ทำได้ไหม', 'ลอง', 'ท้าทาย'
    ],
    revenue: 10,
    follower: 22,
    seo: 15,
    angle: 'คลิปประเภทนี้คนดูนานกว่าค่าเฉลี่ย — เพิ่ม hook ใน 5 วิแรกและ CTA กลางคลิปเพื่อดึงให้ดูจนจบ'
  }
];

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
    // ★ channelStage จาก options หรือ config (settings.json)
    const channelStage = options.channelStage || config.channelStage || 'early_stage';
    
    const title = this.generateTitle(tiktokData, config);
    const description = this.generateDescription(tiktokData, config, { channelStage });
    const tags = this.generateTags(tiktokData, config);
    const categoryId = this.detectCategory(tiktokData);
    const publishAt = options.schedulePublish ? this.getOptimalPublishTime() : null;
    const validation = this.validateForMonetization(tiktokData, title);
    const virality = this.calculateViralityScore(tiktokData);
    const quality = this.scoreMetadata({ title, description, tags, categoryId, validation, virality, tiktokData });

    return {
      title,
      description,
      tags,
      categoryId,
      publishAt,
      validation,
      virality,
      quality,
      privacy: publishAt ? 'private' : (config.privacy || 'public') // Private if scheduled
    };
  }

  /**
   * Score metadata quality so the UI can explain "why this is good/bad".
   * This is intentionally deterministic and transparent: every point maps to
   * a concrete YouTube packaging improvement the user can act on.
   */
  scoreMetadata({ title, description, tags, categoryId, validation, virality, tiktokData }) {
    const checks = [];
    let score = 100;

    const titleLength = title.length;
    if (titleLength < 25) {
      score -= 12;
      checks.push({ level: 'warning', code: 'TITLE_SHORT', message: 'Title ยังสั้นไป เพิ่ม keyword หรือบริบทอีกเล็กน้อย' });
    } else if (titleLength > 85) {
      score -= 8;
      checks.push({ level: 'info', code: 'TITLE_LONG', message: 'Title ยาวใกล้ชน limit อาจถูกตัดบนมือถือ' });
    } else {
      checks.push({ level: 'success', code: 'TITLE_OK', message: 'Title ยาวกำลังดีสำหรับ YouTube SEO' });
    }

    if (!description || description.length < 180) {
      score -= 10;
      checks.push({ level: 'warning', code: 'DESC_SHORT', message: 'Description ยังบางไป ควรมี keyword, CTA และบริบทเพิ่มเติม' });
    } else {
      checks.push({ level: 'success', code: 'DESC_OK', message: 'Description มีเนื้อหาพอให้ YouTube index' });
    }

    if (!Array.isArray(tags) || tags.length < 8) {
      score -= 10;
      checks.push({ level: 'warning', code: 'TAGS_FEW', message: 'Tags น้อยไป ควรมีอย่างน้อย 8-15 tags ที่เกี่ยวข้อง' });
    } else if (tags.length > 25) {
      score -= 3;
      checks.push({ level: 'info', code: 'TAGS_MANY', message: 'Tags เยอะมาก ตรวจว่าไม่กว้างเกินไป' });
    } else {
      checks.push({ level: 'success', code: 'TAGS_OK', message: 'จำนวน tags เหมาะสม' });
    }

    if (categoryId === 22 && this.detectCategory(tiktokData) === 22) {
      score -= 4;
      checks.push({ level: 'info', code: 'GENERIC_CATEGORY', message: 'Category เป็น People & Blogs เพราะจับหมวดเฉพาะไม่ได้' });
    } else {
      checks.push({ level: 'success', code: 'CATEGORY_OK', message: 'Category สอดคล้องกับ keyword ที่พบ' });
    }

    if (validation.status === 'blocked') {
      score = Math.min(score, 20);
      checks.push({ level: 'error', code: 'MONETIZATION_BLOCKED', message: 'มีความเสี่ยงนโยบายสูง ไม่ควรอัปโหลด' });
    } else if (validation.status === 'warning') {
      score -= 18;
      checks.push({ level: 'warning', code: 'MONETIZATION_WARNING', message: 'มีคำ/ลักษณะเสี่ยง ควรตรวจด้วยคนก่อนอัปโหลด' });
    }

    if ((virality?.score || 0) >= 75) {
      score += 5;
      checks.push({ level: 'success', code: 'VIRAL_SIGNAL', message: 'สัญญาณ virality สูง คุ้มกับ quota' });
    } else if ((virality?.score || 0) < 35) {
      score -= 8;
      checks.push({ level: 'info', code: 'LOW_VIRALITY', message: 'สัญญาณ virality ต่ำ ควรใช้ quota อย่างระวัง' });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const grade = score >= 85 ? 'excellent'
      : score >= 70 ? 'good'
      : score >= 50 ? 'needs_work'
      : 'risky';

    return {
      score,
      grade,
      checks,
      recommendation: this._qualityRecommendation(score, validation, virality)
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

    if (views < C.SEO.MIN_VIEWS_FOR_SCORE) {
      return { score: 0, tier: 'unknown', breakdown: { reason: `ยอดดูน้อยเกินไป (ต่ำกว่า ${C.SEO.MIN_VIEWS_FOR_SCORE}) ยังไม่มีข้อมูลพอประเมิน` } };
    }

    const likeRate    = likes    / views;
    const commentRate = comments / views;
    const shareRate   = shares   / views;

    const likeScore    = Math.min(likeRate    / C.SEO.LIKE_RATE_CEILING,    1) * 40;
    const commentScore = Math.min(commentRate / C.SEO.COMMENT_RATE_CEILING, 1) * 15;
    const shareScore   = Math.min(shareRate   / C.SEO.SHARE_RATE_CEILING,   1) * 30;

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
   * Score business opportunity before uploading.
   * รองรับ channelStage: 'early_stage' | 'pre_ypp' | 'monetized'
   * - early_stage: เน้น follower + watch time (ยังไม่ผ่าน YPP)
   * - pre_ypp:     เน้น watch time + follower (รอ 4000 ชม.)
   * - monetized:   เน้น revenue (default เดิม)
   */
  analyzeOpportunity(tiktokData, options = {}) {
    const channelStage = options.channelStage || 'monetized';
    const stageWeights = CHANNEL_STAGES[channelStage] || CHANNEL_STAGES.monetized;

    const text = [
      tiktokData.desc,
      tiktokData.title,
      ...(Array.isArray(tiktokData.matchedKeywords) ? tiktokData.matchedKeywords : [])
    ].filter(Boolean).join(' ').toLowerCase();

    const virality = tiktokData.virality || this.calculateViralityScore(tiktokData);
    const validation = tiktokData.validation || this.validateForMonetization(tiktokData, tiktokData.desc || tiktokData.title || '');
    const categoryId = this.detectCategory(tiktokData);
    const matchedIntents = VALUE_INTENTS
      .map(intent => {
        const hits = intent.keywords.filter(k => text.includes(k.toLowerCase()));
        return hits.length ? { ...intent, hits } : null;
      })
      .filter(Boolean);

    const views = tiktokData.playCount || 0;
    const engagementRate = ((tiktokData.likeCount || 0) + (tiktokData.commentCount || 0) + (tiktokData.shareCount || 0)) / Math.max(views, 1);
    const hasUsefulCaption = (tiktokData.desc || '').replace(/#[\w\u0E00-\u0E7Fа-яА-Я]+/g, '').trim().length >= 18;
    const hasHashtags = this._extractHashtags(tiktokData.desc || '').length >= 2;
    const duration = tiktokData.duration || 0;

    let revenue = 20;
    let follower = 20;
    let seo = 18;
    let watchTime = 20; // ★ ใหม่ — watch time potential score
    const reasons = [];
    const warnings = [];

    for (const intent of matchedIntents) {
      revenue += intent.revenue;
      follower += intent.follower;
      seo += intent.seo;
      reasons.push(`${intent.label}: ${intent.hits.slice(0, 3).join(', ')}`);
    }

    revenue  += Math.min((virality.score || 0) * 0.22, 18);
    follower += Math.min((virality.score || 0) * 0.35, 28);
    seo      += hasUsefulCaption ? 12 : -8;
    seo      += hasHashtags ? 6 : 0;
    follower += engagementRate >= 0.08 ? 12 : engagementRate >= 0.04 ? 7 : 0;
    revenue  += views >= 1000000 ? 10 : views >= 100000 ? 6 : views >= 10000 ? 3 : 0;

    // ★ Watch Time scoring
    // คลิปที่มี narrative/tutorial/list → คนดูนานกว่า
    const wtBoostHits = WATCH_TIME_SIGNALS.boost.filter(k => text.includes(k.toLowerCase()));
    const wtPenaltyHits = WATCH_TIME_SIGNALS.penalty.filter(k => text.includes(k.toLowerCase()));
    watchTime += Math.min(wtBoostHits.length * 10, 35);
    watchTime -= wtPenaltyHits.length * 8;

    // Duration bonus — ยิ่งนานยิ่งมี watch time สะสม (แต่ไม่นานเกินไป)
    if (duration >= 60)  { watchTime += 15; reasons.push('คลิปยาว ≥1 นาที — watch time สะสมได้มาก'); }
    else if (duration >= 30) { watchTime += 8; }
    else if (duration < 15 && duration > 0) { watchTime -= 10; warnings.push('คลิปสั้นมาก (<15s) watch time น้อย'); }

    // engagement = proxy สำหรับ completion rate
    watchTime += engagementRate >= 0.08 ? 12 : engagementRate >= 0.04 ? 6 : 0;

    // Tutorial/howto categories
    if ([26, 27, 28].includes(categoryId)) {
      revenue  += 10;
      seo      += 8;
      watchTime += 10; // tutorial categories → คนดูจนจบ
      reasons.push(`หมวด ${this.getCategoryName(categoryId)} เหมาะกับ search + watch time`);
    } else if ([15, 23, 24].includes(categoryId)) {
      follower += 8;
      reasons.push(`หมวด ${this.getCategoryName(categoryId)} เหมาะกับ reach และผู้ติดตาม`);
    }

    if (duration > 0 && duration < 20) {
      revenue  -= 8;
      seo      -= 5;
    } else if (duration >= 45) {
      revenue  += 5;
      seo      += 4;
    }

    if (options.alreadyUploaded || tiktokData.alreadyUploaded) {
      revenue  -= 30;
      follower -= 20;
      seo      -= 20;
      watchTime -= 20;
      warnings.push('เคยอัปแล้ว ไม่ควรใช้ quota ซ้ำ');
    }

    if (validation.status === 'blocked') {
      revenue = Math.min(revenue, 8);
      follower = Math.min(follower, 12);
      seo = Math.min(seo, 8);
      watchTime = Math.min(watchTime, 8);
      warnings.push('มีความเสี่ยงนโยบายสูง ไม่เหมาะกับ monetization');
    } else if (validation.status === 'warning') {
      revenue  -= 18;
      seo      -= 8;
      warnings.push('มีคำเสี่ยง demonetize ควรปรับ metadata หรือข้าม');
    }

    revenue   = this._clampScore(revenue);
    follower  = this._clampScore(follower);
    seo       = this._clampScore(seo);
    watchTime = this._clampScore(watchTime);

    // ★ Weight ตาม channel stage
    const score = Math.round(
      (revenue  * stageWeights.revenue)  +
      (follower * stageWeights.follower) +
      (watchTime * stageWeights.watchTime)
    );

    const tier = score >= 82 ? 'premium'
      : score >= 68 ? 'growth'
      : score >= 52 ? 'test'
      : 'skip';

    const primaryIntent = matchedIntents[0] || null;
    return {
      score,
      tier,
      revenue,
      follower,
      seo,
      watchTime,
      channelStage,
      stageLabel: stageWeights.label,
      intent: primaryIntent ? primaryIntent.label : 'ทั่วไป',
      angle: primaryIntent ? primaryIntent.angle : this._defaultOpportunityAngle(categoryId, virality, channelStage),
      reasons: reasons.slice(0, 4),
      warnings: warnings.slice(0, 3),
      recommendedAction: this._opportunityRecommendation(score, validation, channelStage)
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
  generateDescription(tiktokData, config = null, options = {}) {
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

    // Add engagement CTA — ปรับตาม channelStage
    const stage = options?.channelStage || config.channelStage || 'early_stage';
    if (stage === 'early_stage') {
      parts.push('👍 ถ้าชอบคลิปนี้ กด Subscribe เพื่อดูคลิปแบบนี้ทุกวัน — ฟรี!');
      parts.push('🔔 กดกระดิ่ง เพื่อไม่พลาดทุกคลิปใหม่ที่อัปโหลดทุกวัน');
      parts.push('💬 Comment บอกด้วยว่าอยากดูเนื้อหาแบบไหน!');
    } else if (stage === 'pre_ypp') {
      parts.push('📌 กดไลค์ กดติดตาม — ช่วยให้ช่องเติบโตและสร้างคอนเทนต์ต่อไปได้!');
      parts.push('🔔 กดกระดิ่งเพื่อรับการแจ้งเตือนวิดีโอใหม่');
    } else {
      parts.push('📌 กดไลค์ กดแชร์ กดติดตาม เพื่อไม่พลาดคลิปใหม่ทุกวัน!');
      parts.push('🔔 กดกระดิ่งเพื่อรับการแจ้งเตือนวิดีโอใหม่');
    }
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

  _qualityRecommendation(score, validation, virality) {
    if (validation.status === 'blocked') return 'ไม่ควรอัปโหลดจนกว่าจะแก้ความเสี่ยงด้านนโยบาย';
    if (score >= 85) return 'พร้อมอัปโหลด เหมาะกับการใช้ quota';
    if ((virality?.score || 0) >= 75 && score >= 70) return 'คลิปแรง ควรอัปโหลด แต่ตรวจ metadata อีกครั้งก่อนเผยแพร่';
    if (score >= 70) return 'ใช้ได้ ควรปรับรายละเอียดเล็กน้อยเพื่อเพิ่ม SEO';
    if (score >= 50) return 'ควรปรับ title/description/tags ก่อนใช้ quota';
    return 'ยังไม่คุ้ม quota แนะนำเลือกคลิปอื่นหรือปรับ metadata มากขึ้น';
  }

  _clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  _defaultOpportunityAngle(categoryId, virality, channelStage = 'monetized') {
    if (channelStage === 'early_stage') {
      if ([26, 27, 28].includes(categoryId)) return 'คลิป tutorial/howto ดีมากสำหรับช่องใหม่ — คนดูนานและมักติดตามเพื่อดูตอนต่อไป';
      if ((virality?.score || 0) >= 75) return 'คลิปแรงมาก — เพิ่ม CTA "กด Subscribe เพื่อดูคลิปแบบนี้ทุกวัน" ท้ายคลิป';
      return 'ช่วงเริ่มต้น: เลือกคลิปที่มี hook ชัด (5 วิแรก) และ CTA ให้ติดตามท้ายคลิปทุกอัน';
    }
    if (channelStage === 'pre_ypp') {
      if (duration >= 60) return 'คลิปยาว ≥1 นาที สะสม watch hours ได้เร็ว — เป็นสิ่งที่ต้องการตอนนี้ก่อน YPP';
      return 'ต้องการ watch hours — เน้นอัปคลิป >45 วินาที และ tutorial ที่คนดูจนจบ';
    }
    if ((virality?.score || 0) >= 75) return 'คลิปแรง ควรอัปในช่วง prime time พร้อม SEO เต็ม';
    if ([26, 27, 28].includes(categoryId)) return 'เพิ่มคำถาม/วิธีทำใน title เพื่อให้ค้นหาเจอระยะยาว';
    return 'เพิ่มบริบทและ keyword ใน description เพื่อให้ YouTube เข้าใจคลิปมากขึ้น';
  }

  _opportunityRecommendation(score, validation, channelStage = 'monetized') {
    if (validation.status === 'blocked') return 'ข้ามคลิปนี้เพื่อป้องกันเสียช่องหรือรายได้';
    if (validation.status === 'warning') return 'ตรวจด้วยคนก่อนอัป และปรับคำเสี่ยงใน title/description';
    if (channelStage === 'early_stage') {
      if (score >= 82) return 'คลิปนี้ดีมากสำหรับช่องใหม่ — มีโอกาสสร้างผู้ติดตามสูง อัปได้เลย';
      if (score >= 68) return 'เหมาะกับการโตช่อง — เพิ่ม CTA ให้ subscribe ท้ายคลิป';
      if (score >= 52) return 'ใช้ได้ แต่หาคลิปที่มี hook และ narrative ชัดกว่า';
      return 'score ต่ำ — ช่วงเริ่มต้นควรเลือกคลิปที่มีโอกาสสร้าง subscriber สูงกว่านี้';
    }
    if (channelStage === 'pre_ypp') {
      if (score >= 82) return 'คลิปนี้ช่วยสะสม watch hours ได้ดีมาก — อัปได้เลย';
      if (score >= 68) return 'ดี — เน้นอัปช่วง 19-21 น. ให้ได้ views เร็ว = watch hours เร็ว';
      return 'หาคลิปที่ยาวกว่าหรือมี tutorial เพื่อสะสม watch hours ให้เร็วขึ้น';
    }
    if (score >= 82) return 'คลิปมูลค่าสูง ควรอัปในช่วง prime time พร้อม SEO เต็ม';
    if (score >= 68) return 'เหมาะกับการโตช่อง เลือกได้ถ้า quota ยังพอ';
    if (score >= 52) return 'ใช้ทดสอบได้ แต่ควรปรับ SEO ก่อนอัป';
    return 'ยังไม่คุ้ม quota หา candidate ที่เจตนา/engagement ชัดกว่านี้';
  }
}

module.exports = new SEOService();
