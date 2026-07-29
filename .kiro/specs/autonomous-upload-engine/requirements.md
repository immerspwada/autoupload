# Requirements Document

## Introduction

**Autonomous Upload Engine** คือชั้น orchestration ใหม่ที่วางทับบน service ที่มีอยู่แล้ว (watchlist / scheduler / queue / quotaRotator / seo / videoTransform / health / eventbus) เพื่อทำให้ระบบ **ค้นหาคลิป → อัปโหลดเอง → รอเมื่อ quota หมด → กลับมาทำงานต่อ วนไม่หยุด 24/7** โดยไม่ต้องมีคนคุม และ **deploy ขึ้น cloud host พร้อม custom domain** ให้รันต่อเนื่องข้าม restart / redeploy โดย **ไม่พึ่งเครื่อง local ของ Operator เลย**

ปัญหาที่ฟีเจอร์นี้แก้ (จากระบบปัจจุบัน):

1. ลูปต่อเนื่องเก็บ state ไว้ใน memory ทั้งหมด — restart 1 ครั้ง = ลืมว่ากำลังรอ quota reset และลูปไม่กลับมาเอง
2. การรอ quota ใช้ `setTimeout` ยาวหลายชั่วโมง — หายไปทันทีเมื่อ process ตาย
3. ลูป `break` ออกหลายเส้นทาง (quota หมด / รอคิวเกินเวลา / ครบเพดานรอบ / error ติดกัน) แล้วไม่มีใครพากลับมา
4. มี multi-account rotation แต่ลูปไม่ใช้ — account A หมด quota แล้วนอนรอเที่ยงคืน PST ทั้งที่ account B ยังว่าง
5. ไม่มีสถานะที่เชื่อถือได้ว่า "ตอนนี้เครื่องยนต์ทำอะไร และจะทำอะไรต่อเมื่อไร"
6. รันจากโน้ตบุ๊กบน LAN — ยังไม่มี deploy ที่ persist `data/` + OAuth token, จัดการ secret, restart policy, health probe, HTTPS domain สำหรับ OAuth redirect, timezone
7. ดิสก์เต็ม 98% — ลูปที่ดาวน์โหลด+แปลงวิดีโอตลอดเวลาจะเต็ม volume ถ้า retention ไม่ใช่ส่วนหนึ่งของเครื่องยนต์
8. อัปรวดเดียวหมด quota ดูเหมือน spam — ต้องกระจายการอัปตลอดวันและเล็ง prime time

**ขอบเขต:** ฟีเจอร์นี้ **ไม่** สร้าง discovery / upload / SEO / transform ใหม่ — ใช้ของเดิมทั้งหมด สิ่งที่สร้างใหม่คือความ **ทนทาน (durable) / ฟื้นตัวเอง (self-healing) / มองเห็นได้ (observable) / deploy บน cloud domain ได้จริง**

---

## Glossary

- **Engine** — Autonomous Upload Engine: service ใหม่ที่เป็นเจ้าของ lifecycle ของลูป 24/7 และเป็นผู้เรียก `watchlist.runAll()` / `uploadQueue` / `quotaRotator` แทนที่ลูปใน `scheduler._startContinuousLoop()`
- **Engine_State** — เอกสาร state ของ Engine ที่ persist ลง `Persistent_Volume` ผ่าน `store.safeUpdate()` มี 12 field: `stateVersion`, `phase`, `desiredState`, `cycleCount`, `consecutiveErrors`, `transitionSeq`, `nextActionAt`, `lastTickAt`, `currentAccountId`, `lastError`, `pacingPlan`, `inFlight`
- **Engine_Phase** — ค่าใน enum เดียวจากชุดนี้: `stopped`, `idle`, `discovering`, `uploading`, `waiting_quota`, `waiting_pacing`, `paused_health`, `paused_manual`, `degraded`
- **Desired_State** — เจตนาของผู้ใช้ที่ persist ไว้: `running` หรือ `stopped` (แยกจาก `Engine_Phase` ซึ่งเป็นสถานะจริงชั่วขณะ)
- **Supervisor** — ตัวจับเวลาภายใน Engine ที่ตื่นเป็นรอบ (tick) เพื่อเทียบ `Desired_State` กับ `Engine_Phase` แล้วพา Engine กลับเข้าสถานะที่ควรเป็น
- **Cycle** — 1 รอบการทำงาน: discovery → คัดกรอง → เข้าคิว → อัปโหลดจนคิวว่าง → สรุปผล
- **Cycle_Error** — ความล้มเหลวระดับรอบ (discovery / planning / enqueue / queue-wait timeout / state I/O) ซึ่งนับเข้า `consecutiveErrors` — **ไม่** รวมความล้มเหลวรายคลิป
- **Clip_Failure** — ความล้มเหลวของคลิปเดี่ยว (download / transform / upload / ถูก Safety_Gate ข้าม) ซึ่งไม่ทำให้ `Cycle` ล้มเหลว
- **Quota_Coordinator** — ส่วนที่ตัดสินใจเรื่อง quota: เรียก `quotaRotator` เพื่อสลับ account ก่อน และคำนวณเวลา reset เมื่อทุก account หมด
- **Quota_Reset_Time** — เวลา reset ที่ **เร็วที่สุด** ในบรรดา account ที่ login แล้ว โดยเวลา reset ของแต่ละ account คือเที่ยงคืนรอบถัดไปตาม timezone `America/Los_Angeles` หลังวัน `quotaResetDate` ของ account นั้น บวก `C.YOUTUBE.QUOTA_RESET_BUFFER_MINUTES`
- **Pacing_Planner** — ส่วนที่กระจายจำนวนอัปโหลดที่อนุญาตต่อวันออกเป็น slot ตามเวลา `Asia/Bangkok`
- **Pacing_Plan** — แผนของวันหนึ่ง: `{ day (YYYY-MM-DD ตาม Asia/Bangkok), dailyAllowance, mode, slots: [{ slotStart, slotEnd, allowedUploads, usedUploads }] }`
- **Retention_Manager** — ส่วนที่ลบไฟล์ชั่วคราว (`downloads/tiktok`, `downloads/transformed`, `downloads/temp`) และตัด log/ประวัติ เพื่อให้ `Persistent_Volume` ไม่เต็มระหว่างรันไม่จำกัดเวลา
- **Safety_Gate** — ด่านตรวจก่อนอัปโหลดทุกครั้ง ที่เรียก `seoService.validateForMonetization()` และการตรวจซ้ำ (duplicate)
- **Engine_Status** — payload สถานะเดียวที่เป็นแหล่งความจริง เปิดให้อ่านผ่าน `GET /api/engine/status` และ broadcast ผ่าน WebSocket
- **Operator** — ผู้ใช้ที่ควบคุม Engine ผ่าน dashboard
- **Deployment_Runtime** — สภาพแวดล้อมที่ Engine รันจริง (Docker container บน cloud host ที่มี custom domain + HTTPS + persistent volume + restart policy)
- **Persistent_Volume** — พื้นที่เก็บข้อมูลที่คงอยู่ข้าม restart และ redeploy ซึ่ง mount ที่ `data/`, `logs/` และ `downloads/`
- **APP_URL** — public HTTPS origin ของระบบที่ deploy แล้ว (เช่น `https://uploader.example.com`) ใช้เป็น origin ของ OAuth redirect URI

---

## Requirements

### Requirement 1: Engine State Machine ที่คงอยู่ข้าม restart

**User Story:** As an Operator, I want Engine จำได้ว่ากำลังทำอะไรอยู่แม้ process จะ restart, so that ระบบไม่หยุดทำงานถาวรเพราะ deploy หรือ crash

#### Acceptance Criteria

1. THE Engine SHALL แสดง `Engine_Phase` เป็นค่าเดียวจาก enum: `stopped`, `idle`, `discovering`, `uploading`, `waiting_quota`, `waiting_pacing`, `paused_health`, `paused_manual`, `degraded`
2. WHEN `Engine_Phase` เปลี่ยนค่า, THE Engine SHALL เขียน `Engine_State` ลง `Persistent_Volume` ผ่าน `store.safeUpdate()` ให้สำเร็จก่อน แล้วจึงกระทำการต่อไปนี้ได้: เรียก YouTube API, เรียก `uploadQueue.add()` หรือ `uploadQueue.cancel()`, เรียก `watchlist.runAll()`, เริ่มดาวน์โหลดหรือแปลงวิดีโอ, และ dispatch event `engine:state_changed`
3. IF การเขียน `Engine_State` ไม่สำเร็จภายใน 5000 มิลลิวินาที หรือโยน error, THEN THE Engine SHALL ยกเลิกการเปลี่ยน `Engine_Phase` นั้น, คงค่า `Engine_Phase` เดิมไว้, บันทึก log ระดับ error และลองเปลี่ยนอีกครั้งในช่วง tick ถัดไป
4. IF การเขียน `Engine_State` ไม่สำเร็จติดกันครบ 3 ครั้ง, THEN THE Engine SHALL dispatch event `engine:blocked` พร้อมเหตุผล `state_persist_failed` และ SHALL งดเรียก YouTube API ทุกชนิดจนกว่าการเขียนจะสำเร็จอีกครั้ง
5. WHEN `Engine_Phase` เปลี่ยนค่าสำเร็จ, THE Engine SHALL dispatch event `engine:state_changed` พร้อม `{ from, to, reason, nextActionAt, transitionSeq }`
6. WHEN process เริ่มทำงาน, THE Engine SHALL อ่าน `Engine_State` จาก `Persistent_Volume` แล้วกู้คืน `Desired_State`, `cycleCount`, `consecutiveErrors`, `transitionSeq`, `nextActionAt` และ `pacingPlan` และ SHALL กู้คืน `Engine_Phase` ตามค่าที่บันทึกไว้เมื่อค่านั้นเป็นหนึ่งใน `stopped`, `idle`, `waiting_quota`, `waiting_pacing`, `paused_health`, `paused_manual`, `degraded`
7. WHEN process เริ่มทำงานในขณะที่ `Engine_State` บันทึก `phase` ไว้เป็น `discovering` หรือ `uploading`, THE Engine SHALL ตั้ง `Engine_Phase` เป็น `idle` เนื่องจากงานที่ค้างกลางรอบไม่สามารถทำต่อจากจุดเดิมได้ และ SHALL บันทึก log ระดับ warn พร้อมค่า `phase` ที่อ่านได้
8. IF ไฟล์ `Engine_State` อ่านไม่ได้ parse ไม่สำเร็จ หรือไม่ผ่านการตรวจ schema ตามข้อ 10, THEN THE Engine SHALL ใช้ค่าเริ่มต้น `desiredState='stopped'`, `phase='stopped'` โดยไม่อนุมานสถานะจากแหล่งข้อมูลอื่น และบันทึก log ระดับ error พร้อมชื่อไฟล์ที่เสียหายและ field ที่ไม่ผ่านการตรวจ
9. THE Engine SHALL อนุญาตการเปลี่ยน `Engine_Phase` เฉพาะคู่ `from → to` ในตารางต่อไปนี้ และ SHALL ปฏิเสธคู่อื่นทุกคู่ รวมถึง self-transition (`from` เท่ากับ `to`) พร้อมบันทึก log ระดับ warn ที่ระบุคู่ที่ถูกปฏิเสธ:

