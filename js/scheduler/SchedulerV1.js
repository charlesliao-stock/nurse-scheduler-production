class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
    }

    run() {
        console.log("=== V1 全域分層排班 ===");
        
        // Layer 1: 全月填志願
        this.runCycle1_Preferences();

        // Layer 3: 全月強制補缺 (依照缺口大小順序)
        // 這裡跳過 Cycle 2 (第二志願) 以簡化示範，實務可加入
        this.runCycle3_ForceFill_Global();

        // Layer 4: 全月平衡 (踢人)
        // this.runCycle4_Balance(); 

        return this.schedule;
    }

    runCycle1_Preferences() {
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.staffList.forEach(staff => {
                const shift = this.getPreference(staff, dateStr, 1);
                // 包班邏輯 V1 較寬鬆，若有包班屬性且無志願，可預設填入
                const target = shift || staff.packageType;
                
                if (target && ['N','E','D'].includes(target)) {
                    if (this.isValidContinuity(staff, dateStr, target)) {
                        this.updateShift(dateStr, staff.id, 'OFF', target);
                    }
                }
            });
        }
    }

    runCycle3_ForceFill_Global() {
        // 1. 計算全月每一天、每一班的缺口
        let allGaps = [];
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            ['N', 'E', 'D'].forEach(shift => {
                const gap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
                if (gap > 0) allGaps.push({ dateStr, shift, gap });
            });
        }

        // 2. 排序：缺口最大的優先處理 (救火邏輯)
        allGaps.sort((a, b) => b.gap - a.gap);

        // 3. 填補
        for (const { dateStr, shift, gap } of allGaps) {
            // 重新計算當下缺口 (因為可能被前面的填補影響)
            const currentGap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (currentGap <= 0) continue;

            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            
            candidates = candidates.filter(s => 
                this.isInWhiteList(s, shift) && 
                this.isValidContinuity(s, dateStr, shift)
            );

            // V1 使用標準排序：欠班多者優先
            candidates.sort((a, b) => this.compareForWork(a, b, shift, dateStr));

            const fillCount = Math.min(currentGap, candidates.length);
            for (let i = 0; i < fillCount; i++) {
                this.updateShift(dateStr, candidates[i].id, 'OFF', shift);
            }
        }
    }
    
    // V1 的白名單較寬鬆，預設都允許，除非明確禁止
    isInWhiteList(staff, shift) {
        // 包班者盡量只上包班，但 V1 允許為了平衡而支援
        if (staff.packageType === 'N' && shift === 'E') return false; 
        return true; 
    }

    // 輔助：V1 共用 Base 的比較函式，或可在此覆寫
    compareForWork(a, b, shift, date) {
        // V1 重視公平 (Total OFF)
        const cA = this.counters[a.id];
        const cB = this.counters[b.id];
        return cB.OFF - cA.OFF; 
    }
    
    // 需實作 getDemand, getPreference (可共用 V3 的或移至 Base)
    getDemand(dateStr, shift) { /* 同 V3 */ return 2; } 
    getPreference(staff, date, level) { /* 同 V3 */ return null; }
}
