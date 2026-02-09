// js/scheduler/BaseScheduler.js
/**
 * 核心排班引擎 - 硬性規則檢查版
 * 🔧 修正版 v5：新增排班可用過濾 (isScheduleAvailable)
 */
window.BaseScheduler = class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff;
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        
        // ✅ 建立班別代碼清單 (過濾排班不可用的班別)
        this.buildShiftCodes();
        
        this.schedule = {}; 
        this.counters = {}; 
        this.shiftTimes = this.buildShiftTimeMap();
        this.parseRules();
        this.init();
    }

    /**
     * ✅ 修正：建立 shiftCodes 陣列時過濾排班不可用的班別
     */
    buildShiftCodes() {
        this.shiftCodes = [];
        
        if (Array.isArray(this.rules.shifts)) {
            // ✅ 關鍵修正：過濾掉 isScheduleAvailable === false 的班別
            const availableShifts = this.rules.shifts
                .filter(s => s.isScheduleAvailable !== false);
            
            this.shiftCodes = availableShifts.map(s => s.code);
            
            // 記錄過濾結果
            const filteredOut = this.rules.shifts
                .filter(s => s.isScheduleAvailable === false)
                .map(s => s.code);
            
            if (filteredOut.length > 0) {
                console.log(`🚫 已過濾排班不可用班別:`, filteredOut);
            }
            console.log(`✅ 排班引擎可用班別:`, this.shiftCodes);
            
        } else if (this.rules.shiftCodes && Array.isArray(this.rules.shiftCodes)) {
            this.shiftCodes = this.rules.shiftCodes;
        } else {
            console.error(`❌ 無法建立 shiftCodes，rules.shifts:`, this.rules.shifts);
        }
        
        // 確保包含 OFF
        if (!this.shiftCodes.includes('OFF')) {
            this.shiftCodes.push('OFF');
        }
    }

    parseRules() {
        const r = this.rules;
        this.rule_minGapHours = 11;
        this.rule_maxDiversity = r.hard?.maxDiversity3 !== false; 
        this.rule_weekStartDay = parseInt(r.hard?.weekStartDay) || 1; 
        this.rule_limitConsecutive = r.policy?.limitConsecutive !== false;
        this.rule_maxConsDays = r.policy?.maxConsDays || 6;
        this.rule_strictPref = (r.policy?.prioritizePref === 'must');
    }

    buildShiftTimeMap() {
        const map = {};
        const shiftsArr = Array.isArray(this.rules.shifts) ? this.rules.shifts : Object.values(this.rules.shifts || {});
        
        // ✅ 修正：只為排班可用的班別建立時間對照表
        shiftsArr
            .filter(s => s.isScheduleAvailable !== false)
            .forEach(s => {
                const [sh, sm] = (s.startTime || '00:00').split(':').map(Number);
                let [eh, em] = (s.endTime || '00:00').split(':').map(Number);
                if (eh === 0 && sh !== 0) eh = 24; 
                map[s.code] = { startH: sh, startM: sm, endH: eh, endM: em, startTime: s.startTime };
            });
        
        map['OFF'] = map['REQ_OFF'] = { startH: 0, startM: 0, endH: 0, endM: 0 };
        return map;
    }

    init() {
        this.staffList.forEach(s => {
            this.counters[s.id] = { OFF: 0 };
            this.shiftCodes.forEach(code => { this.counters[s.id][code] = 0; });
        });
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            this.schedule[ds] = {};
            this.shiftCodes.forEach(code => { this.schedule[ds][code] = []; });
            this.staffList.forEach(s => {
                this.schedule[ds].OFF.push(s.id);
                this.counters[s.id].OFF++;
            });
        }
    }

    isValidAssignment(staff, dateStr, shiftCode, isContinuing = false) {
        if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return true;

        // ✅ 未獨立人員不排班
        if (staff.schedulingParams?.independence === 'dependent') return false;

        // ✅ 檢查特殊狀態限制
        if (!this.checkSpecialStatusByDate(staff, dateStr, shiftCode)) return false;

        // ✅ 11 小時休息檢查
        const prevDate = this.getPreviousDate(dateStr);
        const prevShift = this.getShiftByDateStr(prevDate, staff.id);
        if (!this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, shiftCode, staff.name)) return false;

        const nextDate = this.getNextDate(dateStr);
        const nextShift = this.getShiftByDateStr(nextDate, staff.id);
        if (nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
            if (!this.checkRestPeriodWithDate(dateStr, shiftCode, nextDate, nextShift, staff.name)) return false;
        }

        // ✅ 週內班別種類限制
        if (this.rule_maxDiversity && !this.checkFixedWeekDiversity(staff.id, dateStr, shiftCode)) return false;

        // ✅ 連續上班天數檢查
        if (this.rule_limitConsecutive && this.getConsecutiveWorkDays(staff.id, dateStr) >= this.rule_maxConsDays) return false;

        return true;
    }

    checkRestPeriodWithDate(prevDateStr, prevShiftCode, currDateStr, currShiftCode, staffName) {
        if (!prevShiftCode || prevShiftCode === 'OFF' || prevShiftCode === 'REQ_OFF') return true;
        const p = this.shiftTimes[prevShiftCode], c = this.shiftTimes[currShiftCode];
        if (!p || !c) return true;

        const d1Parts = prevDateStr.split('-').map(Number);
        const d2Parts = currDateStr.split('-').map(Number);
        const d1 = Date.UTC(d1Parts[0], d1Parts[1] - 1, d1Parts[2]);
        const d2 = Date.UTC(d2Parts[0], d2Parts[1] - 1, d2Parts[2]);
        
        const dayDiff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
        const gap = (dayDiff * 24) + (c.startH + c.startM/60) - (p.endH + p.endM/60);

        if (gap < this.rule_minGapHours) {
            console.warn(`🚨 [攔截] ${staffName}: ${prevShiftCode}->${currShiftCode} 間隔僅 ${gap.toFixed(1)}h`);
            return false;
        }
        return true;
    }

    checkFixedWeekDiversity(uid, dateStr, newShift) {
        const date = new Date(dateStr);
        const dayOfWeek = date.getDay(); 
        const startDay = this.rule_weekStartDay; 
        let diff = (dayOfWeek < startDay) ? (dayOfWeek + 7 - startDay) : (dayOfWeek - startDay);
        
        const mon = new Date(date); mon.setDate(mon.getDate() - diff);
        const shiftsInWeek = new Set();
        shiftsInWeek.add(newShift);
        
        for (let i = 0; i < 7; i++) {
            const d = new Date(mon); d.setDate(mon.getDate() + i);
            const ds = this.getDateStrFromDate(d);
            const s = (ds === dateStr) ? newShift : this.getShiftByDateStr(ds, uid);
            if (s && s !== 'OFF' && s !== 'REQ_OFF') shiftsInWeek.add(s);
        }
        return shiftsInWeek.size <= 2; 
    }

    checkSpecialStatusByDate(staff, dateStr, shiftCode) {
        const p = staff.schedulingParams || {};
        if (!p.isPregnant && !p.isBreastfeeding) return true;

        const date = new Date(dateStr);
        const isPregnant = p.isPregnant && p.pregnantExpiry && new Date(p.pregnantExpiry) >= date;
        const isBreastfeeding = p.isBreastfeeding && p.breastfeedingExpiry && new Date(p.breastfeedingExpiry) >= date;

        if (isPregnant || isBreastfeeding) {
            const shift = this.shiftTimes[shiftCode];
            if (!shift) return true;
            
            const startH = shift.startH;
            const endH = shift.endH;
            const isNight = (startH >= 20 || startH <= 6); 
            const isEvening = (startH >= 15 && startH < 20); 
            const isLateEvening = (endH > 22 || (endH <= 6 && endH > 0));

            if (isNight || isEvening || isLateEvening) {
                console.warn(`🤰 [限制] ${staff.name} 為孕/哺狀態，攔截 ${shiftCode}`);
                return false;
            }
        }
        return true;
    }

    isLongVacationMonth(staff) { return false; }
    checkOffGap() { return true; }
    checkPGYStatusByDate() { return true; }

    getDateStr(d) { return `${this.year}-${String(this.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
    getDateStrFromDate(d) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    getPreviousDate(ds) {
        const parts = ds.split('-').map(Number);
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        d.setUTCDate(d.getUTCDate() - 1);
        return this.getDateStrFromDate(d);
    }
    getNextDate(ds) {
        const parts = ds.split('-').map(Number);
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        d.setUTCDate(d.getUTCDate() + 1);
        return this.getDateStrFromDate(d);
    }
    
    getShiftByDateStr(ds, uid) {
        const parts = ds.split('-').map(Number);
        const year = parts[0], month = parts[1], day = parts[2];
        
        if (year < this.year || (year === this.year && month < this.month)) {
            const key = `current_${day}`;
            return this.lastMonthData[uid]?.[key] || 'OFF';
        }
        return this.getShiftByDate(ds, uid);
    }

    getShiftByDate(ds, uid) {
        if (!this.schedule[ds]) return 'OFF';
        for (let code in this.schedule[ds]) if (this.schedule[ds][code].includes(uid)) return code;
        return 'OFF';
    }

    getConsecutiveWorkDays(uid, ds) {
        let count = 0, curr = new Date(ds);
        for (let i = 1; i < 14; i++) {
            curr.setDate(curr.getDate() - 1);
            const s = this.getShiftByDateStr(this.getDateStrFromDate(curr), uid);
            if (!s || s === 'OFF' || s === 'REQ_OFF') break;
            count++;
        }
        return count;
    }

    updateShift(ds, uid, oldS, newS) {
        if (oldS === newS) return;
        if (oldS && this.schedule[ds][oldS]) {
            const idx = this.schedule[ds][oldS].indexOf(uid);
            if (idx > -1) { this.schedule[ds][oldS].splice(idx, 1); this.counters[uid][oldS]--; }
        }
        if (newS && this.schedule[ds][newS]) {
            this.schedule[ds][newS].push(uid);
            if(this.counters[uid][newS] !== undefined) this.counters[uid][newS]++;
            if (newS === 'OFF' || newS === 'REQ_OFF') this.counters[uid].OFF++;
        }
    }

applyPreSchedules() {
    console.log('🔍 開始套用預班...');
    
    this.staffList.forEach(s => {
        // ✅ 優先從 preferences 讀取，再從 schedulingParams 讀取
        const prefs = s.preferences || s.prefs || {};
        const params = s.schedulingParams || {};
        
        let appliedCount = 0;
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const key = `current_${d}`;
            const ds = this.getDateStr(d);
            
            // ✅ 優先使用 preferences，其次 schedulingParams
            const req = prefs[key] || params[key];
            
            if (req && (req === 'REQ_OFF' || this.shiftCodes.includes(req))) {
                this.updateShift(ds, s.id, 'OFF', req);
                appliedCount++;
                console.log(`  ✓ 套用預班: ${s.name} 第${d}日 → ${req}`);
            }
        }
        
        if (appliedCount > 0) {
            console.log(`  ✅ ${s.name} 套用 ${appliedCount} 天預班`);
        }
    });
}

    getLastMonthFinalShift(uid) {
        const lastMonthDays = new Date(this.year, this.month - 1, 0).getDate();
        const key = `current_${lastMonthDays}`;
        return this.lastMonthData[uid]?.[key] || 'OFF';
    }

    applyEarlyMonthContinuity() {
        this.staffList.forEach(s => {
            const lastShift = this.getLastMonthFinalShift(s.id);
            if (lastShift === 'OFF' || lastShift === 'REQ_OFF') return;

            for (let d = 1; d <= 7; d++) {
                const ds = this.getDateStr(d);
                const currentS = this.getShiftByDate(ds, s.id);
                if (currentS !== 'OFF') break;

                const needs = typeof this.getDailyNeeds === 'function' ? this.getDailyNeeds(d) : null;
                if (needs && (needs[lastShift] || 0) <= 0) break;

                if (this.isValidAssignment(s, ds, lastShift, true)) {
                    this.updateShift(ds, s.id, 'OFF', lastShift);
                } else {
                    break;
                }
            }
        });
    }
}
