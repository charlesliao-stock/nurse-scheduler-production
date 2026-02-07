// js/scheduler/BaseScheduler.js
class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff;
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        this.shiftCodes = this.rules.shiftCodes || [];
        if (!this.shiftCodes.includes('OFF')) this.shiftCodes.push('OFF');
        this.schedule = {}; 
        this.counters = {}; 
        this.shiftTimes = this.buildShiftTimeMap();
        this.parseRules();
        this.init();
    }

    parseRules() {
        const r = this.rules;
        this.rule_minGapHours = 11; // 強制 11 小時休息
        this.rule_maxDiversity = r.hard?.maxDiversity3 !== false; 
        this.rule_weekStartDay = parseInt(r.hard?.weekStartDay) || 1; 
        this.rule_limitConsecutive = r.policy?.limitConsecutive !== false;
        this.rule_maxConsDays = r.policy?.maxConsDays || 6;
    }

    buildShiftTimeMap() {
        const map = {};
        if (this.rules.shifts && Array.isArray(this.rules.shifts)) {
            this.rules.shifts.forEach(s => {
                const [sh, sm] = (s.startTime || '00:00').split(':').map(Number);
                let [eh, em] = (s.endTime || '00:00').split(':').map(Number);
                // ✅ 修正：小夜 00:00 視為 24:00 以利計算
                if (s.code === 'E' && eh === 0) eh = 24; 
                map[s.code] = { startH: sh, startM: sm, endH: eh, endM: em };
            });
        }
        map['OFF'] = map['REQ_OFF'] = { startH: 0, startM: 0, endH: 0, endM: 0 };
        return map;
    }

    init() {
        this.staffList.forEach(s => {
            this.counters[s.id] = { OFF: 0 };
            this.shiftCodes.forEach(code => { this.counters[s.id][code] = 0; });
        });
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = {};
            this.shiftCodes.forEach(code => { this.schedule[dateStr][code] = []; });
            this.staffList.forEach(s => {
                this.schedule[dateStr].OFF.push(s.id);
                this.counters[s.id].OFF++;
            });
        }
    }

    isValidAssignment(staff, dateStr, shiftCode) {
        if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return true;

        // ✅ 第一優先：日期加權休息時間檢查
        const prevDate = this.getPreviousDate(dateStr);
        const prevShift = this.getShiftByDateStr(prevDate, staff.id);
        if (!this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, shiftCode, staff.name)) return false;

        const nextDate = this.getNextDate(dateStr);
        const nextShift = this.getShiftByDateStr(nextDate, staff.id);
        if (nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
            if (!this.checkRestPeriodWithDate(dateStr, shiftCode, nextDate, nextShift, staff.name)) return false;
        }

        // ✅ 第二優先：週內班別種類限制
        if (this.rule_maxDiversity && !this.checkFixedWeekDiversity(staff.id, dateStr, shiftCode)) return false;

        // 連續上班天數檢查
        if (this.rule_limitConsecutive) {
            if (this.getConsecutiveWorkDays(staff.id, dateStr) >= this.rule_maxConsDays) return false;
        }

        return true;
    }

    checkRestPeriodWithDate(prevDateStr, prevShiftCode, currDateStr, currShiftCode, staffName) {
        if (!prevShiftCode || prevShiftCode === 'OFF' || prevShiftCode === 'REQ_OFF') return true;
        const p = this.shiftTimes[prevShiftCode], c = this.shiftTimes[currShiftCode];
        if (!p || !c) return true;

        // ✅ 核心公式：(日期差 * 24) + 今日上班 - 昨日下班
        const d1 = new Date(prevDateStr), d2 = new Date(currDateStr);
        const dayDiff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
        const gap = (dayDiff * 24) + (c.startH + c.startM/60) - (p.endH + p.endM/60);
        
        if (gap < this.rule_minGapHours) {
            console.warn(`🚨 [攔截] ${staffName}: ${prevShiftCode}->${currShiftCode} 休息僅 ${gap.toFixed(1)}h`);
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
        return shiftsInWeek.size <= 2; // 不超過 2 種工作班別
    }

    getDateStr(d) { return `${this.year}-${String(this.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
    getDateStrFromDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    getPreviousDate(ds) { const d = new Date(ds); d.setDate(d.getDate()-1); return this.getDateStrFromDate(d); }
    getNextDate(ds) { const d = new Date(ds); d.setDate(d.getDate()+1); return this.getDateStrFromDate(d); }
    getShiftByDateStr(ds, uid) { 
        const d = new Date(ds); 
        if (d.getMonth() + 1 !== this.month) return this.lastMonthData[uid]?.lastShift || 'OFF';
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
            if (idx > -1) { 
                this.schedule[ds][oldS].splice(idx, 1); 
                if(this.counters[uid][oldS]) this.counters[uid][oldS]--; 
            }
        }
        if (newS && this.schedule[ds][newS]) {
            this.schedule[ds][newS].push(uid);
            if(this.counters[uid][newS] !== undefined) this.counters[uid][newS]++;
            if (newS === 'OFF' || newS === 'REQ_OFF') this.counters[uid].OFF++;
        }
    }
    applyPreSchedules() {
        this.staffList.forEach(s => {
            const params = s.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const ds = this.getDateStr(d), req = params[ds];
                if (req && (req === 'REQ_OFF' || this.shiftCodes.includes(req))) this.updateShift(ds, s.id, 'OFF', req);
            }
        });
    }
}// js/scheduler/BaseScheduler.js
class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff;
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        this.shiftCodes = this.rules.shiftCodes || [];
        if (!this.shiftCodes.includes('OFF')) this.shiftCodes.push('OFF');
        this.schedule = {}; 
        this.counters = {}; 
        this.shiftTimes = this.buildShiftTimeMap();
        this.parseRules();
        this.init();
    }

    parseRules() {
        const r = this.rules;
        this.rule_minGapHours = 11; // 強制 11 小時休息
        this.rule_maxDiversity = r.hard?.maxDiversity3 !== false; 
        this.rule_weekStartDay = parseInt(r.hard?.weekStartDay) || 1; 
        this.rule_limitConsecutive = r.policy?.limitConsecutive !== false;
        this.rule_maxConsDays = r.policy?.maxConsDays || 6;
    }

    buildShiftTimeMap() {
        const map = {};
        if (this.rules.shifts && Array.isArray(this.rules.shifts)) {
            this.rules.shifts.forEach(s => {
                const [sh, sm] = (s.startTime || '00:00').split(':').map(Number);
                let [eh, em] = (s.endTime || '00:00').split(':').map(Number);
                // ✅ 修正：小夜 00:00 視為 24:00 以利計算
                if (s.code === 'E' && eh === 0) eh = 24; 
                map[s.code] = { startH: sh, startM: sm, endH: eh, endM: em };
            });
        }
        map['OFF'] = map['REQ_OFF'] = { startH: 0, startM: 0, endH: 0, endM: 0 };
        return map;
    }

    init() {
        this.staffList.forEach(s => {
            this.counters[s.id] = { OFF: 0 };
            this.shiftCodes.forEach(code => { this.counters[s.id][code] = 0; });
        });
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = {};
            this.shiftCodes.forEach(code => { this.schedule[dateStr][code] = []; });
            this.staffList.forEach(s => {
                this.schedule[dateStr].OFF.push(s.id);
                this.counters[s.id].OFF++;
            });
        }
    }

    isValidAssignment(staff, dateStr, shiftCode) {
        if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return true;

        // ✅ 第一優先：日期加權休息時間檢查
        const prevDate = this.getPreviousDate(dateStr);
        const prevShift = this.getShiftByDateStr(prevDate, staff.id);
        if (!this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, shiftCode, staff.name)) return false;

        const nextDate = this.getNextDate(dateStr);
        const nextShift = this.getShiftByDateStr(nextDate, staff.id);
        if (nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
            if (!this.checkRestPeriodWithDate(dateStr, shiftCode, nextDate, nextShift, staff.name)) return false;
        }

        // ✅ 第二優先：週內班別種類限制
        if (this.rule_maxDiversity && !this.checkFixedWeekDiversity(staff.id, dateStr, shiftCode)) return false;

        // 連續上班天數檢查
        if (this.rule_limitConsecutive) {
            if (this.getConsecutiveWorkDays(staff.id, dateStr) >= this.rule_maxConsDays) return false;
        }

        return true;
    }

    checkRestPeriodWithDate(prevDateStr, prevShiftCode, currDateStr, currShiftCode, staffName) {
        if (!prevShiftCode || prevShiftCode === 'OFF' || prevShiftCode === 'REQ_OFF') return true;
        const p = this.shiftTimes[prevShiftCode], c = this.shiftTimes[currShiftCode];
        if (!p || !c) return true;

        // ✅ 核心公式：(日期差 * 24) + 今日上班 - 昨日下班
        const d1 = new Date(prevDateStr), d2 = new Date(currDateStr);
        const dayDiff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
        const gap = (dayDiff * 24) + (c.startH + c.startM/60) - (p.endH + p.endM/60);
        
        if (gap < this.rule_minGapHours) {
            console.warn(`🚨 [攔截] ${staffName}: ${prevShiftCode}->${currShiftCode} 休息僅 ${gap.toFixed(1)}h`);
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
        return shiftsInWeek.size <= 2; // 不超過 2 種工作班別
    }

    getDateStr(d) { return `${this.year}-${String(this.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
    getDateStrFromDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    getPreviousDate(ds) { const d = new Date(ds); d.setDate(d.getDate()-1); return this.getDateStrFromDate(d); }
    getNextDate(ds) { const d = new Date(ds); d.setDate(d.getDate()+1); return this.getDateStrFromDate(d); }
    getShiftByDateStr(ds, uid) { 
        const d = new Date(ds); 
        if (d.getMonth() + 1 !== this.month) return this.lastMonthData[uid]?.lastShift || 'OFF';
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
            if (idx > -1) { 
                this.schedule[ds][oldS].splice(idx, 1); 
                if(this.counters[uid][oldS]) this.counters[uid][oldS]--; 
            }
        }
        if (newS && this.schedule[ds][newS]) {
            this.schedule[ds][newS].push(uid);
            if(this.counters[uid][newS] !== undefined) this.counters[uid][newS]++;
            if (newS === 'OFF' || newS === 'REQ_OFF') this.counters[uid].OFF++;
        }
    }
    applyPreSchedules() {
        this.staffList.forEach(s => {
            const params = s.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const ds = this.getDateStr(d), req = params[ds];
                if (req && (req === 'REQ_OFF' || this.shiftCodes.includes(req))) this.updateShift(ds, s.id, 'OFF', req);
            }
        });
    }
}
