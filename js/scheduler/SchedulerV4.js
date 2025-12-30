class SchedulerV4 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
    }

    run() {
        console.log("=== V4 瓶頸優先排班 ===");
        
        const hardDays = [];
        const easyDays = [];
        
        // 1. 分類日期
        for (let d = 1; d <= this.daysInMonth; d++) {
            const date = new Date(this.year, this.month - 1, d);
            const dayIdx = date.getDay();
            // 定義困難日：週六(6)、週日(0)
            if (dayIdx === 0 || dayIdx === 6) hardDays.push(d);
            else easyDays.push(d);
        }

        // 2. Phase 1: 先排困難日
        this.runBatch(hardDays);

        // 3. Phase 2: 再排簡單日
        this.runBatch(easyDays);

        return this.schedule;
    }

    runBatch(days) {
        days.forEach(d => {
            const dateStr = this.getDateStr(d);
            // 簡化：單日 C1 + C3
            this.runDay_Cycle1(dateStr);
            this.runDay_Cycle3(dateStr);
        });
    }

    runDay_Cycle1(dateStr) { /* 同 V2 */ 
        this.staffList.forEach(staff => {
            const shift = this.getPreference(staff, dateStr, 1); // V4 包班不強制，看志願
            if (shift && this.isValidContinuity(staff, dateStr, shift)) {
                this.updateShift(dateStr, staff.id, 'OFF', shift);
            }
        });
    }

    runDay_Cycle3(dateStr) { /* 同 V2，但順序可調整 */ 
        ['N', 'E', 'D'].forEach(shift => {
            const gap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (gap <= 0) return;
            
            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            candidates = candidates.filter(s => this.isValidContinuity(s, dateStr, shift));
            
            // V4 排序：誰假日上的少，誰優先 (需新增 holidayCounter，此處暫用 OFF 代替)
            candidates.sort((a, b) => this.counters[b.id].OFF - this.counters[a.id].OFF);
            
            const fillCount = Math.min(gap, candidates.length);
            for(let i=0; i<fillCount; i++) this.updateShift(dateStr, candidates[i].id, 'OFF', shift);
        });
    }
    
    getDemand(d,s) { return 2; }
    getPreference(s,d,l) { return null; }
}
