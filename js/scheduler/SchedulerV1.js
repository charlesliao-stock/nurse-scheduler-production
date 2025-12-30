/**
 * 策略 V1: 全域分層法 (Global Layered) - 嚴格人數限制版 (Strict Capacity)
 * * 修正說明：
 * 1. [Critical] 加入 console.log 除錯資訊，讓您確認系統讀到的需求人數是否正確。
 * 2. [Critical] 包班 VIP 通道加入「絕對滿員檢查」，一旦達到 dailyNeeds 設定值，立即停止填入。
 * 3. [Fix] getDemand 強制轉型為整數，避免資料格式錯誤導致判定失效。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // 設定：每個月至少要休幾天？ (預設 8 天)
        this.minMonthlyOffs = (this.rules.policy && this.rules.policy.minMonthlyOffs) || 8;
        
        // 節奏計算
        this.pacingLimit = Math.ceil((this.daysInMonth - this.minMonthlyOffs) / this.minMonthlyOffs) + 1; 
    }

    run() {
        console.log(`=== V1 啟動 (嚴格人數限制模式) ===`);
        console.log(`檢查每日需求設定:`, this.rules.dailyNeeds); // [除錯] 印出設定檔

        // Cycle 0: 包班 VIP (受嚴格人數限制)
        this.runCycle0_PackageVIP_Strict();

        // Cycle 1: 一般志願 (隨機抽籤)
        this.runCycle1_Preferences_Lottery();

        // Cycle 3: 全域強制補缺 (填坑)
        this.runCycle3_ForceFill_Global();

        return this.schedule;
    }

    // ==========================================
    // Cycle 0: 包班 VIP (嚴格模式)
    // ==========================================
    runCycle0_PackageVIP_Strict() {
        // 1. 篩選包班人員
        const packageStaff = this.staffList.filter(s => s.packageType && ['N', 'E'].includes(s.packageType));
        
        // 2. 隨機打亂順序，確保公平 (避免永遠是員編靠前的人佔據有限名額)
        this.shuffleArray(packageStaff);

        console.log(`[V1] 處理包班 VIP，共 ${packageStaff.length} 人`);

        packageStaff.forEach(staff => {
            const targetShift = staff.packageType; 
            let workDaysCount = 0;
            const maxWorkDays = this.daysInMonth - this.minMonthlyOffs;

            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                
                // A. 鎖定檢查
                if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') continue;

                // B. [核心修正] 滿員檢查 (Capacity Check)
                const demand = this.getDemand(dateStr, targetShift);
                const currentCount = this.schedule[dateStr][targetShift].length;
                
                // [除錯] 如果某天明明滿了還塞，請看這個 Log
                if (currentCount >= demand) {
                    // console.log(`[額滿跳過] ${dateStr} ${targetShift}: 需求 ${demand}, 已排 ${currentCount} -> ${staff.name} 無法排入`);
                    continue; 
                }

                // C. 總量檢查
                if (workDaysCount >= maxWorkDays) continue;

                // D. 智慧節奏 (Pacing)
                // 如果連續上班太多天，且當天不缺人，則休息
                const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
                if (currentCons >= this.pacingLimit) {
                    const potentialSupply = this.getPotentialSupply(dateStr, targetShift, staff.id);
                    // 如果潛在供給夠，我就休假；如果不夠，我才支援
                    if (potentialSupply >= demand) { 
                        continue; 
                    }
                }

                // E. 連續性檢查
                if (this.isValidContinuity(staff, dateStr, targetShift)) {
                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                    workDaysCount++;
                }
            }
        });
    }

    // ==========================================
    // Cycle 1: 志願抽籤 (Lottery)
    // ==========================================
    runCycle1_Preferences_Lottery() {
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            ['N', 'E', 'D'].forEach(shiftType => {
                const demand = this.getDemand(dateStr, shiftType);
                const currentCount = this.schedule[dateStr][shiftType].length;
                let slotsOpen = demand - currentCount;

                if (slotsOpen <= 0) return; 

                // 找出第一志願是這個班的人
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

    // ==========================================
    // Cycle 3: 全域缺口填補
    // ==========================================
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
            // 重新計算 Gap，避免重複填補
            let currentGap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (currentGap <= 0) continue;

            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            
            candidates = candidates.filter(s => 
                this.isInWhiteList(s, shift) && 
                this.isValidContinuity(s, dateStr, shift)
            );

            // 排序：包班優先 (補回被擠掉的包班人員) > OFF多優先
            candidates.sort((a, b) => this.compareForWork(a, b, shift));

            const fillCount = Math.min(currentGap, candidates.length);
            for (let i = 0; i < fillCount; i++) {
                this.updateShift(dateStr, candidates[i].id, 'OFF', shift);
            }
        }
    }

    // ==========================================
    // 輔助函式
    // ==========================================

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
        // 1. 包班優先
        const isPkgA = (a.packageType === shift);
        const isPkgB = (b.packageType === shift);
        if (isPkgA && !isPkgB) return -1;
        if (!isPkgA && isPkgB) return 1;
        // 2. OFF 多者優先
        return this.counters[b.id].OFF - this.counters[a.id].OFF;
    }
    
    isInWhiteList(staff, shift) {
        if (staff.packageType && staff.packageType.includes('N') && shift === 'E') return false; 
        if (staff.packageType && staff.packageType.includes('E') && shift === 'N') return false;
        return true; 
    }
    
    // [重要修正] 強制轉型，確保讀到正確的需求數字
    getDemand(dateStr, shift) {
        if (this.rules.dailyNeeds) {
            const dateObj = new Date(dateStr);
            let dayIdx = dateObj.getDay(); // 0(Sun) - 6(Sat)
            
            // 轉換為您的系統習慣: 0=Mon ... 6=Sun
            // JS getDay: 0=Sun, 1=Mon...
            // Mon(1) -> (1+6)%7 = 0
            const adjustedIdx = (dayIdx + 6) % 7;

            const key = `${shift}_${adjustedIdx}`; 
            
            if (this.rules.dailyNeeds[key] !== undefined && this.rules.dailyNeeds[key] !== "") {
                const val = parseInt(this.rules.dailyNeeds[key], 10);
                if (!isNaN(val)) return val;
            }
        }
        // 預設值 (如果讀不到)
        return 2; 
    }
    
    getPreference(staff, dateStr, level) {
        if (staff.prefs && staff.prefs[dateStr]) return staff.prefs[dateStr][level];
        return null;
    }
}
