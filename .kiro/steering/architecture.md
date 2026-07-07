# Architecture Rules — YouTube Auto Uploader v2

## 🎯 Project Goal — PRIMARY OBJECTIVE

**สร้างรายได้จาก YouTube Ad Revenue (Monetization)** 💰

ทุกฟีเจอร์และการตัดสินใจต้องมุ่งเน้น:
1. **ผ่าน YouTube Partner Program (YPP)** — 1,000 subscribers + 4,000 watch hours
2. **ป้องกัน Demonetization/Strike** — หลีกเลี่ยงเนื้อหาเสี่ยง/ผิดนโยบาย
3. **เพิ่ม Watch Time** — คลิปที่มีโอกาสไวรัลสูง = ดูนาน = รายได้เพิ่ม
4. **SEO Optimization** — ให้คลิปโผล่ search/recommended = views เพิ่ม = รายได้เพิ่ม

### ⚠️ ข้อควรระวัง:
- ❌ **Reused Content** — YouTube ไม่ชอบคลิปที่ copy มาตรงๆ (ต้อง add value)
- ❌ **Provocative/Sexual Content** — demonetize ทันที
- ❌ **Copyright Strike** — 3 strikes = channel ถูกปิด
- ❌ **YouTube API Quota Limit** — 10,000 units/day (free tier) = 6 uploads/day max
  - แต่ละ upload = 1,600 units
  - เกิน quota = ต้อรอ 24 ชม. (reset เที่ยงคืน PST)
  - 💡 ขอ extended quota ได้ถึง 1M+ units/day ผ่าน Google Cloud Console
- ✅ **Original Commentary/Compilation/Transformation** — ผ่านได้

---

## Project Overview

ระบบ YouTube Auto Uploader เป็น Node.js Express app ที่ทำงาน:
- 🎵 **ดาวน์โหลด TikTok** แล้วอัปไป YouTube (no watermark) — **ฟีเจอร์หลัก**
- 💎 **SEO Auto-Optimization** — title/description/tags/category/schedule อัตโนมัติ
- 🛡️ **Monetization Safety Check** — บล็อกเนื้อหาเสี่ยงก่อนอัปโหลด
- 🔥 **Virality Scoring** — เลือกคลิปที่มีโอกาสไวรัลสูงอัปก่อน
- 📂 อัปโหลดวิดีโอไป YouTube อัตโนมัติ (จาก folder หรือ drag-drop)
- 🔄 Queue system พร้อม retry + priority
- ⏰ Scheduler + Folder Watcher
- 📊 Dashboard analytics
- 🏥 Health monitoring

## Directory Structure

```
server.js                    — Entry point (Express + WebSocket + Orchestrator init)
src/
├── services/
│   ├── eventbus.js          — ★ Central Event Bus + Rules Engine
│   ├── orchestrator.js      — ★ Wires all services ↔ EventBus
│   ├── queue.js             — Upload queue (retry, priority, concurrency)
│   ├── scheduler.js         — Auto-scan folder + watcher
│   ├── youtube.js           — OAuth + YouTube upload
│   ├── tiktok.js            — TikTok search + download (no watermark)
│   └── health.js            — System monitoring + duplicate detection + cleanup
├── routes/
│   ├── auth.js              — OAuth routes
│   ├── files.js             — File listing + settings + history
│   ├── upload.js            — Upload routes (single/all/drop)
│   ├── stats.js             — Dashboard + scheduler config
│   ├── tiktok.js            — TikTok search/download/batch
│   └── health.js            — Health check + cleanup + logs
├── middleware/
│   ├── errorHandler.js      — Global error + 404
│   └── requestLogger.js     — HTTP request logging
└── utils/
    ├── logger.js            — File-based logging with rotation
    └── store.js             — JSON data store with atomic writes + cache
public/
├── index.html               — SPA with tabs
├── app.js                   — Frontend logic + WebSocket
└── style.css                — Dark theme CSS with variables
data/
├── settings.json            — User settings
├── uploads.json             — Upload history
├── stats.json               — Analytics data
├── scheduler.json           — Scheduler config
└── hashes.json              — File hash registry (duplicate detection)
```

---

## ★ กฎเหล็ก: กระบวนการ Event Flow

### หลักการสำคัญ

