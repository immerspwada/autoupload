# Implementation Plan: Autonomous Upload Engine

## Overview

แผนงาน 6 เฟสสำหรับสร้าง Engine ที่ทำงาน 24/7 บน Fly.io ทั้งหมด 31 task โดยเฟส 1–4 คือ MVP ที่ deploy ได้จริง เฟส 5–6 คือ polish

## Task Dependency Graph

```json
{
  "waves": [
    { "id": "wave1", "tasks": [1, 2], "description": "Engine skeleton + state store" },
    { "id": "wave2", "tasks": [3, 5, 6, 7, 8], "description": "Supervisor + sub-components" },
    { "id": "wave3", "tasks": [4, 9], "description": "Recovery + cycle runner" },
    { "id": "wave4", "tasks": [10], "description": "In-flight safety" },
    { "id": "wave5", "tasks": [11, 12, 13], "description": "Detach scheduler + orchestrator" },
    { "id": "wave6", "tasks": [14, 15], "description": "Wire server + steering doc" },
    { "id": "wave7", "tasks": [16, 17, 18, 19], "description": "API routes + WS" },
    { "id": "wave8", "tasks": [20, 21, 22, 23, 24, 25, 26], "description": "Fly.io deploy" },
    { "id": "wave9", "tasks": [27, 28], "description": "Testing + docs" },
    { "id": "wave10", "tasks": [29, 30, 31], "description": "Future monitoring + UI" }
  ]
}
```

**Visual dependency flow:**
```
Phase 1 (Engine Core):
  [1] Engine skeleton ──→ [2] State store ──→ [3] Supervisor tick
                                              ↓
  [5] Quota Coordinator ←── [3] ──→ [4] Recovery on boot
  [6] Pacing Planner ←──── [3]
  [7] Safety Gate ←──────── [3]
  [8] Retention Manager ←── [3]
                              ↓
  [5,6,7,8] ──→ [9] _runCycle() ──→ [10] In-flight safety

Phase 2 (Integration):
  [9,10] ──→ [11] Detach scheduler loop
  [9,10] ──→ [12] Orchestrator methods ──→ [13] EventBus rules
  [11,12,13] ──→ [14] Wire to server.js ──→ [15] Update steering doc

Phase 3 (API):
  [14] ──→ [16] Engine routes ──→ [17] Mount routes
  [14] ──→ [18] WS broadcast
  [14] ──→ [19] Health/ready update

Phase 4 (Deploy):
  [17,18,19] ──→ [20] fly.toml
  [20] ──→ [21] Dockerfile ──→ [22] .dockerignore
  [20] ──→ [23] Production guards
  [20] ──→ [24] Backup cron
  [20] ──→ [25] Suspension detection

Phase 5 (Cleanup):
  [21] ──→ [26] Remove puppeteer
  [all] ──→ [27] Smoke tests
  [20,21] ──→ [28] Deploy script/docs

Phase 6 (Future):
  [3] ──→ [29] Stuck detection
  [29] ──→ [30] Webhook alerts
  [16] ──→ [31] Dashboard UI panel
```

## Tasks

### Phase 1: Engine Core + State Machine

- [x] 1. สร้าง `src/services/engine.js` — class skeleton พร้อม state enum, transition table (Map<string, Set<string>>), `_transitionTo()` method ที่ validate + persist + dispatch
- [x] 2. สร้าง `data/engine_state.json` store instance ใน `src/utils/store.js` พร้อม default state และ schema validation
- [x] 3. Implement Supervisor tick (`setInterval`) — อ่าน state, เทียบ `desiredState` vs `phase`, ตัดสินใจ action, บันทึก `lastTickAt`
- [x] 4. Implement `_recoverOnBoot()` — อ่าน persisted state, map `discovering`/`uploading` → `idle`, validate `nextActionAt`, reconcile `inFlight`
- [x] 5. Implement Quota Coordinator — wrap `quotaRotator.rotateIfNeeded()`, compute earliest reset (DST-safe via `Intl.DateTimeFormat`), handle 403 reconciliation
- [x] 6. Implement Pacing Planner — 8-slot generator, distribution by priority, `canUploadNow()`, `recordUpload()`, mid-day recompute, day-boundary handling
- [x] 7. Implement Safety Gate — monetization + duplicate + score + transform-mandatory, circuit breaker (40% blocked), no-force invariant
- [x] 8. Implement Retention Manager — post-cycle cleanup, disk guard loop (check→cleanup→recheck×2→paused_health), archive `uploads.json` > 5000, trim hashes, log rotation
- [x] 9. Implement `_runCycle()` — full flow: retention → diskGuard → pacing → quota → discovery → gate → transform → queue → wait drain → summarize
- [x] 10. Implement in-flight upload safety — reserve→upload→record write ordering, startup reconciliation via `videos.list` / `playlistItems.list`

## Phase 2: Integration with Existing Services

