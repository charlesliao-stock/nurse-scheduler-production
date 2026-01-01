/**
 * 策略 V1: 標準排班 (Standard Shift Scheduling)
 * 優化：OFF 天數平均化 (Robin Hood Strategy)
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.dailyNeeds = rules.dailyNeeds || { "N_0":2, "E_0":3, "D_0":4 }; 
    }

    run() {
        console.log("=== V1 排班開始 (含 OFF 平均化) ===");
        this.resetAllToOff();
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.scheduleDay(d);
        }
        return this.schedule;
    }

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

        // A. 處理缺額 (Shortage) - 優先補人
        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] < demand[shift]) {
                const success = this.fillShortage(dateStr, shift);
                if (success) count[shift]++;
                else break; 
            }
        });

        // B. 處理過剩 (Surplus) - 踢人去休假
        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] > demand[shift]) { 
                const success = this.reduceSurplus(dateStr, shift);
                if (success) count[shift]--;
                else break;
            }
        });
    }

    // [核心優化] 補人邏輯：優先抓「休假太多」的人回來上班
    fillShortage(dateStr, targetShift) {
        let candidates = [];
        this.staffList.forEach(s => {
            const current = this.getShiftByDate(dateStr, s.id);
            // 只能抓 OFF 的人 (不抓 REQ_OFF，也不抓已經在上班的人，避免挖東牆補西牆)
            if (current !== 'OFF') return; 
            
            if (!this.isValidAssignment(s, dateStr, targetShift)) return;

            const whitelist = this.createWhitelist(s, dateStr);
            const prefIndex = whitelist.indexOf(targetShift); 
            
            // 如果不在白名單，通常不排，但為了人力平衡，若他是「超級閒人」(OFF > 10) 且合規，可考慮強制排入?
            // V1 暫時維持：必須在白名單內 (或包班)
            if (prefIndex === -1) return; 

            candidates.push({
                id: s.id,
                current: current,
                prefIndex: prefIndex,
                totalOff: this.counters[s.id].OFF // 目前累計休假數
            });
        });

        if (candidates.length === 0) return false;

        // 排序權重：
        // 1. totalOff 大者優先 (休太多了，回來上班) -> Descending
        // 2. prefIndex 小者優先 (符合志願) -> Ascending
        candidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) return b.totalOff - a.totalOff; // OFF 多的排前面
            return a.prefIndex - b.prefIndex;
        });

        const best = candidates[0];
        this.updateShift(dateStr, best.id, best.current, targetShift);
        return true;
    }

    // [核心優化] 刪減邏輯：優先踢「休假太少」的人去休假
    reduceSurplus(dateStr, sourceShift) {
        const workers = this.schedule[dateStr][sourceShift];
        if (workers.length === 0) return false;

        let candidates = [];
        workers.forEach(uid => {
            const s = this.staffList.find(st => st.id === uid);
            candidates.push({
                id: s.id,
                forcedOff: this.counters[s.id].forcedOffCount,
                totalOff: this.counters[s.id].OFF, // 目前累計休假數
                uidVal: parseInt(s.id) || 0 
            });
        });

        // 排序權重：
        // 1. totalOff 小者優先 (休太少了，強迫休假) -> Ascending
        // 2. forcedOffCount 小者優先 (大家輪流被踢) -> Ascending
        candidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) return a.totalOff - b.totalOff; // OFF 少的排前面
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
