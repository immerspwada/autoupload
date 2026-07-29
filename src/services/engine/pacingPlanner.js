/**
 * ★ Pacing Planner — กระจายอัปโหลด 8 slot/วัน เน้น prime time
 *
 * Slot: 8 ช่วง × 3 ชั่วโมง (00:00–03:00, 03:00–06:00, ..., 21:00–24:00) ตาม Asia/Bangkok
 * Distribution priority: 18–21 > 21–24 > 12–15 > 15–18 > 09–12 > 06–09 > 03–06 > 00–03
 * Mode: 'paced' (กระจาย) หรือ 'burst' (อัปทั้งหมดทันที)
 */
'use strict';

const logger = require('../../utils/logger');

// Slot priority order (index in 8-slot array → priority rank)
// Slots: [0]=00-03, [1]=03-06, [2]=06-09, [3]=09-12, [4]=12-15, [5]=15-18, [6]=18-21, [7]=21-24
const PRIORITY_ORDER = [6, 7, 4, 5, 3, 2, 1, 0]; // indices sorted by priority (highest first)

class PacingPlanner {
  /**
   * สร้าง Pacing_Plan ของวันนี้
   * @param {number} dailyAllowance จำนวนอัปโหลดที่อนุญาตต่อวัน
   * @param {'paced'|'burst'} mode
   * @returns {object} PacingPlan
   */
  generatePlan(dailyAllowance, mode = 'paced') {
    const today = this._getTodayBangkok();
    const slots = this._createSlots(today);

    if (mode === 'burst') {
      // Burst: ใส่ทั้งหมดใน slot แรกที่ยังไม่หมด (current or next)
      const now = new Date();
      let targetIdx = slots.findIndex(s => new Date(s.slotEnd) > now);
      if (targetIdx === -1) targetIdx = 0;
      slots[targetIdx].allowedUploads = dailyAllowance;
    } else {
      // Paced: กระจายตาม priority
      this._distribute(slots, dailyAllowance);
    }

    return {
      day: today,
      dailyAllowance,
      mode,
      slots,
    };
  }

  /**
   * ตรวจว่าอัปโหลดได้ตอนนี้ไหม
   * @param {object} plan PacingPlan
   * @returns {{ canUpload: boolean, reason?: string, nextSlotAt?: string }}
   */
  canUploadNow(plan) {
    if (!plan) return { canUpload: true }; // no plan = no restriction
    if (plan.mode === 'burst') {
      const totalUsed = plan.slots.reduce((s, sl) => s + sl.usedUploads, 0);
      if (totalUsed >= plan.dailyAllowance) {
        return { canUpload: false, reason: 'daily_limit_reached' };
      }
      return { canUpload: true };
    }

    const slot = this._currentSlot(plan);
    if (!slot) return { canUpload: false, reason: 'no_current_slot' };

    if (slot.usedUploads >= slot.allowedUploads) {
      // Find next slot with capacity
      const nextSlot = this._nextSlotWithCapacity(plan);
      if (!nextSlot) {
        return { canUpload: false, reason: 'daily_limit_reached' };
      }
      return {
        canUpload: false,
        reason: 'slot_full',
        nextSlotAt: nextSlot.slotStart,
      };
    }

    return { canUpload: true };
  }

  /**
   * บันทึกว่าอัปโหลดสำเร็จ 1 คลิป
   * @param {object} plan PacingPlan (mutated in place)
   */
  recordUpload(plan) {
    if (!plan) return;
    const slot = this._currentSlot(plan);
    if (slot) {
      slot.usedUploads++;
    } else {
      // Edge case: upload succeeded during slot boundary
      // Charge to the last slot
      const last = plan.slots[plan.slots.length - 1];
      if (last) last.usedUploads++;
    }
  }

  /**
   * เพิ่ม allowance เมื่อมี account ใหม่ระหว่างวัน
   * กระจายเฉพาะ slot ที่ยังไม่จบ
   */
  recomputeAllowance(plan, newDailyAllowance) {
    if (!plan || newDailyAllowance <= plan.dailyAllowance) return plan;

    const delta = newDailyAllowance - plan.dailyAllowance;
    plan.dailyAllowance = newDailyAllowance;

    if (plan.mode === 'burst') {
      // Add to current/next slot
      const now = new Date();
      const idx = plan.slots.findIndex(s => new Date(s.slotEnd) > now);
      if (idx >= 0) plan.slots[idx].allowedUploads += delta;
      return plan;
    }

    // Distribute delta to future slots only, in priority order
    const now = new Date();
    const futureIndices = plan.slots
      .map((s, i) => ({ i, end: new Date(s.slotEnd) }))
      .filter(s => s.end > now)
      .map(s => s.i);

    const futurePriority = PRIORITY_ORDER.filter(i => futureIndices.includes(i));

    let remaining = delta;
    for (const idx of futurePriority) {
      if (remaining <= 0) break;
      plan.slots[idx].allowedUploads++;
      remaining--;
    }
    // If still remaining (rare), just add to first future slot
    if (remaining > 0 && futurePriority.length > 0) {
      plan.slots[futurePriority[0]].allowedUploads += remaining;
    }

    return plan;
  }

  /**
   * ตรวจว่าวันเปลี่ยนแล้วหรือยัง (ต้องสร้าง plan ใหม่)
   */
  isDayChanged(plan) {
    if (!plan) return true;
    return plan.day !== this._getTodayBangkok();
  }

  /**
   * คำนวณ dailyAllowance จาก quota + settings
   */
  computeDailyAllowance(totalUploadsLeft, maxPerDay = null) {
    const max = (Number.isInteger(maxPerDay) && maxPerDay >= 1 && maxPerDay <= 1000) ? maxPerDay : Infinity;
    return Math.min(totalUploadsLeft, max);
  }

  // ── Private ───────────────────────────────────────────────────

  _distribute(slots, allowance) {
    const base = Math.floor(allowance / 8);
    let remainder = allowance - (base * 8);

    // Give base to everyone
    for (const slot of slots) {
      slot.allowedUploads = base;
    }

    // Distribute remainder in priority order
    for (const idx of PRIORITY_ORDER) {
      if (remainder <= 0) break;
      slots[idx].allowedUploads++;
      remainder--;
    }
  }

  _createSlots(dayStr) {
    // dayStr = "YYYY-MM-DD" in Asia/Bangkok
    const slots = [];
    for (let h = 0; h < 24; h += 3) {
      const start = this._bangkokToUTC(dayStr, h, 0);
      const end   = this._bangkokToUTC(dayStr, h + 3, 0);
      slots.push({
        slotStart: start,
        slotEnd: end,
        allowedUploads: 0,
        usedUploads: 0,
      });
    }
    return slots;
  }

  _currentSlot(plan) {
    const now = new Date().toISOString();
    return plan.slots.find(s => s.slotStart <= now && s.slotEnd > now) || null;
  }

  _nextSlotWithCapacity(plan) {
    const now = new Date().toISOString();
    return plan.slots.find(s => s.slotStart > now && s.allowedUploads > s.usedUploads) || null;
  }

  _getTodayBangkok() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return formatter.format(new Date()); // "YYYY-MM-DD"
  }

  _bangkokToUTC(dayStr, hour, minute) {
    // Create a date in Bangkok time and convert to UTC ISO string
    // Bangkok is UTC+7 (no DST)
    const [y, m, d] = dayStr.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d, hour - 7, minute, 0, 0));
    return utc.toISOString();
  }
}

module.exports = new PacingPlanner();