| from | to ที่อนุญาต |
|------|-------------|
| `stopped` | `idle` |
| `idle` | `discovering`, `waiting_quota`, `waiting_pacing`, `paused_health`, `paused_manual`, `degraded`, `stopped` |
| `discovering` | `uploading`, `idle`, `waiting_quota`, `waiting_pacing`, `paused_health`, `paused_manual`, `degraded`, `stopped` |
| `uploading` | `idle`, `waiting_quota`, `waiting_pacing`, `paused_health`, `paused_manual`, `degraded`, `stopped` |
| `waiting_quota` | `idle`, `paused_health`, `paused_manual`, `stopped` |
| `waiting_pacing` | `idle`, `waiting_quota`, `paused_health`, `paused_manual`, `stopped` |
| `paused_health` | `idle`, `paused_manual`, `stopped` |
| `paused_manual` | `idle`, `stopped` |
| `degraded` | `idle`, `discovering`, `waiting_quota`, `paused_health`, `paused_manual`, `stopped` |

10. THE `Engine_State` SHALL มี field ตามชนิดและขอบเขตนี้: `stateVersion` (จำนวนเต็มบวก), `phase` (ค่าใน enum ข้อ 1), `desiredState` (`running` หรือ `stopped`), `cycleCount` (จำนวนเต็มไม่ติดลบ), `consecutiveErrors` (จำนวนเต็มไม่ติดลบ), `transitionSeq` (จำนวนเต็มไม่ติดลบ), `nextActionAt` (สตริง ISO 8601 หรือ `null`), `lastTickAt` (สตริง ISO 8601 หรือ `null`), `currentAccountId` (สตริงหรือ `null`), `lastError` (object `{ message, at, phase }` หรือ `null`), `pacingPlan` (`Pacing_Plan` หรือ `null`), `inFlight` (array ของ entry ที่มี `uploadIntentId`, `tiktok_video_id`, `source_url`, `accountId`, `title`, `filepath`, `videoId`, `startedAt`, `reconcileAttempts`)
11. FOR ALL `Engine_State` ที่ผ่านการตรวจ schema ตามข้อ 10, การ serialize แล้ว deserialize SHALL คืนค่าที่เทียบเท่ากับต้นฉบับทุก field (round-trip property)
12. THE Engine SHALL ดำเนินการเปลี่ยน `Engine_Phase` แบบเรียงลำดับ (FIFO) โดยมีการเขียน `Engine_State` ที่ยังไม่เสร็จได้ไม่เกิน 1 รายการในเวลาเดียวกัน
13. WHEN มีคำขอเปลี่ยน `Engine_Phase` เข้ามาขณะที่คำขอก่อนหน้ายังเขียนไม่เสร็จ, THE Engine SHALL ตรวจค่า `from` ของคำขอนั้นกับ `Engine_Phase` ที่เป็นผลจากคำขอก่อนหน้าอีกครั้ง และ SHALL ปฏิเสธคำขอนั้นเมื่อคู่ `from → to` ไม่อยู่ในตารางข้อ 9
14. WHEN `Engine_Phase` เปลี่ยนค่าสำเร็จ, THE Engine SHALL เพิ่ม `transitionSeq` ขึ้น 1
15. FOR ALL ลำดับ event `engine:state_changed` ที่ dispatch ออกไป ค่า `transitionSeq` SHALL เพิ่มขึ้นทีละ 1 อย่างต่อเนื่อง และค่า `from` ของ event ที่ `transitionSeq` เท่ากับ n SHALL เท่ากับค่า `to` ของ event ที่ `transitionSeq` เท่ากับ n−1 (invariant)

### Requirement 2: ลูปทำงานต่อเนื่องที่ฟื้นตัวเองได้

**User Story:** As an Operator, I want ลูปกลับมาทำงานเองทุกครั้งที่หลุด, so that ระบบทำงานจริง 24/7 โดยไม่ต้องเข้าไปกดเริ่มใหม่

#### Acceptance Criteria

1. WHILE `Desired_State` เท่ากับ `running`, THE Supervisor SHALL ตรวจสอบ `Engine_Phase` ทุกช่วง tick ที่กำหนดค่าได้ในช่วง 15 ถึง 300 วินาที (ค่าเริ่มต้น 60 วินาที) โดยมีความคลาดเคลื่อนไม่เกิน 5 วินาที และ SHALL บันทึก `lastTickAt` ลง `Engine_State` ทุก tick
2. WHILE `Desired_State` เท่ากับ `running` และ `Engine_Phase` เท่ากับ `idle`, THE Engine SHALL เริ่ม `Cycle` ใหม่ภายใน 1 ช่วง tick
3. WHEN `Cycle` จบลงด้วยเหตุผลใดก็ตาม, THE Engine SHALL ตั้ง `Engine_Phase` ตามลำดับความสำคัญนี้: `paused_health` เมื่อสถานะ health เป็น `critical`, `paused_manual` เมื่อ Operator สั่ง pause ไว้, `waiting_quota` ตามเงื่อนไข Requirement 3 ข้อ 3, `waiting_pacing` ตามเงื่อนไข Requirement 4 ข้อ 3, และ `idle` เมื่อไม่เข้าเงื่อนไขใด และ SHALL ตั้ง `nextActionAt` เป็นเวลาที่จะเริ่มทำงานครั้งถัดไป
4. IF `Cycle` จบลงด้วย `Cycle_Error`, THEN THE Engine SHALL บันทึก `lastError` ลง `Engine_State`, เพิ่ม `consecutiveErrors` ขึ้น 1 และตั้ง `nextActionAt` เป็นเวลาปัจจุบันบวก `min(60 × 2^(consecutiveErrors − 1), 1800)` วินาที ให้ได้ลำดับการรอที่ตรวจสอบได้คือ 60, 120, 240, 480, 960, 1800, 1800 วินาที โดยไม่เพิ่มค่าสุ่ม
5. IF `consecutiveErrors` มีค่าตั้งแต่ 5 ขึ้นไป, THEN THE Engine SHALL ตั้ง `Engine_Phase` เป็น `degraded`, dispatch event `engine:degraded` พร้อม `{ consecutiveErrors, lastError, nextActionAt }` และคง `Desired_State` ไว้เป็น `running`
6. WHILE `Engine_Phase` เท่ากับ `degraded`, THE Engine SHALL ตั้ง `nextActionAt` เป็นเวลาที่ความพยายามล่าสุดจบลงบวก 1800 วินาที และลอง `Cycle` ใหม่เมื่อถึงเวลานั้น
7. WHEN `Cycle` จบลงโดยไม่มี `Cycle_Error`, THE Engine SHALL เพิ่ม `cycleCount` ขึ้น 1 และตั้ง `consecutiveErrors` เป็น 0 แม้ทุกคลิปในรอบนั้นจะเป็น `Clip_Failure` ก็ตาม
8. IF `Cycle` รอคิวว่างนานเกิน `C.SCHEDULER.QUEUE_WAIT_MAX_MS`, THEN THE Engine SHALL ยกเลิกงานที่ค้างในคิวผ่าน `uploadQueue.cancel()`, บันทึก log ระดับ error, นับเหตุการณ์นั้นเป็น `Cycle_Error` ตามข้อ 4 และตั้ง `Engine_Phase` เป็น `idle`
9. WHILE `Desired_State` เท่ากับ `running`, THE Engine SHALL ไม่คง `Engine_Phase` ใดไว้เป็นสถานะสุดท้ายที่ออกไม่ได้ โดย SHALL ออกจาก `idle`, `waiting_quota`, `waiting_pacing` และ `degraded` ภายใน 1 ช่วง tick บวก 5 วินาที นับจากเวลาที่ `nextActionAt` มาถึง และ SHALL ไม่ตั้ง `Engine_Phase` เป็น `stopped` เว้นแต่ `Desired_State` เท่ากับ `stopped` (invariant)
10. THE Engine SHALL จัดประเภทความล้มเหลวเป็น `Cycle_Error` เฉพาะกรณีที่เกิดใน discovery, การวางแผน pacing, การเข้าคิว, การรอคิวว่างเกินเวลา หรือการอ่าน/เขียน `Engine_State` และ SHALL จัดความล้มเหลวของการดาวน์โหลด, การแปลงวิดีโอ, การอัปโหลด และการถูก Safety_Gate ข้าม เป็น `Clip_Failure` ซึ่งไม่นับเข้า `consecutiveErrors`
11. IF การทำงานภายใน tick ของ Supervisor โยน error, THEN THE Supervisor SHALL จับ error นั้นภายในขอบเขต tick, บันทึก log ระดับ error, บันทึก `lastError` ลง `Engine_State`, ตั้ง tick ถัดไปตามช่วงเวลาปกติ และ SHALL ไม่หยุดทำงานและไม่เปลี่ยน `Desired_State`
12. IF tick เกิดขึ้นขณะที่ `Engine_Phase` เท่ากับ `discovering` หรือ `uploading`, THEN THE Engine SHALL ไม่เริ่ม `Cycle` ใหม่ และ FOR ALL ช่วงเวลา จำนวน `Cycle` ที่ทำงานพร้อมกัน SHALL มีค่าไม่เกิน 1 (invariant)

