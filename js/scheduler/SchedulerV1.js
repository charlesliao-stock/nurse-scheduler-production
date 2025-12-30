/**
 * 策略 V1: 全域分層法 (Global Layered) - 動態供需節奏版
 * * 修正重點：
 * 1. [Init] 不再使用固定的月休 8 天。
 * 2. [Init] 初始化時動態計算全月總需求，推算出「平均月休天數」與「休息節奏」。
 * - 如果人力吃緊，節奏會自動拉長 (例如上 6 休 1)。
 * - 如果人力充裕，節奏會自動縮短 (例如上 3 休 1)。
 * 3. [Cycle 0] 包班 VIP 依然受「滿員檢查」限制，但休息節奏改用上述動態值。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // --- Step 1: 初始化與參數準備 ---
        this.initDynamicPacing();
    }

    // [核心修正] 動態計算供需與節奏
    initDynamicPacing() {
        // 1. 計算全月總需求 (Total Demand)
        let totalDemand = 0;
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            // 累加 N, E, D 的需求
            ['N', 'E', 'D'].forEach(shift => {
                totalDemand += this.getDemand(dateStr, shift);
            });
        }

        // 2. 計算總供給 (Total Supply)
        const staffCount = this.staffList.length;
        const totalSupply = staffCount * this.daysInMonth;

        // 3. 計算剩餘給 OFF 的額度
        const totalOffs = totalSupply - totalDemand;
        
        // 4. 計算平均每人月休 (Avg Offs)
        // 防呆：如果 staffCount 為 0
        this.avgMonthlyOffs = staffCount > 0 ? (totalOffs / staffCount) : 0;

        // 5. 推估放假節奏 (Pacing Limit)
        // 公式：(月天數 - 月休) / 月休 = 平均連上幾天
        if (this.avgMonthlyOffs <= 0) {
            // 極端缺人：完全沒假放
            this.pacingLimit = 999; 
            console.warn(`[V1 Init] 人力嚴重不足！需求 ${totalDemand} > 供給 ${totalSupply}，無法排休。`);
        } else {
            const workDays = this.daysInMonth - this.avgMonthlyOffs;
            const ratio = workDays / this.avgMonthlyOffs;
            // 無條件進位並 +1 寬限，例如算出來 3.5 -> 4 -> 寬限為 5 (連上5天再強制休)
            this.pacingLimit = Math.ceil(ratio) + 1;
        }

        console.log(`=== V1 初始化參數 ===`);
        console.log(`- 總人力: ${staffCount} 人`);
        console.log(`- 總需求人次: ${totalDemand}`);
        console.log(`- 總供給人次: ${totalSupply}`);
        console.log(`- 預估平均月休: ${this.avgMonthlyOffs.toFixed(2)} 天`);
        console.log(`- 動態節奏: 每連上 ${this.pacingLimit} 天建議休假 (若人力允許)`);
    }

    run() {
        // Cycle 0: 包班 VIP (動態節奏 + 嚴格滿員限制)
        this.runCycle0_PackageVIP_Strict();

        // Cycle 1: 一般志願 (隨機抽籤)
        this.runCycle1_Preferences_Lottery();

        // Cycle 3: 全域強制補缺 (填坑)
        this.runCycle3_ForceFill_Global();

        return this.schedule;
    }

    // ==========================================
    // Cycle 0: 包班 VIP (嚴格模式 + 動態節奏)
    // ==========================================
    runCycle0_PackageVIP_Strict() {
        const packageStaff = this.staffList.filter(s => s.packageType && ['N', 'E'].includes(s.packageType));
        this.shuffleArray(packageStaff);

        packageStaff.forEach(staff => {
            const targetShift = staff.packageType; 
            
            // 移除固定的 maxWorkDays 限制，改由 pacing 和 demand 控制
            // 因為如果真的很缺人，VIP 確實可能只休 4 天

            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                
                // A. 鎖定檢查
                if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') continue;

                // B. [絕對限制] 滿員檢查
                const demand = this.getDemand(dateStr, targetShift);
                const currentCount = this.schedule[dateStr][targetShift].length;
                if (currentCount >= demand) continue; // 滿了就跳過

                // C. [動態節奏] 檢查
                const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
                if (currentCons >= this.pacingLimit) {
                    // 達到節奏點，檢查是否有其他人可以頂？
                    const potentialSupply = this.getPotentialSupply(dateStr, targetShift, staff.id);
                    
                    // 如果 (潛在供給 >= 需求)，代表我不上也有別人能上 -> 我休息
                    if (potentialSupply >= demand) { 
                        continue; 
                    }
                    // 如果 (潛在供給 < 需求)，代表我不上會開天窗 -> 我繼續上 (無視節奏)
                }

                // D. 連續性檢查 (生理極限)
                if (this.isValidContinuity(staff, dateStr, targetShift)) {
                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                }
            }
        });
    }

    // ==========================================
    // Cycle 1 & 3 & Helpers (維持原樣)
    // ==========================================
    runCycle1_Preferences_Lottery() {
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            ['N', 'E', 'D'].forEach(shiftType => {
                const demand = this.getDemand(dateStr, shiftType);
                const currentCount = this.schedule[dateStr][shiftType].length;
                let slotsOpen = demand - currentCount;
                if (slotsOpen <= 0) return; 

                let candidates = this.staffList.filter(s => 
                    this.getShiftByDate(dateStr, s.id) === 'OFF' && 
                    this.getPreference(s, dateStr, 1) === shiftType && 
                    this.isValidContinuity(s, dateStr, shiftType)
                );

                if (candidates.length <= slotsOpen) {
                    candidates.forEach(s => this.updateShift(dateStr, s.id, 'OFF', shiftType));
                } else {
                    this.shuffleArray(candidates);
                    const winners = candidates.slice(0, slotsOpen);
                    winners.forEach(s => this.updateShift(dateStr, s.id, 'OFF', shiftType));
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
        allGaps.sort((a, b) => b.gap - a.gap);

        for (const { dateStr, shift } of allGaps) {
            let currentGap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (currentGap <= 0) continue;

            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            candidates = candidates.filter(s => this.isInWhiteList(s, shift) && this.isValidContinuity(s, dateStr, shift));
            candidates.sort((a, b) => this.compareForWork(a, b, shift));

            const fillCount = Math.min(currentGap, candidates.length);
            for (let i = 0; i < fillCount; i++) {
                this.updateShift(dateStr, candidates[i].id, 'OFF', shift);
            }
        }
    }

    // 輔助函式
    getPotentialSupply(dateStr, shiftType, excludeStaffId) {
        let count = 0;
        this.staffList.forEach(s => {
            if (s.id === excludeStaffId) return;
            const currentStatus = this.getShiftByDate(dateStr, s.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return;
            if (['N', 'E', 'D'].includes(currentStatus) && currentStatus !== shiftType) return;
            if (!this.isInWhiteList(s, shiftType)) return;
            count++;
        });
        return count;
    }
    
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    compareForWork(a, b, shift) {
        const isPkgA = (a.packageType === shift);
        const isPkgB = (b.packageType === shift);
        if (isPkgA && !isPkgB) return -1;
        if (!isPkgA && isPkgB) return 1;
        return this.counters[b.id].OFF - this.counters[a.id].OFF;
    }
    
    isInWhiteList(staff, shift) {
        if (staff.packageType && staff.packageType.includes('N') && shift === 'E') return false; 
        if (staff.packageType && staff.packageType.includes('E') && shift === 'N') return false;
        return true; 
    }
    
    getDemand(dateStr, shift) {
        if (this.rules.dailyNeeds) {
            const dateObj = new Date(dateStr);
            let dayIdx = dateObj.getDay(); 
            const adjustedIdx = (dayIdx + 6) % 7; // Mon=0...Sun=6
            const key = `${shift}_${adjustedIdx}`; 
            
            if (this.rules.dailyNeeds[key] !== undefined && this.rules.dailyNeeds[key] !== "") {
                const val = parseInt(this.rules.dailyNeeds[key], 10);
                if (!isNaN(val)) return val;
            }
        }
        return 2; 
    }
    
    getPreference(staff, dateStr, level) {
        if (staff.prefs && staff.prefs[dateStr]) return staff.prefs[dateStr][level];
        return null;
    }
}