1. **ทุกเหตุการณ์ต้อง dispatch ผ่าน EventBus เท่านั้น** — ห้าม update stats/dashboard/notification ตรง
2. **ห้าม duplicate emit** — ถ้าผ่าน Queue path แล้ว ห้าม emit ซ้ำใน route
3. **Routes ต้อง emit ผ่าน `orchestrator.*()` methods** — ไม่ import eventbus ตรง
4. **ทุกฟีเจอร์ใหม่ต้องเพิ่ม rule** ใน `eventbus.js` → `_setupDefaultRules()`

### 2 กระบวนการอัปโหลด (ห้ามสับสน)

#### Path A: Direct Upload (route จัดการเอง → emit เอง)
```
Route (/single, /drop, tiktok/download-and-upload)
  → YouTube API
  → บันทึก uploads.json
  → orchestrator.onUploadCompleted()    ← ★ emit ที่นี่
  → EventBus rules ทำงาน (stats, dashboard, notification)
```

#### Path B: Queue Upload (Queue emit ให้อัตโนมัติ → ห้าม emit ซ้ำ)
```
Route (/all, scheduler._queueFile)
  → uploadQueue.add(task)
  → Queue ประมวลผล task
  → Queue emit 'completed' / 'failed'
  → Orchestrator._wireQueue() จับ event
  → eventBus.dispatch('upload:completed')  ← ★ อัตโนมัติ
  → EventBus rules ทำงาน (stats, dashboard, notification)
```

**★ กฎสำคัญ: ใน task function ของ Queue path → ห้ามเรียก `orchestrator.onUploadCompleted()`**
เพราะ Queue จะ emit `completed` event ให้แล้ว ถ้า emit ซ้ำจะนับ stats 2 ครั้ง

---

## 🎯 Monetization Strategy

### 🚨 YouTube API Quota Management (ปัญหาหลักที่ต้องจัดการ)

**YouTube API Quota Limit:**
- Free tier: 10,000 units/day
- Video upload: 1,600 units each
- **Maximum uploads/day: 6 videos** (10,000 / 1,600 = 6.25)
- Reset: Midnight PST (UTC-8) ทุกวัน
- เกิน quota → ต้อรอ 24 ชม. ถึงจะอัปได้ใหม่

**กลยุทธ์จัดการ Quota:**
1. **เลือกอัปเฉพาะคลิปดีที่สุด** (virality score 75+)
2. **ใช้ quota อย่างชาญฉลาด**:
   - เช้า: อัป 2-3 คลิป (prime-time prep)
   - เย็น: อัป 2-3 คลิป (peak traffic)
   - ไม่อัปคลิป low virality (<35) ถ้า quota เหลือน้อย
3. **Monitor quota real-time**:
   - Dashboard แสดงสถานะ quota (used/remaining/%)
   - เตือนเมื่อใช้ quota > 80%
   - บล็อกการอัปโหลดเมื่อเกิน limit
4. **Extended Quota Request**:
   - สมัครขอเพิ่ม quota ถึง 1M+ units/day
   - ไปที่ Google Cloud Console → YouTube Data API v3 → Quotas
   - อธิบายว่าทำไมต้องใช้ quota สูง (monetization business)

**Quota Costs (สำหรับอ้างอิง):**
- Video upload: 1,600 units
- Video list: 1 unit
- Search: 100 units
- Channel info: 1 unit

### Content Quality Priorities (เรียงตามความสำคัญ)
1. **High Virality Score (75+)** — โอกาสดู/แชร์สูง = watch time สูง = รายได้สูง
2. **Safe for Monetization (✓)** — ผ่านเกณฑ์ YouTube policies
3. **Recent Content (<7 days)** — ยังไวรัลอยู่ = มีโอกาสโผล่ trending
4. **High Engagement Ratio** — like/comment/share rate สูง = audience quality ดี

### Risk Management
```javascript
// Monetization risk levels (ใน seo.js)
RISK_KEYWORDS = {
  block: [...],  // ห้ามอัปโหลด — ผิดนโยบายชัดเจน
  warn: [...]    // เสี่ยง — ให้ user ตัดสินใจเอง
}

// Enforcement points (ใน tiktok.js)
1. /download-and-upload → บล็อกถ้า status='blocked'
2. /batch-upload → skip คลิป blocked อัตโนมัติ
3. Frontend → ซ่อนปุ่มอัปโหลดสำหรับคลิป blocked
```

