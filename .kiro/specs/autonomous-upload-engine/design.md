    # Design Document — Autonomous Upload Engine

## Overview

สร้าง service ใหม่ `src/services/engine.js` เป็นเจ้าของ lifecycle ลูป 24/7 ทั้งหมด วางทับ `scheduler._startContinuousLoop()` (ซึ่งจะถูกปิดใช้งาน) โดย Engine เป็นตัวเดียวที่เรียก `watchlist.runAll()` และตัดสินใจเรื่อง quota/pacing/health

**Platform:** Fly.io (region `sin` — Singapore)
**Domain:** `<app>.fly.dev` (HTTPS by default, ย้ายเป็น custom domain ภายหลัง)
**Accounts:** 1 Google Cloud Project (6 uploads/day) — รองรับเพิ่มผ่าน dashboard
**Pacing:** `paced` mode, 8 slot × 3 ชม. เน้น 18:00–24:00 Bangkok
**Auto-start:** `engine.autoStartOnBoot = true`
**Alerts:** Dashboard only (webhook ready แต่ไม่บังคับ)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  server.js (Express + WS)                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Engine (src/services/engine.js)                     │    │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │    │
│  │  │Supervisor│→ │ Cycle Runner │→ │Quota Coord.  │  │    │
│  │  │  (tick)  │  │  (discover → │  │(rotate/wait) │  │    │
│  │  │          │  │   gate →     │  └──────────────┘  │    │
│  │  │          │  │   transform →│  ┌──────────────┐  │    │
│  │  │          │  │   queue)     │→ │Pacing Planner│  │    │
│  │  └──────────┘  └──────────────┘  └──────────────┘  │    │
│  │  ┌──────────────┐  ┌──────────────┐                │    │
│  │  │Retention Mgr │  │ Safety Gate  │                │    │
│  │  └──────────────┘  └──────────────┘                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Existing services (unchanged):                             │
│  watchlist · queue · quotaRotator · seo · videoTransform    │
│  youtube · health · eventbus · orchestrator · store         │
└─────────────────────────────────────────────────────────────┘

Persistent Volume (Fly.io):
  /app/data/       ← engine_state.json, accounts.json, uploads.json, ...
  /app/logs/       ← app-*.log
  /app/downloads/  ← tiktok/, transformed/, temp/
```

---

## Components and Interfaces

### Engine Service (`src/services/engine.js`)

**Public Interface:**
```typescript
class Engine extends EventEmitter {
  init(broadcastFn: Function): void
  start(): Promise<void>
  stop(): Promise<void>
  pause(): Promise<void>
  getStatus(): EngineStatus
}
```

**Internal Components (composition):**
- `QuotaCoordinator` — wraps quotaRotator + durable wait logic
- `PacingPlanner` — 8-slot plan generator + slot tracker
- `RetentionManager` — post-cycle cleanup + disk guard
- `SafetyGate` — monetization + duplicate + transform gate

### API Routes (`src/routes/engine.js`)
```
GET  /api/engine/status   → engine.getStatus()     [auth: any authenticated]
POST /api/engine/start    → engine.start()          [auth: authenticated + rate limit 10/60s]
POST /api/engine/stop     → engine.stop()           [auth: authenticated + rate limit 10/60s]
POST /api/engine/pause    → engine.pause()          [auth: authenticated + rate limit 10/60s]
```

### Integration Points
- `orchestrator.js` — 7 new methods for engine events
- `server.js` — init engine after orchestrator, autoStartOnBoot
- `scheduler.js` — remove `runWatchlist()` + `_startContinuousLoop()` from `scan()`
- `eventbus.js` — 7 new rules for `engine:*` events

---

## Data Models

### Engine_State (`data/engine_state.json`)

```typescript
interface EngineState {
  stateVersion: number;          // always 1, for future schema migration
  phase: EnginePhase;            // enum of 9 values
  desiredState: 'running' | 'stopped';
  cycleCount: number;            // >= 0
  consecutiveErrors: number;     // >= 0
  transitionSeq: number;         // monotonically increasing
  nextActionAt: string | null;   // ISO 8601
  lastTickAt: string | null;     // ISO 8601
  currentAccountId: string | null;
  lastError: { message: string; at: string; phase: string } | null;
  pacingPlan: PacingPlan | null;
  inFlight: InFlightEntry[];
  updatedAt: string;             // ISO 8601
}

