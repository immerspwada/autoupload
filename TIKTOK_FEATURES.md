# 🚀 TikTok → YouTube Auto-Upload Features (โคตรเทพ)

## ✅ ฟีเจอร์ที่พัฒนาเสร็จแล้ว

### 1. 🎯 **SEO Auto-Optimization System**
- ✅ สร้าง title, description, tags อัตโนมัติจากข้อมูล TikTok
- ✅ เลือก YouTube category ที่เหมาะสมตามเนื้อหา (26 categories)
- ✅ คำนวณเวลาโพสต์ prime-time Thailand (19:00-21:00 เป็นช่วงดีสุด)
- ✅ รองรับ scheduled publishing (YouTube API publishAt)

### 2. 🔥 **Virality Scoring (0-100)**
- ✅ คำนวณจาก engagement ratios (like/view, comment/view, share/view)
- ✅ พิจารณาความใหม่ (คลิปใหม่ = โอกาสไวรัลสูง)
- ✅ แบ่งระดับ: viral (75+), hot (55+), decent (35+), low (<35)
- ✅ ใช้ในการเรียงลำดับผลลัพธ์ (คลิปดีขึ้นบน)
- ✅ batch upload จะอัปคลิป virality สูงก่อน (ถ้าล้มครึ่งทาง อย่างน้อยได้คลิปดี)

### 3. 🛡️ **Monetization Safety Check**
- ✅ ตรวจสอบคำต้องห้าม 2 ระดับ:
  - **BLOCK** (ผิดนโยบาย YouTube ชัดเจน): เซ็กส์, ยาเสพติด, ฆ่า, พนัน, ระเบิด
  - **WARN** (เสี่ยง demonetize): เซ็กซี่, ยั่ว, ขย่ม, thirst trap, onlyfans
- ✅ บล็อกอัตโนมัติก่อนอัปโหลด (ถ้าไม่ใช่ force mode)
- ✅ แสดง badge สถานะ: ✓ ok, ⚠️ warning, 🚫 blocked

### 4. 🔍 **Smart Discovery (3 โหมด)**
- ✅ **Search** — ค้นหาได้หลายคีย์เวิร์ดพร้อมกัน (สูงสุด 15 คำ)
- ✅ **Trending** — ดึงคลิปมาแรงตามภูมิภาค (TH, US, JP, KR)
- ✅ **Creator Tracking** — ติดตามครีเอเตอร์ดึงคลิปล่าสุด (@username)

### 5. 📊 **Provider Health Tracking**
- ✅ จำสถิติความสำเร็จของแต่ละ downloader (tikwm/ssstik/musicaldown)
- ✅ เรียงลำดับ provider ที่น่าเชื่อถือมากที่สุดก่อน
- ✅ API endpoint `/provider-stats` สำหรับดูสถานะ

### 6. 🚦 **Rate Limit Handling**
- ✅ Throttling 1.1s ระหว่าง tikwm requests (ป้องกัน rate limit)
- ✅ Pagination อัตโนมัติ (ถ้าได้ผลลัพธ์น้อยกว่าที่ขอ)
- ✅ Retry with backoff เมื่อโดน rate limit

### 7. 🎨 **Frontend UI**
- ✅ แสดง virality score badges (🔥 viral, 📈 hot, 👍 decent, 📉 low)
- ✅ แสดง monetization status badges (✓, ⚠️, 🚫)
- ✅ Tabs สำหรับสลับโหมด (Search/Trending/Creator)
- ✅ Preview SEO ก่อนอัปโหลด (💎 SEO button)
- ✅ ซ่อนปุ่มอัปโหลดสำหรับคลิป blocked
- ✅ ยืนยันก่อนอัปคลิปที่มี warning

### 8. 🔄 **Duplicate Detection**
- ✅ ตรวจสอบ TikTok video ID ก่อนอัปโหลด
- ✅ แสดงสถานะ "อัปแล้ว" + ลิงก์ YouTube
- ✅ ป้องกันอัปซ้ำ (409 Conflict)

