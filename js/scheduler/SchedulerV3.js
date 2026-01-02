// js/scheduler/SchedulerV3.js
class SchedulerV3 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.phaseOrder = ['N', 'E', 'D']; 
    }

    run() {
        console.log("=== V3 班別優先瀑布流排班 ===");
        for (const shiftType of this.phaseOrder) {
            this.runPhase(shiftType);
        }
        // Phase D 結束後，執行最終 OFF 平衡
        this.runCycle_FinalBalance();
        return this.schedule;
    }

    runPhase(targetShift) {
        this.runCycle1_Preferences(targetShift);
        this.runCycle3_ForceFill(targetShift);
    }

    runCycle1_Preferences(targetShift) {
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.staffList.forEach(staff => {
                if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') return; 

                let isMatch = false;
                if (staff.packageType === targetShift) isMatch = true;
                else if (this.getPreference(staff, dateStr, 1) === targetShift) isMatch = true;

                if (isMatch && this.isValidContinuity(staff, dateStr, targetShift)) {
                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                }
            });
        }
    }

    runCycle3_ForceFill(targetShift) {
        const sortedDates = this.getDatesSortedByGap(targetShift);
        for (const { dateStr, gap } of sortedDates) {
            if (gap <= 0) continue;
            
            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            candidates = candidates.filter(s => 
                this.isInWhiteList(s, targetShift) && 
                this.isValidContinuity(s, dateStr, targetShift)
            );
            candidates.sort((a, b) => this.compareForWork(a, b, targetShift, dateStr));

            const fillCount = Math.min(gap, candidates.length);
            for (let i = 0; i < fillCount; i++) {
                this.updateShift(dateStr, candidates[i].id, 'OFF', targetShift);
            }
        }
    }

    runCycle_FinalBalance() {
        // 在所有班別排定後，嘗試微調 D 班以平衡 OFF 數
        // 簡單實作：目前 compareForWork 在 Phase D 已經給予 OFF 極大權重，
        // 這裡暫時保留擴充空間
    }

    isInWhiteList(staff, shiftType) {
        // 嚴格禁止包 N 上 E
        if (staff.packageType === 'N' || staff.packageType === 'N 1.N') {
            if (shiftType === 'N') return true;
            if (shiftType === 'E') return false; // 嚴格禁止
            if (shiftType === 'D') return true;  // 允許溢出到 D
        }
        if (staff.packageType === 'E' || staff.packageType === 'E 1.E') {
            if (shiftType === 'E') return true;
            if (shiftType === 'N') return false; // 嚴格禁止
            if (shiftType === 'D') return true;  // 允許溢出到 D
        }
        return true;
    }

    compareForWork(staffA, staffB, shiftType, dateStr) {
        const cA = this.counters[staffA.id];
        const cB = this.counters[staffB.id];

        // 1. N/E 班：絕對公平
        if (shiftType === 'N') { if (cA.N !== cB.N) return cA.N - cB.N; }
        else if (shiftType === 'E') { if (cA.E !== cB.E) return cA.E - cB.E; }

        // 2. D 班：全力平衡 OFF (誰 OFF 多，誰優先上)
        if (shiftType === 'D') {
            // 包班溢出者 (包N但沒排到) 視為 OFF 極多，權重置頂
            const isPkgA = (staffA.packageType && staffA.packageType.includes('N'));
            const isPkgB = (staffB.packageType && staffB.packageType.includes('N'));
            if (isPkgA && !isPkgB) return -1000;
            if (!isPkgA && isPkgB) return 1000;
            
            // OFF 差距放大
            return (cB.OFF - cA.OFF) * 10;
        }
        
        // 3. 次要指標
        if (cA.OFF !== cB.OFF) return cB.OFF - cA.OFF;

        const dA = this.calculateWeightedDensity(staffA.id, dateStr);
        const dB = this.calculateWeightedDensity(staffB.id, dateStr);
        if (Math.abs(dA - dB) > 0.5) return dA - dB;

        return (staffA.id.localeCompare(staffB.id));
    }

    getDatesSortedByGap(shiftType) {
        const result = [];
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const need = this.getDemand(dateStr, shiftType);
            const current = this.schedule[dateStr][shiftType].length;
            result.push({ dateStr, gap: need - current });
        }
        return result.sort((a, b) => b.gap - a.gap);
    }

    getDemand(dateStr, shiftType) {
        if (this.rules.dailyNeeds) {
            const dayIdx = new Date(dateStr).getDay(); 
            const k = `${shiftType}_${dayIdx === 0 ? 6 : dayIdx - 1}`; 
            return this.rules.dailyNeeds[k] !== undefined ? this.rules.dailyNeeds[k] : 2;
        }
        return (shiftType === 'D') ? 5 : 2;
    }

    getPreference(staff, dateStr, level) {
        if (staff.prefs && staff.prefs[dateStr]) return staff.prefs[dateStr][level];
        return null;
    }
}