interface PacingPlan {
  day: string;                   // YYYY-MM-DD Asia/Bangkok
  dailyAllowance: number;
  mode: 'paced' | 'burst';
  slots: PacingSlot[];           // always 8 entries
}

interface PacingSlot {
  slotStart: string;             // ISO 8601
  slotEnd: string;               // ISO 8601
  allowedUploads: number;
  usedUploads: number;
}

interface InFlightEntry {
  uploadIntentId: string;        // unique per upload attempt
  tiktok_video_id: string;
  source_url: string;
  accountId: string;
  title: string;
  filepath: string;
  videoId: string | null;        // filled after YouTube responds
  startedAt: string;             // ISO 8601
  reconcileAttempts: number;     // 0 initially, incremented on failed reconciliation
}
```

### EngineStatus (API response)
```typescript
interface EngineStatus {
  phase: EnginePhase;
  desiredState: 'running' | 'stopped';
  nextActionAt: string | null;
  cycleCount: number;
  consecutiveErrors: number;
  lastCycleSummary: CycleSummary | null;
  quota: QuotaInfo;
  pacing: PacingInfo;
  lastError: { message: string; at: string; phase: string } | null;
  uptimeSeconds: number;
  instanceId: string;
  instanceStartedAt: string;
  lastHeartbeatAt: string;
  heartbeatAgeSeconds: number;
  volume: VolumeInfo;
}
```

---

## Correctness Properties

### Property 1: Single-owner invariant
Only Engine calls `watchlist.runAll()`. `scheduler._startContinuousLoop()` is never called while Engine is active. Verified by `scheduler.getLoopState().running === false`.
**Validates: Requirements 10.5**

### Property 2: No-duplicate-upload invariant
For all `tiktok_video_id` values, at most 1 entry exists in `uploads.json`. Enforced by reserve→upload→record ordering (inFlight written BEFORE upload starts).
**Validates: Requirements 9.5**

### Property 3: No-double-emit invariant
Each successful upload produces exactly 1 `upload:completed` event, exactly 1 `stats:increment(type='upload')`. Enforced by Path B only (queue emits, Engine never calls `orchestrator.onUploadCompleted()`).
**Validates: Requirements 10.9**

### Property 4: State transition chain invariant
`transitionSeq` increases monotonically by 1. Each event's `from` equals the previous event's `to`.
**Validates: Requirements 1.15**

### Property 5: Pacing sum invariant
Sum of all `slot.allowedUploads` equals `dailyAllowance` with no remainder discarded.
**Validates: Requirements 4.7**

### Property 6: Durable wait invariant
Process can be killed at any point during `waiting_quota`. On restart, if `nextActionAt` is in the future, Engine resumes waiting without recalculating. If in the past, transitions to `idle`.
**Validates: Requirements 3.8, 3.9**

### Property 7: Transform-mandatory invariant
In autonomous mode, no clip reaches YouTube without passing through Video Transform successfully (transformed=true).
**Validates: Requirements 6.8**

### Property 8: Memory stability
`heapPercentUsed` stays below 80% with ≤5pp drift per 20 cycles.
**Validates: Requirements 5.8**

---

## Error Handling

| Error Type | Source | Handling |
|------------|--------|----------|
| Cycle Error (discovery fails) | tikwm circuit open, network | Increment `consecutiveErrors`, exponential backoff (60s…1800s), `degraded` after 5 |
| Clip Failure (single video) | download timeout, transform fail, upload fail | Skip clip, log, continue cycle. Does NOT increment `consecutiveErrors` |
| Quota 403 (ledger drift) | YouTube API | Reconcile: mark account exhausted, rotate, do not count as error |
| Token revoked | YouTube API | Mark `reauth_required`, exclude from rotation, `paused_health` if no accounts left |
| Disk full | diskGuard | Cleanup→recheck×2, then `paused_health(disk_full)` |
| State persist failure | store.safeUpdate timeout | Cancel transition, retry next tick. After 3 failures: `engine:blocked(state_persist_failed)` |
| Runtime suspension | Fly.io freeze | Detect via lastTickAt gap > 5×tick, dispatch `engine:blocked(runtime_suspended)` |
| SIGTERM during upload | Platform deploy | Wait up to SHUTDOWN_TIMEOUT_MS, flush state, exit |
| SIGKILL / power loss | Platform hard kill | inFlight was written before upload started → reconcile on next boot |
| Content safety ratio | Poisoned keywords | ≥40% blocked → `paused_manual`, wait for operator |
| Queue stuck | Upload hangs | Queue timeout (QUEUE_WAIT_MAX_MS) → cancel items, count as Cycle Error |

**Retry/Backoff Formula:**
- Cycle errors: `min(60 × 2^(n-1), 1800)` seconds, no jitter
- YouTube upload: handled by existing `guarded()` with 3 attempts + jitter
- tikwm: handled by existing circuit breaker (6 failures → 2min open)

---

## Component Design

### 1. Engine State Store (`data/engine_state.json`)

```jsonc
{
  "stateVersion": 1,
  "phase": "idle",                    // Engine_Phase enum
  "desiredState": "running",          // "running" | "stopped"
  "cycleCount": 42,
  "consecutiveErrors": 0,
  "transitionSeq": 156,
  "nextActionAt": "2026-08-01T13:00:00.000Z",  // ISO 8601 | null
  "lastTickAt": "2026-08-01T12:59:02.000Z",
  "currentAccountId": "acc_1720000000000",
  "lastError": null,                  // { message, at, phase } | null
  "pacingPlan": {                     // Pacing_Plan | null
    "day": "2026-08-01",              // YYYY-MM-DD Asia/Bangkok
    "dailyAllowance": 6,
    "mode": "paced",
    "slots": [
      { "slotStart": "2026-07-31T17:00:00.000Z", "slotEnd": "2026-07-31T20:00:00.000Z", "allowedUploads": 0, "usedUploads": 0 },
      // ... 8 slots total
    ]
  },
  "inFlight": [],                     // upload-intent entries
  "updatedAt": "2026-08-01T12:59:02.000Z"
}
```

Managed by `new Store('engine_state.json', DEFAULT_ENGINE_STATE)` — same atomic/serialized infrastructure as other stores.

### 2. Engine Service (`src/services/engine.js`)

```
class Engine extends EventEmitter {
  // ── Lifecycle ──
  init(broadcast)           // called once from server.js after orchestrator.init()
  start()                   // set desiredState='running', persist, kick supervisor
  stop()                    // set desiredState='stopped', wait in-flight, persist
  pause()                   // set phase='paused_manual', keep desiredState='running'

