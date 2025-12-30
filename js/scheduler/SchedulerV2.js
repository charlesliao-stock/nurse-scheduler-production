class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
    }

    run() {
        console.log("=== V2 逐日推進排班 ===");
        
        // 核心：時間軸迴圈
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            
            // Step 1: 填當日志願
            this.runDay_Cycle1(dateStr);
            
            // Step 2: 強制補當日缺口
            this.runDay_Cycle3(dateStr);
            
            // Day d 結束，班表定案，進入下一天
        }
        return this.schedule;
    }

    runDay_Cycle1(dateStr) {
        this.staffList.forEach(staff => {
            const shift = this.getPreference(staff, dateStr, 1) || staff.packageType;
            if (shift && ['N','E','D'].includes(shift)) {
                // V2 的連續性檢查只看「過去」，因為未來還沒排
                if (this.isValidContinuity(staff, dateStr, shift)) {
                    this.updateShift(dateStr, staff.id, 'OFF', shift);
                }
            }
        });
    }

    runDay_Cycle3(dateStr) {
        // V2 優先順序：N -> E -> D (當日解決)
        ['N', 'E', 'D'].forEach(shift => {
            const gap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (gap <= 0) return;

            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            
            candidates = candidates.filter(s => 
                this.isInWhiteList(s, shift) && 
                this.isValidContinuity(s, dateStr, shift)
            );

            // V2 排序：加入「工作密度」權重，避免把人操死
            candidates.sort((a, b) => this.compareForWorkV2(a, b, dateStr));

            const fillCount = Math.min(gap, candidates.length);
            for (let i = 0; i < fillCount; i++) {
                this.updateShift(dateStr, candidates[i].id, 'OFF', shift);
            }
        });
    }

    compareForWorkV2(a, b, dateStr) {
        // 優先看累計 OFF (長期平衡)
        const cA = this.counters[a.id];
        const cB = this.counters[b.id];
        if (cA.OFF !== cB.OFF) return cB.OFF - cA.OFF;

        // 次看短期疲勞 (過去 7 天)
        const denA = this.calculateWeightedDensity(a.id, dateStr);
        const denB = this.calculateWeightedDensity(b.id, dateStr);
        return denA - denB; // 累的排後面
    }
    
    isInWhiteList(staff, shift) { return true; } // V2 為了填坑，條件最寬
    getDemand(date, shift) { return 2; }
    getPreference(staff, date, level) { return null; }
}