### 9. 📝 **Event-Driven Architecture**
- ✅ ทุกการอัปโหลดผ่าน EventBus
- ✅ แยก stats tracking สำหรับ TikTok source
- ✅ WebSocket notification real-time

---

## 🎯 API Endpoints

### TikTok Routes (`/api/tiktok`)
```
POST   /search                   - ค้นหาคลิป (รองรับหลาย keywords)
GET    /trending?region=TH       - ดึงคลิป trending
GET    /creator/:username        - ดึงคลิปจากครีเอเตอร์
POST   /check-duplicate          - เช็คว่าอัปไปแล้วหรือยัง
POST   /download                 - ดาวน์โหลด (ไม่มีลายน้ำ)
POST   /download-and-upload      - ดาวน์โหลด + อัปอัตโนมัติ
POST   /batch-upload             - อัปหลายคลิปพร้อมกัน
GET    /progress                 - SSE stream สำหรับติดตาม batch
GET    /provider-stats           - สถานะความน่าเชื่อถือของ downloaders
GET    /files                    - รายการไฟล์ที่ดาวน์โหลดแล้ว
DELETE /files/:filename          - ลบไฟล์
```

### SEO Routes (`/api/seo`)
```
POST   /preview                  - พรีวิว SEO metadata
GET    /categories               - รายการ YouTube categories
POST   /validate                 - ตรวจสอบ monetization safety
```

---

## 📐 Architecture

### EventBus Flow
```
User Action / Scheduler
        ↓
Route (tiktok.js)
        ↓
SEO Service (validation + metadata)
        ↓
YouTube Service (upload)
        ↓
orchestrator.onUploadCompleted()
        ↓
EventBus.dispatch('upload:completed')
        ↓
Rules Engine
  ├── Update stats (with source: tiktok)
  ├── Refresh dashboard (WebSocket)
  ├── Send notification
  └── Register file hash
```

### 2 Upload Paths
1. **Direct Upload** — route จัดการเอง → emit เอง (`/download-and-upload`)
2. **Queue Upload** — Queue emit อัตโนมัติ → ห้าม emit ซ้ำ (`/batch-upload`)

---

## 🔧 Configuration

### Settings (data/settings.json)
```json
{
  "seoMode": "auto",           // "auto" | "seo" | "manual"
  "autoSchedule": false,       // true = โพสต์ช่วง prime-time อัตโนมัติ
  "titleTemplate": "",         // "{title}" | "{title} - {author}"
  "defaultDescription": "...",
  "defaultTags": "...",
  "channelDescription": "...",
  "privacy": "public"
}
```

---

## 📊 Virality Scoring Formula

```javascript
Score = (likeScore × 40%) + (commentScore × 15%) + (shareScore × 30%) + (recency × 15%) + (views × 10%)

Where:
- likeScore    = min(likeRate / 0.15, 1)      // 15% like rate = perfect
- commentScore = min(commentRate / 0.008, 1)  // 0.8% comment = perfect
- shareScore   = min(shareRate / 0.03, 1)     // 3% share rate = perfect
- recency      = [15pts ≤2d, 12pts ≤7d, 8pts ≤30d, 4pts ≤90d, 1pt older]
- views        = log10(views+1) / 7 × 10      // log scale bonus

Tiers:
- 75-100 = 🔥 viral  (อัปทันที!)
- 55-74  = 📈 hot    (โอกาสดี)
- 35-54  = 👍 decent (พอใช้ได้)
- 0-34   = 📉 low    (เสี่ยง)
```

---

## 🛡️ Monetization Policy

### Hard Blocks (ห้ามอัปโหลด)
- เนื้อหาทางเพศ: เซ็กส์, porn, nude, xxx
- ยาเสพติด: drug, weed, กัญชา, ยาบ้า
- ความรุนแรง: ฆ่า, kill, suicide, ระเบิด, ปืน
- พนัน: gambling, casino, แทงบอล, สล็อต