  // ── Supervisor (internal) ──
  _supervisorTick()         // setInterval(TICK_MS), reads state, decides action
  _transitionTo(to, reason) // validate transition table → persist → dispatch event
  _recoverOnBoot()          // read state, reconcile inFlight, determine initial phase

  // ── Cycle ──
  async _runCycle()         // discover → gate → transform → queue → wait empty → summarize
  
  // ── Sub-components (composition, not inheritance) ──
  _quotaCoordinator         // wraps quotaRotator + durable wait logic
  _pacingPlanner            // 8-slot plan generator + slot tracker
  _retentionManager         // post-cycle cleanup + disk guard
  _safetyGate               // monetization + duplicate + transform gate

  // ── Status ──
  getStatus()               // returns Engine_Status for API + WS
  getLoopState()            // compat shim so scheduler.getLoopState() still works
}
```

**Key design decisions:**

- **Single setInterval, not async loop.** The Supervisor is a 60s `setInterval` that checks `desiredState` vs `phase` and kicks off work. This survives quota-wait (just keeps ticking and comparing time) and is trivially recoverable on restart (read `nextActionAt`, compare with now).
- **State transitions are gated.** `_transitionTo(to, reason)` validates against the table, serializes through `safeUpdate`, and only after success does it dispatch `engine:state_changed` and proceed.
- **Cycle is async but single-threaded.** `_runCycle()` is an async function that runs to completion (or error). The Supervisor will not start another while `phase` is `discovering` or `uploading`.

### 3. State Transition Table

```
stopped        → idle
idle           → discovering, waiting_quota, waiting_pacing, paused_health, paused_manual, degraded, stopped
discovering    → uploading, idle, waiting_quota, waiting_pacing, paused_health, paused_manual, degraded, stopped
uploading      → idle, waiting_quota, waiting_pacing, paused_health, paused_manual, degraded, stopped
waiting_quota  → idle, paused_health, paused_manual, stopped
waiting_pacing → idle, waiting_quota, paused_health, paused_manual, stopped
paused_health  → idle, paused_manual, stopped
paused_manual  → idle, stopped
degraded       → idle, discovering, waiting_quota, paused_health, paused_manual, stopped
```

Implemented as a `Map<string, Set<string>>` constant. Self-transitions rejected.

### 4. Quota Coordinator

```javascript
// Called before each clip upload
async selectAccount() {
  const rotation = quotaRotator.rotateIfNeeded(C.YOUTUBE.UPLOAD_COST);
  if (rotation.success) return rotation.accountId;

  // All accounts exhausted → compute durable wait
  const resetTime = this._computeEarliestReset(); // America/Los_Angeles, DST-safe
  await engine._transitionTo('waiting_quota', 'all_accounts_exhausted');
  // Supervisor tick will resume when now >= nextActionAt
  return null;
}

