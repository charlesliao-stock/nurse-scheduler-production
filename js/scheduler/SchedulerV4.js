// js/scheduler/SchedulerV4.js
class SchedulerV4 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
    }

    run() {
        console.log("=== V4 瓶頸優先排班 ===");
        
        const hardDays = [];
        const easyDays = [];
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const date = new Date(this.year, this.month - 1, d);
            const dayIdx = date.getDay();
            if (dayIdx === 0 || dayIdx === 6) hardDays.push(d);
            else easyDays.push(d);
        }

        // Phase 1: 困難日 (週末)
        this.runBatch(hardDays);
        // Phase 2: 簡單日
        this.runBatch(easyDays);

        return this.schedule;
    }

    runBatch(days) {
        days.forEach(d => {
            const dateStr = this.getDateStr(d);
            this.runDay_Cycle1(dateStr);
            this.runDay_Cycle3(dateStr);
        });
    }

    runDay_Cycle1(dateStr) { 
        this.staffList.forEach(staff => {
            const shift = this.getPreference(staff, dateStr, 1);
            if (shift && this.isValidContinuity(staff, dateStr, shift)) {
                this.updateShift(dateStr, staff.id, 'OFF', shift);
            }
        });
    }

    runDay_Cycle3(dateStr) { 
        ['N', 'E', 'D'].forEach(shift => {
            const gap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (gap <= 0) return;
            
            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            candidates = candidates.filter(s => this.isValidContinuity(s, dateStr, shift));
            
            candidates.sort((a, b) => this.counters[b.id].OFF - this.counters[a.id].OFF);
            
            const fillCount = Math.min(gap, candidates.length);
            for(let i=0; i<fillCount; i++) this.updateShift(dateStr, candidates[i].id, 'OFF', shift);
        });
    }
    
    getDemand(d,s) { return 2; }
    getPreference(s,d,l) { return null; }
}
