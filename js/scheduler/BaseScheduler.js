// js/scheduler/BaseScheduler.js
// 🔧 最終修正版：改善時間軸間隔計算 + 預假保護 + 軟硬規則分離 + 邊界檢查

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
        this.rule_minGap11 = r.hard?.minGap11 !== false; // 開關

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
        
        // 權重 (Must vs Try)
        let prioritizeBundle = r.policy?.prioritizeBundle || 'must';
        let prioritizePref = r.policy?.prioritizePref || 'must';
        let prioritizePreReq = r.policy?.prioritizePreReq || 'must'; 
        let prioritizeAvoid = r.policy?.prioritizeAvoid || 'must';

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
    },

    parseTime(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h + (m || 0) / 60;
    },

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
    },

    // 🔥 清除班表時，嚴格保護 REQ_OFF
    clearDayAssignments(day) {
        const dateStr = this.getDateStr(day);
        const shifts = this.schedule[dateStr];
        
        if (!shifts) return;

        Object.keys(shifts).forEach(code => {
            // 系統產生的 OFF 不用清
            if (code === 'OFF') return;
            
            // 🔥 絕對保護：預假 REQ_OFF 不可清
            if (code === 'REQ_OFF') return;

            [...shifts[code]].forEach(uid => {
                // 雙重檢查：如果原本就是預假，還原為 REQ_OFF
                if (this.isPreRequestOff(uid, dateStr)) {
                    this.updateShift(dateStr, uid, code, 'REQ_OFF');
                } else {
                    this.updateShift(dateStr, uid, code, 'OFF');
                }
            });
        });
    },

    updateShift(dateStr, uid, oldShift, newShift) {
        if (oldShift === newShift) return;
        if (oldShift && this.schedule[dateStr][oldShift]) {
            const arr = this.schedule[dateStr][oldShift];
            const idx = arr.indexOf(uid);
            if (idx > -1) {
                arr.splice(idx, 1);
                if (this.counters[uid] && this.counters[uid][oldShift] !== undefined) this.counters[uid][oldShift]--;
            }
        }
        if (newShift && this.schedule[dateStr][newShift]) {
            this.schedule[dateStr][newShift].push(uid);
            if (this.counters[uid] && this.counters[uid][newShift] !== undefined) this.counters[uid][newShift]++;
        }
    },

    countStaff(day, shiftCode) {
        const dateStr = this.getDateStr(day);
        if (!this.schedule[dateStr] || !this.schedule[dateStr][shiftCode]) return 0;
        return this.schedule[dateStr][shiftCode].length;
    },

    // --- 核心驗證 ---
    isValidAssignment(staff, dateStr, shiftCode) {
        // 如果是 OFF，只檢查休假間隔
        if (shiftCode === 'OFF') {
            if (!this.checkOffGap(staff, dateStr)) return false; 
            return true;
        }

        // 🔥 預假檢查：如果該日已鎖定為 REQ_OFF，則除了填入 REQ_OFF 外，其他一律禁止
        if (this.isPreRequestOff(staff.id, dateStr) && shiftCode !== 'REQ_OFF') {
            return false;
        }

        // 1. 孕婦保護
        if (this.rule_protectPregnant && !this.checkSpecialStatus(staff, shiftCode)) return false;
        
        // 2. 休息時間 (N-D 檢查) - 使用時間軸計算
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (this.rule_minGap11 && !this.checkRestPeriod(prevShift, shiftCode)) return false;
        
        // 3. 週班別多樣性
        if (this.rule_maxDiversity3 && !this.checkFixedWeekDiversity(staff.id, dateStr, shiftCode)) return false;

        // 4. 包班限制
        const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
        if (bundleShift) {
            const targetShiftDef = this.shiftTimes[bundleShift];
            if (targetShiftDef && targetShiftDef.isBundleAvailable) {
                if (bundleShift !== shiftCode && this.rule_strictBundle) return false;
            }
        }

        // 5. 排斥班別 (!D) - 區分 Must 與 Try
        const params = staff.schedulingParams || {};
        if (params[dateStr] === '!' + shiftCode) {
            if (this.rule_strictAvoid) return false; 
        }
        
        // 6. 指定班別 (PreReq)
        const reqShift = params[dateStr];
        if (reqShift && reqShift !== 'REQ_OFF' && !reqShift.startsWith('!')) {
            if (reqShift !== shiftCode && this.rule_strictPreReq) return false;
        }

        // 7. 連續上班限制
        if (this.rule_limitConsecutive) {
            const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
            let limit = this.rule_maxConsDays;
            
            // 長假例外判定
            if (this.isLongVacationMonth(staff)) {
                limit = this.rule_longVacationWorkLimit;
            }
            
            if (currentCons >= limit) return false;
        }

        // 8. 避免休假後接大夜 (可選政策)
        if (this.rule_noNightAfterOff) {
            if (!bundleShift) {
                const isPrevReqOff = this.isPreRequestOff(staff.id, dateStr, -1);
                if (isPrevReqOff && this.isNightShift(shiftCode)) return false;
            }
        }

        return true;
    },

    checkOffGap(staff, dateStr) { return true; }

    isLongVacationMonth(staff) {
        const params = staff.schedulingParams || {};
        let maxSeq = 0;
        let currentSeq = 0;
        const longDays = this.rule_longVacationDays || 7;
        
        for(let d=1; d<=this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            if (params[dateStr] === 'REQ_OFF') currentSeq++;
            else { maxSeq = Math.max(maxSeq, currentSeq); currentSeq = 0; }
        }
        maxSeq = Math.max(maxSeq, currentSeq);
        return maxSeq >= longDays;
    },

    getShiftCategory(shiftCode) {
        if (!shiftCode || shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return null;
        const def = this.shiftTimes[shiftCode];
        if (!def) return shiftCode; 

        const start = def.start; 
        // 簡單分類：0-8(大夜), 8-16(白班), 16-24(小夜)
        if (start >= 0 && start < 8) return 'CAT_0';
        if (start >= 8 && start < 16) return 'CAT_8';
        return 'CAT_16';
    },

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
    },

    /**
     * 🔥 改善版：休息時間檢查 (Check Rest Period)
     * 完全使用時間軸計算，包含詳細的邊界檢查和異常處理
     */
    checkRestPeriod(prevShift, currShift) {
        // 如果前後有任一班是休息 (OFF/REQ_OFF)，則休息時間無限大，必定合法
        if (!prevShift || prevShift === 'OFF' || prevShift === 'REQ_OFF') return true;
        if (!currShift || currShift === 'OFF' || currShift === 'REQ_OFF') return true;
        
        const prev = this.shiftTimes[prevShift];
        const curr = this.shiftTimes[currShift];
        
        // 防呆：若找不到班別定義，預設通過 (避免卡死)
        if (!prev || !curr) {
            console.warn(`⚠️ 找不到班別定義: prev=${prevShift}, curr=${currShift}`);
            return true;
        }

        // 計算昨天班別的結束時間（以昨天 00:00 為基準的小時數）
        // 例如：08:00-16:00 -> start=8, end=16
        // 例如：20:00-04:00 -> start=20, end=4 (跨日)
        let prevEndTimeAbs = prev.end;
        
        // 🔥 跨日判斷：如果結束時間小於開始時間，表示跨日班別
        if (prev.end < prev.start) {
            // 例如：22:00-06:00 -> end=6, start=22 -> end 實際是隔天的 6 點，所以 +24
            prevEndTimeAbs = prev.end + 24;
        }

        // 計算今天班別的開始時間（以昨天 00:00 為基準，所以 +24）
        // 例如：今天 08:00 上班 -> 24 + 8 = 32
        const currStartTimeAbs = curr.start + 24;

        // 計算休息時間間隔（小時）
        const gap = currStartTimeAbs - prevEndTimeAbs;

        // 🔥 異常檢測：如果計算出負值或異常大的值，記錄警告
        if (gap < 0) {
            console.warn(`⚠️ 休息時間計算出現負值: ${prevShift}(${prev.start}-${prev.end}) → ${currShift}(${curr.start}-${curr.end}), gap=${gap}`);
            // 保守處理：拒絕排班
            return false;
        }
        
        if (gap > 48) {
            console.warn(`⚠️ 休息時間異常過長: ${prevShift} → ${currShift}, gap=${gap}小時`);
            // 超過 48 小時通常是計算錯誤，但休息夠長所以通過
            return true;
        }

        // 🔥 核心判斷：比對規則設定的最小間隔小時數
        const isValid = gap >= this.rule_minGapHours;
        
        // 詳細日誌（開發除錯用，生產環境可移除）
        if (!isValid) {
            console.log(`❌ 休息時間不足: ${prevShift}(結束${prevEndTimeAbs-24}點) → ${currShift}(開始${curr.start}點), 間隔${gap.toFixed(1)}小時 < 要求${this.rule_minGapHours}小時`);
        }

        return isValid;
    },

    getYesterdayShift(uid, dateStr) {
        const today = new Date(dateStr);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (yesterday.getMonth() + 1 !== this.month) {
            if (this.lastMonthData && this.lastMonthData[uid]) return this.lastMonthData[uid].lastShift || 'OFF';
            return 'OFF';
        }
        return this.getShiftByDate(this.getDateStrFromDate(yesterday), uid) || 'OFF';
    },

    getShiftByDate(dateStr, uid) {
        if (!this.schedule[dateStr]) return null;
        for (const code of Object.keys(this.schedule[dateStr])) {
            if (this.schedule[dateStr][code].includes(uid)) return code;
        }
        return null;
    },

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
                if (this.lastMonthData && this.lastMonthData[uid]) {
                    shift = this.lastMonthData[uid][`last_${d}`] || 
                            (i === 1 ? this.lastMonthData[uid].lastShift : 'OFF');
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
    },

    isPreRequestOff(uid, dateStr, offset = 0) {
        const targetDate = new Date(dateStr);
        targetDate.setDate(targetDate.getDate() + offset);
        const targetStr = this.getDateStrFromDate(targetDate);
        const staff = this.staffList.find(s => s.id === uid);
        return staff?.schedulingParams?.[targetStr] === 'REQ_OFF';
    },

    isNightShift(shiftCode) {
        const limitList = this.rules.policy?.noNightAfterOff_List || [];
        if (limitList.length > 0) return limitList.includes(shiftCode);
        const time = this.shiftTimes[shiftCode];
        if (!time) return false;
        // 根據時間判斷：跨越午夜(start > end) 或 開始時間 >= 22 或 結束時間 <= 8
        const s = time.start;
        const e = time.end;
        // 跨日判斷 (例如 23:00 - 07:00) -> s=23, e=7
        if (e < s) return true;
        // 傳統夜班定義 (22:00 後開始，或 08:00 前結束且非全天OFF)
        return s >= 22 || s <= 5 || (e <= 8 && e > 0);
    },

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