_computeEarliestReset() {
  // For each authenticated account:
  //   next midnight America/Los_Angeles after account.quotaResetDate
  //   + QUOTA_RESET_BUFFER_MINUTES
  // Return min() of those, clamped to [1 min, 24h + buffer]
  // Uses Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles'})
  // NOT a fixed -8h offset (handles PDT correctly)
}
```

**403 quotaExceeded reconciliation:** If YouTube returns quota error but ledger says available → mark account exhausted for today, rotate, do not increment `consecutiveErrors`. Max 1 reconcile per account per clip.

### 5. Pacing Planner

```javascript
// 8 slots × 3h, boundaries at 00/03/06/09/12/15/18/21 Bangkok time
// Distribution priority: 18–21 > 21–24 > 12–15 > 15–18 > 09–12 > 06–09 > 03–06 > 00–03
// Base = floor(dailyAllowance / 8), remainder distributed 1 per slot in priority order

generatePlan(dailyAllowance, mode = 'paced') {
  if (mode === 'burst') return { slots with allowedUploads = dailyAllowance in first slot };
  // ... distribute per priority
}

canUploadNow() {
  const slot = this._currentSlot();
  return slot.usedUploads < slot.allowedUploads;
}

recordUpload() {
  const slot = this._currentSlot();
  slot.usedUploads++;
  // persist via safeUpdate
}
```

`dailyAllowance` = min(`pacing.maxUploadsPerDay` ?? Infinity, `quotaRotator.totalUploadsLeft`).

### 6. Safety Gate

```javascript
async check(video) {
  // 1. Monetization validation
  const v = seoService.validateForMonetization(video, video.desc);
  if (v.status === 'blocked') return { pass: false, reason: 'blocked' };
  if (v.status === 'warning' && !settings.safety.autonomousAllowWarned)
    return { pass: false, reason: 'warning' };

  // 2. Duplicate check (O(1) via buildDuplicateIndex)
  const dup = isDuplicateTikTok(video.videoUrl, video.id);
  if (dup.duplicate) return { pass: false, reason: 'duplicate' };

  // 3. Score threshold
  const score = seoService.calculateViralityScore(video).score;
  if (score < minScore) return { pass: false, reason: 'low_score' };

  return { pass: true, score, validation: v };
}
```

**Circuit breaker:** If ≥10 clips evaluated and ≥40% blocked in one cycle → `paused_manual` + `engine:blocked(content_safety_ratio)`.

**No force flag:** Engine paths never pass `force=true`.

**Transform mandatory:** If transform returns `transformed: false` → skip with reason `transform_failed`.

### 7. Retention Manager

```javascript
// Called at end of each cycle AND before downloads
async runRetention() {
  // 1. Delete files whose uploads reached terminal state
  // 2. Delete temp files older than TEMP_FILE_MAX_AGE_MS
  // 3. Archive uploads.json if > 5000 entries
  // 4. Trim hashes.json to MAX_HASH_ENTRIES
  // 5. Enforce log rotation
}
```

Disk guard flow: check → cleanup → recheck → cleanup → give up → `paused_health(disk_full)`.

### 8. Cycle Flow (pseudocode)

```
async _runCycle() {
  transitionTo('discovering');
  
  // 1. Pre-flight checks
  retentionManager.runRetention();
  diskGuard.assertSpace();
  
  // 2. Quota + Pacing gate
  if (!pacingPlanner.canUploadNow()) { transitionTo('waiting_pacing'); return; }
  const accountId = await quotaCoordinator.selectAccount();
  if (!accountId) return;  // already transitioned to waiting_quota
  
  // 3. Discovery (via existing watchlist)
  const result = await watchlist.runAll(async ({ video, keyword }) => {
    // Safety Gate
    const gate = await safetyGate.check(video);
    if (!gate.pass) { recordSkip(gate.reason); return; }
    
    // Content safety ratio check
    if (blockedRatio >= 0.40 && evaluated >= 10) {
      transitionTo('paused_manual', 'content_safety_ratio');
      throw new CyclePausedError();
    }
    
    // Transform
    const transformed = await videoTransform.transformSingle(downloadedPath);
    if (!transformed.transformed) { recordSkip('transform_failed'); return; }
    
    // Pacing check per-clip
    if (!pacingPlanner.canUploadNow()) return;  // hold remaining for next slot
    
    // Queue (Path B)
    uploadQueue.add(async () => {
      // reserve inFlight → upload → record videoId → save uploads.json → remove inFlight
      ...
    }, { filename, source: 'tiktok_watchlist' });
  });
  
  // 4. Wait for queue to drain (bounded by QUEUE_WAIT_MAX_MS)
  transitionTo('uploading');
  await waitForQueueEmpty();
  
  // 5. Post-cycle
  retentionManager.runRetention();
  cycleCount++;
  consecutiveErrors = 0;
  transitionTo('idle');
}
```

### 9. Supervisor Tick Logic

```javascript
_supervisorTick() {
  persistLastTickAt();
  
  // Detect runtime suspension (Fly.io freeze detection)
  if (timeSinceLastTick > 5 * TICK_MS) dispatch('engine:blocked', 'runtime_suspended');
  
  if (desiredState !== 'running') return;
  
  switch (phase) {
    case 'idle':
      if (now >= nextActionAt) startCycle();
      break;
    case 'waiting_quota':
      if (now >= nextActionAt) transitionTo('idle');
      break;
    case 'waiting_pacing':
      if (now >= nextActionAt) transitionTo('idle');
      break;
    case 'degraded':
      if (now >= nextActionAt) startCycle();  // retry
      break;
    case 'paused_health':
      if (healthStatus !== 'critical') transitionTo('idle');
      break;
    case 'paused_manual':
    case 'stopped':
      // do nothing until operator acts
      break;
    case 'discovering':
    case 'uploading':
      // cycle running, check stuck timeout
      checkStuckTimeout();
      break;
  }
  
  broadcastStatus();
}
```

### 10. In-Flight Upload Safety (Req 9)

**Write ordering (reserve → upload → record):**

```
1. safeUpdate(engineState → inFlight.push({ uploadIntentId, tiktok_video_id, source_url, accountId, title, filepath, startedAt }))
2. YouTube upload API call
3. safeUpdate(engineState → inFlight[i].videoId = response.videoId)
4. safeUpdate(uploads → uploads.push(record))
5. safeUpdate(engineState → inFlight.splice(i, 1))
```

On boot, if `inFlight` is non-empty:
- If entry has `videoId` → verify with `videos.list` (1 unit) → if exists, save to uploads.json
- If entry has no `videoId` → check via `playlistItems.list` (2 units) → match by title + startedAt
- Max 3 reconcile attempts per entry, then move to manual-review list

### 11. Integration with Existing Services

| Component | Change |
|-----------|--------|
| `scheduler.js` | Remove `runWatchlist()` + `_startContinuousLoop()` chain from `scan()`. Keep folder scan + watcher only. |
| `orchestrator.js` | Add `onEngineStateChanged()`, `onEngineCycleStarted()`, `onEngineCycleCompleted()`, `onEngineDegraded()`, `onEngineStuck()`, `onEngineBlocked()`, `onEngineQuotaWait()` methods. Wire new EventBus rules (priority 15 for degraded/stuck/blocked, 5 for others). |
| `server.js` | Call `engine.init(broadcast)` after `orchestrator.init()`. If `engine.autoStartOnBoot && desiredState !== 'stopped'` → `engine.start()`. |
| `eventbus.js` | Add rules for `engine:*` events (notification dispatch, activity logging). |

### 12. API Routes (`src/routes/engine.js`)

```
GET  /api/engine/status   → engine.getStatus()
POST /api/engine/start    → engine.start()    [auth required]
POST /api/engine/stop     → engine.stop()     [auth required]
POST /api/engine/pause    → engine.pause()    [auth required]
```

Rate limited: 10 req/60s for control, 60 req/60s for status.

### 13. Fly.io Deployment

**`fly.toml`:**
```toml
app = "autoupload"
primary_region = "sin"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  TZ = "Asia/Bangkok"
  HOST = "0.0.0.0"
  PORT = "3000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false    # ★ CRITICAL: never sleep
  auto_start_machines = true
  min_machines_running = 1      # ★ always-on

  [http_service.checks]
    [http_service.checks.live]
      port = 3000
      type = "http"
      interval = "30s"
      timeout = "5s"
      path = "/api/health/live"

    [http_service.checks.ready]
      port = 3000
      type = "http"
      interval = "60s"
      timeout = "10s"
      path = "/api/health/ready"

