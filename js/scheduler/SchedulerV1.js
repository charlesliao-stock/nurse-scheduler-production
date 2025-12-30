/**
 * 策略 V1: 全域分層法 (Global Layered) - 智慧節奏修正版
 * * 特色：
 * 1. Cycle 0 (VIP): 實作「條件式節奏控制」。
 * - 根據月休目標自動計算休息頻率 (Pacing)。
 * - 只有在「當天人力充足」時，才執行強制休息。
 * - 如果當天「其他人預休太多 (人力吃緊)」，VIP 必須無視節奏繼續上班，防止開天窗。
 * 2. Cycle 1 (志願): 實作「隨機抽籤」，避免先到先得的不公平。
 * 3. Cycle 3 (填坑): 全域缺口填補，優先救援缺口最大的日子。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // 設定：每個月至少要休幾天？ (從規則讀取，預設 8 天)
        this.minMonthlyOffs = (this.rules.policy && this.rules.policy.minMonthlyOffs) || 8;
        
        // 節奏計算：平均上幾天休一天？ 
        // 公式：(月天數 - 休天數) / 休天數
        // 例如：(30 - 8) / 8 = 2.75 -> 代表平均上 2.75 天就要休 1 天
        // 我們取無條件進位 (Math.ceil) + 1 作為寬限值
        this.pacingLimit = Math.ceil((this.daysInMonth - this.minMonthlyOffs) / this.minMonthlyOffs) + 1; 
    }

    run() {
        console.log(`=== V1 啟動 (智慧節奏模式: 人力吃緊時優先填坑) ===`);
        console.log(`目標月休: ${this.minMonthlyOffs} 天, 建議休息節奏: 連續 ${this.pacingLimit} 天後`);

        // Cycle 0: 包班 VIP (帶有人力偵測的節奏控制)
        this.runCycle0_PackageVIP_SmartPaced();

        // Cycle 1: 一般志願 (隨機抽籤)
        this.runCycle1_Preferences_Lottery();

        // Cycle 3: 全域強制補缺 (填坑)
        this.runCycle3_ForceFill_Global();

        return this.schedule;
    }

    // ==========================================
    // Cycle 0: 包班 VIP (智慧節奏)
    // ==========================================
    runCycle0_PackageVIP_SmartPaced() {
        // 篩選包班人員 (設定了包 N 或 包 E)
        const packageStaff = this.staffList.filter(s => s.packageType && ['N', 'E'].includes(s.packageType));
        
        packageStaff.forEach(staff => {
            const targetShift = staff.packageType; 
            let workDaysCount = 0;
            // 計算本月最大上班天數 (月天數 - 月休天數)
            const maxWorkDays = this.daysInMonth - this.minMonthlyOffs;

            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                
                // 1. 鎖定檢查 (若已預休 REQ_OFF 則跳過)
                if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') continue;

                // 2. 總量檢查 (若整月已上滿，強制休假)
                if (workDaysCount >= maxWorkDays) continue;

                // 3. [核心修正] 智慧節奏檢查
                const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
                
                if (currentCons >= this.pacingLimit) {
                    // 雖然到了該休息的節奏，但先檢查今天是否「缺人」
                    
                    // A. 當日該班別的需求量
                    const demand = this.getDemand(dateStr, targetShift);
                    
                    // B. 潛在可用人數 (扣除這個 VIP 自己)
                    const potentialSupply = this.getPotentialSupply(dateStr, targetShift, staff.id);

                    // C. 決策：如果 (潛在人數 < 需求)，代表如果不排我，就會開天窗
                    const isShortage = potentialSupply < demand;

                    if (!isShortage) {
                        // 人力充足，我有資格休息
                        // console.log(`[Pacing] ${staff.name} 在 ${dateStr} 休息 (已連上${currentCons}, 人力充裕)`);
                        continue; // 跳過此日 (保持 OFF)
                    } else {
                        // 人力吃緊 (例如別人都預休)，我必須繼續上班，無視節奏
                        // console.log(`[Rescue] ${staff.name} 在 ${dateStr} 繼續上班 (已連上${currentCons}, 但人力短缺)`);
                    }
                }

                // 4. 基本連續性檢查 (生理極限仍需遵守，如禁連七、禁 N接D)
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

                if (slotsOpen <= 0) return; // 沒名額了

                // 找出所有第一志願是這個班的人 (且目前是 OFF)
                let candidates = this.staffList.filter(s => 
                    this.getShiftByDate(dateStr, s.id) === 'OFF' && 
                    this.getPreference(s, dateStr, 1) === shiftType && 
                    this.isValidContinuity(s, dateStr, shiftType)
                );

                if (candidates.length <= slotsOpen) {
                    // 名額夠，全部錄取
                    candidates.forEach(s => this.updateShift(dateStr, s.id, 'OFF', shiftType));
                } else {
                    // 名額不夠，抽籤 (隨機打亂)
                    this.shuffleArray(candidates);
                    
                    // 錄取前 N 名
                    const winners = candidates.slice(0, slotsOpen);
                    winners.forEach(s => this.updateShift(dateStr, s.id, 'OFF', shiftType));
                    
                    // 落選者維持 OFF，等待填坑
                }
            });
        }
    }

    // ==========================================
    // Cycle 3: 全域缺口填補
    // ==========================================
    runCycle3_ForceFill_Global() {
        let allGaps = [];
        // 1. 收集全月缺口
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            ['N', 'E', 'D'].forEach(shift => {
                const gap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
                if (gap > 0) allGaps.push({ dateStr, shift, gap });
            });
        }

        // 2. 排序：缺口大的優先救
        allGaps.sort((a, b) => b.gap - a.gap);

        // 3. 填補
        for (const { dateStr, shift } of allGaps) {
            let currentGap = this.getDemand(dateStr, shift) - this.schedule[dateStr][shift].length;
            if (currentGap <= 0) continue;

            let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            
            candidates = candidates.filter(s => 
                this.isInWhiteList(s, shift) && 
                this.isValidContinuity(s, dateStr, shift)
            );

            // 排序：優先抓包班沒排滿的人 > 再抓休假太多的一般人
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

    // [核心] 預估某天某班別的「潛在可用人力」
    // 用途：判斷是否可以讓 VIP 放假，還是必須救火
    getPotentialSupply(dateStr, shiftType, excludeStaffId) {
        let count = 0;
        this.staffList.forEach(s => {
            // 排除自己
            if (s.id === excludeStaffId) return;

            // 排除已經請假的人 (REQ_OFF)
            const currentStatus = this.getShiftByDate(dateStr, s.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return; // 不能算進戰力

            // 排除已經排了別的班的人 (例如已經在 Cycle 0 被排了 N 的其他 VIP)
            if (['N', 'E', 'D'].includes(currentStatus) && currentStatus !== shiftType) return;

            // 排除被白名單禁止的人 (例如包 N 的不能上 E)
            if (!this.isInWhiteList(s, shiftType)) return;

            // 寬鬆判定：只要不是 REQ_OFF 且符合資格，就算潛在戰力
            count++;
        });
        return count;
    }
    
    // Fisher-Yates Shuffle (隨機洗牌)
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    // 比較函式：決定誰該上班
    compareForWork(a, b, shift) {
        // 1. 包班優先 (若缺 N，包 N 的人絕對優先)
        const isPkgA = (a.packageType === shift);
        const isPkgB = (b.packageType === shift);
        if (isPkgA && !isPkgB) return -1;
        if (!isPkgA && isPkgB) return 1;

        // 2. 公平性：OFF 累積越多的人，越該上班 (由大到小排序)
        return this.counters[b.id].OFF - this.counters[a.id].OFF;
    }
    
    isInWhiteList(staff, shift) {
        // 包 N 不上 E
        if (staff.packageType && staff.packageType.includes('N') && shift === 'E') return false; 
        // 包 E 不上 N
        if (staff.packageType && staff.packageType.includes('E') && shift === 'N') return false;
        return true; 
    }
    
    getDemand(dateStr, shift) {
        if (this.rules.dailyNeeds) {
            const dayIdx = new Date(dateStr).getDay(); 
            const k = `${shift}_${dayIdx === 0 ? 6 : dayIdx - 1}`; 
            return this.rules.dailyNeeds[k] !== undefined ? this.rules.dailyNeeds[k] : 2;
        }
        return 2; // 預設值
    }
    
    getPreference(staff, dateStr, level) {
        if (staff.prefs && staff.prefs[dateStr]) return staff.prefs[dateStr][level];
        return null;
    }
}