### Warnings (ควรระวัง)
- Suggestive content: เซ็กซี่, ยั่ว, ขย่ม, thirst
- Adult themes: onlyfans, ขายตัว, นวด, บิกินี่

**Enforcement:**
- `/download-and-upload` — บล็อกอัตโนมัติ (ถ้าไม่ pass `force=true`)
- `/batch-upload` — skip คลิปที่ blocked + แจ้งเหตุผล
- Frontend — ซ่อนปุ่มอัปโหลด + แสดง 🚫 badge

---

## 🎬 Example Usage

### 1. ค้นหาหลาย keywords
```javascript
POST /api/tiktok/search
{
  "keywords": ["แมวน่ารัก", "cooking tips", "เต้น"],
  "count": 12  // per keyword
}

Response:
{
  "videos": [
    {
      "id": "...",
      "desc": "...",
      "author": "@user",
      "likeCount": 50000,
      "playCount": 200000,
      "virality": { score: 82, tier: "viral" },
      "monetizationStatus": "ok",
      "alreadyUploaded": false
    }
  ],
  "perKeyword": [
    { "keyword": "แมวน่ารัก", "found": 12, "error": null }
  ]
}
```

### 2. ดึงคลิป Trending
```javascript
GET /api/tiktok/trending?region=TH&count=20
```

### 3. ติดตามครีเอเตอร์
```javascript
GET /api/tiktok/creator/catloversth?count=15
```

### 4. Batch upload (เรียงตาม virality)
```javascript
POST /api/tiktok/batch-upload
{
  "videos": [
    { 
      "videoUrl": "...", 
      "title": "...",
      "viralityScore": 85  // ← จะอัปก่อน
    },
    { 
      "videoUrl": "...", 
      "title": "...",
      "viralityScore": 42  // ← อัปทีหลัง
    }
  ]
}
```

---

## ✨ Key Improvements from Original

### Before (ระบบเดิม):
- ❌ ค้นหาได้แค่ 0-9 คลิป (rate limit + pagination ไม่มี)
- ❌ ไม่มี SEO — อัปแบบไม่มี description
- ❌ ไม่มีการตรวจสอบเนื้อหาเสี่ยง
- ❌ ไม่รู้ว่าคลิปไหนมีโอกาสไวรัล
- ❌ ไม่มี trending/creator discovery

### After (ระบบใหม่):
- ✅ pagination + throttling → ได้ครบทุกครั้ง
- ✅ SEO อัตโนมัติ — title/desc/tags/category/schedule
- ✅ บล็อกเนื้อหาเสี่ยงอัตโนมัติ (ป้องกัน demonetize/strike)
- ✅ virality scoring → เลือกคลิปดีอัปก่อน
- ✅ trending/creator → หาคลิปง่ายขึ้น ไม่ต้องคิด keyword

---

## 🚀 Next Steps (ถ้าต้องการเพิ่มเติม)

1. **Auto-scheduling** — อัปคลิปอัตโนมัติตาม prime-time calendar
2. **A/B testing** — ทดสอบหลาย title/thumbnail
3. **Analytics tracking** — วัดว่าคลิปไหนโกยเงินได้มากสุด
4. **Webhook integration** — รับ notification เมื่อมี viral clip ใหม่
5. **Multi-account** — จัดการหลาย YouTube channels

---

## 📝 Notes

- ระบบถูกออกแบบเพื่อเน้น **ค่าโฆษณา YouTube** เป็นหลัก
- ต้องผ่าน YPP (1,000 subscribers + 4,000 watch hours)
- หลีกเลี่ยง reused content / provocative content ที่ YouTube ไม่ชอบ
- ใช้ virality score เป็นตัววัดโอกาสแทน view count (view สูงไม่ได้แปลว่าดี)

---

**สร้างโดย:** Kiro AI Agent  
**วันที่:** 7 มกราคม 2026  
**สถานะ:** Production Ready ✅