[[vm]]
  size = "shared-cpu-1x"
  memory = "1024mb"           # 768 min + headroom

[mounts]
  source = "autoupload_data"
  destination = "/app/data"

[mounts]
  source = "autoupload_downloads"
  destination = "/app/downloads"

[mounts]
  source = "autoupload_logs"
  destination = "/app/logs"
```

**Volumes (create once):**
```bash
fly volumes create autoupload_data -r sin -s 2        # 2 GB
fly volumes create autoupload_downloads -r sin -s 8   # 8 GB
fly volumes create autoupload_logs -r sin -s 1        # 1 GB
```

**Secrets:**
```bash
fly secrets set GOOGLE_CREDENTIALS_JSON='{"web":{...}}'
fly secrets set DASHBOARD_PASSWORD='<12+ chars>'
fly secrets set SESSION_SECRET='<random 64 chars>'
fly secrets set APP_URL='https://autoupload.fly.dev'
```

**Cost:** shared-cpu-1x 1GB = ~$5.70/month (within $15 budget).

### 14. Dockerfile Changes

```dockerfile
# Remove puppeteer + chromium (dead code, saves ~300MB image + 987MB cache)
# Add: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true already in .env but also:
RUN npm pkg delete dependencies.puppeteer

# Ensure downloads dir exists and is writable
RUN mkdir -p /app/downloads/tiktok /app/downloads/transformed /app/downloads/temp

