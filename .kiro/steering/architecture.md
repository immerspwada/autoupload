# Architecture Rules — YouTube Auto Uploader v2

## Project Overview

ระบบ YouTube Auto Uploader เป็น Node.js Express app ที่ทำงาน:
- อัปโหลดวิดีโอไป YouTube อัตโนมัติ (จาก folder หรือ drag-drop)
- ดาวน์โหลด TikTok แล้วอัปไป YouTube
- Queue system พร้อม retry + priority
- Scheduler + Folder Watcher
- Dashboard analytics
- Health monitoring

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

### Routes
- ห้ามเรียก `stats.save()` ตรง — ใช้ EventBus rule
- ห้ามเรียก `broadcast()` ตรง — ใช้ EventBus → Orchestrator
- Import `orchestrator` ไม่ใช่ `eventbus` (routes ไม่รู้จัก eventbus)

### Services
- Services emit ผ่าน EventEmitter ของตัวเอง (เช่น Queue)
- Orchestrator wire events จาก service → EventBus

### Frontend
- WebSocket message type ที่รับ: `queue:*`, `notification`, `dashboard:refresh`, `system:status`
- ห้ามเรียก API เพื่ออัปเดต stats — ให้ backend push ผ่าน WS

### Data Flow ที่ถูกต้อง
```
[User Action / Scheduler / Timer]
        ↓
    [Route / Service]
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
  └──────┴──────┴───────┴───────────┘
```
