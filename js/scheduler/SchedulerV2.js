// js/scheduler/SchedulerV2.js
// 🚀 最終修正版：移除自動放寬 (Relax Mode)，改採「志願優先 + 嚴格回溯」邏輯

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.MAX_SWAP_ATTEMPTS = 5; // 遇到死路時，嘗試換班的次數上限
    }

    /**
     * 主執行函式
     */
    run() {
        console.log(`🚀 SchedulerV2 Strict Mode Start.`);

        // 1. 初始化：填入預班 (絕對鎖定)
        this.applyPreSchedules();

        // 2. 逐日排班
        for (let d = 1; d <= this.daysInMonth; d++) {
            // 取得當日需求 (各班別需要幾人)
            const dailyNeeds = this.getDailyNeeds(d);

            // 針對該日的每個班別需求進行填補
            // 建議順序：大夜(N) -> 白班(D) -> 小夜(E) (通常 N 最難排)
            // 這裡動態排序：需求少的先排？還是在規則裡的 shiftCodes 順序？
            // 這裡使用簡單邏輯：依照 shiftCodes 定義順序
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }
            
            // 每日結束後，可進行簡易平衡 (不破壞規則的前提下)
            this.balanceDay(d);
        }

        return this.formatResult();
    }

    /**
     * 步驟 1：將預班應用到班表，且不允許被覆蓋
     */
    applyPreSchedules() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const req = params[dateStr];
                
                // 如果是預假 (REQ_OFF)
                if (req === 'REQ_OFF') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                }
                // 如果是預排班 (例如指定上白班 D)，且不是排斥(!D)
                else if (req && req !== 'OFF' && !req.startsWith('!')) {
                    // 這是「已知事實」，直接填入
                    this.updateShift(dateStr, staff.id, 'OFF', req);
                }
            }
        });
    }

    /**
     * 步驟 2：核心填班邏輯
     */
    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        
        // 檢查目前已經有多少人 (包含預排的人)
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return; // 人力已足

        // 取得候選池：目前是 OFF 且不是 REQ_OFF 的人
        let candidates = this.staffList.filter(s => {
            const currentShift = this.getShiftByDate(dateStr, s.id);
            // 已經被鎖定為 REQ_OFF 或已有其他班別者，排除
            // 注意：這裡依賴 BaseScheduler 的 getShiftByDate 回傳正確值
            // 如果是 REQ_OFF，getShiftByDate 應該回傳 REQ_OFF
            if (currentShift !== 'OFF') return false; 
            return true;
        });

        // 依分數排序 (高分優先)
        candidates = this.sortCandidates(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;

            // 1. 檢查基本合法性 (BaseScheduler)
            // isValidAssignment 現在對於 'Try' 的 !D 會回傳 true，所以這裡會放行
            const isValid = this.isValidAssignment(staff, dateStr, shiftCode);
            
            // 2. 檢查組別上限
            const isGroupValid = this.checkGroupMaxLimit(day, staff, shiftCode);

            if (isValid && isGroupValid) {
                this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                gap--;
            } 
            else {
                // 3. 嘗試解決衝突 (Swap)
                // 如果是因為規則不符 (例如休息時間不足)，嘗試換班
                // 只有當 isValid 為 false 時才嘗試 Swap
                if (gap > 0 && this.tryResolveConflict(day, staff, shiftCode)) {
                    // 交換成功後，再檢查一次是否能填入
                    // 必須再次檢查 isValid，因為換班只是解決了昨天的衝突，
                    // 但今天可能還有其他限制 (如連續上班)
                    if (this.isValidAssignment(staff, dateStr, shiftCode) && 
                        this.checkGroupMaxLimit(day, staff, shiftCode)) {
                        
                        this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                        gap--;
                    }
                }
            }
        }
        
        // 若跑完所有候選人仍有 gap，則誠實保留缺口 (不硬排)
        if (gap > 0) {
            console.warn(`[缺口警示] ${dateStr} ${shiftCode} 尚缺 ${gap} 人`);
        }
    }

    /**
     * 步驟 3：候選人評分排序
     */
    sortCandidates(staffList, dateStr, shiftCode) {
        return staffList.sort((a, b) => {
            const scoreA = this.calculateScore(a, dateStr, shiftCode);
            const scoreB = this.calculateScore(b, dateStr, shiftCode);
            return scoreB - scoreA; // 分數高者在前
        });
    }

    calculateScore(staff, dateStr, shiftCode) {
        let score = 0;
        const prefs = staff.prefs?.[dateStr] || {};
        const params = staff.schedulingParams || {};

        // 1. 志願權重 (最高優先)
        if (prefs.favShift === shiftCode) score += 1000;
        else if (prefs.favShift2 === shiftCode) score += 500;
        else if (prefs.favShift3 === shiftCode) score += 200;

        // 2. 包班偏好
        const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
        if (bundleShift === shiftCode) score += 800;

        // 3. 處理 "Try" 的排斥 (!D)
        // 雖然 BaseScheduler 放行了，但在這裡我們要扣分，盡量不選他
        if (params[dateStr] === '!' + shiftCode) {
            score -= 2000; // 扣重分，除非真的沒人選，否則輪不到他
        }

        // 4. 避免連續上班過多 (公平性)
        // 優先選那些「剛休完假」的人
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        score -= (consDays * 50);

        // 5. 累積時數/班數平衡 (選目前班數少的人)
        score -= (this.getTotalShifts(staff.id) * 10);

        return score;
    }

    /**
     * 步驟 4：衝突解決 (Swap) - 嘗試微調昨天
     */
    tryResolveConflict(day, staff, targetShift) {
        // 第一天無法回溯
        if (day === 1) return false;

        const dateStr = this.getDateStr(day);
        const prevDateStr = this.getDateStr(day - 1);
        const prevShift = this.getShiftByDate(prevDateStr, staff.id);

        // 只處理「休息時間不足」導致的衝突 (例如昨天 N 接今天 D)
        // 呼叫 BaseScheduler 的檢查方法，若通過則不需交換，代表不是這個原因擋住
        if (this.checkRestPeriod(prevShift, targetShift)) return false; 

        // 尋找「替死鬼」：昨天休假 (OFF) 的人
        // 注意：必須排除昨天是 REQ_OFF 的人 (不可動)
        const swapCandidates = this.staffList.filter(s => 
            s.id !== staff.id && 
            this.getShiftByDate(prevDateStr, s.id) === 'OFF' &&
            !this.isPreRequestOff(s.id, prevDateStr) 
        );

        for (const candidate of swapCandidates) {
            // 檢查 1: 替死鬼能不能上「該員工昨天的班」?
            if (this.isValidAssignment(candidate, prevDateStr, prevShift)) {
                
                // 檢查 2: 交換後，該員工昨天變 OFF，今天能不能上目標班別?
                // (理論上變 OFF 一定可以，因為 OFF 的休息間隔無限大)
                
                // 執行交換
                // 1. 替死鬼：OFF -> prevShift
                this.updateShift(prevDateStr, candidate.id, 'OFF', prevShift);
                // 2. 原員工：prevShift -> OFF
                this.updateShift(prevDateStr, staff.id, prevShift, 'OFF');
                
                return true; // 衝突解決成功
            }
        }
        return false;
    }
    
    // --- 輔助方法 ---

    getDailyNeeds(day) {
        const dateStr = this.getDateStr(day);
        const date = new Date(this.year, this.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; // 週一為0
        const needs = {};
        
        this.shiftCodes.forEach(code => {
            if(code === 'OFF' || code === 'REQ_OFF') return;
            
            // 優先讀取特定日期的需求 (Specific Needs)
            if (this.rules.specificNeeds?.[dateStr]?.[code] !== undefined) {
                needs[code] = this.rules.specificNeeds[dateStr][code];
            } 
            // 其次讀取每週循環的常規需求 (Daily Needs)
            else {
                const key = `${code}_${dayIdx}`;
                const val = this.rules.dailyNeeds?.[key];
                if (val > 0) needs[code] = val;
            }
        });
        return needs;
    }

    checkGroupMaxLimit(day, staff, shiftCode) {
        if (!this.rules.groupLimits) return true;
        const group = staff.group; 
        if (!group) return true;
        
        const limit = this.rules.groupLimits[group]?.[shiftCode]?.max;
        if (limit === undefined || limit === null || limit === '') return true;
        
        let currentCount = 0;
        const dateStr = this.getDateStr(day);
        const assignedUids = this.schedule[dateStr][shiftCode] || [];
        
        assignedUids.forEach(uid => {
            const s = this.staffList.find(st => st.id === uid);
            if (s && s.group === group) currentCount++;
        });
        
        return currentCount < limit;
    }
    
    balanceDay(day) { 
        // 這裡可以實作簡易的平衡邏輯
        // 例如：檢查當天夜班是否都是資淺人員，若是則嘗試與資深人員交換
        // 目前先留空，避免過度複雜化
    }

    getTotalShifts(uid) { 
        const c = this.counters[uid]; 
        if(!c) return 0; 
        return Object.keys(c).reduce((s,k) => 
            (k !== 'OFF' && k !== 'REQ_OFF') ? s + c[k] : s, 0
        ); 
    }

    formatResult() { 
        const res = {}; 
        for(let d = 1; d <= this.daysInMonth; d++){ 
            const ds = this.getDateStr(d); 
            res[ds] = {}; 
            this.shiftCodes.forEach(code => { 
                // REQ_OFF 也要回傳，讓前端顯示
                if (code === 'OFF') return; 
                
                const ids = this.schedule[ds][code] || []; 
                if(ids.length > 0) res[ds][code] = ids; 
            }); 
        } 
        return res; 
    }
}
