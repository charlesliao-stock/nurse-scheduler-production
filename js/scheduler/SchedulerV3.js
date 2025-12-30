/**
 * 班別優先排班策略 (Shift Priority / Waterfall)
 * 繼承自 BaseScheduler
 * 特色：N -> E -> D 順序排班，解決包班溢出至 D 班的問題
 */
class SchedulerV3 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        // 定義排班 Phase 順序
        this.phaseOrder = ['N', 'E', 'D']; 
    }

    run() {
        console.log("=== 執行 V3 班別優先瀑布流排班 ===");

        // 依序執行 Phase
        for (const shiftType of this.phaseOrder) {
            this.runPhase(shiftType);
        }

        // 最終檢查：如果有 LEAVE 被錯誤覆蓋，需還原 (Optional check)
        
        return this.schedule;
    }

    runPhase(targetShift) {
        console.log(`--- 開始 Phase: ${targetShift} ---`);
        
        // Cycle 1: 填志願 & 包班
        this.runCycle1_Preferences(targetShift);
        
        // Cycle 3: 強制補缺 (核心：填坑)
        this.runCycle3_ForceFill(targetShift);
        
        // Cycle 4: 平衡 (踢人) - 可選，視需求決定是否開啟
        // this.runCycle4_Balance(targetShift);
    }

    // ==========================================
    // Cycle 1: 填志願
    // ==========================================
    runCycle1_Preferences(targetShift) {
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            
            this.staffList.forEach(staff => {
                // 如果已經有排班 (例如 Phase N 已經排了 N)，則跳過
                const current = this.getShiftByDate(dateStr, staff.id);
                if (current !== 'OFF') return; 

                let isMatch = false;

                // 1. 包班邏輯
                if (staff.packageType === targetShift) {
                    isMatch = true;
                }
                // 2. 志願邏輯 (Pref 1)
                else if (this.getPreference(staff, dateStr, 1) === targetShift) {
                    isMatch = true;
                }

                if (isMatch && this.isValidContinuity(staff, dateStr, targetShift)) {
                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                }
            });
        }
    }

    // ==========================================
    // Cycle 3: 強制補缺
    // ==========================================
    runCycle3_ForceFill(targetShift) {
        // 智慧遍歷：先計算所有日期的缺口，從缺口最大的日期開始排
        const sortedDates = this.getDatesSortedByGap(targetShift);

        for (const { dateStr, gap } of sortedDates) {
            if (gap <= 0) continue;

            // 1. 找候選人：當天是 OFF 的人 (沒事做的人)
            // 注意：因為是 Waterfall，已被上個 Phase 排班的人不會是 OFF，自然不會被選到
            let candidates = this.staffList.filter(s => 
                this.getShiftByDate(dateStr, s.id) === 'OFF'
            );

            // 2. 過濾：白名單 & 連續性
            candidates = candidates.filter(s => 
                this.isInWhiteList(s, targetShift) && 
                this.isValidContinuity(s, dateStr, targetShift)
            );

            // 3. 排序：三層排序法
            candidates.sort((a, b) => this.compareForWork(a, b, targetShift, dateStr));

            // 4. 填入缺口
            // 安全閥：避免 gap 比候選人多
            const fillCount = Math.min(gap, candidates.length);
            for (let i = 0; i < fillCount; i++) {
                this.updateShift(dateStr, candidates[i].id, 'OFF', targetShift);
            }
            
            if (gap > candidates.length) {
                console.warn(`[V3] ${dateStr} ${targetShift} 班仍缺 ${gap - candidates.length} 人 (無人可用)`);
            }
        }
    }

    // ==========================================
    // 關鍵邏輯：白名單與溢出處理
    // ==========================================
    isInWhiteList(staff, shiftType) {
        // 包班人員邏輯
        if (staff.packageType === 'N') {
            if (shiftType === 'N') return true;  // 首選
            if (shiftType === 'E') return false; // 禁止
            if (shiftType === 'D') return true;  // [溢出] 允許支援 D
        }
        
        if (staff.packageType === 'E') {
            if (shiftType === 'E') return true;
            if (shiftType === 'N') return false; 
            if (shiftType === 'D') return true;  // 允許支援 D
        }

        // 一般人員
        return true;
    }

    // ==========================================
    // 關鍵邏輯：排序 (決定誰上班)
    // ==========================================
    compareForWork(staffA, staffB, shiftType, dateStr) {
        const cA = this.counters[staffA.id];
        const cB = this.counters[staffB.id];

        // 1. 硬指標：該班別數越少越優先 (平衡 N/E)
        if (shiftType === 'N') {
            if (cA.N !== cB.N) return cA.N - cB.N;
        } else if (shiftType === 'E') {
            if (cA.E !== cB.E) return cA.E - cB.E;
        }

        // 2. 共用指標：總休假數越多越優先 (OFF_count 大者排前面)
        // 這會讓 Phase 1 沒排到 N (變成 OFF) 的包 N 人員，在 Phase 3 (D班) 排很前面
        if (cA.OFF !== cB.OFF) return cB.OFF - cA.OFF;

        // 3. 疲勞度指標：近 7 日工作密度越低越優先
        const densityA = this.calculateWeightedDensity(staffA.id, dateStr);
        const densityB = this.calculateWeightedDensity(staffB.id, dateStr);
        if (Math.abs(densityA - densityB) > 0.5) {
            return densityA - densityB; // 小的優先
        }

        // 4. 隨機雜湊 (避免每次都同一人)
        return (staffA.id.length + staffA.name.length) - (staffB.id.length + staffB.name.length);
    }

    // ==========================================
    // 輔助函式
    // ==========================================
    getDatesSortedByGap(shiftType) {
        const result = [];
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const need = this.getDemand(dateStr, shiftType);
            const current = this.schedule[dateStr][shiftType].length;
            const gap = need - current;
            result.push({ dateStr, gap });
        }
        // 缺口大的排前面
        return result.sort((a, b) => b.gap - a.gap);
    }

    getDemand(dateStr, shiftType) {
        // 這裡應該接上您系統的 Daily Needs 資料
        // 暫時 mock: N=2, E=2, D=5
        // 實際整合時，請傳入 dailyNeeds 物件或透過外部注入
        if (this.rules.dailyNeeds) {
            // 需要將 dateStr 轉為 weekday index
            const dayIdx = new Date(dateStr).getDay(); // 0-6
            const key = `${shiftType}_${dayIdx === 0 ? 6 : dayIdx - 1}`; // 轉為 0(Mon)-6(Sun)
            return this.rules.dailyNeeds[key] || 2;
        }
        return (shiftType === 'D') ? 5 : 2;
    }
    
    getPreference(staff, dateStr, level) {
        // 讀取 staff.prefs (需在資料處理層預先格式化)
        if (staff.prefs && staff.prefs[dateStr]) {
            return staff.prefs[dateStr][level];
        }
        return null;
    }
}
