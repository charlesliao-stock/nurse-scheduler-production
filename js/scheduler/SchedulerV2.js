/**
 * SchedulerV2 Enhanced - 人力最大化版本
 * 
 * 核心原則:
 * 1. 優先滿足每日班別需求（不浪費人力）
 * 2. 放假天數大家平均即可（不強制精確相等）
 * 3. 尊重預休和特殊身份
 */

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // AI 參數
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 5;
        this.TOLERANCE = rules.aiParams?.tolerance !== undefined ? 
                         rules.aiParams.tolerance : 3; // [修正] 提高容忍度到 3
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 30;
        
        // 動態權重系統
        this.currentProgress = 0;
        
        console.log(`🚀 Scheduler V2 Enhanced 啟動 (人力最大化模式)`);
        console.log(`📊 容忍度設定: ±${this.TOLERANCE} 天`);
    }

    run() {
        console.log("📅 開始執行人力最大化排班演算法...");
        
        // 階段 0: 預計算
        this.precalculateOffBudgets();
        
        // 階段 1: 初始化 (保留預休)
        this.resetSchedule();
        
        // 階段 2: 確定排班順序 (優先處理困難日)
        const shiftOrder = this.determineShiftOrder();
        const dayOrder = this.determineDayOrder();
        
        // 階段 3: 逐日填滿需求 [核心修正]
        dayOrder.forEach(day => {
            this.currentProgress = day / this.daysInMonth;
            if (!this.solveDayMaximized(day, shiftOrder)) {
                console.warn(`⚠️ Day ${day} 無法完全滿足需求`);
            }
        });
        
        // 階段 4: 後處理 - 微調平衡 (不破壞需求)
        this.postProcessBalancing();
        
        console.log("✅ 人力最大化排班完成");
        this.printFinalStats();
        return this.schedule;
    }

    // ==================== 核心方法 ====================

    precalculateOffBudgets() {
        // 計算每人的理想 OFF 預算（僅供參考，不強制）
        this.staffList.forEach(staff => {
            const totalDays = this.daysInMonth;
            // 計算該人的預休天數
            let preOffCount = 0;
            for (let d = 1; d <= totalDays; d++) {
                const dateStr = this.getDateStr(d);
                const prefs = staff.schedulingParams || staff.prefs || {};
                if (prefs[dateStr] === 'REQ_OFF') {
                    preOffCount++;
                }
            }
            
            // 理想 OFF = 預休 + 適量補休 (但不強制)
            staff.idealOff = Math.min(preOffCount + 3, Math.floor(totalDays * 0.35));
            staff.preOffCount = preOffCount;
        });
    }

    resetSchedule() {
        // 保留預休 (REQ_OFF) 和勿排 (!X)
        this.staffList.forEach(staff => {
            const prefs = staff.schedulingParams || staff.prefs || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const prefVal = prefs[dateStr];
                
                if (prefVal === 'REQ_OFF' || prefVal === 'OFF') {
                    const current = this.getShiftByDate(dateStr, staff.id);
                    this.updateShift(dateStr, staff.id, current, 'REQ_OFF');
                } else if (typeof prefVal === 'string' && prefVal.startsWith('!')) {
                    // 標記勿排的班別（後續檢查用）
                    staff[`ban_${dateStr}`] = prefVal.substring(1);
                }
            }
        });
    }

    determineShiftOrder() {
        // 優先處理夜班 (通常最缺人)
        const order = ['N', 'E', 'D'];
        return order.filter(code => this.shiftCodes.includes(code));
    }

    // [新增] 決定處理日期的順序（困難日優先）
    determineDayOrder() {
        const days = [];
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const date = new Date(this.year, this.month - 1, d);
            const dayIdx = (date.getDay() + 6) % 7;
            
            // 計算該日的總需求
            let totalNeed = 0;
            this.shiftCodes.forEach(code => {
                if (code === 'OFF') return;
                const key = `${code}_${dayIdx}`;
                totalNeed += (this.rules.dailyNeeds && this.rules.dailyNeeds[key]) || 0;
            });
            
            // 計算該日的可用人力
            const available = this.staffList.filter(s => {
                const dateStr = this.getDateStr(d);
                const curr = this.getShiftByDate(dateStr, s.id);
                return curr === 'OFF' && !this.isLocked(d, s.id);
            }).length;
            
            // 緊張度 = 需求 / 可用人力
            const tension = available > 0 ? totalNeed / available : 999;
            
            days.push({ day: d, tension, need: totalNeed, avail: available });
        }
        
        // 按緊張度排序（困難日優先）
        days.sort((a, b) => b.tension - a.tension);
        
        console.log(`📊 日期處理順序 (前5困難日):`, days.slice(0, 5));
        
        return days.map(d => d.day);
    }

    // [核心修正] 以滿足需求為主的排班邏輯
    solveDayMaximized(day, shiftOrder) {
        const dateStr = this.getDateStr(day);
        let allFilled = true;
        
        // 第一輪: 嚴格填滿所有班別需求
        shiftOrder.forEach(shiftCode => {
            const needed = this.getDemand(day, shiftCode);
            let assigned = this.countStaff(day, shiftCode);
            
            while (assigned < needed) {
                // 先嘗試標準規則
                if (!this.assignBestCandidate(day, shiftCode, false)) {
                    // 再嘗試放寬規則
                    if (!this.assignBestCandidate(day, shiftCode, true)) {
                        console.warn(`⚠️ Day ${day} [${shiftCode}] 缺 ${needed - assigned} 人 (無法填滿)`);
                        allFilled = false;
                        break;
                    }
                }
                assigned++;
            }
        });
        
        // 第二輪: [移除] 不主動將人排休
        // 讓人力自然留在 OFF，除非需要上班
        
        return allFilled;
    }

    assignBestCandidate(day, shiftCode, relaxRules = false) {
        const dateStr = this.getDateStr(day);
        
        const candidates = this.staffList.filter(staff => {
            const uid = staff.id;
            const currentShift = this.getShiftByDate(dateStr, uid);
            
            // 只從 OFF 中抓人
            if (currentShift !== 'OFF') return false;
            
            // 不能是鎖定的（預休）
            if (this.isLocked(day, uid)) return false;
            
            // 檢查勿排
            if (staff[`ban_${dateStr}`] === shiftCode) return false;
            
            // 包班限制
            const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
            if (bundleShift && bundleShift !== shiftCode) return false;
            
            // 規則檢查
            if (!this.isValidAssignment(staff, dateStr, shiftCode, relaxRules)) {
                return false;
            }

            return true;
        });

        if (candidates.length === 0) return false;

        // 排序候選人（關鍵修正）
        candidates.sort((a, b) => this.compareCandidatesMaximized(a, b, day, shiftCode));

        const best = candidates[0];
        const currentShift = this.getShiftByDate(dateStr, best.id);
        this.updateShift(dateStr, best.id, currentShift, shiftCode);
        
        return true;
    }

    // [核心修正] 候選人排序邏輯 - 人力最大化優先
    compareCandidatesMaximized(a, b, day, shiftCode) {
        const dateStr = this.getDateStr(day);
        
        // 🔥 第一關: 個人排班偏好（尊重志願）
        const aWants = this.checkWillingness(a, dateStr, shiftCode);
        const bWants = this.checkWillingness(b, dateStr, shiftCode);
        if (aWants && !bWants) return -1;
        if (!aWants && bWants) return 1;

        // 🔥 第二關: 班別公平性（該班排得少的優先）
        const aShiftCount = this.counters[a.id][shiftCode] || 0;
        const bShiftCount = this.counters[b.id][shiftCode] || 0;
        if (aShiftCount !== bShiftCount) {
            return aShiftCount - bShiftCount;
        }

        // 🔥 第三關: 總休假平衡（但不強制）
        const aTotalOff = this.counters[a.id].OFF || 0;
        const bTotalOff = this.counters[b.id].OFF || 0;
        const avgOff = this.calculateAverageOff();
        
        // 只有在差距超過容忍度時才考慮
        const aDiff = Math.abs(aTotalOff - avgOff);
        const bDiff = Math.abs(bTotalOff - avgOff);
        
        if (aDiff > this.TOLERANCE && bDiff <= this.TOLERANCE) return 1; // b 更接近平均，優先 b
        if (bDiff > this.TOLERANCE && aDiff <= this.TOLERANCE) return -1; // a 更接近平均，優先 a
        
        // 如果都超過或都沒超過，休太多的人優先上班
        if (aTotalOff !== bTotalOff) {
            return bTotalOff - aTotalOff; // OFF 多的優先
        }

        // 🔥 第四關: 連班慣性（同班別連續，減少跳班）
        const aPrev = this.getYesterdayShift(a.id, dateStr);
        const bPrev = this.getYesterdayShift(b.id, dateStr);
        const aIsSame = (aPrev === shiftCode);
        const bIsSame = (bPrev === shiftCode);
        if (aIsSame && !bIsSame) return -1;
        if (!aIsSame && bIsSame) return 1;

        return 0;
    }

    // [新增] 後處理 - 微調平衡（不破壞需求）
    postProcessBalancing() {
        console.log("\n🔄 執行後處理微調...");
        
        let swapCount = 0;
        const maxSwaps = 50; // 限制交換次數，避免無限循環
        
        for (let attempt = 0; attempt < maxSwaps; attempt++) {
            let improved = false;
            
            // 隨機挑選一天
            const day = Math.floor(Math.random() * this.daysInMonth) + 1;
            const dateStr = this.getDateStr(day);
            
            // 找出該天上班的人
            const workingStaff = this.staffList.filter(s => {
                const shift = this.getShiftByDate(dateStr, s.id);
                return shift && shift !== 'OFF' && shift !== 'REQ_OFF';
            });
            
            if (workingStaff.length < 2) continue;
            
            // 隨機挑選兩個人
            const i = Math.floor(Math.random() * workingStaff.length);
            let j = Math.floor(Math.random() * workingStaff.length);
            while (j === i) j = Math.floor(Math.random() * workingStaff.length);
            
            const staff1 = workingStaff[i];
            const staff2 = workingStaff[j];
            
            const shift1 = this.getShiftByDate(dateStr, staff1.id);
            const shift2 = this.getShiftByDate(dateStr, staff2.id);
            
            if (shift1 === shift2) continue; // 同班別無需交換
            
            // 計算交換前的不平衡度
            const beforeVariance = this.calculateVariance();
            
            // 嘗試交換
            this.updateShift(dateStr, staff1.id, shift1, shift2);
            this.updateShift(dateStr, staff2.id, shift2, shift1);
            
            // 檢查合法性
            const valid1 = this.isValidAssignment(staff1, dateStr, shift2, false);
            const valid2 = this.isValidAssignment(staff2, dateStr, shift1, false);
            
            if (valid1 && valid2) {
                const afterVariance = this.calculateVariance();
                
                // 如果改善了平衡性，保留交換
                if (afterVariance < beforeVariance - 0.1) {
                    swapCount++;
                    improved = true;
                } else {
                    // 回退交換
                    this.updateShift(dateStr, staff1.id, shift2, shift1);
                    this.updateShift(dateStr, staff2.id, shift1, shift2);
                }
            } else {
                // 不合法，回退
                this.updateShift(dateStr, staff1.id, shift2, shift1);
                this.updateShift(dateStr, staff2.id, shift1, shift2);
            }
            
            if (!improved && attempt > maxSwaps / 2) break; // 後期無改善就停止
        }
        
        console.log(`✅ 後處理完成，成功交換 ${swapCount} 次`);
    }

    calculateVariance() {
        const offCounts = this.staffList.map(s => this.counters[s.id].OFF || 0);
        const avg = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const variance = offCounts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / offCounts.length;
        return variance;
    }
    
    calculateAverageOff() {
        const offCounts = this.staffList.map(s => this.counters[s.id].OFF || 0);
        return offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
    }

    // [新增] 輸出最終統計
    printFinalStats() {
        console.log("\n📊 排班完成統計:");
        
        const offCounts = this.staffList.map(s => this.counters[s.id].OFF || 0);
        const avgOff = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const minOff = Math.min(...offCounts);
        const maxOff = Math.max(...offCounts);
        
        console.log(`- 平均休假: ${avgOff.toFixed(1)} 天`);
        console.log(`- 休假範圍: ${minOff} ~ ${maxOff} 天 (差距 ${maxOff - minOff})`);
        
        // 檢查需求滿足度
        let totalGaps = 0;
        for (let d = 1; d <= this.daysInMonth; d++) {
            const date = new Date(this.year, this.month - 1, d);
            const dayIdx = (date.getDay() + 6) % 7;
            
            this.shiftCodes.forEach(code => {
                if (code === 'OFF') return;
                const key = `${code}_${dayIdx}`;
                const need = (this.rules.dailyNeeds && this.rules.dailyNeeds[key]) || 0;
                const actual = this.countStaff(d, code);
                if (actual < need) {
                    totalGaps += (need - actual);
                }
            });
        }
        
        console.log(`- 總缺口: ${totalGaps} 個班次`);
        console.log(`- 滿足率: ${((1 - totalGaps / (this.daysInMonth * this.shiftCodes.length)) * 100).toFixed(1)}%`);
    }

    // ==================== 輔助方法 ====================

    isLocked(day, uid) {
        const s = this.getShiftByDate(this.getDateStr(day), uid);
        return s === 'REQ_OFF' || s === 'LEAVE';
    }

    checkWillingness(staff, dateStr, shiftCode) {
        const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
        if (bundleShift === shiftCode) return true;
        if (staff.prefs) {
            if (staff.prefs.priority_1 === shiftCode) return true;
            if (staff.prefs.priority_2 === shiftCode) return true;
            if (staff.prefs.priority_3 === shiftCode) return true;
        }
        return false;
    }
}
```

## 核心改進說明

### 1. **優先順序調整**
```
修正前: 公平性 > 需求滿足
修正後: 需求滿足 > 公平性（在容忍範圍內）