### Requirement 3: จัดการ quota หมด — สลับ account ก่อน แล้วรอแบบทนทาน

**User Story:** As an Operator, I want ระบบใช้ quota ของทุก account ให้หมดก่อนจะนอนรอ reset, so that ได้จำนวนอัปโหลดต่อวันมากที่สุดและไม่เสียเวลารอเปล่า ๆ

#### Acceptance Criteria

1. WHEN Engine เตรียมอัปโหลด 1 คลิป, THE Quota_Coordinator SHALL เรียก `quotaRotator.rotateIfNeeded(C.YOUTUBE.UPLOAD_COST)` หนึ่งครั้งก่อนเริ่มดาวน์โหลดไฟล์ และ SHALL ใช้ `accountId` ที่ได้กลับมาเป็น account เดียวสำหรับการอัปโหลดคลิปนั้น
2. IF account ที่ใช้อยู่มี quota เหลือน้อยกว่า `C.YOUTUBE.UPLOAD_COST` และมี account อื่นที่ login แล้ว (มี `refresh_token` หรือ `access_token`) ซึ่งมี quota เหลือมากกว่าหรือเท่ากับ `C.YOUTUBE.UPLOAD_COST`, THEN THE Quota_Coordinator SHALL สลับไปใช้ account นั้นและดำเนินการอัปโหลดคลิปเดิมต่อภายในรอบเดียวกัน โดยไม่ตั้ง `Engine_Phase` เป็น `waiting_quota` และไม่นับเป็น error
3. IF ไม่มี account ที่ login แล้วรายใดที่มี quota เหลือมากกว่าหรือเท่ากับ `C.YOUTUBE.UPLOAD_COST` (ประเมินทีละ account ไม่ใช่ผลรวมข้าม account), THEN THE Engine SHALL ตั้ง `nextActionAt` เป็น `Quota_Reset_Time`, เขียน `Engine_State` ลง `Persistent_Volume` ให้สำเร็จก่อน แล้วจึงตั้ง `Engine_Phase` เป็น `waiting_quota` และ dispatch event `engine:quota_wait` พร้อม `{ nextActionAt, accountsAuthenticated, accountsExhausted }`
4. WHILE `Engine_Phase` เท่ากับ `waiting_quota`, THE Engine SHALL งดเรียก YouTube upload API และงดเริ่มดาวน์โหลดหรือแปลงวิดีโอคลิปใหม่
5. WHILE `Engine_Phase` เท่ากับ `waiting_quota`, THE Supervisor SHALL อ่าน `nextActionAt` จาก `Engine_State` แล้วเทียบกับเวลาปัจจุบันทุกช่วง tick และ SHALL งดสร้างตัวจับเวลาที่มีระยะยาวกว่า 1 ช่วง tick สำหรับการรอ quota
6. WHEN เวลาปัจจุบันมากกว่าหรือเท่ากับ `nextActionAt` ในขณะที่ `Engine_Phase` เท่ากับ `waiting_quota`, THE Engine SHALL ประเมิน quota ของทุก account ที่ login แล้วใหม่ ภายในไม่เกิน 1 ช่วง tick แล้วตั้ง `Engine_Phase` เป็น `idle` เพื่อให้ `Cycle` ถัดไปเริ่มทำงาน
7. IF การประเมินใหม่เมื่อถึง `nextActionAt` พบว่ายังไม่มี account ที่ login แล้วรายใดมี quota เหลือมากกว่าหรือเท่ากับ `C.YOUTUBE.UPLOAD_COST`, THEN THE Engine SHALL คง `Engine_Phase` ไว้เป็น `waiting_quota` และตั้ง `nextActionAt` เป็น `Quota_Reset_Time` ที่คำนวณใหม่ โดยไม่เรียก YouTube upload API ในระหว่างนั้น
8. WHEN process เริ่มทำงานใหม่ในขณะที่ `Engine_State` บันทึกไว้ว่า `phase='waiting_quota'` และ `nextActionAt` เป็นค่า ISO 8601 ที่ถูกต้องและอยู่ในอนาคต, THE Engine SHALL กู้คืน `Engine_Phase` เป็น `waiting_quota` พร้อม `nextActionAt` เดิมโดยไม่คำนวณเวลารอใหม่
9. WHEN process เริ่มทำงานใหม่ในขณะที่ `Engine_State` บันทึกไว้ว่า `phase='waiting_quota'` และ `nextActionAt` เป็นเวลาในอดีต ขาดหายไป หรือไม่ใช่ค่า ISO 8601 ที่ถูกต้อง, THE Engine SHALL ตั้ง `Engine_Phase` เป็น `idle` และบันทึก log ระดับ warn เมื่อค่าที่อ่านได้ไม่ถูกต้อง
10. THE Quota_Coordinator SHALL คำนวณ `Quota_Reset_Time` เป็นค่าที่เร็วที่สุดของเวลา reset รายบุคคลของทุก account ที่ login แล้ว โดยเวลา reset ของแต่ละ account คือเที่ยงคืนรอบถัดไปตาม timezone `America/Los_Angeles` ที่หลังจากวัน `quotaResetDate` ของ account นั้น บวก `C.YOUTUBE.QUOTA_RESET_BUFFER_MINUTES` และ SHALL คำนวณจาก timezone `America/Los_Angeles` โดยไม่ใช้ค่า offset คงที่ เพื่อให้ถูกต้องทั้งช่วง PST และ PDT
11. THE Quota_Coordinator SHALL จำกัด `Quota_Reset_Time` ให้อยู่ในช่วงตั้งแต่ 1 นาที ถึง 24 ชั่วโมงบวก `C.YOUTUBE.QUOTA_RESET_BUFFER_MINUTES` นับจากเวลาปัจจุบัน และ IF ค่าที่คำนวณได้อยู่นอกช่วงนี้, THEN THE Quota_Coordinator SHALL ใช้ค่าขอบเขตที่ใกล้ที่สุดแทน และบันทึก log ระดับ warn พร้อมค่าที่คำนวณได้เดิม
12. IF YouTube API ตอบกลับด้วยข้อผิดพลาดประเภทเกินโควตา (`quotaExceeded` / `dailyLimitExceeded` / `uploadLimitExceeded`) สำหรับ account ที่ระบบบันทึกไว้ว่ามี quota เหลือมากกว่าหรือเท่ากับ `C.YOUTUBE.UPLOAD_COST`, THEN THE Quota_Coordinator SHALL ปรับ `quotaUsed` ของ account นั้นให้เท่ากับ `quotaLimit` สำหรับวัน PST ปัจจุบัน, SHALL งดเรียก YouTube upload API ด้วย account นั้นอีกจนกว่าเวลา reset รายบุคคลของ account นั้นจะมาถึง, SHALL เรียก `quotaRotator.rotateIfNeeded(C.YOUTUBE.UPLOAD_COST)` อีกครั้งเพื่อเลือก account ถัดไป และ SHALL ไม่เพิ่ม `consecutiveErrors` จากกรณีนี้
13. THE Quota_Coordinator SHALL ปรับค่า quota ตามเกณฑ์ข้อ 12 ได้ไม่เกิน 1 ครั้งต่อ account ต่อการอัปโหลด 1 คลิป และ IF ทุก account ที่ login แล้วถูกปรับว่า quota หมดครบแล้วสำหรับคลิปเดียวกัน, THEN THE Engine SHALL หยุดพยายามอัปโหลดคลิปนั้น, คงคลิปนั้นไว้สำหรับรอบถัดไป และเข้าสู่ `waiting_quota` ตามข้อ 3
14. IF การเรียก YouTube API ล้มเหลวด้วยข้อผิดพลาดด้านสิทธิ์การเข้าถึง (token หมดอายุ, ถูกเพิกถอน, `invalid_grant` หรือ unauthorized) ซึ่งไม่ใช่ข้อผิดพลาดประเภทเกินโควตา, THEN THE Quota_Coordinator SHALL ทำเครื่องหมาย account นั้นว่า `reauth_required`, SHALL คงค่า `quotaUsed` ของ account นั้นไว้ไม่เปลี่ยนแปลง, SHALL ตัด account นั้นออกจากการเลือกของ `quotaRotator` จนกว่าจะมี event `auth:login` สำหรับ account นั้น และ SHALL เรียก `quotaRotator.rotateIfNeeded(C.YOUTUBE.UPLOAD_COST)` เพื่ออัปโหลดคลิปเดิมต่อด้วย account อื่น
15. IF จำนวน account ที่ login แล้วและไม่ถูกทำเครื่องหมาย `reauth_required` มีค่าเท่ากับ 0, THEN THE Engine SHALL ตั้ง `Engine_Phase` เป็น `paused_health`, SHALL งดเรียก YouTube upload API, SHALL งดตั้ง `nextActionAt` เป็น `Quota_Reset_Time` และ SHALL dispatch event `engine:blocked` พร้อมเหตุผล `no_authenticated_account`
16. WHILE `Engine_Phase` เท่ากับ `paused_health` ด้วยเหตุผล `no_authenticated_account`, THE Supervisor SHALL ตรวจจำนวน account ที่ login แล้วทุกช่วง tick และ WHEN จำนวนนั้นมีค่าตั้งแต่ 1 ขึ้นไป, THE Engine SHALL ตั้ง `Engine_Phase` เป็น `idle` ภายในไม่เกิน 1 ช่วง tick
17. THE Engine_Status SHALL รายงาน `quota` ประกอบด้วย `totalUploadsLeft`, `activeAccountId`, `accountsAuthenticated`, `accountsNeedingReauth`, `nextResetAt` (เท่ากับ `Quota_Reset_Time`) และรายการต่อ account ที่ระบุ `accountId`, `uploadsLeft`, `authenticated` และ `resetAt` โดยค่าเวลาทุกค่าอยู่ในรูปแบบ ISO 8601 พร้อม offset UTC

