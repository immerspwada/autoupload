// ═══════════════════════════════════════════════════════════════════
// Event Bus + Rules Engine — ศูนย์กลางเหตุการณ์ของทั้งระบบ
// 
// กฎ: ทุกฟีเจอร์ที่เกิดเหตุการณ์ใดๆ ต้อง emit ผ่าน EventBus
// EventBus จะ dispatch ไปยังทุก listener ที่เกี่ยวข้องตามกฎ
// ═══════════════════════════════════════════════════════════════════

const EventEmitter = require('events');
const logger = require('../utils/logger');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.rules = [];
    this.history = []; // event history for debugging
    this.maxHistory = 200;
    this._setupDefaultRules();
  }

  // ==================== EMIT WITH CONTEXT ====================
  // ทุกเหตุการณ์ต้องมี context บอกว่ามาจากไหน ไปไหน
  dispatch(event, payload = {}) {
    const entry = {
      event,
      payload,
      timestamp: Date.now(),
      isoTime: new Date().toISOString()
    };

    // Record history
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    logger.debug(`[EventBus] ${event}`, payload);

    // Emit the event for direct listeners
    this.emit(event, payload);

    // Run rules engine
    this._executeRules(event, payload);
  }

  // ==================== RULES ENGINE ====================
  // กฎกำหนดว่า: เมื่อเกิด event X → ให้ทำอะไรบ้าง
  addRule(rule) {
    this.rules.push({
      id: rule.id || `rule_${this.rules.length + 1}`,
      name: rule.name,
      when: rule.when,       // event name or array of events
      condition: rule.condition || (() => true),  // optional filter
      then: rule.then,       // action function(payload, eventbus)
      priority: rule.priority || 0,
      enabled: rule.enabled !== false
    });
    // Sort by priority (higher first)
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  _executeRules(event, payload) {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      const triggers = Array.isArray(rule.when) ? rule.when : [rule.when];
      if (!triggers.includes(event) && !triggers.includes('*')) continue;

      try {
        if (rule.condition(payload, event)) {
          rule.then(payload, this, event);
        }
      } catch (err) {
        logger.error(`[EventBus] Rule "${rule.name}" error`, {
          rule: rule.id,
          event,
          error: err.message
        });
      }
    }
  }

  // ==================== DEFAULT RULES ====================
  // กฎเริ่มต้นที่เชื่อมทุกฟีเจอร์เข้าด้วยกัน
  _setupDefaultRules() {

    // ──────── RULE 1: อัปโหลดสำเร็จ → อัปเดต stats + dashboard + history ────────
    this.addRule({
      id: 'upload_success_propagate',
      name: 'Upload Success → Update All',
      when: 'upload:completed',
      priority: 10,
      then: (payload, bus) => {
        // Notify stats
        bus.dispatch('stats:increment', {
          type: 'upload',
          filename: payload.filename,
          size: payload.size || 0,
          source: payload.source || 'folder'
        });
        // Notify dashboard to refresh
        bus.dispatch('dashboard:refresh', { reason: 'upload_completed' });
        // Notify history
        bus.dispatch('history:add', payload);
        // Notify health to register hash
        if (payload.hash) {
          bus.dispatch('health:register_hash', { hash: payload.hash, filename: payload.filename });
        }
      }
    });

    // ──────── RULE 2: อัปโหลดล้มเหลว → อัปเดต stats + แจ้งเตือน ────────
    this.addRule({
      id: 'upload_failed_propagate',
      name: 'Upload Failed → Update All',
      when: 'upload:failed',
      priority: 10,
      then: (payload, bus) => {
        bus.dispatch('stats:increment', {
          type: 'failure',
          filename: payload.filename,
          error: payload.error
        });
        bus.dispatch('notification:send', {
          level: 'error',
          title: 'อัปโหลดล้มเหลว',
          message: `${payload.filename}: ${payload.error}`,
          source: 'upload'
        });
        bus.dispatch('dashboard:refresh', { reason: 'upload_failed' });
      }
    });

    // ──────── RULE 3: Retry → แจ้งเตือน + log ────────
    this.addRule({
      id: 'upload_retry_notify',
      name: 'Upload Retry → Notify',
      when: 'upload:retry',
      priority: 5,
      then: (payload, bus) => {
        bus.dispatch('notification:send', {
          level: 'warning',
          title: 'ลองอัปโหลดใหม่',
          message: `${payload.filename} (ครั้งที่ ${payload.attempt})`,
          source: 'queue'
        });
      }
    });

    // ──────── RULE 4: Queue drain → Cleanup + Summary ────────
    this.addRule({
      id: 'queue_drain_cleanup',
      name: 'Queue Done → Cleanup + Summary',
      when: 'queue:drain',
      priority: 5,
      then: (payload, bus) => {
        bus.dispatch('notification:send', {
          level: 'success',
          title: 'คิวเสร็จสิ้น',
          message: `สำเร็จ ${payload.done || 0} / ล้มเหลว ${payload.failed || 0}`,
          source: 'queue'
        });
        bus.dispatch('dashboard:refresh', { reason: 'queue_drain' });
        // Trigger auto-cleanup after queue finishes
        bus.dispatch('health:cleanup', { trigger: 'queue_drain' });
      }
    });

    // ──────── RULE 5: Scheduler พบไฟล์ใหม่ → แจ้งเตือน + Dashboard ────────
    this.addRule({
      id: 'scheduler_new_files',
      name: 'Scheduler Found Files → Notify',
      when: 'scheduler:files_found',
      priority: 5,
      then: (payload, bus) => {
        if (payload.count > 0) {
          bus.dispatch('notification:send', {
            level: 'info',
            title: 'พบไฟล์ใหม่',
            message: `Scheduler พบ ${payload.count} ไฟล์ → เพิ่มลงคิว`,
            source: 'scheduler'
          });
          bus.dispatch('dashboard:refresh', { reason: 'new_files_found' });
        }
      }
    });

    // ──────── RULE 6: TikTok ดาวน์โหลดสำเร็จ → แจ้ง + อัปเดต ────────
    this.addRule({
      id: 'tiktok_download_complete',
      name: 'TikTok Download → Notify + Stats',
      when: 'tiktok:downloaded',
      priority: 5,
      then: (payload, bus) => {
        bus.dispatch('notification:send', {
          level: 'info',
          title: 'ดาวน์โหลด TikTok สำเร็จ',
          message: payload.filename,
          source: 'tiktok'
        });
      }
    });

    // ──────── RULE 7: Auth สถานะเปลี่ยน → แจ้งทุกส่วน ────────
    this.addRule({
      id: 'auth_change_propagate',
      name: 'Auth Changed → Notify All',
      when: ['auth:login', 'auth:logout'],
      priority: 10,
      then: (payload, bus, event) => {
        const loggedIn = event === 'auth:login';
        bus.dispatch('notification:send', {
          level: loggedIn ? 'success' : 'info',
          title: loggedIn ? 'เข้าสู่ระบบสำเร็จ' : 'ออกจากระบบแล้ว',
          message: loggedIn ? 'เชื่อมต่อ YouTube เรียบร้อย' : 'ตัดการเชื่อมต่อ YouTube',
          source: 'auth'
        });
        // Scheduler ต้องรู้ — ถ้า logout ให้หยุด, ถ้า login ให้เริ่มทำงาน
        if (loggedIn) {
          bus.dispatch('scheduler:check_start', {});
        } else {
          bus.dispatch('scheduler:pause', { reason: 'auth_logout' });
        }
        bus.dispatch('dashboard:refresh', { reason: 'auth_changed' });
      }
    });

    // ──────── RULE 8: Settings เปลี่ยน → แจ้ง Scheduler + Watcher ────────
    this.addRule({
      id: 'settings_change_propagate',
      name: 'Settings Changed → Restart Watcher',
      when: 'settings:updated',
      priority: 8,
      then: (payload, bus) => {
        // ถ้า folder เปลี่ยน → restart watcher
        if (payload.folder !== undefined) {
          bus.dispatch('scheduler:restart_watcher', { folder: payload.folder });
        }
        bus.dispatch('dashboard:refresh', { reason: 'settings_changed' });
      }
    });

    // ──────── RULE 9: Health Critical → Pause Queue ────────
    this.addRule({
      id: 'health_critical_pause',
      name: 'Health Critical → Pause Queue',
      when: 'health:status_changed',
      condition: (payload) => payload.overall === 'critical',
      priority: 15,
      then: (payload, bus) => {
        bus.dispatch('queue:auto_pause', { reason: 'system_critical' });
        bus.dispatch('notification:send', {
          level: 'error',
          title: 'ระบบวิกฤต!',
          message: 'คิวถูกหยุดอัตโนมัติ — กรุณาตรวจสอบดิสก์/หน่วยความจำ',
          source: 'health'
        });
      }
    });

    // ──────── RULE 10: Duplicate detected → Block + Notify ────────
    this.addRule({
      id: 'duplicate_block',
      name: 'Duplicate Detected → Block Upload',
      when: 'upload:duplicate_detected',
      priority: 20,
      then: (payload, bus) => {
        bus.dispatch('notification:send', {
          level: 'warning',
          title: 'ไฟล์ซ้ำ!',
          message: `"${payload.filename}" ซ้ำกับ "${payload.originalFile}"`,
          source: 'health'
        });
      }
    });
  }

  // ==================== QUERIES ====================
  getHistory(limit = 50) {
    return this.history.slice(-limit).reverse();
  }

  getRules() {
    return this.rules.map(r => ({
      id: r.id,
      name: r.name,
      when: r.when,
      priority: r.priority,
      enabled: r.enabled
    }));
  }

  enableRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) { rule.enabled = true; return true; }
    return false;
  }

  disableRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) { rule.enabled = false; return true; }
    return false;
  }
}

// Singleton
module.exports = new EventBus();