# Entrypoint uses supervise.js
CMD ["node", "scripts/supervise.js"]
```

### 15. Backup Strategy

- Every 24h: copy `data/accounts.json` + `uploads.json` → `data/backups/YYYY-MM-DD_HH-mm/`
- Keep 7 copies, delete older
- On corrupt `accounts.json` → restore latest parseable backup

---

## Data Flow Diagram

```
                    ┌────────────────┐
         boot ────→│ _recoverOnBoot │
                    │  (read state,  │
                    │   reconcile    │
                    │   inFlight)    │
                    └───────┬────────┘
                            │
                            ▼
                    ┌────────────────┐
  ┌────────────────│   Supervisor   │◄──── setInterval(60s)
  │                │   Tick Loop    │
  │                └───────┬────────┘
  │                        │ (desiredState=running && phase=idle && now>=nextActionAt)
  │                        ▼
  │                ┌────────────────┐
  │                │   _runCycle()  │
  │                │                │
  │                │  1. retention  │
  │                │  2. diskGuard  │
  │                │  3. pacing?    │──── waiting_pacing
  │                │  4. quota?     │──── waiting_quota
  │                │  5. discovery  │
  │                │  6. gate+xform │
  │                │  7. queue      │
  │                │  8. wait drain │
  │                │  9. cleanup    │
  │                └───────┬────────┘
  │                        │
  │     ┌──────────────────┼──────────────────┐
  │     │                  │                  │
  │     ▼                  ▼                  ▼
  │  success            error            paused
  │  (idle,             (backoff,        (health/manual/
  │   nextActionAt)      degraded?)       content_safety)
  │     │                  │
  └─────┴──────────────────┘
