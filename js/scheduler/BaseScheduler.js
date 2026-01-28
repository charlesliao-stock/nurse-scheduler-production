// js/scheduler/BaseScheduler.js
// 🔧 最終修正版：改善時間軸間隔計算 + 預假保護 + 軟硬規則分離 + 邊界檢查 + 語法修正

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
        
        // 🔥 讀取自訂的最小休息時數，預設 11 小時
        this.rule_minGapHours = parseFloat(r.hard?.minGapHours) || 11;
        this.rule_minGap11 = r.hard?.minGap11 !== false;

        this.rule_maxDiversity3 = r.hard?.maxDiversity3 !== false;
        this.rule_protectPregnant = r.hard?.protectPregnant !== false;
        this.rule_twoOffPerFortnight = r.hard?.twoOffPerFortnight !== false;
        this.rule_offGapMax = parseInt(r.hard?.offGapMax) || 12;
        this.rule_weekStartDay = parseInt(r.hard?.weekStartDay) || 1;

        // 政策與長假
        this.rule_enableRelaxation = r.policy?.enableRelaxation === true;
        this.rule_limitConsecutive = r.policy?.limitConsecutive !== false;
        this.rule_maxConsDays = r.policy?.maxConsDays || 6;
        this.rule_longVacationDays = r.policy?.longVacationDays || 7;
        this.rule_longVacationWorkLimit = r.policy?.longVacationWorkLimit || 7;
        this.rule_noNightAfterOff = r.policy?.noNightAfterOff !== false;
        
        // 🔥 修正：權重 (Must vs Try) - 使用 const 並確保格式正確
        const prioritizeBundle = r.policy?.prioritizeBundle || 'must';
        const prioritizePref = r.policy?.prioritizePref || 'must';
        const prioritizePreReq = r.policy?.prioritizePreReq || 'must';
        const prioritizeAvoid = r.policy?.prioritizeAvoid || 'must';

        this.rule_strictBundle = (prioritizeBundle === 'must');
        this.rule_strictPref = (prioritizePref === 'must');
        this.rule_strictPreReq = (prioritizePreReq === 'must');
        this.rule_strictAvoid = (prioritizeAvoid === 'must');
    }

    buildShiftTimeMap() {
        const map = {};
        if (this.rules.shifts && Array.isArray(this.rules.shifts)) {
            this.rules.shifts.forEach(s => {
                map[s.code] = {
                    start: this.parseTime(s.startTime),
                    end: this.parseTime(s.endTime),
                    hours: s.hours || 8,
                    isBundleAvailable: s.isBundleAvailable === true
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
            this.shiftCodes.forEach(code => {
                this.counters[s.id][code] = 0;
            });
        });
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = {};
            this.shiftCodes.forEach(code => {
                this.schedule[dateStr][code] = [];
            });
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

    clearDayAssignments(day) {
        const dateStr = this.getDateStr(day);
        const shifts = this.schedule[dateStr];
        
        if (!shifts) return;

        Object.keys(shifts).forEach(code => {
            if (code === 'OFF') return;
            if (code === 'REQ_OFF') return;

            [...shifts[code]].forEach(uid => {
                if (this.isPreRequestOff(uid, dateStr)) {
                    this.updateShift(dateStr, uid, code, 'REQ_OFF');
                } else {
                    this.updateShift(dateStr, uid, code, 'OFF');
                }
            });
        });
    }

    updateShift(dateStr, uid, oldShift, newShift) {
        if (oldShift === newShift) return;
        
        if (oldShift && this.schedule[dateStr][oldShift]) {
            const arr = this.schedule[dateStr][oldShift];
            const idx = arr.indexOf(uid);
            if (idx > -1) {
                arr.splice(idx, 1);
                if (this.counters[uid] && this.counters[uid][oldShift] !== undefined) {
                    this.counters[uid][oldShift]--;
                }
            }
        }
        
        if (newShift && this.schedule[dateStr][newShift]) {
            this.schedule[dateStr][newShift].push(uid);
            if (this.counters[uid] && this.counters[uid][newShift] !== undefined) {
                this.counters[uid][newShift]++;
            }
        }
    }

    countStaff(day, shiftCode) {
        const dateStr = this.getDateStr(day);
        if (!this.schedule[dateStr] || !this.schedule[dateStr][shiftCode]) return 0;
        return this.schedule[dateStr][shiftCode].length;
    }

    isValidAssignment(staff, dateStr, shiftCode) {
        if (shiftCode === 'OFF') {
            if (!this.checkOffGap(staff, dateStr)) return false;
            return true;
        }

        if (this.isPreRequestOff(staff.id, dateStr) && shiftCode !== 'REQ_OFF') {
            return false;
        }

        if (this.rule_protectPregnant && !this.checkSpecialStatus(staff, shiftCode)) return false;
        
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (this.rule_minGap11 && !this.checkRestPeriod(prevShift, shiftCode)) return false;
        
        if (this.rule_maxDiversity3 && !this.checkFixedWeekDiversity(staff.id, dateStr, shiftCode)) return false;

        const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
        if (bundleShift) {
            const targetShiftDef = this.shiftTimes[bundleShift];
            if (targetShiftDef && targetShiftDef.isBundleAvailable) {
                if (bundleShift !== shiftCode && this.rule_strictBundle) return false;
            }
        }

        const params = staff.schedulingParams || {};
        if (params[dateStr] === '!' + shiftCode) {
            if (this.rule_strictAvoid) return false;
        }
        
        const reqShift = params[dateStr];
        if (reqShift && reqShift !== 'REQ_OFF' && !reqShift.startsWith('!')) {
            if (reqShift !== shiftCode && this.rule_strictPreReq) return false;
        }

        if (this.rule_limitConsecutive) {
            const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
            let limit = this.rule_maxConsDays;
            
            if (this.isLongVacationMonth(staff)) {
                limit = this.rule_longVacationWorkLimit;
            }
            
            if (currentCons >= limit) return false;
        }

        if (this.rule_noNightAfterOff) {
            if (!bundleShift) {
                const isPrevReqOff = this.isPreRequestOff(staff.id, dateStr, -1);
                if (isPrevReqOff && this.isNightShift(shiftCode)) return false;
            }
        }

        return true;
    }

    checkOffGap(staff, dateStr) {
        return true;
    }

    isLongVacationMonth(staff) {
        const params = staff.schedulingParams || {};
        let maxSeq = 0;
        let currentSeq = 0;
        const longDays = this.rule_longVacationDays || 7;
        
        for(let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            if (params[dateStr] === 'REQ_OFF') {
                currentSeq++;
            } else {
                maxSeq = Math.max(maxSeq, currentSeq);
                currentSeq = 0;
            }
        }
        maxSeq = Math.max(maxSeq, currentSeq);
        return maxSeq >= longDays;
    }

    getShiftCategory(shiftCode) {
        if (!shiftCode || shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return null;
        const def = this.shiftTimes[shiftCode];
        if (!def) return shiftCode;

        const start = def.start;
        if (start >= 0 && start < 8) return 'CAT_0';
        if (start >= 8 && start < 16) return 'CAT_8';
        return 'CAT_16';
    }

    checkFixedWeekDiversity(uid, dateStr, newShift) {
        const date = new Date(dateStr);
        const dayOfWeek = date.getDay();
        const diff = (dayOfWeek < this.rule_weekStartDay) ? (7 - this.rule_weekStartDay + dayOfWeek) : (dayOfWeek - this.rule_weekStartDay);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - diff);
        
        const categories = new Set();
        const newCat = this.getShiftCategory(newShift);
        if (newCat) categories.add(newCat);

        for (let i = 0; i < 7; i++) {
            const checkDate = new Date(weekStart);
            checkDate.setDate(weekStart.getDate() + i);
            const checkStr = this.getDateStrFromDate(checkDate);
            if (checkStr === dateStr) continue;
            
            const shift = this.getShiftByDate(checkStr, uid);
            const cat = this.getShiftCategory(shift);
            if (cat) categories.add(cat);
        }
        return categories.size <= 2;
    }

    checkRestPeriod(prevShift, currShift) {
        if (!prevShift || prevShift === 'OFF' || prevShift === 'REQ_OFF') return true;
        if (!currShift || currShift === 'OFF' || currShift === 'REQ_OFF') return true;
        
        const prev = this.shiftTimes[prevShift];
        const curr = this.shiftTimes[currShift];
        
        if (!prev || !curr) {
            console.warn(`⚠️ 找不到班別定義: prev=${prevShift}, curr=${currShift}`);
            return true;
        }

        let prevEndTimeAbs = prev.end;
        
        if (prev.end < prev.start) {
            prevEndTimeAbs = prev.end + 24;
        }

        const currStartTimeAbs = curr.start + 24;
        const gap = currStartTimeAbs - prevEndTimeAbs;

        if (gap < 0) {
            console.warn(`⚠️ 休息時間計算出現負值: ${prevShift}(${prev.start}-${prev.end}) → ${currShift}(${curr.start}-${curr.end}), gap=${gap}`);
            return false;
        }
        
        if (gap > 48) {
            console.warn(`⚠️ 休息時間異常過長: ${prevShift} → ${currShift}, gap=${gap}小時`);
            return true;
        }

        const isValid = gap >= this.rule_minGapHours;
        
        if (!isValid) {
            console.log(`❌ 休息時間不足: ${prevShift}(結束${prevEndTimeAbs-24}點) → ${currShift}(開始${curr.start}點), 間隔${gap.toFixed(1)}小時 < 要求${this.rule_minGapHours}小時`);
        }

        return isValid;
    }

    getYesterdayShift(uid, dateStr) {
        const today = new Date(dateStr);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        
        if (yesterday.getMonth() + 1 !== this.month) {
            if (this.lastMonthData && this.lastMonthData[uid]) {
                return this.lastMonthData[uid].lastShift || 'OFF';
            }
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

    getDateStr(d) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    getDateStrFromDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    getConsecutiveWorkDays(uid, dateStr) {
        const targetDate = new Date(dateStr);
        let count = 0;
        
        for (let i = 1; i <= 14; i++) {
            const checkDate = new Date(targetDate);
            checkDate.setDate(checkDate.getDate() - i);
            let shift = null;
            
            if (checkDate.getMonth() + 1 !== this.month) {
                const d = checkDate.getDate();
                if (this.lastMonthData && this.lastMonthData[uid]) {
                    shift = this.lastMonthData[uid][`last_${d}`] || (i === 1 ? this.lastMonthData[uid].lastShift : 'OFF');
                } else {
                    shift = 'OFF';
                }
            } else {
                shift = this.getShiftByDate(this.getDateStrFromDate(checkDate), uid);
            }
            
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') break;
            count++;
        }
        return count;
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
        
        const s = time.start;
        const e = time.end;
        
        if (e < s) return true;
        return s >= 22 || s <= 5 || (e <= 8 && e > 0);
    }

    checkSpecialStatus(staff, shiftCode) {
        const isNight = this.isNightShift(shiftCode);
        if (!isNight) return true;
        
        const params = staff.schedulingParams || {};
        const today = new Date(this.year, this.month - 1, 1);
        
        if (params.isPregnant && params.pregnantExpiry && today <= new Date(params.pregnantExpiry)) {
            return false;
        }
        if (params.isBreastfeeding && params.breastfeedingExpiry && today <= new Date(params.breastfeedingExpiry)) {
            return false;
        }
        return true;
    }
}
