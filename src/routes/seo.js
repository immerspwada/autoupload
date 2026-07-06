// SEO Routes — API สำหรับจัดการ SEO Optimization
// ★ ทุกเหตุการณ์ emit ผ่าน Orchestrator → EventBus
const express = require('express');
const router = express.Router();
const seoService = require('../services/seo');
const { settings } = require('../utils/store');
const logger = require('../utils/logger');

// Preview SEO metadata for a TikTok video (before uploading)
router.post('/preview', (req, res) => {
  const { desc, title, author, duration, hashtags, videoUrl } = req.body;

  const tiktokData = { desc, title, author, duration, videoUrl };
  const options = {
    schedulePublish: req.body.schedulePublish || false
  };

  try {
    const metadata = seoService.generateMetadata(tiktokData, options);
    res.json({
      success: true,
      metadata,
      categoryName: seoService.getCategoryName(metadata.categoryId)
    });
  } catch (error) {
    logger.error('SEO preview error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Generate just the title
router.post('/title', (req, res) => {
  const { desc, title, author } = req.body;
  const generated = seoService.generateTitle({ desc, title, author });
  res.json({ title: generated });
});

// Generate just tags
router.post('/tags', (req, res) => {
  const { desc, title, author } = req.body;
  const tags = seoService.generateTags({ desc, title, author });
  res.json({ tags });
});

// Detect category
router.post('/category', (req, res) => {
  const { desc, title } = req.body;
  const categoryId = seoService.detectCategory({ desc, title });
  res.json({
    categoryId,
    categoryName: seoService.getCategoryName(categoryId)
  });
});

// Get all YouTube categories
router.get('/categories', (req, res) => {
  res.json(seoService.getCategories());
});

// Get optimal publish time
router.get('/publish-time', (req, res) => {
  const preferredHour = req.query.hour ? parseInt(req.query.hour) : null;
  const publishAt = seoService.getOptimalPublishTime(preferredHour);
  res.json({
    publishAt,
    formatted: new Date(publishAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    timezone: 'Asia/Bangkok'
  });
});

// Validate content for monetization
router.post('/validate', (req, res) => {
  const { desc, title, duration } = req.body;
  const validation = seoService.validateForMonetization({ desc, duration }, title);
  res.json(validation);
});

// Get/Update SEO settings
router.get('/settings', (req, res) => {
  const config = settings.load();
  res.json({
    seoMode: config.seoMode || 'auto',
    titleTemplate: config.titleTemplate || '',
    channelDescription: config.channelDescription || '',
    defaultDescription: config.defaultDescription || '',
    defaultTags: config.defaultTags || '',
    autoSchedule: config.autoSchedule || false,
    preferredPublishHour: config.preferredPublishHour || null,
    categoryOverride: config.categoryOverride || null
  });
});

router.post('/settings', (req, res) => {
  const config = settings.load();
  const seoFields = ['seoMode', 'titleTemplate', 'channelDescription', 'defaultDescription',
    'defaultTags', 'autoSchedule', 'preferredPublishHour', 'categoryOverride'];

  for (const field of seoFields) {
    if (req.body[field] !== undefined) {
      config[field] = req.body[field];
    }
  }

  settings.save(config);
  res.json({ success: true, settings: config });
});

module.exports = router;
