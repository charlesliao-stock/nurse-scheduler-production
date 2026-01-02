/**
 * 策略 V1: 標準排班 (Standard Shift Scheduling)
 * Fix: 確保連續天數檢查正確應用 BaseScheduler 的修復邏輯
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.dailyNeeds = rules.dailyNeeds || { "N_0":2, "E_0":3, "D_0":4 };
    }

    run() {
        console.log("=== V1 排班開始 ===");
        this.resetAllToOff();
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.scheduleDay(d);
        }
        return this.schedule;
    }

    resetAllToOff() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'OFF'); 
                }
            }
        });
        console.log("[Phase 0] 已重置為初始狀態 (保留預休)");
    }

    scheduleDay(day) {
        const dateStr = this.getDateStr(day);
        const dayOfWeek = new Date(dateStr).getDay(); 
        const adjustedDayIdx = (dayOfWeek + 6) % 7; 
        
        // 1. 決定初始班別
        this.staffList.forEach(staff => {
            const currentStatus = this.getShiftByDate(dateStr, staff.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return;

            const prevShift = this.getYesterdayShift(staff.id, dateStr);
            let whitelist = this.createWhitelist(staff, dateStr);
            let candidate = 'OFF';
            
            if (prevShift === 'OFF' || prevShift === 'LEAVE') {
                if (whitelist.length > 0) candidate = whitelist[0];
            } else {
                // 順接嘗試
                if (this.isValidAssignment(staff, dateStr, prevShift)) {
                    candidate = prevShift;
                } else {
                    candidate = 'OFF'; 
                }
            }

            // 二次確認 (如果順接失敗，嘗試白名單第一志願，若還不行則 OFF)
            if (candidate === 'OFF' && prevShift !== 'OFF' && prevShift !== 'LEAVE') {
                 if (whitelist.length > 0 && this.isValidAssignment(staff, dateStr, whitelist[0])) {
                     candidate = whitelist[0];
                 }
            }

            // 最終防守
            if (candidate !== 'OFF' && !this.isValidAssignment(staff, dateStr, candidate)) {
                candidate = 'OFF';
            }

            this.updateShift(dateStr, staff.id, 'OFF', candidate);
        });

        // 2. 人力平衡
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

        // 1. 11小時間隔
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (!this.checkRestPeriod(prevShift, shift)) return false;

        // 2. 週班別種類
        if (!this.checkWeeklyVariety(staff.id, dateStr, shift)) return false;

        // 3. [關鍵] 連續上班天數檢查
        // 讀取設定，預設為 6 (代表做6休1)
        const maxCons = (this.rules.policy && this.rules.policy.maxConsDays) ? this.rules.policy.maxConsDays : 6;
        
        // 取得「截至昨天為止」的連續上班天數 (已包含上月結轉)
        const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
        
        // 如果 已經連上 6 天了，今天就不能再排班 (否則變連 7)
        // Log for debugging specific staff if needed:
        // if (staff.name === '陳皓芸') console.log(`${dateStr} 陳皓芸 History: ${currentCons}, Max: ${maxCons}`);
        
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

        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] < demand[shift]) {
                if(this.fillShortage(dateStr, shift)) count[shift]++;
                else break;
            }
        });

        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] > demand[shift]) { 
                if(this.reduceSurplus(dateStr, shift)) count[shift]--;
                else break;
            }
        });
    }

    fillShortage(dateStr, targetShift) {
        let candidates = [];
        this.staffList.forEach(s => {
            const current = this.getShiftByDate(dateStr, s.id);
            if (current === 'REQ_OFF' || current === 'LEAVE' || current === targetShift) return;
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
            if (a.prefIndex !== b.prefIndex) return a.prefIndex - b.prefIndex;
            return b.totalOff - a.totalOff;
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
                forcedOff: this.counters[s.id].forcedOffCount || 0,
                totalOff: this.counters[s.id].OFF,
                uidVal: parseInt(s.id) || 0 
            });
        });

        candidates.sort((a, b) => {
            if (a.forcedOff !== b.forcedOff) return a.forcedOff - b.forcedOff;
            if (a.totalOff !== b.totalOff) return a.totalOff - b.totalOff;
            return a.uidVal - b.uidVal;
        });

        const victim = candidates[0];
        this.updateShift(dateStr, victim.id, sourceShift, 'OFF');
        if (!this.counters[victim.id].forcedOffCount) this.counters[victim.id].forcedOffCount = 0;
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
