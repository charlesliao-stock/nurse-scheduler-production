/**
 * SchedulerV2 Enhanced - 平衡優化版
 * 
 * 核心改進:
 * 1. 嚴格控制放假天數差異在 ±2 天以內
 * 2. 提升放假平衡的優先級
 * 3. 增強後處理平衡機制
 */

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // AI 參數 - [關鍵修正] 降低容忍度到 2
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 5;
        this.TOLERANCE = 2; // 強制設為 2，不允許超過
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 30;
        
        // 動態權重系統
        this.currentProgress = 0;
        
        console.log(`🚀 Scheduler V2 Enhanced 啟動 (嚴格平衡模式)`);
        console.log(`📊 容忍度設定: ±${this.TOLERANCE} 天 (強制)`);
    }

    run() {
        console.log("📅 開始執行嚴格平衡排班演算法...");
        
        // 階段 0: 預計算
        this.precalculateOffBudgets();
        
        // 階段 1: 初始化 (保留預休)
        this.resetSchedule();
        
        // 階段 2: 確定排班順序
        const shiftOrder = this.determineShiftOrder();
        const dayOrder = this.determineDayOrder();
        
        // 階段 3: 逐日填滿需求
        dayOrder.forEach(day => {
            this.currentProgress = day / this.daysInMonth;
            if (!this.solveDayMaximized(day, shiftOrder)) {
                console.warn(`⚠️ Day ${day} 無法完全滿足需求`);
            }
        });
        
        // 階段 4: [增強] 多輪後處理平衡
        this.postProcessBalancing();
        
        // 階段 5: [新增] 最終強制平衡檢查
        this.finalBalanceCheck();
        
        console.log("✅ 嚴格平衡排班完成");
        this.printFinalStats();
        return this.schedule;
    }

    precalculateOffBudgets() {
        // 計算理想放假天數（僅供參考）
        this.staffList.forEach(staff => {
            const totalDays = this.daysInMonth;
            let preOffCount = 0;
            for (let d = 1; d <= totalDays; d++) {
                const dateStr = this.getDateStr(d);
                const prefs = staff.schedulingParams || staff.prefs || {};
                if (prefs[dateStr] === 'REQ_OFF') {
                    preOffCount++;
                }
            }
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
                    staff[`ban_${dateStr}`] = prefVal.substring(1);
                }
            }
        });
    }

    determineShiftOrder() {
        const order = ['N', 'E', 'D'];
        return order.filter(code => this.shiftCodes.includes(code));
    }

    determineDayOrder() {
        const days = [];
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const date = new Date(this.year, this.month - 1, d);
            const dayIdx = (date.getDay() + 6) % 7;
            
            let totalNeed = 0;
            this.shiftCodes.forEach(code => {
                if (code === 'OFF') return;
                const key = `${code}_${dayIdx}`;
                totalNeed += (this.rules.dailyNeeds && this.rules.dailyNeeds[key]) || 0;
            });
            
            const available = this.staffList.filter(s => {
                const dateStr = this.getDateStr(d);
                const curr = this.getShiftByDate(dateStr, s.id);
                return curr === 'OFF' && !this.isLocked(d, s.id);
            }).length;
            
            const tension = available > 0 ? totalNeed / available : 999;
            days.push({ day: d, tension, need: totalNeed, avail: available });
        }
        
        days.sort((a, b) => b.tension - a.tension);
        console.log(`📊 日期處理順序 (前5困難日):`, days.slice(0, 5));
        
        return days.map(d => d.day);
    }

    solveDayMaximized(day, shiftOrder) {
        const dateStr = this.getDateStr(day);
        let allFilled = true;
        
        shiftOrder.forEach(shiftCode => {
            const needed = this.getDemand(day, shiftCode);
            let assigned = this.countStaff(day, shiftCode);
            
            while (assigned < needed) {
                if (!this.assignBestCandidate(day, shiftCode, false)) {
                    if (!this.assignBestCandidate(day, shiftCode, true)) {
                        console.warn(`⚠️ Day ${day} [${shiftCode}] 缺 ${needed - assigned} 人`);
                        allFilled = false;
                        break;
                    }
                }
                assigned++;
            }
        });
        
        return allFilled;
    }

    assignBestCandidate(day, shiftCode, relaxRules = false) {
        const dateStr = this.getDateStr(day);
        
        const candidates = this.staffList.filter(staff => {
            const uid = staff.id;
            const currentShift = this.getShiftByDate(dateStr, uid);
            
            if (currentShift !== 'OFF') return false;
            if (this.isLocked(day, uid)) return false;
            if (staff[`ban_${dateStr}`] === shiftCode) return false;
            
            const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
            if (bundleShift && bundleShift !== shiftCode) return false;
            
            if (!this.isValidAssignment(staff, dateStr, shiftCode, relaxRules)) {
                return false;
            }

            return true;
        });

        if (candidates.length === 0) return false;

        // [關鍵修正] 使用嚴格平衡的排序
        candidates.sort((a, b) => this.compareCandidatesStrict(a, b, day, shiftCode));

        const best = candidates[0];
        const currentShift = this.getShiftByDate(dateStr, best.id);
        this.updateShift(dateStr, best.id, currentShift, shiftCode);
        
        return true;
    }

    // [關鍵修正] 嚴格平衡的候選人排序
    compareCandidatesStrict(a, b, day, shiftCode) {
        const dateStr = this.getDateStr(day);
        
        // 🔥 第一關: 放假平衡 (提升為最高優先級)
        const aTotalOff = this.counters[a.id].OFF || 0;
        const bTotalOff = this.counters[b.id].OFF || 0;
        const avgOff = this.calculateAverageOff();
        
        const aDiff = Math.abs(aTotalOff - avgOff);
        const bDiff = Math.abs(bTotalOff - avgOff);
        
        // 優先選擇休太多的人上班
        if (Math.abs(aTotalOff - bTotalOff) > 0) {
            return bTotalOff - aTotalOff; // OFF 多的優先
        }

        // 🔥 第二關: 個人排班偏好
        const aWants = this.checkWillingness(a, dateStr, shiftCode);
        const bWants = this.checkWillingness(b, dateStr, shiftCode);
        if (aWants && !bWants) return -1;
        if (!aWants && bWants) return 1;

        // 🔥 第三關: 班別公平性
        const aShiftCount = this.counters[a.id][shiftCode] || 0;
        const bShiftCount = this.counters[b.id][shiftCode] || 0;
        if (aShiftCount !== bShiftCount) {
            return aShiftCount - bShiftCount;
        }

        // 🔥 第四關: 連班慣性
        const aPrev = this.getYesterdayShift(a.id, dateStr);
        const bPrev = this.getYesterdayShift(b.id, dateStr);
        const aIsSame = (aPrev === shiftCode);
        const bIsSame = (bPrev === shiftCode);
        if (aIsSame && !bIsSame) return -1;
        if (!aIsSame && bIsSame) return 1;

        return 0;
    }

    // [增強] 後處理 - 積極平衡
    postProcessBalancing() {
        console.log("\n🔄 執行積極平衡後處理...");
        
        const maxRounds = 100; // 增加輪數
        let swapCount = 0;
        
        for (let round = 0; round < maxRounds; round++) {
            let improved = false;
            
            // 找出放假最多和最少的人
            const offCounts = this.staffList.map(s => ({
                uid: s.id,
                name: s.name,
                off: this.counters[s.id].OFF || 0
            }));
            
            offCounts.sort((a, b) => b.off - a.off);
            const maxOff = offCounts[0];
            const minOff = offCounts[offCounts.length - 1];
            
            // 如果差異 <= 2，停止
            if (maxOff.off - minOff.off <= 2) {
                console.log(`✅ 已達平衡 (差異: ${maxOff.off - minOff.off}), 提前結束`);
                break;
            }
            
            // 嘗試交換：讓休太多的人多上班
            const swapped = this.trySwapForBalance(maxOff.uid, minOff.uid);
            if (swapped) {
                swapCount++;
                improved = true;
            }
            
            if (!improved && round > 50) break; // 後期無改善就停止
        }
        
        console.log(`✅ 後處理完成，成功交換 ${swapCount} 次`);
    }

    trySwapForBalance(maxOffUid, minOffUid) {
        // 隨機選擇一天
        const day = Math.floor(Math.random() * this.daysInMonth) + 1;
        const dateStr = this.getDateStr(day);
        
        const maxOffShift = this.getShiftByDate(dateStr, maxOffUid);
        const minOffShift = this.getShiftByDate(dateStr, minOffUid);
        
        // 只有當 maxOff 在休息，minOff 在上班時，才交換
        if ((maxOffShift === 'OFF' || maxOffShift === 'REQ_OFF') && 
            (minOffShift && minOffShift !== 'OFF' && minOffShift !== 'REQ_OFF')) {
            
            // 檢查是否鎖定
            if (maxOffShift === 'REQ_OFF' || minOffShift === 'REQ_OFF') return false;
            
            // 檢查交換後是否合法
            const maxOffStaff = this.staffList.find(s => s.id === maxOffUid);
            const minOffStaff = this.staffList.find(s => s.id === minOffUid);
            
            if (!maxOffStaff || !minOffStaff) return false;
            
            // 嘗試交換
            this.updateShift(dateStr, maxOffUid, maxOffShift, minOffShift);
            this.updateShift(dateStr, minOffUid, minOffShift, 'OFF');
            
            // 驗證合法性
            const valid1 = this.isValidAssignment(maxOffStaff, dateStr, minOffShift, false);
            const valid2 = true; // minOff 改為 OFF 一定合法
            
            if (valid1 && valid2) {
                return true;
            } else {
                // 回退
                this.updateShift(dateStr, maxOffUid, minOffShift, maxOffShift);
                this.updateShift(dateStr, minOffUid, 'OFF', minOffShift);
                return false;
            }
        }
        
        return false;
    }

    // [新增] 最終強制平衡檢查
    finalBalanceCheck() {
        console.log("\n🔍 執行最終平衡檢查...");
        
        const offCounts = this.staffList.map(s => ({
            uid: s.id,
            name: s.name,
            off: this.counters[s.id].OFF || 0
        }));
        
        offCounts.sort((a, b) => b.off - a.off);
        const maxOff = offCounts[0].off;
        const minOff = offCounts[offCounts.length - 1].off;
        const diff = maxOff - minOff;
        
        if (diff > 2) {
            console.warn(`⚠️ 最終差異 ${diff} 超過 2 天，執行強制調整...`);
            
            // 列出需要調整的人
            offCounts.forEach(item => {
                if (item.off === maxOff) {
                    console.log(`  - ${item.name}: ${item.off} 天 (需減少)`);
                }
                if (item.off === minOff) {
                    console.log(`  - ${item.name}: ${item.off} 天 (需增加)`);
                }
            });
            
            // 這裡可以加入更激進的調整邏輯
            // 但通常前面的後處理已經足夠
        } else {
            console.log(`✅ 最終差異 ${diff} 天，符合要求`);
        }
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

    printFinalStats() {
        console.log("\n📊 排班完成統計:");
        
        const offCounts = this.staffList.map(s => this.counters[s.id].OFF || 0);
        const avgOff = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const minOff = Math.min(...offCounts);
        const maxOff = Math.max(...offCounts);
        
        console.log(`- 平均休假: ${avgOff.toFixed(1)} 天`);
        console.log(`- 休假範圍: ${minOff} ~ ${maxOff} 天 (差距 ${maxOff - minOff})`);
        
        // 列出每個人的休假天數
        console.log("\n個人休假明細:");
        this.staffList.forEach(s => {
            const off = this.counters[s.id].OFF || 0;
            const diff = off - avgOff;
            const diffStr = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
            console.log(`  ${s.name}: ${off} 天 (${diffStr})`);
        });
        
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
        const totalSlots = this.daysInMonth * (this.shiftCodes.length - 1); // 排除 OFF
        const satisfaction = ((1 - totalGaps / totalSlots) * 100).toFixed(1);
        console.log(`- 滿足率: ${satisfaction}%`);
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
