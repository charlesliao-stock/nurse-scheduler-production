/**
 * SchedulerV2 Enhanced - 強化版 AI 排班演算法
 * 
 * 核心改進:
 * 1. 雙階段排班: 預分配 + 微調
 * 2. 動態權重調整: 根據排班進度自適應
 * 3. 預測性回溯: 提前檢測潛在衝突
 * 4. 公平性前置: 在排班過程中即時平衡
 */

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // AI 參數
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 5;
        this.TOLERANCE = rules.aiParams?.tolerance !== undefined ? 
                         rules.aiParams.tolerance : 2;
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 30;
        
        // 動態權重系統
        this.currentProgress = 0; // 0-1, 表示排班進度
        
        console.log(`🚀 Scheduler V2 Enhanced 啟動`);
    }

    run() {
        console.log("📅 開始執行強化版排班演算法...");
        
        // 階段 0: 預計算
        this.precalculateOffBudgets();
        this.calculateStaffAvailability();
        
        // 階段 1: 初始化 (保留預休)
        this.resetSchedule();
        
        // 階段 2: 預分配 (粗排)
        const shiftOrder = this.determineShiftOrder();
        this.preallocateShifts(shiftOrder);
        
        // 階段 3: 逐日精排
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.currentProgress = day / this.daysInMonth;
            
            if (!this.solveDay(day, shiftOrder)) {
                console.warn(`⚠️ Day ${day} 無法完全滿足需求`);
            }
        }
        
        // 階段 4: 後處理優化
        this.postProcessOptimization();
        
        console.log("✅ 強化版排班完成");
        return this.schedule;
    }

    // ==================== 核心方法 ====================

    precalculateOffBudgets() {
        // 計算每人的 OFF 預算
        this.staffList.forEach(staff => {
            const totalDays = this.daysInMonth;
            const avgWorkDays = Math.floor(totalDays * 0.7); // 假設 70% 上班
            staff.offBudget = totalDays - avgWorkDays;
        });
    }

    calculateStaffAvailability() {
        this.availabilityMap = {};
        
        this.staffList.forEach(staff => {
            this.availabilityMap[staff.id] = {};
            
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                let score = 100;
                
                // 因素 1: 連續上班天數
                const consecDays = this.getConsecutiveWorkDays(staff.id, dateStr);
                score -= consecDays * 5;
                
                // 因素 2: 本月累計 OFF
                const currentOff = this.counters[staff.id].OFF || 0;
                score -= currentOff * 2;
                
                // 因素 3: 特殊身份保護
                const params = staff.schedulingParams || {};
                if (params.isPregnant || params.isBreastfeeding) {
                    score = 0; // 夜班完全不可排
                }
                
                this.availabilityMap[staff.id][d] = Math.max(0, score);
            }
        });
        
        console.log("📊 人員可用性地圖建立完成");
    }

    preallocateShifts(shiftOrder) {
        console.log("🎯 開始預分配階段...");
        
        const tenseDays = [];
        for (let d = 1; d <= this.daysInMonth; d++) {
            const date = new Date(this.year, this.month - 1, d);
            const dayIdx = (date.getDay() + 6) % 7;
            
            let totalNeed = 0;
            shiftOrder.forEach(code => {
                const key = `${code}_${dayIdx}`;
                totalNeed += (this.rules.dailyNeeds && this.rules.dailyNeeds[key]) || 0;
            });
            
            const available = this.staffList.filter(s => {
                const dateStr = this.getDateStr(d);
                const curr = this.getShiftByDate(dateStr, s.id);
                return curr === 'OFF' && !this.isLocked(d, s.id);
            }).length;
            
            if (available < totalNeed * 1.2) {
                tenseDays.push({ day: d, need: totalNeed, avail: available });
            }
        }
        
        console.log(`⚠️ 發現 ${tenseDays.length} 個緊張日`);
        
        tenseDays.sort((a, b) => a.avail - b.avail);
        
        tenseDays.forEach(({ day }) => {
            shiftOrder.forEach(shiftCode => {
                const needed = this.getDemand(day, shiftCode);
                let assigned = this.countStaff(day, shiftCode);
                const targetPre = Math.floor(needed * 0.8);
                
                while (assigned < targetPre) {
                    if (!this.assignBestCandidate(day, shiftCode, false)) break;
                    assigned++;
                }
            });
        });
        
        console.log("✅ 預分配完成");
    }

    resetSchedule() {
        // 保留預休 (REQ_OFF)
        this.staffList.forEach(staff => {
            const prefs = staff.prefs || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const prefVal = prefs[dateStr];
                
                if (prefVal === 'REQ_OFF' || prefVal === 'OFF') {
                    const current = this.getShiftByDate(dateStr, staff.id);
                    this.updateShift(dateStr, staff.id, current, 'REQ_OFF');
                }
            }
        });
    }

    determineShiftOrder() {
        // 優先處理夜班 (N)，再處理其他班別
        const order = ['N', 'E', 'D'];
        return order.filter(code => this.shiftCodes.includes(code));
    }

    solveDay(day, shiftOrder) {
        let success = true;
        
        shiftOrder.forEach(shiftCode => {
            const needed = this.getDemand(day, shiftCode);
            let assigned = this.countStaff(day, shiftCode);
            
            while (assigned < needed) {
                if (!this.assignBestCandidate(day, shiftCode, false)) {
                    // 嘗試放寬規則
                    if (!this.assignBestCandidate(day, shiftCode, true)) {
                        console.warn(`⚠️ Day ${day} [${shiftCode}] 缺 ${needed - assigned} 人`);
                        success = false;
                        break;
                    }
                }
                assigned++;
            }
        });
        
        return success;
    }

    assignBestCandidate(day, shiftCode, relaxRules = false) {
        const dateStr = this.getDateStr(day);
        
        const candidates = this.staffList.filter(staff => {
            const uid = staff.id;
            const currentShift = this.getShiftByDate(dateStr, uid);
            
            if (currentShift !== 'OFF') return false;
            if (this.isLocked(day, uid)) return false;
            
            const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
            if (bundleShift && bundleShift !== shiftCode) return false;
            
            if (!this.isValidAssignment(staff, dateStr, shiftCode, relaxRules)) {
                return false;
            }

            return true;
        });

        if (candidates.length === 0) return false;

        candidates.sort((a, b) => this.compareCandidates(a, b, day, shiftCode, relaxRules));

        const best = candidates[0];
        const currentShift = this.getShiftByDate(dateStr, best.id);
        this.updateShift(dateStr, best.id, currentShift, shiftCode);
        
        return true;
    }

    compareCandidates(a, b, day, shiftCode, relaxRules = false) {
        const dateStr = this.getDateStr(day);
        
        // 第一關: 個人排班偏好
        const aWants = this.checkWillingness(a, dateStr, shiftCode);
        const bWants = this.checkWillingness(b, dateStr, shiftCode);
        if (aWants && !bWants) return -1;
        if (!aWants && bWants) return 1;

        // 第二關: 總假量平衡
        const aTotalOff = this.counters[a.id].OFF || 0;
        const bTotalOff = this.counters[b.id].OFF || 0;
        
        const offDiff = Math.abs(aTotalOff - bTotalOff);
        const shouldBalance = (this.currentProgress > 0.7 && offDiff > this.TOLERANCE);
        
        if (shouldBalance) {
            return bTotalOff - aTotalOff;
        } else if (offDiff >= 2) {
            return bTotalOff - aTotalOff;
        }

        // 第三關: 班別公平性
        const aShiftCount = this.counters[a.id][shiftCode] || 0;
        const bShiftCount = this.counters[b.id][shiftCode] || 0;
        if (aShiftCount !== bShiftCount) {
            return aShiftCount - bShiftCount;
        }

        // 第四關: 可用性分數
        const aAvail = (this.availabilityMap[a.id] && this.availabilityMap[a.id][day]) || 50;
        const bAvail = (this.availabilityMap[b.id] && this.availabilityMap[b.id][day]) || 50;
        if (aAvail !== bAvail) {
            return bAvail - aAvail;
        }

        // 第五關: 連班慣性
        const aPrev = this.getYesterdayShift(a.id, dateStr);
        const bPrev = this.getYesterdayShift(b.id, dateStr);
        const aIsSame = (aPrev === shiftCode);
        const bIsSame = (bPrev === shiftCode);
        if (aIsSame && !bIsSame) return -1;
        if (!aIsSame && bIsSame) return 1;

        return 0;
    }

    postProcessOptimization() {
        console.log("\n🔄 執行後處理優化...");
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const shiftOrder = this.determineShiftOrder();
            
            for (let i = 0; i < this.staffList.length; i++) {
                for (let j = i + 1; j < this.staffList.length; j++) {
                    const uid1 = this.staffList[i].id;
                    const uid2 = this.staffList[j].id;
                    
                    const shift1 = this.getShiftByDate(dateStr, uid1);
                    const shift2 = this.getShiftByDate(dateStr, uid2);
                    
                    if (shift1 === 'REQ_OFF' || shift2 === 'REQ_OFF') continue;
                    if (!shift1 || !shift2) continue;
                    if (shift1 === shift2) continue;
                    
                    const beforeVariance = this.calculateVariance();
                    
                    this.updateShift(dateStr, uid1, shift1, shift2);
                    this.updateShift(dateStr, uid2, shift2, shift1);
                    
                    const valid1 = this.isValidAssignment(this.staffList[i], dateStr, shift2, false);
                    const valid2 = this.isValidAssignment(this.staffList[j], dateStr, shift1, false);
                    
                    if (valid1 && valid2) {
                        const afterVariance = this.calculateVariance();
                        
                        if (afterVariance < beforeVariance) {
                            continue;
                        }
                    }
                    
                    this.updateShift(dateStr, uid1, shift2, shift1);
                    this.updateShift(dateStr, uid2, shift1, shift2);
                }
            }
        }
        
        console.log("✅ 後處理優化完成");
    }

    calculateVariance() {
        const offCounts = this.staffList.map(s => this.counters[s.id].OFF || 0);
        const avg = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const variance = offCounts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / offCounts.length;
        return variance;
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
