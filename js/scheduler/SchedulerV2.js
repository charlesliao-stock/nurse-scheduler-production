// js/scheduler/SchedulerV2.js
class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
    }

    run() {
        console.log("=== V2 逐日推進排班 ===");
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.runDay_Cycle1(dateStr);
            this.runDay_Cycle3(dateStr);
        }
        return this.schedule;
    }

    runDay_Cycle1(dateStr) {
        this.staffList.forEach(staff => {
            const shift = this.getPreference(staff, dateStr, 1) || staff.packageType;
            if (shift && ['N','E','D'].includes(shift)) {
                if (this.isValidContinuity(staff, dateStr, shift)) {
                    this.updateShift(dateStr, staff.id, 'OFF', shift);
                }
            }
        });
    }

    runDay_Cycle3(dateStr) {
        ['N', 'E', 'D'].forEach(shift => {
            const gap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (gap <= 0) return;

            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            candidates = candidates.filter(s => 
                this.isInWhiteList(s, shift) && 
                this.isValidContinuity(s, dateStr, shift)
            );

            candidates.sort((a, b) => this.compareForWorkV2(a, b, dateStr));

            const fillCount = Math.min(gap, candidates.length);
            for (let i = 0; i < fillCount; i++) {
                this.updateShift(dateStr, candidates[i].id, 'OFF', shift);
            }
        });
    }

    compareForWorkV2(a, b, dateStr) {
        // V2 兼顧累計 OFF 與短期疲勞
        const cA = this.counters[a.id];
        const cB = this.counters[b.id];
        if (cA.OFF !== cB.OFF) return cB.OFF - cA.OFF;

        const denA = this.calculateWeightedDensity(a.id, dateStr);
        const denB = this.calculateWeightedDensity(b.id, dateStr);
        return denA - denB;
    }
    
    isInWhiteList(staff, shift) { return true; } 
    getDemand(date, shift) { return 2; }
    getPreference(staff, date, level) { return null; }
}
