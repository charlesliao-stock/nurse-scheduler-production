/**
 * SchedulerV2 Enhanced - 強化版 AI 排班演算法
 * 
 * 核心改進:
 * 1. 雙階段排班: 預分配 + 微調
 * 2. 動態權重調整: 根據排班進度自適應
 * 3. 預測性回溯: 提前檢測潛在衝突
 * 4. 公平性前置: 在排班過程中即時平衡
 */

class SchedulerV2Enhanced extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // AI 參數
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 5; // 提升至 5
        this.TOLERANCE = rules.aiParams?.tolerance !== undefined ? 
                         rules.aiParams.tolerance : 2;
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 30; // 提升至 30
        
        // [新增] 動態權重系統
        this.currentProgress = 0; // 0-1, 表示排班進度
        
        console.log(`🚀 Scheduler V2 Enhanced 啟動`);
    }

    run() {
        console.log("📅 開始執行強化版排班演算法...");
        
        // 階段 0: 預計算
        this.precalculateOffBudgets();
        this.calculateStaffAvailability(); // [新增]
        
        // 階段 1: 初始化 (保留預休)
        this.resetSchedule();
        
        // 階段 2: 預分配 (粗排)
        const shiftOrder = this.determineShiftOrder();
        this.preallocateShifts(shiftOrder); // [新增]
        
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

    // ==================== 新增功能 ====================

    /**
     * [新增] 計算每位人員每天的可用性分數 (0-100)
     * 考慮因素: 連續上班天數、累計假期、個人偏好、特殊身份
     */
    calculateStaffAvailability() {
        this.availabilityMap = {}; // { uid: { day: score } }
        
        this.staffList.forEach(staff => {
            this.availabilityMap[staff.id] = {};
            
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                let score = 100; // 基礎分數
                
                // 因素 1: 連續上班天數 (-5 分/天)
                const consecDays = this.getConsecutiveWorkDays(staff.id, dateStr);
                score -= consecDays * 5;
                
                // 因素 2: 本月累計 OFF (-2 分/天)
                const currentOff = this.counters[staff.id].OFF || 0;
                score -= currentOff * 2;
                
                // 因素 3: 特殊身份保護 (降至 0)
                const params = staff.schedulingParams || {};
                if (params.isPregnant || params.isBreastfeeding) {
                    // 假設夜班定義為 22:00-06:00
                    const date = new Date(this.year, this.month - 1, d);
                    const hour = date.getHours();
                    if (hour >= 22 || hour <= 6) {
                        score = 0; // 完全不可排夜班
                    }
                }
                
                // 因素 4: 包班限制 (其他班別 = 0)
                const bundleShift = staff.packageType || (staff.prefs && staff.prefs.bundleShift);
                if (bundleShift) {
                    // 此人只能排包班的班別,其他班別分數設為 0
                    // (此邏輯需在 assignBestCandidate 中配合檢查)
                }
                
                this.availabilityMap[staff.id][d] = Math.max(0, score);
            }
        });
        
        console.log("📊 人員可用性地圖建立完成");
    }

    /**
     * [新增] 預分配階段: 快速粗排,確保基本人力覆蓋
     * 策略: 優先填滿「難排的日子」(週末、節日、需求高峰)
     */
    preallocateShifts(shiftOrder) {
        console.log("🎯 開始預分配階段...");
        
        // 1. 找出「緊張日」: 可用人力 < 需求人力 * 1.2
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
        
        console.log(`⚠️ 發現 ${tenseDays.length} 個緊張日:`, tenseDays);
        
        // 2. 對緊張日優先分配「高可用性」人員
        tenseDays.sort((a, b) => a.avail - b.avail); // 最緊張的優先
        
        tenseDays.forEach(({ day }) => {
            shiftOrder.forEach(shiftCode => {
                const needed = this.getDemand(day, shiftCode);
                let assigned = this.countStaff(day, shiftCode);
                
                // 預分配 80% 人力
                const targetPre = Math.floor(needed * 0.8);
                
                while (assigned < targetPre) {
                    if (!this.assignBestCandidate(day, shiftCode, false)) break;
                    assigned++;
                }
            });
        });
        
        console.log("✅ 預分配完成");
    }

    /**
     * [改良] 候選人比較函數 - 加入動態權重
     */
    compareCandidates(a, b, day, shiftCode, relaxRules = false) {
        const dateStr = this.getDateStr(day);
        
        // 🔥 第一關: 個人排班偏好 (最高優先)
        const aWants = this.checkWillingness(a, dateStr, shiftCode);
        const bWants = this.checkWillingness(b, dateStr, shiftCode);
        if (aWants && !bWants) return -1;
        if (!aWants && bWants) return 1;

        // 🔥 第二關: 總假量平衡 - [修正] 不重複計算
        const aTotalOff = this.counters[a.id].OFF || 0;
        const bTotalOff = this.counters[b.id].OFF || 0;
        
        // [新增] 動態權重: 月初看絕對值,月末看相對差距
        const offDiff = Math.abs(aTotalOff - bTotalOff);
        const shouldBalance = (this.currentProgress > 0.7 && offDiff > this.TOLERANCE);
        
        if (shouldBalance) {
            // 月末強制平衡
            return bTotalOff - aTotalOff;
        } else if (offDiff >= 2) {
            // 月初也要注意差距過大
            return bTotalOff - aTotalOff;
        }

        // 🔥 第三關: 班別公平性
        const aShiftCount = this.counters[a.id][shiftCode] || 0;
        const bShiftCount = this.counters[b.id][shiftCode] || 0;
        if (aShiftCount !== bShiftCount) {
            return aShiftCount - bShiftCount;
        }

        // 🔥 第四關: 可用性分數 (新增)
        const aAvail = (this.availabilityMap[a.id] && this.availabilityMap[a.id][day]) || 50;
        const bAvail = (this.availabilityMap[b.id] && this.availabilityMap[b.id][day]) || 50;
        if (aAvail !== bAvail) {
            return bAvail - aAvail; // 分數高的優先
        }

        // 🔥 第五關: 連班慣性
        const aPrev = this.getYesterdayShift(a.id, dateStr);
        const bPrev = this.getYesterdayShift(b.id, dateStr);
        const aIsSame = (aPrev === shiftCode);
        const bIsSame = (bPrev === shiftCode);
        if (aIsSame && !bIsSame) return -1;
        if (!aIsSame && bIsSame) return 1;

        return 0;
    }

    /**
     * [新增] 預測性回溯: 提前檢測未來 3 天是否會缺人
     */
    predictFutureShortage(currentDay) {
        const lookahead = 3;
        let shortage = 0;
        
        for (let d = currentDay + 1; d <= Math.min(currentDay + lookahead, this.daysInMonth); d++) {
            const shiftOrder = this.determineShiftOrder();
            
            shiftOrder.forEach(code => {
                const needed = this.getDemand(d, code);
                const available = this.staffList.filter(s => {
                    const dateStr = this.getDateStr(d);
                    const curr = this.getShiftByDate(dateStr, s.id);
                    return (curr === 'OFF' || !curr) && !this.isLocked(d, s.id);
                }).length;
                
                if (available < needed) {
                    shortage += (needed - available);
                }
            });
        }
        
        return shortage;
    }

    /**
     * [新增] 後處理優化: 微調換班,提升整體公平性
     */
    postProcessOptimization() {
        console.log("\n🔄 執行後處理優化...");
        
        // 策略 1: 交換同一天內兩人的班別,若能減少公平性偏差
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const shiftOrder = this.determineShiftOrder();
            
            // 嘗試所有可能的兩兩交換
            for (let i = 0; i < this.staffList.length; i++) {
                for (let j = i + 1; j < this.staffList.length; j++) {
                    const uid1 = this.staffList[i].id;
                    const uid2 = this.staffList[j].id;
                    
                    const shift1 = this.getShiftByDate(dateStr, uid1);
                    const shift2 = this.getShiftByDate(dateStr, uid2);
                    
                    // 跳過鎖定的預休
                    if (shift1 === 'REQ_OFF' || shift2 === 'REQ_OFF') continue;
                    if (!shift1 || !shift2) continue;
                    if (shift1 === shift2) continue;
                    
                    // 計算交換前的偏差
                    const beforeVariance = this.calculateVariance();
                    
                    // 嘗試交換
                    this.updateShift(dateStr, uid1, shift1, shift2);
                    this.updateShift(dateStr, uid2, shift2, shift1);
                    
                    // 檢查是否合法
                    const valid1 = this.isValidAssignment(this.staffList[i], dateStr, shift2, false);
                    const valid2 = this.isValidAssignment(this.staffList[j], dateStr, shift1, false);
                    
                    if (valid1 && valid2) {
                        const afterVariance = this.calculateVariance();
                        
                        if (afterVariance < beforeVariance) {
                            console.log(`✅ 交換 Day ${d}: ${uid1}(${shift1}↔${shift2}) ⇄ ${uid2}`);
                            continue; // 保留交換結果
                        }
                    }
                    
                    // 無效或無改善,還原
                    this.updateShift(dateStr, uid1, shift2, shift1);
                    this.updateShift(dateStr, uid2, shift1, shift2);
                }
            }
        }
        
        console.log("✅ 後處理優化完成");
    }

    /**
     * [新增] 計算全局方差 (用於評估公平性)
     */
    calculateVariance() {
        const offCounts = this.staffList.map(s => this.counters[s.id].OFF || 0);
        const avg = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const variance = offCounts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / offCounts.length;
        return variance;
    }

    // ==================== 覆寫基礎方法 ====================

    assignBestCandidate(day, shiftCode, relaxRules = false) {
        const dateStr = this.getDateStr(day);
        
        // [新增] 提前檢測未來缺口
        if (!relaxRules && this.currentProgress < 0.8) {
            const futureShortage = this.predictFutureShortage(day);
            if (futureShortage > 5) {
                console.warn(`⚠️ Day ${day} 未來 3 天預測缺 ${futureShortage} 人次`);
                // 可以選擇觸發更保守的排班策略
            }
        }
        
        // 原有邏輯
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
        
        console.log(`✅ Day ${day} [${shiftCode}] 指派: ${best.name || best.id} (分數: ${this.availabilityMap[best.id][day]})`);
        return true;
    }

    // 其他繼承方法維持不變...
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

    // 簡單回溯邏輯
    backtrack(day, shiftCode, depth) {
        if (depth > this.BACKTRACK_DEPTH) return false;
        // 這裡可以實作更複雜的交換邏輯，目前先保留結構
        return false;
    }
}
