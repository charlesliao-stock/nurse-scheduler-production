/**
 * 策略 V1: 標準排班 (Standard Shift Scheduling)
 * 修復：補回遺失的 resetAllToOff 函式
 * 功能：含跨月連續檢查、OFF 平均化 (Robin Hood)
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.dailyNeeds = rules.dailyNeeds || { "N_0":2, "E_0":3, "D_0":4 }; 
    }

    run() {
        console.log("=== V1 排班開始 (含 OFF 平均化) ===");
        
        // [Step 0] 初始化
        this.resetAllToOff();
        
        // [Step 1] 逐日排班
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.scheduleDay(d);
        }
        return this.schedule;
    }

    // ==========================================
    // [修復] 補回此函式
    // ==========================================
    resetAllToOff() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);
                
                // 只要不是「預休 (REQ_OFF)」或「請假 (LEAVE)」，全部清成 OFF
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'OFF'); 
                }
            }
        });
        console.log("[Step 0] 已重置所有非預休班別為 OFF");
    }

    // ==========================================
    // 每日排班邏輯
    // ==========================================
    scheduleDay(day) {
        const dateStr = this.getDateStr(day);
        const dayOfWeek = new Date(dateStr).getDay(); 
        const adjustedDayIdx = (dayOfWeek + 6) % 7; 
        
        // 1. 決定每人的「初始班別」
        this.staffList.forEach(staff => {
            const currentStatus = this.getShiftByDate(dateStr, staff.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return;

            const prevShift = this.getYesterdayShift(staff.id, dateStr);
            let whitelist = this.createWhitelist(staff, dateStr);

            let candidate = 'OFF';
            
            if (prevShift === 'OFF' || prevShift === 'LEAVE') {
                if (whitelist.length > 0) candidate = whitelist[0];
            } else {
                // 嘗試延續
                if (this.isValidAssignment(staff, dateStr, prevShift)) {
                    candidate = prevShift;
                } else {
                    candidate = 'OFF'; 
                }
            }

            if (candidate !== 'OFF' && !this.isValidAssignment(staff, dateStr, candidate)) {
                candidate = 'OFF';
            }

            this.updateShift(dateStr, staff.id, 'OFF', candidate);
        });

        // 2. 人力平衡 (Balance)
        this.balanceStaff(dateStr, adjustedDayIdx);
    }

    createWhitelist(staff, dateStr) {
        let list = [];
        if (staff.packageType && ['N', 'E', 'D'].includes(staff.packageType)) {
            list.push(staff.packageType);
        }
        if (staff.prefs && staff.prefs[dateStr] && typeof staff.prefs[dateStr] === 'object') {
            if (staff.prefs[dateStr][1]) list.push(staff.prefs[dateStr][1]);
            if (staff.prefs[dateStr][2]) list.push(staff.prefs[dateStr][2]);
            if (staff.prefs[dateStr][3]) list.push(staff.prefs[dateStr][3]);
        }
        return [...new Set(list)];
    }

    isValidAssignment(staff, dateStr, shift) {
        if (shift === 'OFF') return true;

        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (!this.checkRestPeriod(prevShift, shift)) return false;
        if (!this.checkWeeklyVariety(staff.id, dateStr, shift)) return false;

        const maxCons = this.rules.policy?.maxConsDays || 6; 
        const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
        if (currentCons >= maxCons) return false;

        return true;
    }

    balanceStaff(dateStr, dayIdx) {
        const demand = {
            N: this.getDailyDemand('N', dayIdx),
            E: this.getDailyDemand('E', dayIdx),
            D: this.getDailyDemand('D', dayIdx)
        };

        const count = {
            N: this.schedule[dateStr]['N'].length,
            E: this.schedule[dateStr]['E'].length,
            D: this.schedule[dateStr]['D'].length
        };

        // A. 處理缺額 (Shortage)
        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] < demand[shift]) {
                const success = this.fillShortage(dateStr, shift);
                if (success) count[shift]++;
                else break; 
            }
        });

        // B. 處理過剩 (Surplus)
        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] > demand[shift]) { 
                const success = this.reduceSurplus(dateStr, shift);
                if (success) count[shift]--;
                else break;
            }
        });
    }

    // 補人：優先抓「休假太多」的人
    fillShortage(dateStr, targetShift) {
        let candidates = [];
        this.staffList.forEach(s => {
            const current = this.getShiftByDate(dateStr, s.id);
            if (current !== 'OFF') return; 
            
            if (!this.isValidAssignment(s, dateStr, targetShift)) return;

            const whitelist = this.createWhitelist(s, dateStr);
            const prefIndex = whitelist.indexOf(targetShift); 
            
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
            if (a.totalOff !== b.totalOff) return b.totalOff - a.totalOff; // OFF 多的優先抓
            return a.prefIndex - b.prefIndex;
        });

        const best = candidates[0];
        this.updateShift(dateStr, best.id, best.current, targetShift);
        return true;
    }

    // 刪人：優先踢「休假太少」的人
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
            if (a.totalOff !== b.totalOff) return a.totalOff - b.totalOff; // OFF 少的優先踢
            if (a.forcedOff !== b.forcedOff) return a.forcedOff - b.forcedOff;
            return a.uidVal - b.uidVal;
        });

        const victim = candidates[0];
        this.updateShift(dateStr, victim.id, sourceShift, 'OFF');
        this.counters[victim.id].forcedOffCount++; 
        return true;
    }

    getDailyDemand(shift, dayIdx) {
        const key = `${shift}_${dayIdx}`;
        if (this.rules.dailyNeeds && this.rules.dailyNeeds[key] !== undefined) {
            return parseInt(this.rules.dailyNeeds[key]);
        }
        return 0;
    }
}