### Requirement 4: กระจายการอัปโหลดตลอดวัน (Pacing)

**User Story:** As an Operator, I want ระบบทยอยอัปโหลดตลอดวันและเน้นช่วง prime time, so that ช่องดูเป็นธรรมชาติ ลดความเสี่ยงถูกมองว่า spam และได้ views สูงสุด

#### Acceptance Criteria

1. WHEN Engine ต้องตัดสินใจอัปโหลดในขณะที่ยังไม่มี `Pacing_Plan` ของวันปัจจุบันตามเวลา `Asia/Bangkok`, THE Pacing_Planner SHALL สร้าง `Pacing_Plan` ที่มี 8 slot ความยาว 3 ชั่วโมงเท่ากัน โดยมีขอบเขตที่ 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00 และ 21:00 ถึง 24:00 ตามเวลา `Asia/Bangkok` และ SHALL อ่านวันปัจจุบันจากแหล่งเวลาเดียวที่ทดสอบแทนค่าได้
2. THE Pacing_Planner SHALL กระจาย `dailyAllowance` ให้ทุก slot โดยให้ค่าพื้นฐานของแต่ละ slot เท่ากับผลหารจำนวนเต็มของ `dailyAllowance` หารด้วย 8 แล้วแจกเศษที่เหลือ slot ละ 1 หน่วยตามลำดับนี้: 18:00–21:00, 21:00–24:00, 12:00–15:00, 15:00–18:00, 09:00–12:00, 06:00–09:00, 03:00–06:00, 00:00–03:00
3. IF `usedUploads` ของ slot ปัจจุบันมีค่าเท่ากับ `allowedUploads` ของ slot นั้น และผลรวม `usedUploads` ทุก slot ยังน้อยกว่า `dailyAllowance`, THEN THE Engine SHALL ตั้ง `Engine_Phase` เป็น `waiting_pacing` และตั้ง `nextActionAt` เป็นเวลาเริ่มของ slot ถัดไปที่มี `allowedUploads` มากกว่า `usedUploads`
4. WHEN การอัปโหลดสำเร็จ 1 คลิป, THE Pacing_Planner SHALL เพิ่ม `usedUploads` ของ slot ที่ครอบคลุมเวลาที่การอัปโหลดสำเร็จขึ้น 1 และบันทึก `Pacing_Plan` ลง `Persistent_Volume` ผ่าน `store.safeUpdate()`
5. WHERE Operator ตั้งค่า `pacing.mode` เป็น `burst`, THE Engine SHALL อัปโหลดต่อเนื่องโดยไม่ตั้ง `Engine_Phase` เป็น `waiting_pacing` จนกว่าผลรวม `usedUploads` ทุก slot จะเท่ากับ `dailyAllowance` หรือ quota หมดตาม Requirement 3
6. THE Pacing_Planner SHALL กำหนด `dailyAllowance` เป็นค่าที่น้อยกว่าระหว่าง `pacing.maxUploadsPerDay` (จำนวนเต็ม 1 ถึง 1000 และถือว่าไม่จำกัดเมื่อไม่ได้ตั้งค่าหรืออยู่นอกช่วงนี้) กับ `totalUploadsLeft` ที่รายงานโดย `quotaRotator`
7. FOR ALL `Pacing_Plan` ที่สร้างขึ้น ผลรวมของ `allowedUploads` ทุก slot SHALL เท่ากับ `dailyAllowance` โดยไม่มีเศษที่ถูกละทิ้ง (invariant)
8. WHEN process เริ่มทำงานใหม่ภายในวันเดียวกันตามเวลา `Asia/Bangkok`, THE Pacing_Planner SHALL ใช้ `Pacing_Plan` และค่า `usedUploads` ที่บันทึกไว้ต่อ แทนการสร้างแผนใหม่
9. WHEN `totalUploadsLeft` เพิ่มขึ้นระหว่างวันเพราะ Operator เพิ่ม account ใหม่, THE Pacing_Planner SHALL คำนวณ `dailyAllowance` ใหม่ตามข้อ 6 แล้วกระจายเฉพาะส่วนที่เพิ่มขึ้นไปยัง slot ที่ยังไม่สิ้นสุด ตามลำดับข้อ 2 และ SHALL ไม่แก้ `allowedUploads` หรือ `usedUploads` ของ slot ที่สิ้นสุดไปแล้ว
10. WHEN เวลาข้ามเข้าวันใหม่ตามเวลา `Asia/Bangkok` ขณะที่มีการอัปโหลดกำลังดำเนินอยู่, THE Engine SHALL ไม่ยกเลิกการอัปโหลดนั้น และ SHALL สร้าง `Pacing_Plan` ของวันใหม่ให้เสร็จก่อนตัดสินใจอัปโหลดคลิปถัดไป
11. THE Engine SHALL ใช้ `Pacing_Plan` กำหนดเฉพาะเวลาที่เรียก YouTube upload API และ SHALL ใช้ `seoService.getOptimalPublishTime()` กำหนดค่า `publishAt` ที่ทำให้คลิปเผยแพร่สู่สาธารณะ โดย SHALL ไม่หน่วงการอัปโหลดเพื่อรอเวลา `publishAt` และ SHALL ไม่เขียนทับ `publishAt` ด้วยขอบเขตเวลาของ slot

### Requirement 5: ความปลอดภัยของทรัพยากรสำหรับการรันไม่จำกัดเวลา

**User Story:** As an Operator, I want Engine ดูแลดิสก์และหน่วยความจำของตัวเอง, so that ระบบไม่ล้มเพราะ volume เต็มหลังรันไปหลายวัน

#### Acceptance Criteria