- [x] 11. แก้ `scheduler.js` — ลบ `runWatchlist()` chain จาก `scan()`, ลบ `_startContinuousLoop()` call, เก็บ folder scan + watcher เดิม
- [x] 12. เพิ่ม orchestrator methods — `onEngineStateChanged()`, `onEngineCycleStarted()`, `onEngineCycleCompleted()`, `onEngineDegraded()`, `onEngineStuck()`, `onEngineBlocked()`, `onEngineQuotaWait()`
- [x] 13. เพิ่ม EventBus rules สำหรับ `engine:*` events — priority 15 (degraded/stuck/blocked), 5 (state_changed/cycle/quota_wait), notification + activity log
- [x] 14. Wire Engine เข้า `server.js` — `engine.init(broadcast)` หลัง orchestrator, autoStartOnBoot logic, shutdown hook (flush inFlight)
- [x] 15. อัปเดต `.kiro/steering/architecture.md` — เพิ่ม `engine:*` events ในตาราง, เพิ่ม Engine ใน directory structure

## Phase 3: API + Dashboard

- [x] 16. สร้าง `src/routes/engine.js` — GET /status, POST /start, POST /stop, POST /pause (auth + rate limit)
- [x] 17. mount route ใน `server.js` — `app.use('/api/engine', require('./src/routes/engine'))`
- [x] 18. เพิ่ม WebSocket broadcast `engine:status` — ทุกครั้งที่ state เปลี่ยน + ทุก tick (throttled)
- [x] 19. เพิ่ม Engine status ใน `/api/health/ready` — รายงาน persistence evidence (data/ writable, account count, uploads count, lastWrite)

## Phase 4: Fly.io Deployment

- [x] 20. สร้าง `fly.toml` — region sin, shared-cpu-1x 1GB, auto_stop=false, min_machines=1, health checks, force_https, mounts
- [x] 21. แก้ `Dockerfile` — ลบ puppeteer/chromium, CMD=supervise.js, mkdir downloads dirs, multi-stage build ถ้าเหมาะ
- [x] 22. สร้าง `.dockerignore` ที่ครอบคลุม — data/, logs/, downloads/, node_modules/, .git/
- [x] 23. เพิ่ม production guards ใน `server.js` — บังคับ DASHBOARD_PASSWORD ≥12 chars เมื่อ NODE_ENV=production, บังคับ APP_URL เป็น https
- [x] 24. เพิ่ม backup cron logic ใน Engine — ทุก 24h copy accounts.json + uploads.json → data/backups/, keep 7, auto-restore on corrupt
- [x] 25. เพิ่ม runtime suspension detection — เทียบ `lastTickAt` gap > 5×tick → dispatch `engine:blocked(runtime_suspended)`

## Phase 5: Cleanup + Testing

- [x] 26. ลบ `puppeteer` จาก `package.json`, ลบ `data/browser-session/` ออกจาก `.gitignore` guidance
- [x] 27. เพิ่ม smoke tests ใน `scripts/smoke-test.js` — state machine transitions, pacing invariant, safety gate, in-flight reconciliation
- [x] 28. สร้าง deploy script/docs — `scripts/deploy-fly.sh` (fly deploy + verify health), update `DEPLOY.md`

## Phase 6: Monitoring & Future

- [x] 29. เพิ่ม stuck detection ใน Supervisor tick — phase-specific timeouts, dispatch `engine:stuck`
- [ ] 30. (Future) Webhook alert integration — LINE/Discord when degraded/stuck/blocked
- [ ] 31. (Future) Dashboard UI panel สำหรับ Engine — แสดง phase, nextActionAt, cycle history, controls


## Notes

- Task 1–10 สามารถทำได้โดยไม่กระทบระบบที่ทำงานอยู่ (Engine เป็นไฟล์ใหม่ ยังไม่ wire)
- Task 11 เป็นจุดเปลี่ยน: ลูปเดิมจะถูกปิด ต้องทำพร้อมกับ 14 (wire Engine เข้า server.js)
- Task 20–25 ต้องทำพร้อมกัน (fly deploy ครั้งแรกต้องมี fly.toml + Dockerfile + secrets)
- Task 26 ทำตอนไหนก็ได้แต่แนะนำก่อน deploy ครั้งแรกเพื่อลดขนาด image
- Task 29–31 เป็น future work ที่ไม่บล็อก MVP
- **ค่าใช้จ่าย Fly.io:** shared-cpu-1x 1GB ≈ $5.70/เดือน + volumes ($0.15/GB/เดือน × 11GB = $1.65) = **~$7.35/เดือน** ซึ่งต่ำกว่างบ $15 มาก
- **OAuth Migration:** token เดิมจาก localhost ยังใช้ refresh ได้ ไม่ต้อง re-auth ทั้งหมด แต่ต้องลงทะเบียน `https://<app>.fly.dev/oauth2callback` ใน Google Cloud Console ก่อน deploy
