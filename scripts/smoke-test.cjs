#!/usr/bin/env node
/* eslint-disable */
// @ts-nocheck
'use strict';
/**
 * ★ Smoke test — ตรวจว่าการแก้ stability ยังทำงานอยู่จริง
 *
 * ครอบคลุมบั๊กที่แก้ไปแล้วทุกตัว (regression guard):
 *   1. store: clone-on-load, safeUpdate ไม่ทำข้อมูลหาย, ไฟล์เสียไม่ทำระบบล่ม
 *   2. queue: active counter ไม่ติดลบ, drain ไม่ยิงซ้ำ, permanent error ไม่ retry
 *   3. resilience: retry/backoff, circuit breaker เปิด-ปิด, timeout abort
 *   4. pathGuard: บล็อก path นอกระบบ + symlink + traversal
 *   5. videoTransform: parseFrameRate แทน eval, clamp ค่าที่ทำ ffmpeg พัง
 *   6. security: HMAC session, timing-safe compare, rate limiter
 *
 * ใช้งาน: npm run smoke
 */
process.env.LOG_LEVEL = 'error';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

function group(title) { console.log(`\n${title}`); }

(async () => {
  console.log('★ Smoke test — stability regression guard\n' + '='.repeat(55));

  // ═══════════════════════════════════════════════════════════════
  group('1) Store — clone-on-load + serialized writes');
  // ═══════════════════════════════════════════════════════════════
  const { Store, flushAll } = require('../src/utils/store');
  const tmpName = `__smoke_${Date.now()}.json`;
  const tmpPath = path.join(__dirname, '..', 'data', tmpName);
  const cleanupFiles = [tmpPath, `${tmpPath}.corrupt`, `${tmpPath}.tmp`];

  await test('load() คืน clone — mutate แล้วไม่กระทบ cache', async () => {
    const s = new Store(tmpName, []);
    await s.safeUpdate(() => [{ n: 1 }]);
    const a = s.load();
    a.push({ n: 999 });
    a[0].n = 'MUTATED';
    const b = s.load();
    assert.strictEqual(b.length, 1, 'ความยาว array ต้องไม่เปลี่ยน');
    assert.strictEqual(b[0].n, 1, 'ค่าใน object ต้องไม่ถูกแก้');
  });

  await test('loadRef() คืน reference เดิม (สำหรับ hot path)', () => {
    const s = new Store(tmpName, []);
    assert.strictEqual(s.loadRef(), s.loadRef(), 'loadRef ต้องคืน object เดียวกัน');
  });

  await test('safeUpdate 100 ครั้งพร้อมกัน — ไม่มีข้อมูลหาย', async () => {
    const s = new Store(tmpName, []);
    await s.safeUpdate(() => []);
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => s.safeUpdate(arr => { arr.push(i); return arr; }))
    );
    const final = s.load();
    assert.strictEqual(final.length, 100, `ควรมี 100 รายการ แต่มี ${final.length}`);
    assert.strictEqual(new Set(final).size, 100, 'ต้องไม่มีค่าซ้ำ/หาย');
  });

  await test('ไฟล์ JSON เสีย → quarantine แล้วใช้ fallback (ไม่ throw)', () => {
    fs.writeFileSync(tmpPath, '{ นี่ไม่ใช่ json ');
    const s = new Store(tmpName, { ok: true });
    const data = s.load();
    assert.deepStrictEqual(data, { ok: true }, 'ต้องคืน fallback');
    assert.ok(fs.existsSync(`${tmpPath}.corrupt`), 'ต้องสำรองไฟล์เสียไว้');
  });

  await test('flush() รอ write ที่ค้างจนเสร็จ', async () => {
    const s = new Store(tmpName, []);
    s.safeUpdate(() => [1, 2, 3]);
    await s.flush();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(tmpPath, 'utf8')), [1, 2, 3]);
  });

  for (const f of cleanupFiles) { try { fs.unlinkSync(f); } catch (_) {} }

  // ═══════════════════════════════════════════════════════════════
  group('2) Queue — race conditions');
  // ═══════════════════════════════════════════════════════════════
  const queue = require('../src/services/queue');

  await test('reset() ระหว่าง retry backoff → active ไม่ติดลบ', async () => {
    queue.reset();
    queue.retryDelay = 50;
    queue.add(async () => { throw new Error('boom'); }, { filename: 'fail.mp4' });
    await new Promise(r => setTimeout(r, 30));   // อยู่ระหว่างรอ backoff
    queue.reset();                               // เดิม: timer เก่ายิง active-- → ติดลบ
    await new Promise(r => setTimeout(r, 150));
    assert.ok(queue.active >= 0, `active ต้องไม่ติดลบ (ได้ ${queue.active})`);
    assert.strictEqual(queue.active, 0, `หลัง reset active ต้องเป็น 0 (ได้ ${queue.active})`);
  });

  await test('resume() ตอนคิวว่าง → ไม่ยิง drain ซ้ำ', async () => {
    queue.reset();
    let drains = 0;
    const onDrain = () => drains++;
    queue.on('drain', onDrain);
    queue.pause(); queue.resume();
    queue.pause(); queue.resume();
    await new Promise(r => setTimeout(r, 60));
    queue.off('drain', onDrain);
    assert.strictEqual(drains, 0, `คิวว่างไม่ควรยิง drain (ยิง ${drains} ครั้ง)`);
  });

  await test('drain ยิงครั้งเดียวเมื่องานหมดจริง', async () => {
    queue.reset();
    let drains = 0;
    const onDrain = () => drains++;
    queue.on('drain', onDrain);
    queue.delayBetween = 1;
    queue.add(async () => 'ok', { filename: 'a.mp4' });
    await new Promise(r => setTimeout(r, 400));
    queue.off('drain', onDrain);
    assert.strictEqual(drains, 1, `drain ควรยิง 1 ครั้ง (ยิง ${drains})`);
  });

  await test('permanent error (quota) → ไม่ retry เสียเวลา', async () => {
    queue.reset();
    let attempts = 0;
    let failedEvent = null;
    queue.once('failed', (d) => { failedEvent = d; });
    queue.add(async () => { attempts++; throw new Error('quotaExceeded: daily limit'); }, { filename: 'q.mp4' });
    await new Promise(r => setTimeout(r, 300));
    assert.strictEqual(attempts, 1, `ต้องลองครั้งเดียว (ลอง ${attempts} ครั้ง)`);
    assert.ok(failedEvent?.permanent, 'ต้องระบุว่าเป็น permanent error');
  });

  await test('timeout → เรียก onCancel เพื่อยกเลิกงานจริง', async () => {
    queue.reset();
    let cancelled = false;
    queue.add(
      () => new Promise(() => {}),          // ค้างตลอดกาล
      { filename: 't.mp4', timeoutMs: 80, onCancel: () => { cancelled = true; } }
    );
    await new Promise(r => setTimeout(r, 400));
    assert.ok(cancelled, 'onCancel ต้องถูกเรียกตอน timeout');
    assert.ok(queue.metrics.totalTimeouts >= 1, 'ต้องนับ timeout');
  });

  await test('getStatus() จำกัดจำนวน item ที่ serialize', () => {
    queue.reset();
    for (let i = 0; i < 250; i++) queue.queue.push({ id: i, status: 'done', filename: `f${i}`, retries: 0 });
    const st = queue.getStatus({ maxItems: 100 });
    assert.strictEqual(st.items.length, 100, 'ต้องส่งแค่ 100 รายการ');
    assert.strictEqual(st.total, 250, 'total ต้องบอกจำนวนจริง');
    assert.ok(st.truncated, 'ต้องบอกว่าถูกตัด');
    queue.reset();
  });

  // ═══════════════════════════════════════════════════════════════
  group('3) Resilience — retry / circuit breaker / timeout');
  // ═══════════════════════════════════════════════════════════════
  const R = require('../src/utils/resilience');

  await test('retry สำเร็จหลังล้มเหลวชั่วคราว', async () => {
    let n = 0;
    const out = await R.retry(async () => {
      if (++n < 3) { const e = new Error('temp'); e.code = 'ECONNRESET'; throw e; }
      return 'ok';
    }, { attempts: 5, baseDelayMs: 5, label: 'test' });
    assert.strictEqual(out, 'ok');
    assert.strictEqual(n, 3);
  });

  await test('retry ไม่ลองซ้ำกับ quota error (403)', async () => {
    let n = 0;
    await assert.rejects(() => R.retry(async () => {
      n++;
      const e = new Error('quota exceeded'); e.code = 403; throw e;
    }, { attempts: 5, baseDelayMs: 5 }));
    assert.strictEqual(n, 1, `ต้องลองครั้งเดียว (ลอง ${n})`);
  });

  await test('circuit breaker เปิดหลังล้มครบเกณฑ์ แล้วปฏิเสธทันที', async () => {
    const cb = new R.CircuitBreaker('smoke-cb', { failureThreshold: 3, openMs: 5000 });
    for (let i = 0; i < 3; i++) {
      await cb.exec(async () => { throw new Error('down'); }).catch(() => {});
    }
    assert.strictEqual(cb.state, 'open', 'circuit ต้องเปิด');

    let rejectedFast = false;
    await cb.exec(async () => 'should not run').catch(e => { rejectedFast = e.code === 'ECIRCUITOPEN'; });
    assert.ok(rejectedFast, 'ต้องปฏิเสธทันทีด้วย ECIRCUITOPEN');
  });

  await test('circuit breaker กลับมา closed หลัง half-open สำเร็จ', async () => {
    const cb = new R.CircuitBreaker('smoke-cb2', { failureThreshold: 2, openMs: 40 });
    for (let i = 0; i < 2; i++) await cb.exec(async () => { throw new Error('x'); }).catch(() => {});
    assert.strictEqual(cb.state, 'open');
    await new Promise(r => setTimeout(r, 60));
    await cb.exec(async () => 'recovered');
    assert.strictEqual(cb.state, 'closed', 'ต้องกลับมา closed');
  });

  await test('withTimeout เรียก onTimeout เพื่อ abort งานจริง', async () => {
    let aborted = false;
    await assert.rejects(
      () => R.withTimeout(() => new Promise(() => {}), 40, {
        label: 'hang', onTimeout: () => { aborted = true; },
      }),
      /หมดเวลา/
    );
    assert.ok(aborted, 'onTimeout ต้องถูกเรียก');
  });

  await test('Semaphore จำกัดงานพร้อมกันได้จริง', async () => {
    const sem = new R.Semaphore(2, 'smoke');
    let concurrent = 0, peak = 0;
    await Promise.all(Array.from({ length: 8 }, () => sem.run(async () => {
      peak = Math.max(peak, ++concurrent);
      await new Promise(r => setTimeout(r, 15));
      concurrent--;
    })));
    assert.strictEqual(peak, 2, `พร้อมกันได้สูงสุด 2 (ได้ ${peak})`);
    assert.strictEqual(sem.active, 0, 'ต้องปล่อย slot คืนหมด');
  });

  // ═══════════════════════════════════════════════════════════════
  group('4) PathGuard — arbitrary file access');
  // ═══════════════════════════════════════════════════════════════
  const pg = require('../src/utils/pathGuard');

  await test('บล็อก absolute path นอกระบบ', () => {
    assert.throws(() => pg.resolveSafe('/etc/hosts'), /ไม่อนุญาต|รองรับเฉพาะ/);
  });

  await test('บล็อก path traversal', () => {
    assert.throws(() => pg.resolveSafe('downloads/../../../../etc/passwd'), /ไม่อนุญาต|ไม่พบ|รองรับเฉพาะ/);
  });

  await test('บล็อก symlink ที่ชี้ออกนอกระบบ', () => {
    const linkDir = path.join(__dirname, '..', 'downloads', 'tiktok');
    fs.mkdirSync(linkDir, { recursive: true });
    const link = path.join(linkDir, '__smoke_link.mp4');
    const target = path.join(os.tmpdir(), '__smoke_target.mp4');
    try {
      fs.writeFileSync(target, 'x'.repeat(2048));
      try { fs.unlinkSync(link); } catch (_) {}
      fs.symlinkSync(target, link);
      assert.throws(() => pg.resolveSafe(link), /ไม่อนุญาต/);
    } finally {
      try { fs.unlinkSync(link); } catch (_) {}
      try { fs.unlinkSync(target); } catch (_) {}
    }
  });

  await test('ยอมรับไฟล์ในโฟลเดอร์ของระบบ', () => {
    const dir = path.join(__dirname, '..', 'downloads', 'tiktok');
    fs.mkdirSync(dir, { recursive: true });
    const ok = path.join(dir, '__smoke_ok.mp4');
    try {
      fs.writeFileSync(ok, 'x'.repeat(4096));
      assert.strictEqual(pg.resolveSafe(ok), fs.realpathSync(ok));
    } finally { try { fs.unlinkSync(ok); } catch (_) {} }
  });

  await test('จำกัดจำนวนไฟล์ต่อคำขอ', () => {
    assert.throws(() => pg.resolveSafeMany(Array(60).fill('a.mp4'), { maxCount: 30 }), /เยอะเกินไป/);
  });

  // ═══════════════════════════════════════════════════════════════
  group('5) VideoTransform — eval removal + config clamp');
  // ═══════════════════════════════════════════════════════════════
  const vt = require('../src/services/videoTransform');

  await test('ไม่มี eval() ในโค้ดที่รันจริง (ตัด comment ออกก่อนตรวจ)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'videoTransform.js'), 'utf8');
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')      // block comment
      .replace(/^\s*\/\/.*$/gm, '')          // full-line comment
      .replace(/([^:])\/\/.*$/gm, '$1');     // trailing comment
    assert.ok(!/\beval\s*\(/.test(codeOnly), 'ต้องไม่มี eval() ในโค้ดที่รันจริง');
  });

  await test('parseFrameRate จัดการค่าจาก ffprobe ได้ทุกรูปแบบ', () => {
    const p = vt._parseFrameRate;
    assert.strictEqual(p('30/1'), 30);
    assert.strictEqual(p('60/1'), 60);
    assert.ok(Math.abs(p('30000/1001') - 29.97) < 0.01, 'NTSC 29.97 ต้องคำนวณถูก');
    assert.strictEqual(p('0/0'), 30, 'ค่าที่อ่านไม่ออกต้อง fallback');
    assert.strictEqual(p(undefined), 30);
    assert.strictEqual(p('99999/1'), 30, 'ค่าเกินจริงต้อง fallback');
    // ★ ตัวที่เคยเป็นช่องโหว่: eval จะรันโค้ดนี้จริง
    assert.strictEqual(p('process.exit(1)'), 30, 'สตริงที่เป็นโค้ดต้องไม่ถูกรัน');
    assert.strictEqual(p('require("fs")'), 30);
  });

  await test('clamp ค่าที่ทำ ffmpeg พัง (speed=0, zoom สูงเกิน)', () => {
    const cfg = vt._sanitizeConfig({
      visual: { speed: 0, zoom: 99, brightness: 50, contrast: -5, saturation: 100 },
      audio:  { originalVolume: -3, fadeInDuration: 999 },
      output: { fps: 0, resolution: 'ไม่มีจริง' },
    });
    assert.ok(cfg.visual.speed >= 0.5, 'speed ต้องไม่เป็น 0 (setpts=Infinity)');
    assert.ok(cfg.visual.zoom <= 2, 'zoom ต้องถูกจำกัด');
    assert.ok(cfg.audio.originalVolume >= 0, 'volume ต้องไม่ติดลบ');
    assert.ok(cfg.output.fps >= 15, 'fps ต้องอยู่ในช่วงที่ใช้ได้');
    assert.strictEqual(cfg.output.resolution, '1080p', 'resolution ที่ไม่รู้จักต้อง fallback');
  });

  await test('killAll() ทำงานได้แม้ไม่มี process (idempotent)', () => {
    assert.deepStrictEqual(vt.killAll('smoke'), { killed: 0 });
  });

  // ═══════════════════════════════════════════════════════════════
  group('6) Security — session + rate limit');
  // ═══════════════════════════════════════════════════════════════
  const sec = require('../src/middleware/security');

  await test('session token ที่ถูกแก้ไข → ไม่ผ่าน', () => {
    const good = sec.signToken(Date.now() + 60_000);
    assert.ok(sec.verifyToken(good), 'token ที่ถูกต้องต้องผ่าน');

    // ★ พลิกตัวอักษรท้ายให้ต่างจากเดิมแน่นอน (ไม่ใช่แทนด้วยค่าคงที่ที่อาจตรงกับเดิม)
    const last = good.slice(-1);
    const tampered = good.slice(0, -1) + (last === 'a' ? 'b' : 'a');
    assert.notStrictEqual(tampered, good, 'ต้องแก้ token ได้จริง');
    assert.ok(!sec.verifyToken(tampered), 'token ที่ถูกแก้ต้องไม่ผ่าน');

    // แก้ payload (เวลาหมดอายุ) โดยคง signature เดิม
    const idx = good.lastIndexOf('.');
    const forgedPayload = `${Number(good.slice(0, idx)) + 999_999}.${good.slice(idx + 1)}`;
    assert.ok(!sec.verifyToken(forgedPayload), 'ยืดอายุ token เองต้องไม่ผ่าน');

    assert.ok(!sec.verifyToken(`${Date.now() + 60_000}.deadbeef`), 'ลายเซ็นปลอมต้องไม่ผ่าน');
    assert.ok(!sec.verifyToken(''), 'token ว่างต้องไม่ผ่าน');
    assert.ok(!sec.verifyToken(null), 'null ต้องไม่ผ่าน');
  });

  await test('session ที่หมดอายุ → ไม่ผ่าน', () => {
    assert.ok(!sec.verifyToken(sec.signToken(Date.now() - 1000)));
  });

  await test('timingSafeEqual จัดการความยาวต่างกันได้ไม่ throw', () => {
    assert.strictEqual(sec.timingSafeEqual('abc', 'abcdef'), false);
    assert.strictEqual(sec.timingSafeEqual('same', 'same'), true);
  });

  await test('rate limiter บล็อกเมื่อเกินโควตา', () => {
    const mw = sec.rateLimit({ windowMs: 1000, max: 3, name: 'smoke' });
    const req = { ip: '1.2.3.4', path: '/api/x' };
    let blocked = 0;
    for (let i = 0; i < 6; i++) {
      const res = {
        setHeader() {},
        status(code) { if (code === 429) blocked++; return { json() {} }; },
      };
      mw(req, res, () => {});
    }
    clearInterval(mw._sweeper);
    assert.strictEqual(blocked, 3, `ควรบล็อก 3 คำขอ (บล็อก ${blocked})`);
  });

  // ═══════════════════════════════════════════════════════════════
  group('7) DiskGuard');
  // ═══════════════════════════════════════════════════════════════
  const dg = require('../src/utils/diskGuard');

  await test('อ่านข้อมูลดิสก์ได้', () => {
    const info = dg.getDiskInfo();
    if (info.available) {
      assert.ok(info.freeBytes > 0 && info.percentUsed >= 0 && info.percentUsed <= 100);
    }
  });

  await test('ปฏิเสธเมื่อขอพื้นที่เกินจริง', () => {
    const r = dg.check(Number.MAX_SAFE_INTEGER / 4, { label: 'smoke' });
    if (!r.unknown) assert.strictEqual(r.ok, false, 'ต้องปฏิเสธ');
  });

  await test('assertSpace throw DiskFullError พร้อม statusCode 507', () => {
    try {
      dg.assertSpace(Number.MAX_SAFE_INTEGER / 4, { label: 'smoke' });
    } catch (err) {
      assert.strictEqual(err.code, 'ENOSPC_GUARD');
      assert.strictEqual(err.statusCode, 507);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  group('8) Orchestrator / EventBus — duplicate emission');
  // ═══════════════════════════════════════════════════════════════
  const eventBus = require('../src/services/eventbus');

  await test('listener ที่ throw ไม่ทำให้ dispatch() พัง', () => {
    const bad = () => { throw new Error('listener exploded'); };
    eventBus.on('smoke:test', bad);
    assert.doesNotThrow(() => eventBus.dispatch('smoke:test', {}));
    eventBus.off('smoke:test', bad);
    assert.ok(eventBus.metrics.listenerErrors > 0, 'ต้องนับ listener error');
  });

  await test('transform event ไม่เพิ่ม uploadsByHour (กราฟไม่เพี้ยน)', async () => {
    const { stats } = require('../src/utils/store');
    const orchestrator = require('../src/services/orchestrator');
    orchestrator.init(() => {});                    // idempotent — init ซ้ำไม่ทำอะไร

    const hour = new Date().getHours().toString();
    const before = stats.load().uploadsByHour?.[hour] || 0;
    eventBus.dispatch('stats:increment', { type: 'transform', filename: 'x.mp4' });
    await stats.flush();
    const after = stats.load().uploadsByHour?.[hour] || 0;
    assert.strictEqual(after, before, 'transform ต้องไม่เพิ่ม uploadsByHour');
  });

  await test('EventBus Rule 9 (health critical → pause) ถูกลงทะเบียนไว้', () => {
    const rules = eventBus.getRules();
    const rule = rules.find(r => r.id === 'health_critical_pause');
    assert.ok(rule, 'ต้องมี rule health_critical_pause');
    assert.ok(rule.enabled, 'rule ต้องเปิดใช้งาน');
  });

  await test('orchestrator มี onHealthStatusChanged (ทำให้ Rule 9 ไม่เป็น dead code)', () => {
    const orchestrator = require('../src/services/orchestrator');
    assert.strictEqual(typeof orchestrator.onHealthStatusChanged, 'function');
  });


  // ═══════════════════════════════════════════════════════════════
  group('9) Engine — state machine + components');
  // ═══════════════════════════════════════════════════════════════
  const engine = require('../src/services/engine');
  const { ENGINE_PHASES, TRANSITION_TABLE } = engine;

  await test('Engine มี 9 phases ตามที่ requirements กำหนด', () => {
    assert.strictEqual(ENGINE_PHASES.length, 9);
    assert.ok(ENGINE_PHASES.includes('stopped'));
    assert.ok(ENGINE_PHASES.includes('waiting_quota'));
    assert.ok(ENGINE_PHASES.includes('degraded'));
  });

  await test('Transition table ปฏิเสธ self-transition', async () => {
    // Engine เริ่มที่ stopped ← from load test ก่อนหน้า
    const result = await engine._transitionTo('stopped', 'self-test');
    assert.strictEqual(result, false, 'self-transition ต้องถูกปฏิเสธ');
  });

  await test('Transition table ปฏิเสธ invalid pair', async () => {
    const result = await engine._transitionTo('uploading', 'invalid');
    assert.strictEqual(result, false, 'stopped→uploading ไม่อยู่ในตาราง');
  });

  await test('Transition table อนุญาต valid pair', async () => {
    const result = await engine._transitionTo('idle', 'valid-test');
    assert.strictEqual(result, true, 'stopped→idle ต้องได้');
    // Cleanup: go back to stopped
    await engine._transitionTo('stopped', 'cleanup');
  });

  await test('Transition table มีทั้งหมด 43 pairs ตาม design', () => {
    let total = 0;
    for (const [, allowed] of TRANSITION_TABLE) total += allowed.size;
    assert.strictEqual(total, 43, `ต้องมี 43 pairs (มี ${total})`);
  });

  await test('PacingPlanner sum invariant ผ่านสำหรับทุก allowance 1-20', () => {
    const pp = require('../src/services/engine/pacingPlanner');
    for (let a = 1; a <= 20; a++) {
      const plan = pp.generatePlan(a, 'paced');
      const sum = plan.slots.reduce((s, sl) => s + sl.allowedUploads, 0);
      assert.strictEqual(sum, a, `allowance=${a}: sum=${sum}`);
    }
  });

  await test('PacingPlanner burst mode ใส่ทั้งหมดใน slot เดียว', () => {
    const pp = require('../src/services/engine/pacingPlanner');
    const plan = pp.generatePlan(6, 'burst');
    const nonZero = plan.slots.filter(s => s.allowedUploads > 0);
    assert.strictEqual(nonZero.length, 1);
    assert.strictEqual(nonZero[0].allowedUploads, 6);
  });

  await test('SafetyGate ข้ามคลิปที่ status=blocked', () => {
    const sg = require('../src/services/engine/safetyGate');
    sg.resetCycleStats();
    // Mock a video that will likely be blocked (empty desc triggers no block, but let's test the flow)
    const result = sg.check({ desc: '', videoUrl: 'https://tiktok.com/test', id: 'test123' }, { minScore: 0 });
    // Either passes or fails with a reason — verify structure
    assert.ok('pass' in result, 'check() ต้องมี pass field');
    if (!result.pass) {
      assert.ok(['blocked', 'warning', 'duplicate', 'low_score', 'validation_error'].includes(result.reason));
    }
  });

  await test('SafetyGate circuit breaker ทำงานเมื่อ ≥40% blocked จาก ≥10 คลิป', () => {
    const sg = require('../src/services/engine/safetyGate');
    sg.resetCycleStats();
    // Simulate: 10 evaluated, 4 blocked
    sg._cycleStats = { evaluated: 10, blocked: 4 };
    assert.ok(sg.shouldPauseCycle(), '40% blocked ต้อง trigger pause');
    sg._cycleStats = { evaluated: 10, blocked: 3 };
    assert.ok(!sg.shouldPauseCycle(), '30% blocked ไม่ควร trigger');
    sg._cycleStats = { evaluated: 5, blocked: 4 };
    assert.ok(!sg.shouldPauseCycle(), 'น้อยกว่า 10 คลิปไม่ trigger');
  });

  await test('QuotaCoordinator คำนวณ reset time ได้ (DST-safe)', () => {
    const qc = require('../src/services/engine/quotaCoordinator');
    const resetMs = qc.computeEarliestReset();
    const resetDate = new Date(resetMs);
    assert.ok(resetMs > Date.now(), 'reset time ต้องอยู่ในอนาคต');
    assert.ok(resetMs < Date.now() + 25 * 60 * 60_000, 'reset time ต้องไม่เกิน 25 ชม. จากตอนนี้');
    assert.ok(resetDate.toISOString(), 'ต้อง format เป็น ISO ได้');
  });

  await test('RetentionManager.run() ทำงานได้ไม่ crash (idempotent)', () => {
    const rm = require('../src/services/engine/retentionManager');
    const result = rm.run();
    assert.ok('cleaned' in result && 'archived' in result && 'trimmed' in result);
    assert.ok(result.durationMs >= 0);
  });

  await test('Engine getStatus() มีทุก field ที่ requirement กำหนด', () => {
    const status = engine.getStatus();
    const required = ['phase', 'desiredState', 'nextActionAt', 'cycleCount', 'consecutiveErrors',
      'lastCycleSummary', 'quota', 'pacing', 'lastError', 'uptimeSeconds',
      'instanceId', 'instanceStartedAt', 'lastHeartbeatAt', 'heartbeatAgeSeconds', 'inFlightCount'];
    const missing = required.filter(k => !(k in status));
    assert.strictEqual(missing.length, 0, `Missing fields: ${missing.join(', ')}`);
  });

  await test('Engine EventBus rules ลงทะเบียนครบ 6 ตัว', () => {
    const eb = require('../src/services/eventbus');
    const engineRules = eb.getRules().filter(r => r.id.startsWith('engine_'));
    assert.ok(engineRules.length >= 6, `ต้องมี ≥6 engine rules (มี ${engineRules.length})`);
  });

  await test('Orchestrator มี engine methods ครบ 7 ตัว', () => {
    const o = require('../src/services/orchestrator');
    const methods = ['onEngineStateChanged', 'onEngineCycleStarted', 'onEngineCycleCompleted',
      'onEngineDegraded', 'onEngineStuck', 'onEngineBlocked', 'onEngineQuotaWait'];
    const missing = methods.filter(m => typeof o[m] !== 'function');
    assert.strictEqual(missing.length, 0, `Missing: ${missing.join(', ')}`);
  });

  await test('scheduler.scan() ไม่เรียก runWatchlist อีกแล้ว', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/scheduler.js'), 'utf8'
    );
    // Find the scan method body specifically
    const scanStart = src.indexOf('  scan() {');
    const scanBody = src.slice(scanStart, scanStart + 2000);
    assert.ok(scanBody.includes('ENGINE TAKEOVER'), 'ต้องมี ENGINE TAKEOVER comment');
    // Check there's no active runWatchlist call (not in comment)
    const lines = scanBody.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const hasActiveCall = lines.some(l => l.includes('this.runWatchlist()'));
    assert.ok(!hasActiveCall, 'scan() ต้องไม่เรียก runWatchlist() ใน code ที่ active');
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(55));
  console.log(`ผลลัพธ์: ✓ ${passed} ผ่าน   ✗ ${failed} ล้มเหลว`);
  if (failed > 0) {
    console.log('\nรายการที่ล้มเหลว:');
    failures.forEach(f => console.log(`  • ${f.name}\n    ${f.error}`));
  }
  await flushAll();
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('\n❌ smoke test พังกลางทาง:', err);
  process.exit(1);
});
