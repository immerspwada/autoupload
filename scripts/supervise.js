#!/usr/bin/env node
/**
 * ★ Supervisor — รัน server.js แล้วปลุกกลับอัตโนมัติเมื่อ crash
 *
 * ทำไมต้องมี:
 *   เดิม uncaughtException ถูก log แล้วปล่อยให้ process วิ่งต่อด้วย state ที่พังแล้ว
 *   → เขียนข้อมูลผิดเงียบๆ, quota นับเพี้ยน, ffmpeg ค้าง
 *   ตอนนี้ server ออกด้วย exit 1 เมื่อ state ไม่น่าเชื่อถือ — ตัวนี้คือคนปลุกกลับ
 *
 * คุณสมบัติ:
 *   - Exponential backoff (1s → 2s → ... → 60s) กัน restart รวดเดี่ยวเผาซีพียู
 *   - Crash loop detection: crash เร็วติดกันหลายครั้ง → หยุดแล้วบอกให้ดู log
 *   - ส่งต่อ SIGTERM/SIGINT ให้ลูกปิดตัวเองอย่างปลอดภัย (ไม่ kill -9)
 *   - exit 0 = ตั้งใจปิด → supervisor ออกตาม ไม่ restart
 *
 * ใช้งาน: npm run start:supervised
 */
const { spawn } = require('child_process');
const path = require('path');

const SERVER      = path.join(__dirname, '..', 'server.js');
const MIN_UPTIME_MS = 20_000;   // อยู่ได้เกินนี้ = ถือว่า start สำเร็จ → reset backoff
const MAX_BACKOFF_MS = 60_000;
const MAX_FAST_CRASHES = 8;     // crash เร็วติดกันเกินนี้ → ยอมแพ้

let child = null;
let fastCrashes = 0;
let shuttingDown = false;
let restarts = 0;

const ts = () => new Date().toISOString();
const log = (msg) => console.log(`[supervisor ${ts()}] ${msg}`);

function backoffMs() {
  return Math.min(1000 * 2 ** Math.max(0, fastCrashes - 1), MAX_BACKOFF_MS);
}

function start() {
  const startedAt = Date.now();
  log(`เริ่ม server (restart #${restarts})`);

  child = spawn(process.execPath, [SERVER], {
    stdio: 'inherit',
    env: { ...process.env, SUPERVISED: '1' },
  });

  child.on('exit', (code, signal) => {
    const uptime = Date.now() - startedAt;
    child = null;

    if (shuttingDown) {
      log('ปิดตามคำสั่ง — supervisor ออกด้วย');
      process.exit(code ?? 0);
    }

    // ตั้งใจปิด (exit 0) → ไม่ต้อง restart
    if (code === 0 && !signal) {
      log('server ปิดตัวเองปกติ (exit 0) — ไม่ restart');
      process.exit(0);
    }

    if (uptime >= MIN_UPTIME_MS) {
      fastCrashes = 0;   // อยู่ได้นานพอ = ไม่ใช่ crash loop
    } else {
      fastCrashes++;
    }

    if (fastCrashes >= MAX_FAST_CRASHES) {
      log(`❌ server crash เร็วติดกัน ${fastCrashes} ครั้ง — หยุด restart`);
      log('   ตรวจ log ที่ logs/ แล้วแก้ปัญหาก่อนเริ่มใหม่');
      process.exit(1);
    }

    const delay = backoffMs();
    restarts++;
    log(`server ออก (code=${code} signal=${signal}) หลังทำงาน ${Math.round(uptime / 1000)}s — restart ในอีก ${delay / 1000}s`);
    setTimeout(start, delay);
  });

  child.on('error', (err) => {
    log(`เริ่ม server ไม่สำเร็จ: ${err.message}`);
  });
}

// ── ส่งต่อสัญญาณปิดให้ลูก (ให้ลูก flush ข้อมูลเอง) ──────────────
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${sig} — ส่งต่อให้ server ปิดอย่างปลอดภัย`);
    if (child) {
      child.kill(sig);
      // ถ้าลูกไม่ยอมตายใน 25s ให้บังคับ (server ตั้ง deadline ตัวเองไว้ 20s)
      setTimeout(() => {
        if (child) { log('server ไม่ตอบสนอง — บังคับปิด'); child.kill('SIGKILL'); }
      }, 25_000).unref();
    } else {
      process.exit(0);
    }
  });
}

start();