### SEO Best Practices (บังคับใช้ใน seo.js)
- Title: ≤100 chars, มีคำสำคัญ, capitalize first letter
- Description: มี CTA + hashtags + source credit + disclaimer
- Tags: รวม hashtags + category keywords + trending terms (≤450 chars total)
- Category: auto-detect จาก content (26 YouTube categories)
- Schedule: prime-time Thailand (19:00-21:00 weekday = weight 10)

### Analytics Tracking
- แยก stats สำหรับ source='tiktok' (ใน EventBus rules)
- Track virality score distribution
- Monitor blocked/warned content ratio
- Compare upload time vs. performance

---

## 📝 Development Guidelines

### เมื่อเพิ่ม/แก้ฟีเจอร์ TikTok:
1. ✅ เรียก `seoService.validateForMonetization()` ก่อน upload
2. ✅ เรียก `seoService.calculateViralityScore()` สำหรับ sorting/display
3. ✅ เรียก `seoService.generateMetadata()` สำหรับ auto-SEO
4. ✅ Check duplicate ก่อน upload (ป้องกันซ้ำ)
5. ✅ Emit events ผ่าน orchestrator (ไม่ใช่ eventbus ตรง)
6. ✅ Track provider stats (reliability)
7. ✅ Handle rate limits (throttling)

### เมื่อเพิ่มฟีเจอร์อื่นๆ:
- ถาม: ฟีเจอร์นี้ช่วยเพิ่มรายได้ได้ยังไง?
- ถ้าไม่ช่วย → ลำดับความสำคัญต่ำ → ทำหลังจากฟีเจอร์หลักเสร็จ

---

## 🚀 Success Metrics (วัดผลสำเร็จ)

### Primary (รายได้):
- YouTube AdSense earnings per month
- RPM (Revenue per 1000 views)
- Watch time (hours)
- Subscriber growth rate

### Secondary (คุณภาพ):
- Average view duration %
- Click-through rate (CTR)
- Engagement rate (likes/comments/shares)
- Demonetization/strike count (ต้องเป็น 0)

### Operational (ประสิทธิภาพ):
- Upload success rate
- Average virality score of uploaded content
- Blocked content ratio (ควร <5%)
- Time saved per upload (automation efficiency)

---
  → eventBus.dispatch('upload:completed')  ← ★ อัตโนมัติ
  → EventBus rules ทำงาน (stats, dashboard, notification)
