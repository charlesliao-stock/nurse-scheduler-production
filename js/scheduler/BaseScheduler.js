// js/scheduler/BaseScheduler.js
// 🔧 核心修正版：休息間隔優先權重構
// ✅ 修正重點：
// 1. 將休息時間檢查提升為第一優先，不符 11 小時絕對不排班。
// 2. 修正 D 接 N 的 8 小時判定邏輯，精確計算跨日時間點。
// 3. 確保回溯與優化階段皆遵循此硬性規則。

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
        // 檢查前一日班別 vs 今日預排班別
        const prevDate = this.getPreviousDate(dateStr);
        const prevShift = this.getShiftByDateStr(prevDate, staff.id);
        
        if (!this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, shiftCode, staff.name)) {
            // 間隔不足 11 小時，直接否決，不檢查後續規則
            return false;
        }

        // 檢查今日預排班別 vs 明日已固定班別 (例如預假後的指定班)
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
        // 連續上班天數限制
        if (this.rule_limitConsecutive) {
            const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
            let limit = parseInt(this.rule_maxConsDays) || 6;
            if (currentCons >= limit) return false;
        }

        // 5. 【第四優先：志願與避班設定】
        const prefs = staff.preferences || staff.prefs || {};
        const priorities = prefs.priorities || [prefs.favShift, prefs.favShift2, prefs.favShift3].filter(Boolean);
        
        if (this.rule_strictPref && priorities.length > 0) {
            if (!priorities.includes(shiftCode)) return false;
        }

        if (params[dateStr] === '!' + shiftCode && this.rule_strictAvoid) return false;

        return true;
    }

    // ✅ 精確的日期時間計算邏輯
    checkRestPeriodWithDate(prevDateStr, prevShiftCode, currDateStr, currShiftCode, staffName = '') {
        // 若其中一班是假，間隔必充足
        if (!prevShiftCode || prevShiftCode === 'OFF' || prevShiftCode === 'REQ_OFF') return true;
        if (!currShiftCode || currShiftCode === 'OFF' || currShiftCode === 'REQ_OFF') return true;
        
        const prevShift = this.shiftTimes[prevShiftCode];
        const currShift = this.shiftTimes[currShiftCode];
        if (!prevShift || !currShift) return true;

        try {
            // 前一班的下班時間物件
            const prevEnd = new Date(prevDateStr);
            prevEnd.setHours(prevShift.endHour, prevShift.endMinute, 0, 0);
            
            // 處理跨日班別 (如 N 班 00:00-08:00，其 endHour < startHour 為 false)
            // 或是小夜班 E 接隔日凌晨的狀況
            if (prevShift.endHour < prevShift.startHour || (prevShift.endHour === prevShift.startHour && prevShift.endMinute < prevShift.startMinute)) {
                prevEnd.setDate(prevEnd.getDate() + 1);
            }
            
            // 當前欲排班別的上班時間物件
            const currStart = new Date(currDateStr);
            currStart.setHours(currShift.startHour, currShift.startMinute, 0, 0);
            
            // 計算間隔小時
            const gap = (currStart - prevEnd) / (1000 * 60 * 60);
            const minGap = this.rule_minGapHours || 11;
            
            if (gap < minGap) {
                console.warn(`🚨 [休息違規攔截] ${staffName}: ${prevShiftCode}(${prevDateStr} 下班) -> ${currShiftCode}(${currDateStr} 上班) 只有 ${gap.toFixed(1)}h`);
                return false; 
            }
            
            return true;
        } catch (e) {
            console.error('間隔計算異常:', e);
            return false; // 發生異常時預設不允許排班，以保安全
        }
    }

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
            if (idx > -1) arr.splice(idx, 1);
        }
        if (newShift && this.schedule[dateStr][newShift]) {
            this.schedule[dateStr][newShift].push(uid);
        }
    }
}
