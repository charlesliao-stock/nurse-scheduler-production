// js/scheduler/SchedulerV1.js
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
    }

    run() {
        console.log("=== V1 全域分層排班 ===");
        
        // Layer 1: 全月填志願
        this.runCycle1_Preferences();

        // Layer 3: 全月強制補缺 (依照缺口大小順序)
        this.runCycle3_ForceFill_Global();

        return this.schedule;
    }

    runCycle1_Preferences() {
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.staffList.forEach(staff => {
                const shift = this.getPreference(staff, dateStr, 1);
                const target = shift || staff.packageType; // V1 較寬鬆，無志願則填包班
                
                if (target && ['N','E','D'].includes(target)) {
                    if (this.isValidContinuity(staff, dateStr, target)) {
                        this.updateShift(dateStr, staff.id, 'OFF', target);
                    }
                }
            });
        }
    }

    runCycle3_ForceFill_Global() {
        let allGaps = [];
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            ['N', 'E', 'D'].forEach(shift => {
                const gap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
                if (gap > 0) allGaps.push({ dateStr, shift, gap });
            });
        }

        // 缺口大的優先處理
        allGaps.sort((a, b) => b.gap - a.gap);

        for (const { dateStr, shift, gap } of allGaps) {
            const currentGap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (currentGap <= 0) continue;

            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            
            candidates = candidates.filter(s => 
                this.isInWhiteList(s, shift) && 
                this.isValidContinuity(s, dateStr, shift)
            );

            // V1 使用標準排序：OFF 多者優先
            candidates.sort((a, b) => this.compareForWork(a, b));

            const fillCount = Math.min(currentGap, candidates.length);
            for (let i = 0; i < fillCount; i++) {
                this.updateShift(dateStr, candidates[i].id, 'OFF', shift);
            }
        }
    }
    
    isInWhiteList(staff, shift) {
        if (staff.packageType && staff.packageType.includes('N') && shift === 'E') return false; 
        return true; 
    }

    compareForWork(a, b) {
        const cA = this.counters[a.id];
        const cB = this.counters[b.id];
        return cB.OFF - cA.OFF; 
    }
    
    getDemand(dateStr, shift) { /* 同 V3 */ return 2; } 
    getPreference(staff, date, level) { /* 同 V3 */ return null; }
}