```

**★ กฎสำคัญ: ใน task function ของ Queue path → ห้ามเรียก `orchestrator.onUploadCompleted()`**
เพราะ Queue จะ emit `completed` event ให้แล้ว ถ้า emit ซ้ำจะนับ stats 2 ครั้ง

---

## Event Naming Convention

รูปแบบ: `domain:action`

| Domain | Events |
|--------|--------|
| upload | `upload:completed`, `upload:failed`, `upload:retry`, `upload:duplicate_detected` |
| queue | `queue:drain`, `queue:progress`, `queue:auto_pause` |
| scheduler | `scheduler:files_found`, `scheduler:check_start`, `scheduler:pause`, `scheduler:restart_watcher` |
| tiktok | `tiktok:downloaded` |
| auth | `auth:login`, `auth:logout` |
| settings | `settings:updated` |
| health | `health:status_changed`, `health:cleanup`, `health:register_hash` |
| notification | `notification:send` |
| dashboard | `dashboard:refresh` |
| stats | `stats:increment` |

---

## Rules Priority (ลำดับความสำคัญ)

| Priority | ประเภท | ตัวอย่าง |
|----------|--------|----------|
| **20** | Security / Blocking | Duplicate detection → block upload |
| **15** | Critical system safety | Health critical → auto-pause queue |
| **10** | Core data propagation | Upload success → stats + dashboard + hash |
| **8** | Settings propagation | Settings changed → restart watcher |
| **5** | Notifications & info | Queue done → summary, TikTok → notify |

---

## กฎการเพิ่มฟีเจอร์ใหม่ (Checklist)

เมื่อเพิ่มฟีเจอร์ใหม่ ต้องทำ:

- [ ] ตั้งชื่อ event ตามรูปแบบ `domain:action`
- [ ] เพิ่ม rule ใน `eventbus.js` → `_setupDefaultRules()`
- [ ] กำหนด priority ตามตาราง
- [ ] เพิ่ม method ใน `orchestrator.js` ถ้า route ต้อง emit
- [ ] Wire reaction ใน `orchestrator.js` ถ้าต้องเชื่อมกับ service อื่น
- [ ] ตรวจว่าไม่ duplicate emit (ถ้าผ่าน Queue = ห้าม emit ซ้ำ)
- [ ] ตรวจว่าทุก success path มี emit
- [ ] ตรวจว่าทุก error path มี emit (onUploadFailed)
- [ ] อัปเดต event list ในไฟล์นี้

---

## กฎการเขียนโค้ด

### 🎯 Monetization-First Approach (ทุกฟีเจอร์ต้องคิดถึงรายได้)

เมื่อเพิ่มฟีเจอร์ใหม่ ถามตัวเองก่อน:
1. **ฟีเจอร์นี้ช่วยเพิ่ม watch time ไหม?** (เช่น เลือกคลิปดี = คนดูจบ = retention สูง)
2. **ฟีเจอร์นี้ช่วยลด demonetization risk ไหม?** (เช่น content filter)
3. **ฟีเจอร์นี้ช่วย SEO ไหม?** (เช่น auto-tags, category detection)
4. **ฟีเจอร์นี้ช่วยประหยัดเวลา/เพิ่มปริมาณอัปโหลดไหม?** (เช่น batch upload)

ถ้าตอบไม่ได้ → ลำดับความสำคัญต่ำ

### Routes
- ห้ามเรียก `stats.save()` ตรง — ใช้ EventBus rule
- ห้ามเรียก `broadcast()` ตรง — ใช้ EventBus → Orchestrator
- Import `orchestrator` ไม่ใช่ `eventbus` (routes ไม่รู้จัก eventbus)
- **TikTok routes ต้องเรียก SEO service ก่อนอัปโหลดทุกครั้ง** (เว้น force mode)

### Services
- Services emit ผ่าน EventEmitter ของตัวเอง (เช่น Queue)
- Orchestrator wire events จาก service → EventBus
- **SEO Service** — ต้องถูกเรียกก่อนทุก TikTok upload เพื่อ:
  - Generate metadata ที่ SEO-friendly
  - Validate monetization safety
  - Calculate virality score
- **TikTok Service** — ต้อง:
  - Track provider stats (reliability)
  - Handle rate limiting (1.1s throttle)
  - Return complete video data (engagement metrics) สำหรับ virality scoring

### Frontend
- WebSocket message type ที่รับ: `queue:*`, `notification`, `dashboard:refresh`, `system:status`
- ห้ามเรียก API เพื่ออัปเดต stats — ให้ backend push ผ่าน WS
- **TikTok UI ต้องแสดง:**
  - Virality score badge (🔥/📈/👍/📉) — ให้ user เลือกคลิปดีก่อน
  - Monetization status badge (✓/⚠️/🚫) — ป้องกันอัปคลิปเสี่ยง
  - SEO preview (💎 button) — ให้ user เห็นว่า metadata จะเป็นยังไง
- **ห้ามให้อัปโหลดคลิป blocked** — ซ่อนปุ่ม/disable

### Data Flow ที่ถูกต้อง (Monetization-Aware)
```
[User Action / Scheduler / Timer]
        ↓
    [Route / Service]
        ↓
  ★ SEO Service ★ (validation + metadata)
        │
        ├─ monetization check (block/warn/ok)
        ├─ virality scoring (0-100)
        └─ metadata generation (title/desc/tags/category)
        ↓
  [If blocked → return 422, else continue]
        ↓
  orchestrator.onXxx()  หรือ  service.emit()
        ↓
    [EventBus.dispatch()]
        ↓
    [Rules Engine จับ]
        ↓
  ┌──────┬──────┬───────┬───────────┐
  │Stats │Notify│Health │Dashboard  │
  │update│(WS)  │action │refresh(WS)│
  │(track│      │       │(show      │
  │source│      │       │virality)  │
  │=tiktok)     │       │           │
  └──────┴──────┴───────┴───────────┘
```
