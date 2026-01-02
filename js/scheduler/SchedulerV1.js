/**
 * 策略 V1: 標準排班 - 嚴格合規版
 * 特性：
 * 1. 嚴格白名單 (Whitelist is strictly filtered by rules)
 * 2. 解決連續上班過長與間隔不足問題
 * 3. 解決缺口填補時的合規性
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules, shifts) {
        super(allStaff, year, month, lastMonthData, rules, shifts);
        this.dailyNeeds = rules.dailyNeeds || { "N_0":2, "E_0":3, "D_0":4 }; 
        this.checkInterval = 5; 
    }

    run() {
        console.log("=== V1 排班開始 (嚴格合規版) ===");
        this.resetAllToOff();
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.scheduleDay(d);
            this.fixDailyGaps(d);
            if (d % this.checkInterval === 0 || d === this.daysInMonth) {
                this.performHealthCheck(d);
            }
        }
        return this.schedule;
    }

    scheduleDay(day) {
        const dateStr = this.getDateStr(day);
        const dayOfWeek = new Date(dateStr).getDay(); 
        const adjustedDayIdx = (dayOfWeek + 6) % 7; 
        
        this.staffList.forEach(staff => {
            const currentStatus = this.getShiftByDate(dateStr, staff.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return;

            // [關鍵] 取得「經過規則過濾」的白名單
            // 如果連上 6 天，這裡回傳的 list 會是空，或不包含上班班別
            const whitelist = this.createWhitelist(staff, dateStr);
            const prevShift = this.getYesterdayShift(staff.id, dateStr);
            
            let candidate = 'OFF';

            if (whitelist.length > 0) {
                // 優先順接
                if (['N', 'E', 'D'].includes(prevShift) && whitelist.includes(prevShift)) {
                    candidate = prevShift;
                } else {
                    candidate = whitelist[0];
                }
            }

            this.updateShift(dateStr, staff.id, 'OFF', candidate);
        });

        this.balanceStaff(dateStr, adjustedDayIdx);
    }

    // ==========================================
    // [核心] 產生「合法」白名單
    // ==========================================
    createWhitelist(staff, dateStr) {
        let rawList = [];

        // 1. 收集意願
        // 包班
        if (staff.packageType && ['N', 'E', 'D'].includes(staff.packageType)) {
            rawList.push(staff.packageType);
        }
        // 偏好
        if (staff.prefs && staff.prefs[dateStr]) {
            if (staff.prefs[dateStr][1]) rawList.push(staff.prefs[dateStr][1]);
            if (staff.prefs[dateStr][2]) rawList.push(staff.prefs[dateStr][2]);
            if (staff.prefs[dateStr][3]) rawList.push(staff.prefs[dateStr][3]);
        }

        // 無偏好 -> 開放 (解決巫宇涵問題)
        if (rawList.length === 0) {
            rawList = ['D', 'E', 'N']; 
        }

        rawList = [...new Set(rawList)];

        // 2. 嚴格過濾規則 (Filter)
        // 只有通過檢查的班別才能留在清單中
        return rawList.filter(shift => this.isValidAssignment(staff, dateStr, shift));
    }

    isValidAssignment(staff, dateStr, shift) {
        if (shift === 'OFF') return true;

        // 1. 間隔 (使用新版 checkRestPeriod，動態時間)
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (!this.checkRestPeriod(prevShift, shift)) return false;

        // 2. 週種類
        if (!this.checkWeeklyVariety(staff.id, dateStr, shift)) return false;

        // 3. 連續上班天數 (嚴格限制)
        const maxCons = this.rules.policy?.maxConsDays || 6; 
        const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
        // 若「截至昨天」已達 6 天，今天再排班就是 7 -> 違規
        if (currentCons >= maxCons) return false;

        return true;
    }

    balanceStaff(dateStr, dayIdx) {
        const shifts = ['N', 'E', 'D'];
        
        // 補缺
        shifts.forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let count = this.schedule[dateStr][shift].length;
            while (count < demand) {
                if (this.fillShortage(dateStr, shift)) count++;
                else break; 
            }
        });

        // 減剩
        shifts.forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let count = this.schedule[dateStr][shift].length;
            while (count > demand) { 
                if (this.reduceSurplus(dateStr, shift)) count--;
                else break;
            }
        });
    }

    // [修正] 嚴格補缺：只從白名單抓人
    fillShortage(dateStr, targetShift) {
        let candidates = [];
        this.staffList.forEach(s => {
            const current = this.getShiftByDate(dateStr, s.id);
            if (current !== 'OFF') return; 
            
            // 使用 createWhitelist (已內含 isValidAssignment)
            const whitelist = this.createWhitelist(s, dateStr);
            const prefIndex = whitelist.indexOf(targetShift); 
            
            // 必須在白名單內 (遵守不可放寬原則)
            if (prefIndex === -1) return; 

            candidates.push({
                id: s.id,
                current: current,
                prefIndex: prefIndex, 
                totalOff: this.counters[s.id].OFF
            });
        });

        if (candidates.length === 0) return false;

        candidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) return b.totalOff - a.totalOff; 
            return a.prefIndex - b.prefIndex;
        });

        const best = candidates[0];
        this.updateShift(dateStr, best.id, best.current, targetShift);
        return true;
    }

    reduceSurplus(dateStr, sourceShift) {
        const workers = this.schedule[dateStr][sourceShift];
        if (workers.length === 0) return false;

        let candidates = [];
        workers.forEach(uid => {
            const s = this.staffList.find(st => st.id === uid);
            candidates.push({
                id: s.id,
                forcedOff: this.counters[s.id].forcedOffCount,
                totalOff: this.counters[s.id].OFF,
                uidVal: parseInt(s.id) || 0 
            });
        });

        candidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) return a.totalOff - b.totalOff; 
            if (a.forcedOff !== b.forcedOff) return a.forcedOff - b.forcedOff;
            return a.uidVal - b.uidVal;
        });

        const victim = candidates[0];
        this.updateShift(dateStr, victim.id, sourceShift, 'OFF');
        this.counters[victim.id].forcedOffCount++; 
        return true;
    }

    fixDailyGaps(day) {
        const dateStr = this.getDateStr(day);
        const dayIdx = (new Date(dateStr).getDay() + 6) % 7;
        ['N', 'E', 'D'].forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let currentCount = this.schedule[dateStr][shift].length;
            while (currentCount < demand) {
                if (this.fillShortage(dateStr, shift)) currentCount++;
                else break;
            }
        });
    }

    performHealthCheck(currentDay) {
        for (let k = 0; k < 50; k++) {
            let minOff = 999, maxOff = -1;
            let poorStaff = null, richStaff = null;
            this.staffList.forEach(s => {
                const offs = this.counters[s.id].OFF;
                if (offs < minOff) { minOff = offs; poorStaff = s; }
                if (offs > maxOff) { maxOff = offs; richStaff = s; }
            });
            if (maxOff - minOff <= 2) break;

            const startCheckDay = Math.max(1, currentDay - this.checkInterval + 1);
            let swapped = false;
            for (let d = currentDay; d >= startCheckDay; d--) {
                const dateStr = this.getDateStr(d);
                const poorShift = this.getShiftByDate(dateStr, poorStaff.id);
                const richShift = this.getShiftByDate(dateStr, richStaff.id);
                
                if (['N', 'E', 'D'].includes(poorShift) && richShift === 'OFF') {
                    // 交換檢查：使用新版 createWhitelist 確保合規
                    const richWL = this.createWhitelist(richStaff, dateStr);
                    
                    if (richWL.includes(poorShift)) {
                        // 額外檢查明天
                        if (this.isSafeSwap(dateStr, richStaff, poorShift) && this.isSafeSwap(dateStr, poorStaff, 'OFF')) {
                            this.updateShift(dateStr, poorStaff.id, poorShift, 'OFF');
                            this.updateShift(dateStr, richStaff.id, 'OFF', poorShift);
                            swapped = true;
                            break;
                        }
                    }
                }
            }
            if (!swapped) break; 
        }
    }

    isSafeSwap(dateStr, staff, newShift) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1);
        if (d.getMonth() + 1 === this.month && d.getDate() <= this.daysInMonth) {
            const nextDateStr = this.getDateStrFromDate(d);
            const nextShift = this.getShiftByDate(nextDateStr, staff.id);
            if (!this.checkRestPeriod(newShift, nextShift)) return false;
        }
        return true;
    }

    getDailyDemand(shift, dayIdx) {
        const key = `${shift}_${dayIdx}`;
        if (this.rules.dailyNeeds && this.rules.dailyNeeds[key] !== undefined) return parseInt(this.rules.dailyNeeds[key]);
        return 0;
    }
    
    resetAllToOff() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') this.updateShift(dateStr, staff.id, 'OFF', 'OFF'); 
            }
        });
    }
}