1. WHEN `Cycle` จบลง, THE Retention_Manager SHALL ลบไฟล์วิดีโอที่ดาวน์โหลดและไฟล์ที่แปลงแล้วซึ่งงานอัปโหลดที่เกี่ยวข้องอยู่ในสถานะสุดท้ายแล้ว (`done`, `failed` ที่ไม่มี retry เหลือ หรือ `cancelled`) และ SHALL ไม่ลบไฟล์ที่งานอัปโหลดยังอยู่ในสถานะ `pending` หรือ `processing` (invariant: ไฟล์ที่ยังอัปโหลดไม่จบต้องไม่ถูกลบ)
2. WHEN `Cycle` จบลง, THE Retention_Manager SHALL ลบไฟล์ใน `downloads/tiktok`, `downloads/transformed` และ `downloads/temp` ที่เก่ากว่า `C.HEALTH.TEMP_FILE_MAX_AGE_MS` โดยใช้เวลาไม่เกิน 60 วินาทีต่อรอบ และ SHALL ไม่หน่วงการเริ่ม `Cycle` ถัดไป
3. BEFORE เริ่มดาวน์โหลดวิดีโอ, THE Engine SHALL ตรวจพื้นที่ว่างของ `Persistent_Volume` ที่ mount ไว้ (ไม่ใช่ root ของ container) ผ่าน `diskGuard.assertSpace()` โดยใช้เกณฑ์พื้นที่ว่างขั้นต่ำเท่ากับค่าที่มากกว่าระหว่าง 10 เปอร์เซ็นต์ของความจุ volume กับ 1024 MB
4. IF พื้นที่ว่างต่ำกว่าเกณฑ์ในข้อ 3, THEN THE Engine SHALL รัน Retention_Manager หนึ่งรอบ แล้วตรวจพื้นที่อีกครั้ง โดยทำวนได้ไม่เกิน 2 รอบต่อ 1 `Cycle`
5. IF พื้นที่ว่างยังต่ำกว่าเกณฑ์หลังครบ 2 รอบตามข้อ 4, THEN THE Engine SHALL ตั้ง `Engine_Phase` เป็น `paused_health`, ตั้ง `nextActionAt` เป็นเวลาปัจจุบันบวก 15 นาที และ dispatch event `engine:blocked` พร้อมเหตุผล `disk_full` โดย SHALL dispatch event นี้ด้วยเหตุผลเดิมซ้ำได้ไม่เกิน 1 ครั้งต่อ 6 ชั่วโมง
6. WHILE `Engine_Phase` เท่ากับ `paused_health` ด้วยเหตุผล `disk_full`, THE Supervisor SHALL ตั้ง `Engine_Phase` เป็น `idle` เมื่อพื้นที่ว่างมีค่าตั้งแต่ 1.5 เท่าของเกณฑ์ในข้อ 3 ขึ้นไปติดกัน 2 ช่วง tick และสถานะ health เป็น `healthy` หรือ `warning`
7. THE Retention_Manager SHALL จำกัดจำนวนไฟล์ log ไว้ไม่เกิน `C.LOGGER.MAX_FILES` และขนาดต่อไฟล์ไม่เกิน `C.LOGGER.MAX_FILE_SIZE_BYTES` โดยตรวจขนาดทุกครั้งที่เขียน log และ SHALL คงขนาดรวมของ `logs/` ไว้ไม่เกิน `C.LOGGER.MAX_FILE_SIZE_BYTES × C.LOGGER.MAX_FILES` ตลอดช่วงการเขียนต่อเนื่องไม่น้อยกว่า 7 วัน
8. WHILE Engine ทำงานต่อเนื่อง, THE Engine SHALL คง `heapPercentUsed` ที่รายงานโดย health service ไว้ต่ำกว่า 80 เปอร์เซ็นต์ และ SHALL คงค่าเฉลี่ยเคลื่อนที่ของ `heapPercentUsed` ทุก 20 `Cycle` ให้เปลี่ยนแปลงไม่เกิน 5 จุดเปอร์เซ็นต์เมื่อเทียบกับค่าเฉลี่ยของ 20 `Cycle` ก่อนหน้า
9. THE Retention_Manager SHALL คงจำนวนรายการใน `uploads.json` ไว้ไม่เกิน 5000 รายการล่าสุด และ WHEN จำนวนเกินค่านั้น, THE Retention_Manager SHALL ย้ายรายการเก่าที่สุดไปเก็บในไฟล์ archive บน `Persistent_Volume` โดยคงค่า `tiktok_video_id` และ `source_url` ของทุกรายการที่ย้ายไว้ในรูปแบบที่ Safety_Gate อ่านเพื่อตรวจซ้ำได้
10. THE Retention_Manager SHALL คงจำนวนรายการใน `hashes.json` ไว้ไม่เกิน `C.HEALTH.MAX_HASH_ENTRIES` และคงขนาดรวมของ `data/` ไว้ไม่เกิน 20 เปอร์เซ็นต์ของความจุ `Persistent_Volume`
11. WHEN `Cycle` จบลงในขณะที่อัตราการใช้พื้นที่ของ `Persistent_Volume` มีค่าตั้งแต่ 70 เปอร์เซ็นต์ขึ้นไป, THE Retention_Manager SHALL รันหนึ่งรอบทันที และ THE Engine_Status SHALL รายงาน `volumeCapacityBytes`, `volumeFreeBytes` และ `volumePercentUsed`

### Requirement 6: ด่านตรวจความปลอดภัยเนื้อหาในโหมดไม่มีคนคุม

**User Story:** As an Operator, I want ทุกคลิปที่ Engine อัปเองผ่านการตรวจ monetization และตรวจซ้ำเสมอ, so that ช่องไม่ถูก demonetize หรือได้ strike ตอนที่ไม่มีใครเฝ้า

#### Acceptance Criteria

1. BEFORE เข้าคิวอัปโหลดทุกคลิป, THE Safety_Gate SHALL เรียก `seoService.validateForMonetization()` กับข้อมูลคลิปนั้น และ IF การเรียกโยน error หรือคืนค่า `status` ที่ไม่ใช่ `ok`, `warning` หรือ `blocked`, THEN THE Safety_Gate SHALL ถือว่าคลิปนั้นไม่ผ่านและข้ามคลิปนั้นด้วยเหตุผล `validation_error`
2. IF ผลการตรวจมี `status` เท่ากับ `blocked`, THEN THE Safety_Gate SHALL ข้ามคลิปนั้น, SHALL งดเรียก YouTube upload API สำหรับคลิปนั้น, SHALL ลบไฟล์ชั่วคราวของคลิปนั้น และ SHALL dispatch event `seo:validation_issue` พร้อม `{ tiktokVideoId, sourceUrl, issues }`
3. IF ผลการตรวจมี `status` เท่ากับ `warning` และ Operator ตั้งค่า `safety.autonomousAllowWarned` เป็น `false`, THEN THE Safety_Gate SHALL ข้ามคลิปนั้นด้วยเหตุผล `warning`
4. BEFORE เข้าคิวอัปโหลดทุกคลิป, THE Safety_Gate SHALL ตรวจว่าคลิปนั้นซ้ำกับรายการใน `uploads.json` และไฟล์ archive ตาม Requirement 5 ข้อ 9 โดยเทียบ `source_url` และ `tiktok_video_id`
5. IF คลิปซ้ำกับรายการที่อัปแล้ว, THEN THE Safety_Gate SHALL ข้ามคลิปนั้นและ dispatch event `upload:duplicate_detected`
6. THE Engine SHALL ส่งคลิปที่ผ่าน Safety_Gate เข้า Video Transform ก่อนอัปโหลดทุกคลิป
7. THE Engine_Status SHALL รายงานจำนวนคลิปที่ถูกข้ามในรอบล่าสุด แยกตามเหตุผลจากชุดนี้เท่านั้น: `duplicate`, `blocked`, `warning`, `low_score`, `validation_error`, `transform_failed`, `disk_full`, `quota_exhausted` โดยแต่ละคลิปที่ถูกข้าม SHALL ถูกนับด้วยเหตุผลเดียว และผลรวมของทุกเหตุผล SHALL เท่ากับจำนวนคลิปที่ถูกข้ามทั้งหมดในรอบนั้น (invariant)
8. IF Video Transform คืนค่าที่ระบุว่าไม่ได้แปลงไฟล์ (รวมกรณีที่ล้มเหลวแล้วคืนไฟล์ต้นฉบับ กรณีที่ข้ามเพราะไฟล์ใหญ่เกินกำหนด และกรณีที่การตั้งค่า `videoTransform.enabled` เป็น `false`), THEN THE Engine SHALL งดอัปโหลดคลิปนั้น, ข้ามคลิปนั้นด้วยเหตุผล `transform_failed` และลบไฟล์ที่ดาวน์โหลดไว้ เพื่อไม่ให้คลิปที่ไม่ผ่านการ transform ถูกอัปขึ้นช่องและเสี่ยงถูกจัดเป็น Reused Content
9. IF ในหนึ่ง `Cycle` มีคลิปที่ผ่านการตรวจตามข้อ 1 ตั้งแต่ 10 คลิปขึ้นไป และสัดส่วนของคลิปที่ได้ `status` เท่ากับ `blocked` มีค่าตั้งแต่ 0.40 ขึ้นไป, THEN THE Engine SHALL หยุดเข้าคิวคลิปที่เหลือในรอบนั้น, ตั้ง `Engine_Phase` เป็น `paused_manual` และ dispatch event `engine:blocked` พร้อมเหตุผล `content_safety_ratio` และ SHALL คงสถานะนั้นไว้จนกว่า Operator จะเรียก `POST /api/engine/start`
10. THE Engine SHALL งดใช้พารามิเตอร์ที่ข้าม Safety_Gate (รวม `force`) ในทุกเส้นทางที่ Engine เป็นผู้เริ่ม และ FOR ALL คลิปที่ Engine อัปโหลด คลิปนั้น SHALL ผ่านการตรวจตามข้อ 1 และข้อ 4 มาแล้วทุกคลิป (invariant)

### Requirement 7: การมองเห็นสถานะและการควบคุม

**User Story:** As an Operator, I want รู้ได้ทันทีว่า Engine กำลังทำอะไรและจะทำอะไรต่อเมื่อไร, so that มั่นใจได้ว่าระบบยังทำงานอยู่และสั่งหยุด/เริ่มได้จากที่ไหนก็ได้

#### Acceptance Criteria

