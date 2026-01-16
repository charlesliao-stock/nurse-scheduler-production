// js/scheduler/BaseScheduler.js
// 🔧 最終完整版：整合 4 種權重驗證、絕對間隔檢查、救火降級

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
        
        // 1. 硬性規則
        this.rule_minGap11 = r.hard?.minGap11 !== false;
        this.rule_maxDiversity3 = r.hard?.maxDiversity3 !== false;
        this.rule_protectPregnant = r.hard?.protectPregnant !== false;
        this.rule_twoOffPerFortnight = r.hard?.twoOffPerFortnight !== false;
        
        // 2. 救火模式
        this.rule_enableRelaxation = r.policy?.enableRelaxation === true;

        // 3. 權重 (4種)
        let prioritizeBundle = r.policy?.prioritizeBundle || 'must';
        let prioritizePref = r.policy?.prioritizePref || 'must';
        let prioritizePreReq = r.policy?.prioritizePreReq || 'must'; 
        let prioritizeAvoid = r.policy?.prioritizeAvoid || 'must';

        // 救火模式啟動 -> 強制降級
        if (this.rule_enableRelaxation) {
            console.warn("🔥 救火模式已啟動：所有「必定滿足」條件降級為「盡量滿足」");
            prioritizeBundle = 'try';
            prioritizePref = 'try';
            prioritizePreReq = 'try';
            prioritizeAvoid = 'try';
        }

        this.rule_strictBundle = (prioritizeBundle === 'must');
        this.rule_strictPref = (prioritizePref === 'must');
        this.rule_strictPreReq = (prioritizePreReq === 'must');
        this.rule_strictAvoid = (prioritizeAvoid === 'must');

        // 其他政策
        this.rule_limitConsecutive = r.policy?.limitConsecutive !== false;
        this.rule_maxConsDays = r.policy?.maxConsDays || 6;
        this.rule_noNightAfterOff = r.policy?.noNightAfterOff !== false;
    }

    buildShiftTimeMap() {
        const map = {};
        if (this.rules.shifts && Array.isArray(this.rules.shifts)) {
            this.rules.shifts.forEach(s => {
                map[s.code] = {
                    start: this.parseTime(s.startTime),
                    end: this.parseTime(s.endTime),
                    hours: s.hours || 8
                };
            });
        }
        map['OFF'] = { start: 0, end: 0, hours: 0 };
        map['REQ_OFF'] = { start: 0, end: 0, hours: 0 };
        return map;
    }
    parseTime(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h + (m || 0) / 60;
    }
    init() {
        this.staffList.forEach(s => {
            this.counters[s.id] = {};
            this.shiftCodes.forEach(code => this.counters[s.id][code] = 0);
        });
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = {};
            this.shiftCodes.forEach(code => this.schedule[dateStr][code] = []);
        }
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                if (this.schedule[dateStr].OFF) {
                    this.schedule[dateStr].OFF.push(staff.id);
                    this.counters[staff.id].OFF++;
                }
            }
        });
    }

    isValidAssignment(staff, dateStr, shiftCode, isRelaxMode = false) {
        if (shiftCode === 'OFF') return true;

        // 1. 絕對禁止
        if (this.rule_protectPregnant && !this.checkSpecialStatus(staff, shiftCode)) return false;
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (this.rule_minGap11 && !this.checkRestPeriod(prevShift, shiftCode)) return false;

        // 2. 條件式禁止 (Must / Try)
        
        // (A) 包班
        const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
        if (bundleShift && bundleShift !== shiftCode) {
            if (this.rule_strictBundle) return false;
        }

        // (B) 勿排 (!X)
        const params = staff.schedulingParams || {};
        if (params[dateStr] === '!' + shiftCode) {
            if (this.rule_strictAvoid) return false; 
        }

        // (C) 指定預班 (Specific)
        const reqShift = params[dateStr];
        if (reqShift && reqShift !== 'REQ_OFF' && !reqShift.startsWith('!')) {
            if (reqShift !== shiftCode) {
                if (this.rule_strictPreReq) return false;
            }
        }

        // (D) 個人偏好 (Wish)
        const prefs = staff.prefs?.[dateStr] || {};
        if (Object.values(prefs).length > 0) {
            if (!Object.values(prefs).includes(shiftCode)) {
                if (this.rule_strictPref) return false; 
            }
        }

        // 3. 軟性規則 (救火可放寬)
        if (isRelaxMode && this.rule_enableRelaxation) return true;

        if (this.rule_limitConsecutive && this.getConsecutiveWorkDays(staff.id, dateStr) >= this.rule_maxConsDays) return false;
        if (this.rule_noNightAfterOff && !bundleShift) {
            const isPrevReqOff = this.isPreRequestOff(staff.id, dateStr, -1);
            if (isPrevReqOff && this.isNightShift(shiftCode)) return false;
        }
        if (this.rule_maxDiversity3 && !this.checkWeeklyDiversity(staff.id, dateStr, shiftCode)) return false;

        return true;
    }
    
    checkRestPeriod(prevShift, currShift) {
        if (!prevShift || prevShift === 'OFF' || prevShift === 'REQ_OFF') return true;
        if (!currShift || currShift === 'OFF' || currShift === 'REQ_OFF') return true;
        
        const prev = this.shiftTimes[prevShift];
        const curr = this.shiftTimes[currShift];
        if (!prev || !curr) return true; 

        let prevEndTimeAbs = prev.end;
        if (prev.end <= prev.start) prevEndTimeAbs += 24; 
        let currStartTimeAbs = curr.start + 24;
        return (currStartTimeAbs - prevEndTimeAbs) >= 11;
    }

    getYesterdayShift(uid, dateStr) {
        const today = new Date(dateStr);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (yesterday.getMonth() + 1 !== this.month) {
            if (this.lastMonthData && this.lastMonthData[uid]) return this.lastMonthData[uid].lastShift || 'OFF';
            return 'OFF';
        }
        return this.getShiftByDate(this.getDateStrFromDate(yesterday), uid) || 'OFF';
    }

    getShiftByDate(dateStr, uid) {
        if (!this.schedule[dateStr]) return null;
        for (const code of Object.keys(this.schedule[dateStr])) {
            if (this.schedule[dateStr][code].includes(uid)) return code;
        }
        return null;
    }

    getDateStr(d) { return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    getDateStrFromDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

    getConsecutiveWorkDays(uid, dateStr) {
        const targetDate = new Date(dateStr);
        let count = 0;
        for (let i = 1; i <= 14; i++) {
            const checkDate = new Date(targetDate);
            checkDate.setDate(checkDate.getDate() - i);
            let shift = null;
            if (checkDate.getMonth() + 1 !== this.month) {
                const d = checkDate.getDate();
                if (this.lastMonthData[uid]) shift = this.lastMonthData[uid][`last_${d}`];
            } else {
                shift = this.getShiftByDate(this.getDateStrFromDate(checkDate), uid);
            }
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') break;
            count++;
        }
        return count;
    }

    checkWeeklyDiversity(uid, dateStr, newShift) {
        const targetDate = new Date(dateStr);
        const shifts = new Set([newShift]);
        for (let i = 1; i <= 6; i++) { 
            const checkDate = new Date(targetDate);
            checkDate.setDate(checkDate.getDate() - i);
            let shift = null;
            if (checkDate.getMonth() + 1 !== this.month) {
                 const d = checkDate.getDate();
                 if (this.lastMonthData[uid]) shift = this.lastMonthData[uid][`last_${d}`];
            } else {
                 shift = this.getShiftByDate(this.getDateStrFromDate(checkDate), uid);
            }
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') shifts.add(shift);
        }
        return shifts.size <= 3;
    }

    isPreRequestOff(uid, dateStr, offset = 0) {
        const targetDate = new Date(dateStr);
        targetDate.setDate(targetDate.getDate() + offset);
        const targetStr = this.getDateStrFromDate(targetDate);
        const staff = this.staffList.find(s => s.id === uid);
        return staff?.schedulingParams?.[targetStr] === 'REQ_OFF';
    }

    isNightShift(shiftCode) {
        const limitList = this.rules.policy?.noNightAfterOff_List || [];
        if (limitList.length > 0) return limitList.includes(shiftCode);
        const time = this.shiftTimes[shiftCode];
        if (!time) return false;
        return time.start >= 22 || time.start <= 5 || (time.end <= 8 && time.end > 0);
    }

    checkSpecialStatus(staff, shiftCode) {
        const isNight = this.isNightShift(shiftCode);
        if (!isNight) return true;
        const params = staff.schedulingParams || {};
        const today = new Date(this.year, this.month - 1, 1);
        if (params.isPregnant && params.pregnantExpiry && today <= new Date(params.pregnantExpiry)) return false;
        if (params.isBreastfeeding && params.breastfeedingExpiry && today <= new Date(params.breastfeedingExpiry)) return false;
        return true;
    }
}
