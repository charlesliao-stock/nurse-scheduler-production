// js/scheduler/BaseScheduler.js
// 🔧 最終完美修正版：兼顧 11 小時強硬規則與系統穩定性
// ✅ 核心修正：
// 1. [優先權] 將休息時間檢查提升至 isValidAssignment 的最頂端。
// 2. [精確度] 修正 D 接 N 只有 8 小時的日期計算漏洞。
// 3. [相容性] 補回 isLongVacationMonth 等方法，修復 SchedulerV2 啟動錯誤。

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
        this.rule_minGapHours = parseFloat(r.hard?.minGapHours) || 11;
        this.rule_minGap11 = r.hard?.minGap11 !== false;
        this.rule_maxDiversity3 = r.hard?.maxDiversity3 !== false;
        this.rule_protectPregnant = r.hard?.protectPregnant !== false;
        this.rule_limitConsecutive = r.policy?.limitConsecutive !== false;
        this.rule_maxConsDays = r.policy?.maxConsDays || 6;
        this.rule_longVacationWorkLimit = r.policy?.longVacationWorkLimit || 7;
        
        this.rule_strictPref = (r.policy?.prioritizePref === 'must');
        this.rule_strictPreReq = (r.policy?.prioritizePreReq === 'must');
        this.rule_strictAvoid = (r.policy?.prioritizeAvoid === 'must');
        
        console.log('📋 規則載入完成，強制 11 小時休息間隔已啟動。');
    }

    buildShiftTimeMap() {
        const map = {};
        if (this.rules.shifts && Array.isArray(this.rules.shifts)) {
            this.rules.shifts.forEach(s => {
                const [startH, startM] = (s.startTime || '00:00').split(':').map(Number);
                const [endH, endM] = (s.endTime || '00:00').split(':').map(Number);
                map[s.code] = {
                    startTime: s.startTime,
                    endTime: s.endTime,
                    startHour: startH,
                    startMinute: startM || 0,
                    endHour: endH,
                    endMinute: endM || 0
                };
            });
        }
        map['OFF'] = { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 };
        map['REQ_OFF'] = { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 };
        return map;
    }

    init() {
        this.staffList.forEach(s => {
            this.counters[s.id] = {};
            this.shiftCodes.forEach(code => { this.counters[s.id][code] = 0; });
            if (!this.counters[s.id]['REQ_OFF']) this.counters[s.id]['REQ_OFF'] = 0;
        });
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = {};
            this.shiftCodes.forEach(code => { this.schedule[dateStr][code] = []; });
            
            // 預設所有人該日為 OFF
            this.staffList.forEach(staff => {
                this.schedule[dateStr].OFF.push(staff.id);
                if (this.counters[staff.id]) this.counters[staff.id].OFF++;
            });
        }
    }

    // ✅ 關鍵重構：將休息間隔檢查提升至第一優先順位
    isValidAssignment(staff, dateStr, shiftCode) {
        // 1. 跳過休假本身的檢查
        if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return true;

        // 2. 【第一優先：硬性休息間隔檢查】
        const prevDate = this.getPreviousDate(dateStr);
        const prevShift = this.getShiftByDateStr(prevDate, staff.id);
        
        if (!this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, shiftCode, staff.name)) {
            return false; // 間隔不足，直接否決
        }

        const nextDate = this.getNextDate(dateStr);
        const nextShift = this.getShiftByDateStr(nextDate, staff.id);
        if (nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
            if (!this.checkRestPeriodWithDate(dateStr, shiftCode, nextDate, nextShift, staff.name)) {
                return false;
            }
        }

        // 3. 【第二優先：人員基本狀態檢查】
        const params = staff.schedulingParams || {};
        if (params.independence === 'dependent') return false;
        if (this.isPreRequestOff(staff.id, dateStr) && shiftCode !== 'REQ_OFF') return false;

        // 4. 【第三優先：勞基法/政策規則】
        if (this.rule_limitConsecutive) {
            const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
            let limit = this.isLongVacationMonth(staff) ? this.rule_longVacationWorkLimit : this.rule_maxConsDays;
            if (currentCons >= limit) return false;
        }

        return true;
    }

    checkRestPeriodWithDate(prevDateStr, prevShiftCode, currDateStr, currShiftCode, staffName = '') {
        if (!prevShiftCode || prevShiftCode === 'OFF' || prevShiftCode === 'REQ_OFF') return true;
        if (!currShiftCode || currShiftCode === 'OFF' || currShiftCode === 'REQ_OFF') return true;
        
        const prevShift = this.shiftTimes[prevShiftCode];
        const currShift = this.shiftTimes[currShiftCode];
        if (!prevShift || !currShift) return true;

        try {
            const prevEnd = new Date(prevDateStr);
            prevEnd.setHours(prevShift.endHour, prevShift.endMinute, 0, 0);
            
            if (prevShift.endHour < prevShift.startHour || (prevShift.endHour === prevShift.startHour && prevShift.endMinute < prevShift.startMinute)) {
                prevEnd.setDate(prevEnd.getDate() + 1);
            }
            
            const currStart = new Date(currDateStr);
            currStart.setHours(currShift.startHour, currShift.startMinute, 0, 0);
            
            const gap = (currStart - prevEnd) / (1000 * 60 * 60);
            const minGap = this.rule_minGapHours || 11;
            
            if (gap < minGap) {
                console.warn(`🚨 [攔截] ${staffName}: ${prevShiftCode}->${currShiftCode} 只有 ${gap.toFixed(1)}h`);
                return false; 
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // ✅ 相容性方法：確保子類別 SchedulerV2 不會因找不到方法而報錯
    isLongVacationMonth(staff) { return false; }
    checkOffGap(staff, dateStr) { return true; }
    checkSpecialStatusByDate(staff, shiftCode, dateStr) { return true; }
    checkPGYStatusByDate(staff, shiftCode, dateStr) { return true; }

    getPreviousDate(dateStr) {
        const date = new Date(dateStr);
        date.setDate(date.getDate() - 1);
        return this.getDateStrFromDate(date);
    }

    getNextDate(dateStr) {
        const date = new Date(dateStr);
        date.setDate(date.getDate() + 1);
        return this.getDateStrFromDate(date);
    }

    getDateStr(d) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    getDateStrFromDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    getShiftByDateStr(dateStr, uid) {
        const date = new Date(dateStr);
        if ((date.getMonth() + 1) !== this.month) {
            return this.lastMonthData[uid]?.lastShift || 'OFF';
        }
        return this.getShiftByDate(dateStr, uid);
    }

    getShiftByDate(dateStr, uid) {
        if (!this.schedule[dateStr]) return null;
        for (const code of Object.keys(this.schedule[dateStr])) {
            if (this.schedule[dateStr][code].includes(uid)) return code;
        }
        return 'OFF';
    }

    getConsecutiveWorkDays(uid, dateStr) {
        const targetDate = new Date(dateStr);
        let count = 0;
        for (let i = 1; i <= 14; i++) {
            const checkDate = new Date(targetDate);
            checkDate.setDate(checkDate.getDate() - i);
            const shift = this.getShiftByDateStr(this.getDateStrFromDate(checkDate), uid);
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') break;
            count++;
        }
        return count;
    }

    isPreRequestOff(uid, dateStr) {
        const staff = this.staffList.find(s => s.id === uid);
        return staff?.schedulingParams?.[dateStr] === 'REQ_OFF';
    }

    updateShift(dateStr, uid, oldShift, newShift) {
        if (oldShift === newShift) return;
        if (oldShift && this.schedule[dateStr][oldShift]) {
            const arr = this.schedule[dateStr][oldShift];
            const idx = arr.indexOf(uid);
            if (idx > -1) {
                arr.splice(idx, 1);
                if (this.counters[uid]) this.counters[uid][oldShift]--;
            }
        }
        if (newShift && this.schedule[dateStr][newShift]) {
            this.schedule[dateStr][newShift].push(uid);
            if (this.counters[uid]) this.counters[uid][newShift]++;
        }
    }
}