1. THE Engine SHALL ให้ `GET /api/engine/status` คืน `Engine_Status` ที่ประกอบด้วย `phase`, `desiredState`, `nextActionAt`, `cycleCount`, `consecutiveErrors`, `lastCycleSummary`, `quota`, `pacing`, `lastError`, `uptimeSeconds`, `instanceId`, `instanceStartedAt`, `lastHeartbeatAt` และ `heartbeatAgeSeconds` โดย SHALL ตอบกลับภายใน 2000 มิลลิวินาที และ SHALL ไม่เรียก YouTube API ในการสร้าง response นี้
2. THE Engine SHALL ให้ค่า `nextActionAt` เป็นสตริง ISO 8601 ทุกครั้งที่ `Engine_Phase` เป็นหนึ่งใน `idle`, `waiting_quota`, `waiting_pacing`, `degraded`, `paused_health`
3. WHEN `Engine_Status` เปลี่ยนแปลง, THE Engine SHALL broadcast ผ่าน WebSocket ด้วย message type `engine:status`
4. WHEN Operator ที่ผ่านการยืนยันตัวตนเรียก `POST /api/engine/start`, THE Engine SHALL ตั้ง `Desired_State` เป็น `running`, บันทึกลง `Persistent_Volume` และเริ่ม `Cycle` ภายใน 1 ช่วง tick
5. WHEN Operator ที่ผ่านการยืนยันตัวตนเรียก `POST /api/engine/stop`, THE Engine SHALL ตั้ง `Desired_State` เป็น `stopped`, ตั้ง `nextActionAt` เป็น `null` และตั้ง `Engine_Phase` เป็น `stopped` หลังงานที่กำลังอัปโหลดอยู่จบลง และ WHEN process เริ่มทำงานใหม่หลังจากนั้น, THE Engine SHALL คง `Engine_Phase` ไว้เป็น `stopped`
6. WHEN Operator ที่ผ่านการยืนยันตัวตนเรียก `POST /api/engine/pause`, THE Engine SHALL ตั้ง `Engine_Phase` เป็น `paused_manual`, คง `Desired_State` ไว้เป็น `running`, คงค่า `cycleCount` และ `Pacing_Plan` ไว้ และ WHEN process เริ่มทำงานใหม่หลังจากนั้น, THE Engine SHALL กู้คืน `Engine_Phase` เป็น `paused_manual`
7. IF `Engine_Phase` คงค่าเดิมนานเกินงบเวลาของ phase นั้น โดยงบเวลาคือ `discovering` 600 วินาที, `uploading` 3600 วินาที, `idle` 300 วินาที, `degraded` 2100 วินาที, `paused_health` 21600 วินาที, `waiting_quota` และ `waiting_pacing` เท่ากับระยะเวลาถึง `nextActionAt` บวก 300 วินาที และไม่ตรวจสำหรับ `stopped` กับ `paused_manual`, THEN THE Engine SHALL dispatch event `engine:stuck` พร้อม `{ phase, stuckForSeconds, lastActivityAt }` และ SHALL dispatch event นี้ซ้ำสำหรับ phase เดิมได้ไม่เกิน 1 ครั้งต่อ 1800 วินาที
8. WHERE Operator ตั้งค่า `alerts.webhookUrl`, WHEN เกิด event `engine:degraded`, `engine:stuck` หรือ `engine:blocked`, THE Engine SHALL ส่ง HTTP POST ไปยัง URL นั้นโดยห่อการเรียกด้วย `guarded()` ด้วย timeout 10 วินาทีและ retry ไม่เกิน 3 ครั้ง และ SHALL งดส่ง HTTP POST เมื่อไม่เกิด event เหล่านี้
9. THE Engine SHALL ส่ง payload ของ webhook ที่ประกอบด้วย `event`, `occurredAt`, `instanceId`, `phase`, `desiredState`, `reason`, `nextActionAt`, `cycleCount`, `consecutiveErrors`, `stuckForSeconds`, `lastCycleSummary`, `quota`, `activeAccountId`, `lastError` และ `suppressedCount` และ SHALL งดส่ง webhook ซ้ำสำหรับชุด `event` + `reason` + `phase` เดิมภายใน 1800 วินาที, SHALL ส่ง webhook รวมไม่เกิน 6 ครั้งต่อชั่วโมง และ SHALL รายงานจำนวนที่ถูกระงับไว้ใน `suppressedCount` ของการส่งครั้งถัดไป
10. IF คำขอไปยัง `POST /api/engine/start`, `POST /api/engine/stop` หรือ `POST /api/engine/pause` ไม่ผ่านการยืนยันตัวตน, THEN THE Engine SHALL ปฏิเสธคำขอนั้น, SHALL ไม่เปลี่ยน `Desired_State` หรือ `Engine_Phase` และ SHALL บันทึก log โดยไม่บันทึกค่า credential ที่ส่งมา
11. THE Engine SHALL จำกัดอัตราคำขอไปยัง `POST /api/engine/start`, `POST /api/engine/stop` และ `POST /api/engine/pause` รวมกันไว้ไม่เกิน 10 คำขอต่อ 60 วินาทีต่อต้นทาง และจำกัด `GET /api/engine/status` ไว้ไม่เกิน 60 คำขอต่อ 60 วินาทีต่อต้นทาง โดยคำขอที่เกินขอบเขต SHALL ไม่เปลี่ยน `Desired_State` หรือ `Engine_Phase`
12. THE Engine SHALL ไม่รวมค่า OAuth token, `refresh_token`, client secret, `DASHBOARD_PASSWORD`, session cookie หรือค่า `alerts.webhookUrl` ไว้ใน `Engine_Status`, ข้อความ WebSocket, payload ของ webhook หรือ activity log และ SHALL ตัด credential และ query string ออกจากข้อความใน `lastError`
13. THE Engine SHALL ปรับค่า `lastHeartbeatAt` ทุก tick แม้ `Engine_Phase` เป็น `idle`, `waiting_quota` หรือ `waiting_pacing`, SHALL บันทึกค่านั้นลง `Persistent_Volume` อย่างน้อยทุก 60 วินาที และ SHALL รายงาน `heartbeatAgeSeconds` เพื่อให้แยกได้ว่า Engine ยังทำงานอยู่แต่ว่าง (`heartbeatAgeSeconds` ไม่เกิน 120) ออกจาก Engine ที่หยุดทำงาน (`heartbeatAgeSeconds` มากกว่า 180 หรือไม่ตอบกลับ)
14. THE Engine SHALL บันทึกสรุปของแต่ละ `Cycle` (เวลาเริ่ม, เวลาจบ, คลิปที่พบ, คลิปที่อัปสำเร็จ, คลิปที่ข้ามแยกตามเหตุผล, account ที่ใช้) ลง activity log

### Requirement 8: การ deploy บน cloud domain สำหรับรัน 24/7

**User Story:** As an Operator, I want deploy ระบบขึ้น cloud host ที่มี domain ของตัวเองและรันตลอดเวลา, so that ระบบทำงานต่อแม้ปิดโน้ตบุ๊ก, ทำ OAuth ได้จากเบราว์เซอร์ที่ไหนก็ได้ และ token ไม่หายเมื่อ redeploy

#### Acceptance Criteria

