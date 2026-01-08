/**
 * js/scheduler/SchedulerV2.js
 * 🚀 完整修正版：整合所有規則設定
 * 策略 V2: 啟發式回溯排班 (Fuzzy Fairness + Backtracking + Full Rules)
 */

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // AI 參數
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || rules.backtrackDepth || 3;
        this.TOLERANCE = rules.aiParams?.tolerance !== undefined ? rules.aiParams.tolerance : 
                         (rules.tolerance !== undefined ? rules.tolerance : 2);
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 20;
        
        // 權重參數 (用於評分)
        this.W_BALANCE = rules.aiParams?.w_balance || 200;
        this.W_CONTINUITY = rules.aiParams?.w_continuity || 50;
        this.W_SURPLUS = rules.aiParams?.w_surplus || 150;
        
        console.log(`🚀 Scheduler V2 啟動:`, {
            容許誤差: `${this.TOLERANCE} 天`,
            回溯深度: `${this.BACKTRACK_DEPTH} 天`,
            最大嘗試: `${this.MAX_ATTEMPTS} 次`,
            權重設定: `平衡=${this.W_BALANCE}, 連續=${this.W_CONTINUITY}`
        });
    }

    run() {
        console.log("📅 開始執行 V2 排班演算法...");
        
        // 1. 初始化：保留預休 (REQ_OFF) 與 請假 (LEAVE)，其餘重置為 OFF
        this.resetSchedule();

        // 2. 🆕 決定排班順序 (根據 rule_rotationOrder)
        const shiftOrder = this.determineShiftOrder();
        console.log("📋 排班順序:", shiftOrder);

        // 3. 逐日排班 (Day 1 -> Day N)
        for (let day = 1; day <= this.daysInMonth; day++) {
            console.log(`\n--- 第 ${day} 天排班 ---`);
            if (!this.solveDay(day, shiftOrder)) {
                console.warn(`⚠️ Day ${day} 無法完全滿足需求 (已盡力填補)`);
            }
        }
        
        // 4. 🆕 後處理：公平性調整
        if (this.rule_fairOff || this.rule_fairNight) {
            console.log("\n🔄 執行公平性後處理...");
            this.postProcessFairness();
        }
        
        console.log("✅ V2 排班完成");
        return this.schedule;
    }

    // 🆕 根據規則決定排班順序
    determineShiftOrder() {
        let order = [];
        
        // 使用規則設定的輪替順序
        if (this.rule_rotationOrder && this.rule_rotationOrder.length > 0) {
            order = this.rule_rotationOrder.filter(code => 
                code !== 'OFF' && this.shiftCodes.includes(code)
            );
        }
        
        // 如果沒有設定或設定不完整，補上剩餘班別
        const remaining = this.shiftCodes.filter(code => 
            code !== 'OFF' && !order.includes(code)
        );
        
        if (remaining.length > 0) {
            // 按優先順序補上：N > E > 其他
            remaining.sort((a, b) => {
                const priority = { 'N': 1, 'E': 2, 'D': 3 };
                return (priority[a] || 99) - (priority[b] || 99);
            });
            order.push(...remaining);
        }
        
        // 如果完全沒有設定，使用預設
        if (order.length === 0) {
            order = ['N', 'E', 'D'].filter(code => this.shiftCodes.includes(code));
        }
        
        return order;
    }

    resetSchedule() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const current = this.getShiftByDate(dateStr, staff.id);
                
                // 只有不是預休或請假，才重置為 OFF
                if (current !== 'REQ_OFF' && current !== 'LEAVE' && !this.isLocked(d, staff.id)) {
                    this.updateShift(dateStr, staff.id, current, 'OFF');
                }
            }
        });
    }

    solveDay(day, shiftOrder) {
        for (const shiftCode of shiftOrder) {
            const needed = this.getDemand(day, shiftCode);
            let currentCount = this.countStaff(day, shiftCode);

            // 迴圈直到補足缺額
            let attempts = 0;
            while (currentCount < needed && attempts < this.MAX_ATTEMPTS) {
                attempts++;
                
                // 步驟 1: 嘗試直接找「條件最好」的人 (Greedy)
                if (this.assignBestCandidate(day, shiftCode)) {
                    currentCount++;
                    continue;
                }

                // 步驟 2: 找不到人 -> 啟動回溯 (Backtracking)
                if (this.backtrack(day, shiftCode, 1)) {
                    currentCount++;
                    continue;
                }

                // 步驟 3: 放寬規則限制 (受控：必須由規則開啟)
                if (this.rule_enableRelaxation && this.assignBestCandidate(day, shiftCode, true)) {
                    console.warn(`⚠️ Day ${day} [${shiftCode}] 透過放寬規則補足人力 (attempt ${attempts})`);
                    currentCount++;
                    continue;
                }

                // 步驟 4: 真的開天窗了
                console.error(`❌ Day ${day} [${shiftCode}] 開天窗 (缺 ${needed - currentCount} 人, 嘗試 ${attempts} 次)`);
                break;
            }
        }
        return true;
    }

    assignBestCandidate(day, shiftCode, relaxRules = false) {
        const dateStr = this.getDateStr(day);
        
        // 1. 找出所有「合法」的候選人
        const candidates = this.staffList.filter(staff => {
            const uid = staff.id;
            const currentShift = this.getShiftByDate(dateStr, uid);
            
            // A. 基本狀態檢查 (必須是 OFF 才能被排班)
            if (currentShift !== 'OFF') return false; 
            if (this.isLocked(day, uid)) return false; 
            
            // B. 🆕 包班邏輯檢查 (嚴格遵守)
            if (staff.packageType) {
                // 如果有包班，則該員只能排該班別，不能排其他班
                if (staff.packageType !== shiftCode) return false;
            }
            
            // C. 預休/請假檢查 (已在 isLocked 處理，此處為保險)
            if (currentShift === 'REQ_OFF' || currentShift === 'LEAVE') return false;
            
            // C. 法規與規則檢查
            if (!relaxRules) {
                if (!this.isValidAssignment(staff, dateStr, shiftCode)) {
                    return false;
                }
            } else {
                // 放寬模式：只保留最基本的間隔檢查
                const prevShift = this.getYesterdayShift(staff.id, dateStr);
                if (this.rule_minGap11 && !this.checkRestPeriod(prevShift, shiftCode)) {
                    return false;
                }
            }

            return true;
        });

        if (candidates.length === 0) return false;

        // 2. 使用模糊比較邏輯排序
        candidates.sort((a, b) => this.compareCandidates(a, b, day, shiftCode));

        // 3. 選出第一名 (Winner)
        const best = candidates[0];

        // 4. 執行指派
        const currentShift = this.getShiftByDate(dateStr, best.id);
        this.updateShift(dateStr, best.id, currentShift, shiftCode);
        
        console.log(`✅ Day ${day} [${shiftCode}] 指派: ${best.name || best.id}`);
        return true;
    }

    // 🆕 人員比較函數 (整合所有規則)
    compareCandidates(a, b, day, shiftCode) {
        const dateStr = this.getDateStr(day);
        
        // 🔥 第一關：個人志願 (最高優先)
        const aWants = this.checkWillingness(a, dateStr, shiftCode);
        const bWants = this.checkWillingness(b, dateStr, shiftCode);
        
        if (aWants && !bWants) return -1;
        if (!aWants && bWants) return 1;
        
        // 🔥 第二關：慣性連班 (避免斷班)
        if (this.rule_consecutivePref) {
            const aPrev = this.getYesterdayShift(a.id, dateStr);
            const bPrev = this.getYesterdayShift(b.id, dateStr);
            
            const aIsSame = (aPrev === shiftCode);
            const bIsSame = (bPrev === shiftCode);
            
            if (aIsSame && !bIsSame) return -1;
            if (!aIsSame && bIsSame) return 1;
        }

        // 🔥 第三關：天數公平性 (模糊比較)
        const aStats = this.counters[a.id];
        const bStats = this.counters[b.id];

        // 根據班別類型決定比較標的
        let aVal, bVal;
        const isNight = shiftCode.includes('N') || shiftCode.includes('E');

        if (isNight) {
            // 排夜班：比較該班別數 (少的優先)
            aVal = aStats[shiftCode] || 0; 
            bVal = bStats[shiftCode] || 0;
        } else {
            // 排白班：比較休假數 (反向比較，OFF多的要被抓來上班)
            aVal = bStats.OFF || 0; 
            bVal = aStats.OFF || 0; 
        }

        const diff = Math.abs(aVal - bVal);

        // --- [核心邏輯] ---
        
        // 情況 A: 差距過大 (超過容許值) -> 嚴格執行公平性
        if (diff > this.TOLERANCE) {
            return aVal - bVal; // 升序：數值小的優先
        }

        // 情況 B: 差距在容許範圍內 -> 忽略天數，改看「連班慣性」
        const aWorkedYesterday = (this.getYesterdayShift(a.id, dateStr) !== 'OFF');
        const bWorkedYesterday = (this.getYesterdayShift(b.id, dateStr) !== 'OFF');

        if (aWorkedYesterday && !bWorkedYesterday) return -1;
        if (!aWorkedYesterday && bWorkedYesterday) return 1;

        // 🔥 第四關：🆕 組別平衡 (如果有設定組別限制)
        if (this.rules.groupLimits) {
            const aGroup = a.group || '';
            const bGroup = b.group || '';
            
            if (aGroup && bGroup && aGroup !== bGroup) {
                // 檢查哪個組別更需要排這個班
                const aGroupNeed = this.calcGroupNeed(aGroup, shiftCode);
                const bGroupNeed = this.calcGroupNeed(bGroup, shiftCode);
                
                if (aGroupNeed > bGroupNeed) return -1;
                if (bGroupNeed > aGroupNeed) return 1;
            }
        }

        // 最後：隨機 (避免永遠是編號 001 的人被選中)
        return Math.random() - 0.5;
    }

    // 🆕 計算組別需求度
    calcGroupNeed(groupId, shiftCode) {
        const limits = this.rules.groupLimits?.[groupId];
        if (!limits) return 0;
        
        // 計算該組目前已排該班的人數
        let currentCount = 0;
        Object.keys(this.schedule).forEach(dateStr => {
            const daySchedule = this.schedule[dateStr][shiftCode] || [];
            daySchedule.forEach(uid => {
                const staff = this.staffList.find(s => s.id === uid);
                if (staff && staff.group === groupId) {
                    currentCount++;
                }
            });
        });
        
        // 計算需求缺口
        const minRequired = limits[`min${shiftCode}`] || limits.minTotal || 0;
        const need = minRequired - currentCount;
        
        return Math.max(0, need);
    }

    backtrack(day, shiftCode, depth) {
        if (depth > this.BACKTRACK_DEPTH) return false;
        if (day - depth < 1) return false;

        const targetDate = day;
        const pastDate = day - depth;

        // 尋找救星
        const potentialSaviors = this.staffList.filter(staff => {
            if (this.getShiftByDate(this.getDateStr(targetDate), staff.id) !== 'OFF') return false;
            if (this.isLocked(pastDate, staff.id)) return false;

            const originalPastShift = this.getShiftByDate(this.getDateStr(pastDate), staff.id);
            if (originalPastShift === 'OFF') return false; 

            // 模擬測試
            this.updateShift(this.getDateStr(pastDate), staff.id, originalPastShift, 'OFF');
            const canWorkNow = this.isValidAssignment(staff, this.getDateStr(targetDate), shiftCode);
            this.updateShift(this.getDateStr(pastDate), staff.id, 'OFF', originalPastShift);

            return canWorkNow;
        });

        for (const savior of potentialSaviors) {
            const originalShift = this.getShiftByDate(this.getDateStr(pastDate), savior.id);

            // 策略 1: 簡單回溯
            if (this.countStaff(pastDate, originalShift) > this.getDemand(pastDate, originalShift)) {
                 this.updateShift(this.getDateStr(pastDate), savior.id, originalShift, 'OFF');
                 this.updateShift(this.getDateStr(targetDate), savior.id, 'OFF', shiftCode);
                 console.log(`🔨 簡單回溯：${savior.name} Day ${pastDate} 改休，支援 Day ${targetDate}`);
                 return true;
            }

            // 策略 2: 交換回溯
            const victim = this.findReplacement(pastDate, originalShift, [savior.id]);
            if (victim) {
                this.updateShift(this.getDateStr(pastDate), victim.id, 'OFF', originalShift);
                this.updateShift(this.getDateStr(pastDate), savior.id, originalShift, 'OFF');
                this.updateShift(this.getDateStr(targetDate), savior.id, 'OFF', shiftCode);
                console.log(`🔨 交換回溯：${victim.name} 替 ${savior.name} (Day ${pastDate})`);
                return true;
            }
        }
        
        // 往更深層找
        return this.backtrack(day, shiftCode, depth + 1);
    }

    findReplacement(day, shiftCode, excludeIds) {
        const candidates = this.staffList.filter(staff => {
            if (excludeIds.includes(staff.id)) return false;
            if (this.getShiftByDate(this.getDateStr(day), staff.id) !== 'OFF') return false;
            if (this.isLocked(day, staff.id)) return false;
            return this.isValidAssignment(staff, this.getDateStr(day), shiftCode);
        });

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => this.compareCandidates(a, b, day, shiftCode));
        return candidates[0];
    }

    // 🆕 公平性後處理
    postProcessFairness() {
        // 檢查並調整極端不平衡情況
        const stats = this.calculateGlobalStats();
        
        if (this.rule_fairOff) {
            console.log("  檢查 OFF 公平性...");
            this.balanceOffDays(stats);
        }
        
        if (this.rule_fairNight) {
            console.log("  檢查夜班公平性...");
            this.balanceNightShifts(stats);
        }
    }

    calculateGlobalStats() {
        const stats = {};
        this.staffList.forEach(staff => {
            stats[staff.id] = { ...this.counters[staff.id] };
        });
        return stats;
    }

    balanceOffDays(stats) {
        const offCounts = Object.values(stats).map(s => s.OFF || 0);
        const avg = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const max = Math.max(...offCounts);
        const min = Math.min(...offCounts);
        
        console.log(`  OFF 天數: 平均=${avg.toFixed(1)}, 最多=${max}, 最少=${min}`);
        
        if (max - min > this.rule_fairOffVar) {
            console.warn(`  ⚠️ OFF 分配不均 (差距 ${max - min} > ${this.rule_fairOffVar})`);
            // TODO: 可實作自動調整邏輯
        }
    }

    balanceNightShifts(stats) {
        const nightCodes = this.shiftCodes.filter(c => c.includes('N') || c.includes('E'));
        
        nightCodes.forEach(code => {
            const counts = Object.values(stats).map(s => s[code] || 0);
            const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
            const max = Math.max(...counts);
            const min = Math.min(...counts);
            
            console.log(`  ${code} 班數: 平均=${avg.toFixed(1)}, 最多=${max}, 最少=${min}`);
            
            if (max - min > this.rule_fairNightVar) {
                console.warn(`  ⚠️ ${code} 分配不均 (差距 ${max - min} > ${this.rule_fairNightVar})`);
            }
        });
    }

    // 輔助：判斷是否鎖定 (預休或請假)
    isLocked(day, uid) {
        const s = this.getShiftByDate(this.getDateStr(day), uid);
        return s === 'REQ_OFF' || s === 'LEAVE';
    }

    // 輔助：檢查意願
    checkWillingness(staff, dateStr, shiftCode) {
        if (staff.prefs) {
            // 檢查包班意願
            if (staff.prefs.bundleShift === shiftCode) return true;
            
            // 檢查志願序
            if (staff.prefs.priority_1 === shiftCode) return true;
            if (staff.prefs.priority_2 === shiftCode) return true;
            if (staff.prefs.priority_3 === shiftCode) return true;
        }
        
        return false;
    }
}