```

---

## Testing Strategy

| Layer | Approach |
|-------|----------|
| State machine transitions | Unit test: verify every allowed pair passes, every forbidden pair rejects, round-trip property of serialized state |
| Supervisor tick | Unit test with injectable clock: verify phase transitions happen at correct times |
| Quota coordinator | Unit test: mock quotaRotator, verify rotation + durable wait + 403 reconciliation |
| Pacing planner | Unit test: verify slot distribution invariant, remainder handling, mid-day recompute |
| Safety gate | Unit test: mock seoService, verify block/warn/dup/score/transform paths |
| In-flight reconciliation | Integration test: simulate crash at each step of reserve→upload→record |
| Full cycle | Integration test: mock TikTok + YouTube APIs, run one cycle end-to-end |
| Fly.io deploy | Smoke test: `fly deploy --ha=false`, verify `/api/health/ready`, `/api/engine/status` |
| 7-day stability | Monitoring: track cycleCount, consecutiveErrors, heapPercentUsed, volumePercentUsed |

---

## Migration Plan

1. **Phase 1: Engine service + state machine** — new file, no disruption to existing flow
2. **Phase 2: Detach scheduler loop** — `scan()` stops calling `runWatchlist()`, Engine takes over
3. **Phase 3: API routes + dashboard** — `/api/engine/*` endpoints, WS broadcasts
4. **Phase 4: Fly.io deployment** — `fly.toml`, volumes, secrets, first deploy
5. **Phase 5: Remove puppeteer** — shrink image, free disk/memory budget
6. **Phase 6: Monitoring & hardening** — stuck detection, backup cron, alert webhook (future)