1. THE Deployment_Runtime SHALL mount `Persistent_Volume` ที่ `data/` (ความจุไม่น้อยกว่า 1 GB), `logs/` (ไม่น้อยกว่า 500 MB) และ `downloads/` (ไม่น้อยกว่า 5 GB) เพื่อให้ OAuth token, `Engine_State`, `uploads.json`, log และไฟล์ที่ดาวน์โหลดค้างไว้คงอยู่ข้าม restart และ redeploy โดยการ redeploy SHALL ผูก `Persistent_Volume` ชุดเดิมกลับเข้ากับ container ใหม่ และ SHALL ไม่สร้าง volume ใหม่
2. WHEN container เริ่มทำงาน, THE Engine SHALL อ่าน Google OAuth client credentials จาก environment variable `GOOGLE_CREDENTIALS_JSON` เมื่อ environment variable นั้นมีค่า และ SHALL ใช้ค่า `APP_URL` เป็น origin ของ redirect URI แทนค่า `redirect_uris` ที่มาพร้อม credential โดย redirect URI ที่ Engine ใช้ SHALL มีค่าเท่ากับ `<APP_URL>/oauth2callback` และ SHALL ตรงแบบตัวอักษรต่อตัวอักษรกับ Authorized redirect URI ที่ลงทะเบียนไว้ใน Google Cloud Console
3. IF ไม่มีทั้ง `GOOGLE_CREDENTIALS_JSON` และไฟล์ `client_secret.json`, หรือ `APP_URL` ไม่ถูกตั้งค่า, หรือ `APP_URL` ไม่ได้เริ่มต้นด้วย `https://`, THEN THE Engine SHALL บันทึก log ระดับ error พร้อมชื่อ environment variable ที่ขาดหรือไม่ถูกต้อง, ปฏิเสธการสร้าง OAuth authorization URL พร้อมข้อความที่ระบุว่า redirect URI ตั้งค่าไม่ถูกต้อง และคง `Engine_Phase` ไว้เป็น `stopped`
4. THE Deployment_Runtime SHALL ตั้ง environment variable `TZ` เป็น `Asia/Bangkok` และ Engine SHALL คำนวณ `Quota_Reset_Time` จาก timezone `America/Los_Angeles` โดยไม่พึ่งค่า `TZ`
5. THE Deployment_Runtime SHALL รัน process ภายใต้ `scripts/supervise.js` หรือ process manager ของ platform เพื่อรองรับการ `process.exit(1)` จาก `uncaughtException` และ SHALL เริ่ม process ใหม่อัตโนมัติภายใน 60 วินาที ทุกครั้งที่ process ออกด้วย exit code ที่ไม่เท่ากับ 0 โดยไม่จำกัดจำนวนครั้ง
6. WHEN เวลาผ่านไปครบทุก 24 ชั่วโมง, THE Engine SHALL สร้างสำเนาสำรองของ `data/accounts.json` และ `uploads.json` ไว้ใน `Persistent_Volume` โดยเก็บสำเนาย้อนหลังไม่เกิน 7 ชุด และลบชุดที่เก่ากว่านั้น
7. IF ไฟล์ `data/accounts.json` อ่านไม่ได้หรือ parse ไม่สำเร็จ, THEN THE Engine SHALL กู้คืนจากสำเนาสำรองล่าสุดที่ parse สำเร็จ, บันทึก log ระดับ error พร้อมเวลาของสำเนาที่ใช้กู้ และ SHALL ไม่เขียนทับไฟล์ที่เสียหายจนกว่าการกู้คืนจะสำเร็จ
8. THE Engine SHALL ให้ `GET /api/health/live` ตอบสถานะ 200 เมื่อ HTTP server รับ request ได้, ให้ `GET /api/health/ready` ตอบสถานะ 200 เมื่อ Engine อ่าน `Engine_State` สำเร็จแล้ว และให้ `GET /api/health/ready` รายงานหลักฐานความคงอยู่ของข้อมูลประกอบด้วย สถานะเขียนได้ของ `data/`, จำนวน account ที่มี token, จำนวนรายการใน `uploads.json` และเวลาเขียนข้อมูลล่าสุดในรูปแบบ ISO 8601 เพื่อให้ Operator เทียบค่าก่อนและหลัง redeploy ได้
9. IF environment variable `DASHBOARD_PASSWORD` ไม่ถูกตั้งค่าหรือมีความยาวน้อยกว่า 12 ตัวอักษร ในขณะที่ `NODE_ENV` เท่ากับ `production`, THEN THE Engine SHALL บันทึก log ระดับ error พร้อมชื่อ environment variable ที่ขาดทันทีที่ process เริ่มทำงาน, ปฏิเสธ request ทุกตัวภายใต้ `/api/*` ยกเว้น `/api/health/live` และ `/api/health/ready` และคง `Engine_Phase` ไว้เป็น `stopped`
10. WHERE Operator ตั้งค่า `engine.autoStartOnBoot` เป็น `true`, THE Engine SHALL ตั้ง `Desired_State` เป็น `running` เมื่อ process เริ่มทำงาน โดยไม่ต้องมีการเรียก API
11. THE Deployment_Runtime SHALL จัดสรรหน่วยความจำให้ container ไม่น้อยกว่า 768 MB (ffmpeg 1 งานพร้อมกันตาม `VT_CONCURRENCY=1` ไม่เกิน 400 MB บวก Node heap ไม่เกิน 300 MB บวก runtime พื้นฐานไม่เกิน 100 MB โดยไม่นับ chromium เพราะ runtime path ของระบบไม่เรียก puppeteer) และ SHALL จัดสรรพื้นที่ดิสก์รวมไม่น้อยกว่า 10 GB
12. THE Deployment_Runtime SHALL ใช้แผนบริการที่มีค่าใช้จ่ายคงที่ต่อเดือนไม่เกิน 15 USD และ SHALL ไม่ใช้รายการคิดค่าบริการแบบผันแปรตามปริมาณที่ไม่มีเพดาน
13. THE Deployment_Runtime SHALL ให้บริการผ่าน HTTPS บน custom domain ด้วย certificate ที่ยังไม่หมดอายุ, SHALL ต่ออายุ certificate อัตโนมัติก่อนหมดอายุไม่น้อยกว่า 14 วัน และ SHALL redirect request ที่เข้ามาทาง HTTP ไปยัง URL เดียวกันบน HTTPS ทุก path (Google OAuth ปฏิเสธ redirect URI ที่ไม่ใช่ HTTPS สำหรับ host ที่ไม่ใช่ localhost)
14. WHEN Operator เปิด `<APP_URL>` จากเบราว์เซอร์บนเครื่องใดก็ได้แล้วเริ่ม OAuth consent flow, THE Engine SHALL ทำ flow จนจบและบันทึก token ลง `Persistent_Volume` ได้โดยไม่ต้องเข้าถึงเครื่อง local ของ Operator และโดยไม่ใช้ URL ที่ชี้ไปยัง localhost ในขั้นตอนใด
15. IF การ refresh token ของ account ใดล้มเหลวเพราะ grant ถูกเพิกถอนหรือไม่ถูกต้อง, THEN THE Engine SHALL ทำเครื่องหมาย account นั้นเป็น `reauth_required`, งดเลือก account นั้นใน `quotaRotator`, dispatch event `auth:logout` และรายงานสถานะนั้นใน `Engine_Status` เพื่อให้ Operator ทำ consent flow ใหม่ผ่าน `<APP_URL>` (token ที่แลกไว้ก่อนเปลี่ยน domain ยังใช้ได้ต่อ เพราะ redirect URI ถูกตรวจเฉพาะตอนแลก authorization code)
16. THE Deployment_Runtime SHALL ใช้แผนบริการที่ไม่ระงับ (sleep / suspend / scale-to-zero) instance เมื่อไม่มี HTTP request เข้ามา และ SHALL ไม่พึ่งพา traffic จากภายนอกเพื่อคง process ให้ทำงานต่อ
17. IF ผลต่างระหว่างเวลาปัจจุบันกับ `lastTickAt` ที่บันทึกไว้มีค่ามากกว่า 5 เท่าของช่วง tick, THEN THE Engine SHALL บันทึก log ระดับ error พร้อมระยะเวลาที่ขาดหาย และ dispatch event `engine:blocked` พร้อมเหตุผล `runtime_suspended`
18. THE Deployment_Runtime SHALL ถูกประกาศไว้ในไฟล์ config ที่ commit อยู่ในรีโป (Dockerfile และไฟล์ config ของ platform) ครอบคลุม restart policy, volume mount point และขนาด, resource limit และรายชื่อ environment variable ที่ต้องใช้ โดย SHALL ไม่ต้องมีขั้นตอนตั้งค่าผ่านการคลิกใน UI ของ platform นอกเหนือจากการใส่ค่า secret ผ่าน secret store ของ platform

### Requirement 9: พฤติกรรมระหว่าง restart และ deploy

**User Story:** As an Operator, I want deploy ใหม่ได้โดยไม่เกิดคลิปซ้ำหรือข้อมูลหาย, so that อัปเดตระบบได้ระหว่างที่ Engine กำลังทำงาน

#### Acceptance Criteria

1. WHEN Engine ได้รับสัญญาณ `SIGTERM`, THE Engine SHALL ตั้ง `Engine_Phase` เป็น `stopped` ใน `Engine_State` และเรียก `store.flushAll()` ให้เสร็จก่อน process ออก โดย SHALL งดสร้างรายการ `inFlight` ใหม่ในขั้นตอนปิดระบบ (ทุกรายการ `inFlight` ต้องถูกเขียนไว้ก่อนเริ่มอัปโหลดแล้วตามข้อ 7)
2. WHEN Engine ได้รับสัญญาณ `SIGTERM` ขณะที่มีการอัปโหลดหนึ่งงานกำลังส่งข้อมูลไปยัง YouTube, THE Engine SHALL รอให้การอัปโหลดนั้นจบไม่เกิน `SHUTDOWN_TIMEOUT_MS` (ค่าเริ่มต้น 20000 มิลลิวินาที) แล้วจึงปิดระบบ และ SHALL คงรายการของงานนั้นไว้ใน `inFlight` ทุกกรณีที่ยังไม่ได้บันทึกลง `uploads.json`
3. WHEN process เริ่มทำงานใหม่และพบรายการใน `inFlight`, THE Engine SHALL ตรวจสอบผลการอัปโหลดของรายการนั้นให้เสร็จก่อนจัดเข้าคิวใหม่ ตามลำดับนี้: (ก) เมื่อรายการมี `videoId` บันทึกไว้ ให้เรียก `youtube.videos.list` ด้วย `videoId` นั้น (1 unit); (ข) เมื่อรายการไม่มี `videoId` ให้เรียก `youtube.channels.list` เพื่อหา uploads playlist ของ `accountId` ที่บันทึกไว้ (1 unit) แล้วเรียก `youtube.playlistItems.list` อ่านคลิปล่าสุดไม่เกิน 50 รายการ (1 unit) และถือว่าตรงกันเมื่อพบคลิปที่ `title` ตรงกันทุกตัวอักษรกับ `title` ในรายการ และมีเวลาเผยแพร่ไม่เก่ากว่า `startedAt` ของรายการนั้น; THE Engine SHALL ใช้ quota ในการตรวจสอบไม่เกิน 3 units ต่อรายการต่อการเริ่ม process หนึ่งครั้ง, SHALL งดเรียก `youtube.search.list` (100 units) ในการตรวจสอบนี้ และ SHALL จัดคลิปเข้าคิวอัปโหลดใหม่เฉพาะเมื่อการตรวจสอบสำเร็จและไม่พบคลิปที่ตรงกัน โดยใช้ไฟล์เดิมบน `Persistent_Volume` เมื่อไฟล์นั้นยังมีอยู่และมีขนาดมากกว่า 0 ไบต์ และดาวน์โหลดใหม่เมื่อไฟล์นั้นหายไปหรือมีขนาด 0 ไบต์
4. IF การตรวจสอบตามข้อ 3 พบคลิปที่ตรงกันบน YouTube, THEN THE Engine SHALL บันทึกรายการนั้นลง `uploads.json` ให้เสร็จก่อน แล้วจึงลบรายการออกจาก `inFlight` และ SHALL งดเรียก YouTube upload API สำหรับคลิปนั้นอีก
5. FOR ALL จุดที่ process หยุดทำงาน รวมกรณี `SIGKILL` และไฟดับ จำนวนรายการใน `uploads.json` ที่มี `tiktok_video_id` เดียวกัน SHALL มีค่าไม่เกิน 1 และจำนวนคลิปบน YouTube ที่เกิดจาก `uploadIntentId` เดียวกัน SHALL มีค่าไม่เกิน 1 (invariant)
6. WHEN process เริ่มทำงานใหม่, THE Engine SHALL คงค่า `cycleCount` และ `Pacing_Plan.usedUploads` ของวันปัจจุบันไว้ต่อจากค่าที่บันทึกไว้
7. THE Engine SHALL บันทึกทุกการเปลี่ยนแปลง `Engine_State`, `Pacing_Plan` และ `uploads.json` ผ่าน `store.safeUpdate()` เท่านั้น และ SHALL ทำทุกการอัปโหลดตามลำดับ reserve → upload → record ดังนี้: (1) เขียนรายการ `inFlight` ที่ประกอบด้วย `uploadIntentId`, `tiktok_video_id`, `source_url`, `accountId`, `title`, `filepath` และ `startedAt` แล้วรอให้การเขียนนั้นสำเร็จ (2) เรียก YouTube upload API (3) บันทึก `videoId` ที่ได้รับลงรายการ `inFlight` เดิมแล้วรอให้การเขียนนั้นสำเร็จ (4) บันทึกรายการลง `uploads.json` (5) ลบรายการออกจาก `inFlight`
8. WHEN Engine ได้รับสัญญาณ `SIGTERM` ขณะที่ Video Transform กำลังทำงานกับคลิปที่ยังไม่มีการเรียก YouTube upload API, THE Engine SHALL ยุติ ffmpeg ทันทีผ่าน `videoTransform.killAll('shutdown')` โดยไม่รอครบ `SHUTDOWN_TIMEOUT_MS`, ลบไฟล์ผลลัพธ์ที่แปลงไม่จบใน `downloads/transformed`, คงไฟล์ต้นฉบับที่ดาวน์โหลดไว้ใน `downloads/tiktok` เพื่อให้ `Cycle` ถัดไปใช้ซ้ำได้, งดสร้างรายการใน `inFlight` และงดเขียน `uploads.json` สำหรับคลิปนั้น และ SHALL ให้ `Retention_Manager` ลบไฟล์ต้นฉบับนั้นเมื่อไฟล์เก่ากว่า 24 ชั่วโมงและยังไม่มีรายการที่ตรงกันใน `uploads.json`
9. WHEN process เริ่มทำงานใหม่และ `Engine_State` ที่อ่านได้ระบุ `phase` เป็นค่าอื่นที่ไม่ใช่ `stopped` (บ่งชี้ว่า process ก่อนหน้าถูกยุติโดยไม่มี graceful shutdown เช่น `SIGKILL` หรือไฟดับ), THE Engine SHALL ตรวจสอบทุกรายการใน `inFlight` ตามข้อ 3 ให้จบก่อนเริ่ม `Cycle` ใหม่, คง `Desired_State` ตามค่าที่บันทึกไว้ และ SHALL งดพึ่งพาขั้นตอนปิดระบบในการสร้างรายการ `inFlight`
10. IF การตรวจสอบตามข้อ 3 ไม่สำเร็จเพราะเรียก YouTube API ไม่ได้หรือ quota รวมของทุก account เหลือน้อยกว่า 3 units, THEN THE Engine SHALL เพิ่ม `reconcileAttempts` ของรายการนั้นขึ้น 1, คงรายการไว้ใน `inFlight`, งดจัดคลิปนั้นเข้าคิว, ดำเนินการ `Cycle` ต่อกับคลิปอื่น และเมื่อ `reconcileAttempts` มีค่าตั้งแต่ 3 ขึ้นไป SHALL ย้ายรายการนั้นออกจาก `inFlight` ไปยังรายการที่รอตรวจสอบด้วยมือ แล้ว dispatch event `engine:blocked` พร้อมเหตุผล `unverified_upload`

### Requirement 10: การรวมเข้ากับ EventBus และ service เดิม

**User Story:** As a developer, I want Engine ใช้ทางเดินข้อมูลเดิมของระบบ, so that stats, dashboard และ notification ยังถูกต้องและไม่นับซ้ำ

#### Acceptance Criteria

1. THE Engine SHALL เข้าคิวอัปโหลดผ่าน `uploadQueue.add()` เท่านั้น (Path B), SHALL งดเรียก `orchestrator.onUploadCompleted()` จากภายใน task function และ SHALL ระบุ `source` เท่ากับ `tiktok_watchlist` ในผลลัพธ์ของทุกงานที่เข้าคิว เพื่อให้ `sourceStats` นับที่มาของการอัปโหลดอัตโนมัติได้
2. THE Engine SHALL dispatch event ทุกตัวผ่าน method ของ `orchestrator` โดย SHALL งด import `eventbus` โดยตรง และ SHALL งดเรียก `stats.safeUpdate()`, `broadcast()` หรือ `activityLogger.log()` โดยตรง
3. THE Engine SHALL ใช้ชื่อ event จากชุดปิดนี้เท่านั้นสำหรับ event ใหม่: `engine:state_changed`, `engine:cycle_started`, `engine:cycle_completed`, `engine:degraded`, `engine:stuck`, `engine:blocked`, `engine:quota_wait` และ SHALL เพิ่มรายการ event ทั้ง 7 ตัวนี้ในตาราง event ของ `.kiro/steering/architecture.md`
4. WHEN Engine เริ่มควบคุมลูป, THE Engine SHALL เรียก `scheduler.requestLoopStop()` แล้วรอจนกว่า `scheduler.getLoopState().running` มีค่าเป็น `false` ภายในไม่เกิน 2 ช่วง tick ก่อนเริ่ม `Cycle` แรก
5. FOR ALL ช่วงเวลาที่ Engine ทำงาน, `watchlist.runAll()` SHALL ถูกเรียกโดย Engine เท่านั้น และ `scheduler.getLoopState().running` SHALL มีค่าเป็น `false` (invariant: มีเจ้าของลูปเพียงหนึ่งเดียว)
6. IF `watchlist.runAll()` ถูกเรียกขณะที่รอบก่อนหน้ายังทำงานอยู่, THEN THE Engine SHALL ข้ามการเรียกนั้น, รับค่า `skippedReason` เท่ากับ `already_running` และบันทึก log ระดับ warn หนึ่งรายการต่อการข้ามที่เกิดขึ้นจริงหนึ่งครั้ง และ FOR ALL ช่วงเวลา จำนวนการทำงานพร้อมกันของ `watchlist.runAll()` SHALL มีค่าไม่เกิน 1
7. THE `scheduler` SHALL คงหน้าที่เฉพาะการสแกนโฟลเดอร์ตามช่วงเวลาและ folder watcher ซึ่งเข้าคิวด้วย `source` เท่ากับ `folder` และ `scheduler.scan()` SHALL งดเรียก `runWatchlist()` และ `_startContinuousLoop()` ต่อท้าย
8. THE Engine SHALL ลงทะเบียน EventBus rule สำหรับ event ใหม่ทุกตัวโดยกำหนด priority ตามตารางในเอกสาร steering คือ 15 สำหรับ `engine:degraded`, `engine:stuck` และ `engine:blocked` และ 5 สำหรับ `engine:state_changed`, `engine:cycle_started`, `engine:cycle_completed` และ `engine:quota_wait` และ rule ทั้งหมด SHALL ปรากฏในผลลัพธ์ของ `orchestrator.getRules()`
9. WHEN การอัปโหลดหนึ่งคลิปสำเร็จ, THE Engine SHALL ทำให้เกิด event `upload:completed` จำนวน 1 ครั้ง, event `stats:increment` ที่มี `type` เท่ากับ `upload` จำนวน 1 ครั้ง, `totalUploads` เพิ่มขึ้น 1 และ `sourceStats.tiktok_watchlist` เพิ่มขึ้น 1 (invariant กันการนับซ้ำ)
10. WHEN การอัปโหลดหนึ่งคลิปล้มเหลวถาวร, THE Engine SHALL ทำให้เกิด event `upload:failed` จำนวน 1 ครั้ง และ SHALL ไม่ทำให้เกิด event `upload:completed` สำหรับคลิปเดียวกัน
11. WHEN event `health:status_changed` มีค่าใหม่เป็น `critical`, THE Engine SHALL ตั้ง `Engine_Phase` เป็น `paused_health` ภายในไม่เกิน 1 ช่วง tick โดยไม่รอให้ `Cycle` ปัจจุบันจบ และ SHALL หยุดเข้าคิวคลิปเพิ่ม
12. THE Engine SHALL ห่อการเรียกออกนอกระบบทุกครั้งด้วย `guarded()` จาก `src/utils/resilience.js` ครอบคลุมการเรียก YouTube API, การค้นหาและดาวน์โหลด TikTok, การเรียก ffmpeg และการส่ง webhook และ SHALL ไม่มีเส้นทางใดที่เรียกบริการภายนอกโดยข้าม `guarded()`

---

## คำถามที่ยังต้องยืนยันก่อนเข้า Design

1. ~~**จะ deploy ที่ไหน**~~ — ✅ **ยืนยันแล้ว: cloud host + custom domain + HTTPS ไม่พึ่งเครื่อง local** แต่ยังต้องเลือก **platform** ให้ชัด เพราะกระทบข้อ 8.1 (Render รองรับ 1 volume, Fly.io/Railway รองรับหลาย mount) และข้อ 8.16 (free tier บางเจ้า sleep = ทำลาย 24/7 ทันที) — ตัวเลือกที่ผ่านเกณฑ์: **Fly.io (Singapore)**, **Railway**, หรือ **VPS + Docker Compose + Caddy**
2. **มี Google Cloud Project / YouTube account กี่ตัวสำหรับ rotation** — 1 ตัว = 6 อัป/วัน, 3 ตัว = 18 อัป/วัน ตัวเลขนี้กำหนดค่า `dailyAllowance` และการกระจายใน 8 slot
3. **อยากอัปกี่คลิปต่อวัน และแบบไหน** — `paced` (กระจาย 8 slot เน้น 18:00–24:00) หรือ `burst` (อัปรวดเดียวจนหมด quota)
4. **ให้ Engine เริ่มทำงานเองเมื่อ boot ไหม** (`engine.autoStartOnBoot`) — สำหรับ 24/7 ที่ไม่มีคนคุม แนะนำ `true`
5. **ต้องการ alert ไปที่ไหน** — webhook (Discord / Slack / LINE) หรือดูใน dashboard เท่านั้น
6. **domain ที่จะใช้** — ต้องรู้ชื่อ domain เพื่อกำหนด `APP_URL` และไปลงทะเบียน Authorized redirect URI ใน Google Cloud Console (ถ้าไม่ลงทะเบียน OAuth login จะพังเงียบ)
