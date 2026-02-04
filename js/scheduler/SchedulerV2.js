// js/scheduler/SchedulerV2.js
// 🚀 Charles 需求優化版：
// 1. 包班配額檢查改為僅警告
// 2. 夜班平衡改為以實際平均為目標
// 3. 分段平衡考慮全月 OFF + 未來壓力
// 4. 長假人員 OFF 動態計算
// 5. 轉換夜班自動處理

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; 
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 3;
        
        this.tolerance = this.rules.fairness?.fairOffVar || 2; 
        this.minCons = this.rules.pattern?.minConsecutive || 2;
        
        // 分組清單
        this.bundleStaff = [];
        this.nonBundleStaff = [];
        
        // 🔥 新增：效能監控
        this.lastBalanceGap = null;
        
        // 🔥 新增：轉換夜班追蹤
        this.bundleTransitions = new Map();
    }

    run() {
        console.log(`🚀 SchedulerV2 Full Brute-Force Mode Start.`);
        
        // 1. 預處理
        this.applyPreSchedules();
        
        // 2. 初始化並計算配額
        this.calculateFixedQuota(); 
        this.classifyStaffByBundle();
        
        // 🔥 新增：檢測需要轉換夜班的人員
        this.detectBundleTransitions();
        
        // 🔥 新增：優先處理假日
        this.prioritizeWeekendOffs();
        
        // 設定分段平衡點
        const segments = Math.max(3, this.rules.aiParams?.balancingSegments || 3);
        const interval = Math.floor(this.daysInMonth / segments);
        for (let i = 1; i < segments; i++) {
            this.checkpoints.push(i * interval);
        }

        // --- 主迴圈 ---
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.calculateDailyWorkPressure(d);
            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.getOptimalShiftOrder(dailyNeeds);

            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) this.fillShiftNeeds(d, shiftCode, count);
            }

            this.optimizeDailyAllocation(d);

            // 🔥 修改：分段平衡改用新函數
            if (this.checkpoints.includes(d)) {
                this.performSegmentBalance(d);
            }
        }

        console.log(`⚖️ 執行最終全月暴力平衡...`);
        this.postProcessBalancing(this.daysInMonth, true);

        return this.formatResult();
    }

    // ============================================================
    // 🔧 核心功能區
    // ============================================================
    
    calculateFixedQuota() {
        let totalNeedsByShift = {};
        for (let d = 1; d <= this.daysInMonth; d++) {
            const needs = this.getDailyNeeds(d);
            Object.entries(needs).forEach(([shift, count]) => {
                if (!totalNeedsByShift[shift]) totalNeedsByShift[shift] = 0;
                totalNeedsByShift[shift] += count;
            });
        }
        
        this.staffList.forEach(staff => {
            let reqOffCount = 0;
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                if (params[this.getDateStr(d)] === 'REQ_OFF') reqOffCount++;
            }
            const availableDays = this.daysInMonth - reqOffCount;

            this.staffStats[staff.id] = {
                reqOffCount: reqOffCount,
                availableDays: availableDays,
                workQuota: 0,
                workedShifts: 0,
                isLongVacationer: false,
                initialRandom: Math.random(),
                targetShift: null,  
                targetQuota: 0,
                expectedTotalOffs: 0  // 🔥 新增：預期總放假天數
            };
        });

        const bundleStaffByShift = {};
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (bundleShift) {
                if (!bundleStaffByShift[bundleShift]) bundleStaffByShift[bundleShift] = [];
                bundleStaffByShift[bundleShift].push(staff);
                this.staffStats[staff.id].targetShift = bundleShift;
            }
        });
        
        Object.entries(bundleStaffByShift).forEach(([shift, staffs]) => {
            const totalNeed = totalNeedsByShift[shift] || 0;
            const totalAvailable = staffs.reduce((sum, s) => sum + this.staffStats[s.id].availableDays, 0);
            
            staffs.forEach(staff => {
                const stats = this.staffStats[staff.id];
                const ratio = totalAvailable > 0 ? (stats.availableDays / totalAvailable) : 0;
                stats.targetQuota = Math.floor(totalNeed * ratio);
                
                const avgQuota = totalNeed / staffs.length;
                if (stats.availableDays <= avgQuota) {
                    stats.workQuota = stats.availableDays;
                    stats.targetQuota = stats.availableDays;
                    stats.isLongVacationer = true;
                } else {
                    stats.workQuota = stats.targetQuota;
                }
                stats.workQuota = Math.max(stats.workQuota, stats.targetQuota);
            });
            
            const allocated = staffs.reduce((sum, s) => sum + this.staffStats[s.id].targetQuota, 0);
            const remainder = totalNeed - allocated;
            
            if (remainder > 0) {
                const sorted = [...staffs].sort((a, b) => this.staffStats[b.id].availableDays - this.staffStats[a.id].availableDays);
                for (let i = 0; i < remainder && i < sorted.length; i++) {
                    const stats = this.staffStats[sorted[i].id];
                    if (!stats.isLongVacationer) {
                        stats.targetQuota++;
                        stats.workQuota = Math.max(stats.workQuota + 1, stats.targetQuota);
                    }
                }
            }
        });

        let remainingShifts = 0;
        Object.entries(totalNeedsByShift).forEach(([shift, total]) => {
            const bundleStaffs = bundleStaffByShift[shift] || [];
            const bundleAllocated = bundleStaffs.reduce((sum, s) => sum + this.staffStats[s.id].targetQuota, 0);
            remainingShifts += Math.max(0, total - bundleAllocated);
        });
        
        const nonBundleStaff = this.staffList.filter(s => {
            const bundleShift = s.packageType || s.prefs?.bundleShift;
            return !bundleShift;
        });
        
        if (nonBundleStaff.length > 0) {
            let staffToAssign = [...nonBundleStaff];
            for(let iter = 0; iter < 5; iter++) {
                if (staffToAssign.length === 0) break;
                const avgQuota = Math.ceil(remainingShifts / staffToAssign.length);
                let nextRoundStaff = [];
                
                staffToAssign.forEach(staff => {
                    const stats = this.staffStats[staff.id];
                    if (stats.availableDays <= avgQuota) {
                        stats.workQuota = stats.availableDays;
                        remainingShifts -= stats.availableDays;
                        stats.isLongVacationer = true;
                    } else {
                        stats.workQuota = avgQuota;
                        nextRoundStaff.push(staff);
                    }
                });
                
                if (nextRoundStaff.length === staffToAssign.length) {
                    const finalAvg = Math.floor(remainingShifts / nextRoundStaff.length);
                    const remainder = remainingShifts % nextRoundStaff.length;
                    nextRoundStaff.forEach((s, idx) => {
                        this.staffStats[s.id].workQuota = finalAvg + (idx < remainder ? 1 : 0);
                    });
                    break;
                }
                staffToAssign = nextRoundStaff;
            }
        }
        
        this.staffList.forEach(s => {
            if (this.staffStats[s.id].reqOffCount >= 5) {
                this.staffStats[s.id].isLongVacationer = true;
            }
        });
        
        // 🔥 新增：計算預期總放假天數（expectedTotalOffs）
        this.calculateExpectedTotalOffs();
    }

    // 🔥 新增：計算預期總放假天數
    calculateExpectedTotalOffs() {
        // 分類：長假人員 vs 非長假人員
        const longVacationers = this.staffList.filter(s => this.staffStats[s.id].isLongVacationer);
        const normalStaff = this.staffList.filter(s => !this.staffStats[s.id].isLongVacationer);
        
        // 計算總放假配額
        const dailyNeed = 8; // 簡化，實際應從 rules 計算
        const totalOffQuota = (this.daysInMonth * this.staffList.length) - (this.daysInMonth * dailyNeed);
        
        // 先分配長假人員的 OFF
        let remainingOffQuota = totalOffQuota;
        
        longVacationers.forEach(s => {
            const stats = this.staffStats[s.id];
            const workDays = this.daysInMonth - stats.reqOffCount;
            const maxCons = this.rule_longVacationWorkLimit || 7;
            const offsNeeded = Math.floor(workDays / (maxCons + 1));
            stats.expectedTotalOffs = stats.reqOffCount + offsNeeded;
            remainingOffQuota -= stats.expectedTotalOffs;
            
            console.log(`📊 長假人員 ${s.id}: REQ_OFF=${stats.reqOffCount}, 預期系統OFF=${offsNeeded}, 總計=${stats.expectedTotalOffs}`);
        });
        
        // 非長假人員平分剩餘配額
        if (normalStaff.length > 0) {
            const avgOffs = remainingOffQuota / normalStaff.length;
            normalStaff.forEach(s => {
                this.staffStats[s.id].expectedTotalOffs = Math.round(avgOffs);
            });
            console.log(`📊 非長假人員 (${normalStaff.length}人): 平均總放假=${avgOffs.toFixed(1)}天`);
        }
    }

    // 🔥 新增：偵測需要轉換夜班的人員
    detectBundleTransitions() {
        this.bundleStaff.forEach(staff => {
            const currentBundle = staff.packageType || staff.prefs?.bundleShift;
            const lastMonthShift = this.lastMonthData?.[staff.id]?.lastShift;
            
            // 如果上月最後一班是夜班，且與本月包班不同
            if (lastMonthShift && 
                lastMonthShift !== 'OFF' && 
                lastMonthShift !== 'REQ_OFF' &&
                lastMonthShift !== currentBundle) {
                
                this.bundleTransitions.set(staff.id, {
                    fromShift: lastMonthShift,
                    toShift: currentBundle,
                    hasTransitioned: false
                });
                
                console.log(`🔄 偵測到轉換需求: ${staff.id} 從 ${lastMonthShift} → ${currentBundle}`);
            }
        });
    }

    // 🔥 新增：檢查人員是否有第一個 OFF（用於轉換夜班）
    hasOffBetween(uid, startDay, endDay) {
        for (let d = startDay; d <= endDay; d++) {
            const shift = this.getShiftByDate(this.getDateStr(d), uid);
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
        }
        return false;
    }

    // 🔥 新增：分段平衡（考慮全月 OFF + 未來壓力）
    performSegmentBalance(checkDay) {
        console.log(`\n⚖️ 執行第 ${checkDay} 天分段平衡...`);
        
        // 1. 計算每個人的 OFF 進度
        const offProgress = this.staffList.map(s => {
            const stats = this.staffStats[s.id];
            
            // 計算目前已累計的 OFF（包含未來的 REQ_OFF）
            let currentTotalOffs = 0;
            for (let d = 1; d <= this.daysInMonth; d++) {
                const shift = this.getShiftByDate(this.getDateStr(d), s.id);
                if (shift === 'OFF' || shift === 'REQ_OFF') {
                    currentTotalOffs++;
                }
            }
            
            // 計算偏離度
            const deviation = currentTotalOffs - stats.expectedTotalOffs;
            
            return {
                id: s.id,
                obj: s,
                expectedOffs: stats.expectedTotalOffs,
                currentOffs: currentTotalOffs,
                deviation: deviation,  // 正數=太多，負數=太少
                isLongVacationer: stats.isLongVacationer
            };
        });
        
        // 2. 找出需要調整的人
        const overOff = offProgress.filter(p => p.deviation > 0.5).sort((a, b) => b.deviation - a.deviation);
        const underOff = offProgress.filter(p => p.deviation < -0.5).sort((a, b) => a.deviation - b.deviation);
        
        console.log(`  超額放假：${overOff.length}人，缺少放假：${underOff.length}人`);
        
        // 3. 執行調整（優先調整前 checkDay 天的內容）
        const maxSwaps = 10;
        let swapCount = 0;
        
        for (const over of overOff) {
            if (swapCount >= maxSwaps) break;
            
            for (const under of underOff) {
                if (swapCount >= maxSwaps) break;
                
                // 嘗試在 1 到 checkDay 範圍內互換
                if (this.trySwapForBalance(over, under, 1, checkDay)) {
                    swapCount++;
                    console.log(`  ✓ 成功調整: ${over.id}(${over.deviation.toFixed(1)}) ↔ ${under.id}(${under.deviation.toFixed(1)})`);
                    break;
                }
            }
        }
        
        console.log(`  完成 ${swapCount} 次調整\n`);
    }

    // 🔥 新增：嘗試互換以平衡 OFF
    trySwapForBalance(overPerson, underPerson, startDay, endDay) {
        // 策略：找一天，over 在上班，under 在 OFF，且可以互換
        // 優先選擇「最接近 REQ_OFF」的天數（連休）
        
        const days = [];
        for (let d = startDay; d <= endDay; d++) {
            days.push(d);
        }
        
        // 🔥 排序：優先選擇「靠近 REQ_OFF」的天數
        days.sort((a, b) => {
            const scoreA = this.calculateOffAdjustmentScore(overPerson.id, a);
            const scoreB = this.calculateOffAdjustmentScore(overPerson.id, b);
            return scoreB - scoreA;  // 高分優先
        });
        
        for (const d of days) {
            const dateStr = this.getDateStr(d);
            
            // 檢查是否可交換
            if (this.isPreRequestOff(overPerson.id, dateStr) || this.isPreRequestOff(underPerson.id, dateStr)) {
                continue;
            }
            
            const shiftOver = this.getShiftByDate(dateStr, overPerson.id);
            const shiftUnder = this.getShiftByDate(dateStr, underPerson.id);
            
            // over 在上班，under 在 OFF
            if (shiftOver !== 'OFF' && shiftOver !== 'REQ_OFF' && shiftUnder === 'OFF') {
                // 檢查互換後是否合法
                if (this.checkSwapValidity(d, underPerson.obj, 'OFF', shiftOver, true) &&
                    this.checkSwapValidity(d, overPerson.obj, shiftOver, 'OFF', true)) {
                    
                    this.updateShift(dateStr, overPerson.id, shiftOver, 'OFF');
                    this.updateShift(dateStr, underPerson.id, 'OFF', shiftOver);
                    return true;
                }
            }
        }
        
        return false;
    }

    // 🔥 新增：計算 OFF 調整的優先分數
    calculateOffAdjustmentScore(uid, day) {
        const dateStr = this.getDateStr(day);
        let score = 0;
        
        // 1. 檢查前一天
        if (day > 1) {
            const prevShift = this.getShiftByDate(this.getDateStr(day - 1), uid);
            if (prevShift === 'OFF' || prevShift === 'REQ_OFF') {
                score += 10;  // 可以連休
            }
        }
        
        // 2. 檢查後一天
        if (day < this.daysInMonth) {
            const nextShift = this.getShiftByDate(this.getDateStr(day + 1), uid);
            if (nextShift === 'OFF' || nextShift === 'REQ_OFF') {
                score += 10;  // 可以連休
            }
        }
        
        // 3. 檢查是否靠近 REQ_OFF
        for (let offset = -2; offset <= 2; offset++) {
            if (offset === 0) continue;
            const checkDay = day + offset;
            if (checkDay >= 1 && checkDay <= this.daysInMonth) {
                if (this.isPreRequestOff(uid, this.getDateStr(checkDay))) {
                    score += (3 - Math.abs(offset));  // 越近分數越高
                }
            }
        }
        
        // 4. 避免孤兒班（上1休1上1）
        if (day > 1 && day < this.daysInMonth) {
            const prevShift = this.getShiftByDate(this.getDateStr(day - 1), uid);
            const nextShift = this.getShiftByDate(this.getDateStr(day + 1), uid);
            
            if (prevShift !== 'OFF' && prevShift !== 'REQ_OFF' && 
                nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
                score += 5;  // 這天改成 OFF 可以避免連續工作
            }
        }
        
        return score;
    }

    calculateDailyWorkPressure(currentDay) {
        this.staffList.forEach(s => {
            const stats = this.staffStats[s.id];
            const workedShifts = this.getTotalShiftsUpTo(s.id, currentDay - 1);
            const remainingQuota = stats.workQuota - workedShifts;
            
            let remainingAvailableDays = 0;
            const params = s.schedulingParams || {};
            for(let d = currentDay; d <= this.daysInMonth; d++) {
                if (params[this.getDateStr(d)] !== 'REQ_OFF') remainingAvailableDays++;
            }

            const basePressure = remainingAvailableDays > 0 ? (remainingQuota / remainingAvailableDays) : 999;
            stats.workedShifts = workedShifts;
            stats.workPressure = basePressure;
            
            if (stats.targetShift) {
                const workedTarget = this.countSpecificShiftsUpTo(s.id, currentDay - 1, stats.targetShift);
                const remainingTarget = stats.targetQuota - workedTarget;
                const targetPressure = remainingAvailableDays > 0 ? (remainingTarget / remainingAvailableDays) : 999;
                
                stats.targetShiftPressure = targetPressure;
                stats.workedTargetShifts = workedTarget;
                
                const targetRatio = stats.targetQuota > 0 ? (workedTarget / stats.targetQuota) : 0;
                const totalRatio = stats.workQuota > 0 ? (workedShifts / stats.workQuota) : 0;
                
                if (targetRatio < totalRatio - 0.1) stats.workPressure += 0.5;
            } else {
                stats.targetShiftPressure = 0;
                stats.workedTargetShifts = 0;
            }
        });
    }

    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;
        if (gap <= 0) return;

        // 🔥 修改：包班人員排班時，考慮轉換夜班
        const bundleStaff = this.bundleStaff.filter(s => {
            const currentBundle = s.packageType || s.prefs?.bundleShift;
            
            // 檢查是否需要轉換夜班（只在月初 10 天內檢查）
            if (day <= 10 && this.bundleTransitions.has(s.id)) {
                const transition = this.bundleTransitions.get(s.id);
                
                if (!transition.hasTransitioned) {
                    // 尚未轉換，檢查是否已經有 OFF
                    if (this.hasOffBetween(s.id, 1, day - 1)) {
                        // 已經有 OFF，可以轉換了
                        transition.hasTransitioned = true;
                        this.bundleTransitions.set(s.id, transition);
                        console.log(`🔄 ${s.id} 在第 ${day} 天完成夜班轉換：${transition.fromShift} → ${transition.toShift}`);
                        return currentBundle === shiftCode;
                    } else {
                        // 尚未有 OFF，繼續使用上月夜班
                        return transition.fromShift === shiftCode;
                    }
                }
            }
            
            return currentBundle === shiftCode;
        });
        
        if (bundleStaff.length > 0) {
            const bundleTarget = Math.ceil(neededCount * 0.9);
            const bundleGap = Math.min(gap, bundleTarget);
            let bundleCandidates = bundleStaff.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
            this.sortCandidatesByPressure(bundleCandidates, dateStr, shiftCode);

            let filled = 0;
            for (const staff of bundleCandidates) {
                if (filled >= bundleGap || gap <= 0) break;
                const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
                if (scoreInfo.totalScore < -50000) continue;
                if (this.assignIfValid(day, staff, shiftCode)) {
                    gap--;
                    filled++;
                }
            }
        }

        if (gap > 0) {
            let prefCandidates = this.nonBundleStaff.filter(s => {
                if (this.getShiftByDate(dateStr, s.id) !== 'OFF') return false;
                const prefs = s.prefs || {};
                return (prefs.favShift === shiftCode || prefs.favShift2 === shiftCode || prefs.favShift3 === shiftCode);
            });
            this.sortCandidatesByPressure(prefCandidates, dateStr, shiftCode);
            for (const staff of prefCandidates) {
                if (gap <= 0) break;
                const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
                if (scoreInfo.totalScore < -50000) continue;
                if (this.assignIfValid(day, staff, shiftCode)) gap--;
                else if (this.tryResolveConflict(day, staff, shiftCode)) {
                    if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }
        }

        if (gap > 0) {
            let allCandidates = this.staffList.filter(s => {
                if (this.getShiftByDate(dateStr, s.id) !== 'OFF') return false;
                const stats = this.staffStats[s.id];
                if (stats.targetShift && stats.targetShift !== shiftCode) {
                    const ratio = stats.targetQuota > 0 ? (stats.workedTargetShifts / stats.targetQuota) : 0;
                    const totalRatio = stats.workQuota > 0 ? (stats.workedShifts / stats.workQuota) : 0;
                    return ratio > totalRatio + 0.05;
                }
                return true;
            });
            this.sortCandidatesByPressure(allCandidates, dateStr, shiftCode);
            for (const staff of allCandidates) {
                if (gap <= 0) break;
                const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
                if (scoreInfo.totalScore < -50000) continue;
                if (this.assignIfValid(day, staff, shiftCode)) gap--;
                else if (this.tryResolveConflict(day, staff, shiftCode)) {
                    if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }
        }
        
        if (gap > 0 && this.backtrackDepth > 0) {
            const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
            gap -= recovered;
        }
        
        // 🔥 新增：如果還有缺額，嘗試從低優先班別借調
        if (gap > 0) {
            const borrowRecovered = this.borrowFromLowerPriority(day, shiftCode, gap);
            gap -= borrowRecovered;
        }
        
        // 最終缺額警告（含優先順序資訊）
        if (gap > 0) {
            const priorityOrder = this.rules.policy?.shortageHandling?.priorityOrder || [];
            const priorityIndex = priorityOrder.indexOf(shiftCode);
            
            let priorityLabel = '';
            if (priorityIndex === 0) {
                priorityLabel = '（⚠️ 最高優先班別仍有缺額！）';
            } else if (priorityIndex === priorityOrder.length - 1) {
                priorityLabel = '（可接受缺額）';
            } else if (priorityIndex > 0) {
                priorityLabel = `（優先順序: ${priorityIndex + 1}）`;
            }
            
            console.warn(`[缺口] ${dateStr} ${shiftCode} 尚缺 ${gap} ${priorityLabel}`);
        }
    }

    // 🔥 新增：從低優先班別借調人力（完全基於單位班別設定）
    borrowFromLowerPriority(day, targetShift, gap) {
        const dateStr = this.getDateStr(day);
        
        // 從規則中取得優先順序設定
        const priorityOrder = this.rules.policy?.shortageHandling?.priorityOrder || [];
        
        // 如果沒有設定優先順序，不進行借調
        if (priorityOrder.length === 0) {
            return 0;
        }
        
        const currentIndex = priorityOrder.indexOf(targetShift);
        
        // 如果目標班別不在優先清單中，或已經是最低優先，無法借調
        if (currentIndex === -1 || currentIndex === priorityOrder.length - 1) {
            return 0;
        }
        
        let recovered = 0;
        console.log(`🔄 嘗試為 ${targetShift} 班借調人力（缺 ${gap} 人）...`);
        
        // 從優先順序更低的班別開始借調（從後往前）
        for (let i = priorityOrder.length - 1; i > currentIndex && gap > 0; i--) {
            const sourceShift = priorityOrder[i];
            const sourceUids = this.schedule[dateStr][sourceShift] || [];
            
            // 跳過空班別
            if (sourceUids.length === 0) continue;
            
            // 嘗試將人從 sourceShift 移到 targetShift
            for (const uid of [...sourceUids]) {
                if (gap <= 0) break;
                
                const staff = this.staffList.find(s => s.id === uid);
                if (!staff) continue;
                
                // 檢查是否是預排的（不能調整）
                if (this.isPreRequestOff(uid, dateStr)) continue;
                
                const params = staff.schedulingParams || {};
                if (params[dateStr] === sourceShift) continue; // 使用者指定的班別不調整
                
                // 檢查是否可以改排到目標班別
                if (this.isValidAssignment(staff, dateStr, targetShift)) {
                    this.updateShift(dateStr, uid, sourceShift, targetShift);
                    gap--;
                    recovered++;
                    console.log(`  ✓ 從 ${sourceShift} 調 ${staff.name || uid} 到 ${targetShift}`);
                }
            }
            
            if (recovered > 0) {
                console.log(`  → 從 ${sourceShift} 成功調整 ${recovered} 人`);
            }
        }
        
        if (recovered === 0) {
            console.log(`  ✗ 無法從低優先班別借調人力`);
        }
        
        return recovered;
    }

    // 🔥 新增：優先安排假日休假
    prioritizeWeekendOffs() {
        console.log('📅 優先安排假日休假...');
        
        let weekendOffCount = 0;
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const date = new Date(this.year, this.month - 1, d);
            const dayOfWeek = date.getDay();
            
            // 0=週日, 6=週六
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                const dateStr = this.getDateStr(d);
                const dayName = dayOfWeek === 0 ? '週日' : '週六';
                
                // 統計目前有多少人休假
                let currentOffCount = 0;
                this.staffList.forEach(staff => {
                    const shift = this.getShiftByDate(dateStr, staff.id);
                    if (shift === 'OFF' || shift === 'REQ_OFF') {
                        currentOffCount++;
                    }
                });
                
                console.log(`  第 ${d} 天（${dayName}）：目前 ${currentOffCount}/${this.staffList.length} 人休假`);
                weekendOffCount += currentOffCount;
            }
        }
        
        console.log(`✅ 假日總休假人次：${weekendOffCount}`);
    }


    // 🔥 改善版：效能優化的平衡處理
    postProcessBalancing(limitDay, isFinal = false) {
        const rounds = isFinal ? 500 : 50; 
        const isFairOff = this.rules.fairness?.fairOff !== false;
        if (isFairOff) this.forceBalanceGlobalOffs(limitDay, rounds);
        const isFairNight = this.rules.fairness?.fairNight !== false;
        if (isFairNight) this.balanceNightShiftsByGroup(limitDay, rounds);
    }

    // 🔥 改善版：提早終止與無進展檢測
    forceBalanceGlobalOffs(limitDay, rounds) {
        for (let r = 0; r < rounds; r++) {
            const stats = this.staffList.map(s => {
                let offCount = 0;
                for(let d = 1; d <= limitDay; d++) {
                    const shift = this.getShiftByDate(this.getDateStr(d), s.id);
                    if (shift === 'OFF' || shift === 'REQ_OFF') offCount++;
                }
                return { id: s.id, count: offCount, obj: s };
            }).sort((a, b) => a.count - b.count);

            const poorPerson = stats[0];
            const richPerson = stats[stats.length - 1];
            const currentGap = richPerson.count - poorPerson.count;
            
            // 🔥 提早終止條件
            if (currentGap <= this.tolerance) {
                console.log(`✅ OFF 平衡已達標（差距 ${currentGap} ≤ ${this.tolerance}），於第 ${r+1} 輪終止`);
                break;
            }
            
            // 🔥 無進展檢測（每 10 輪檢查一次）
            if (r > 0 && r % 10 === 0) {
                if (currentGap === this.lastBalanceGap) {
                    console.warn(`⚠️ OFF 平衡無進展（停滯於差距 ${currentGap}），終止於第 ${r+1} 輪`);
                    break;
                }
                this.lastBalanceGap = currentGap;
            }

            let swapped = false;
            const days = Array.from({length: limitDay}, (_, i) => i + 1);
            this.shuffleArray(days);

            for (const d of days) {
                const dateStr = this.getDateStr(d);
                if (this.isPreRequestOff(poorPerson.id, dateStr) || this.isPreRequestOff(richPerson.id, dateStr)) continue;
                const shiftPoor = this.getShiftByDate(dateStr, poorPerson.id);
                const shiftRich = this.getShiftByDate(dateStr, richPerson.id);

                if (shiftPoor !== 'OFF' && shiftPoor !== 'REQ_OFF' && shiftRich === 'OFF') {
                    if (this.checkSwapValidity(d, richPerson.obj, 'OFF', shiftPoor, true)) {
                        this.updateShift(dateStr, richPerson.id, 'OFF', shiftPoor);
                        this.updateShift(dateStr, poorPerson.id, shiftPoor, 'OFF');
                        swapped = true;
                        break;
                    }
                }
            }
            
            // 🔥 如果本輪無法交換，也記錄以便下次檢測無進展
            if (!swapped && r % 10 === 9) {
                this.lastBalanceGap = currentGap;
            }
        }
    }

    balanceNightShiftsByGroup(limitDay, rounds) {
        const nightShifts = this.shiftCodes.filter(code => (super.isNightShift ? super.isNightShift(code) : ['N','E'].includes(code)));
        const groups = new Map();
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (bundleShift && nightShifts.includes(bundleShift)) {
                const key = `bundle_${bundleShift}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(staff);
            } else if (!bundleShift) {
                const key = 'non_bundle_night';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(staff);
            }
        });
        groups.forEach((staffGroup, groupKey) => {
            if (groupKey.startsWith('bundle_')) {
                const targetShift = groupKey.replace('bundle_', '');
                this.balanceShiftTypeForGroup(targetShift, staffGroup, limitDay, rounds);
            } else {
                this.balanceTotalNightShiftsForGroup(nightShifts, staffGroup, limitDay, rounds);
            }
        });
    }

    // 🔥 修改：夜班平衡改為以實際平均為目標
    balanceShiftTypeForGroup(targetShift, staffGroup, limitDay, rounds) {
        const tolerance = this.tolerance || 2;
        const isLocked = (d, uid) => {
            const dateStr = this.getDateStr(d);
            const s = this.staffList.find(x => x.id === uid);
            return s?.schedulingParams?.[dateStr] !== undefined;
        };
        
        for (let r = 0; r < rounds; r++) {
            const stats = staffGroup.map(s => {
                let count = 0;
                for(let d = 1; d <= limitDay; d++) {
                    if(this.getShiftByDate(this.getDateStr(d), s.id) === targetShift) count++;
                }
                return { id: s.id, count, obj: s };
            });
            
            if (stats.length === 0) break;
            
            // 🔥 計算實際平均值
            const totalCount = stats.reduce((sum, s) => sum + s.count, 0);
            const avgCount = totalCount / stats.length;
            
            // 找出偏離平均最多的人
            const aboveAvg = stats.filter(s => s.count > avgCount + tolerance).sort((a, b) => b.count - a.count);
            const belowAvg = stats.filter(s => s.count < avgCount - tolerance).sort((a, b) => a.count - b.count);
            
            if (aboveAvg.length === 0 || belowAvg.length === 0) {
                console.log(`✅ ${targetShift} 班平衡已達標（平均${avgCount.toFixed(1)}班，容許±${tolerance}）`);
                break;
            }
            
            const maxPerson = aboveAvg[0];
            const minPerson = belowAvg[0];
            
            console.log(`  調整 ${targetShift}: ${maxPerson.id}(${maxPerson.count}) ↔ ${minPerson.id}(${minPerson.count}), 平均=${avgCount.toFixed(1)}`);
            
            this.attemptSwap(maxPerson, minPerson, targetShift, null, limitDay, isLocked);
        }
    }

    balanceTotalNightShiftsForGroup(nightShifts, staffGroup, limitDay, rounds) {
        const tolerance = this.tolerance || 2;
        const isLocked = (d, uid) => {
            const dateStr = this.getDateStr(d);
            const s = this.staffList.find(x => x.id === uid);
            return s?.schedulingParams?.[dateStr] !== undefined;
        };
        for (let r = 0; r < rounds; r++) {
            const stats = staffGroup.map(s => {
                let count = 0;
                for(let d = 1; d <= limitDay; d++) {
                    const shift = this.getShiftByDate(this.getDateStr(d), s.id);
                    if(nightShifts.includes(shift)) count++;
                }
                return { id: s.id, count, obj: s };
            }).sort((a, b) => b.count - a.count);
            if (stats.length === 0 || stats[stats.length-1].count - stats[0].count <= tolerance) break;
            const maxPerson = stats[stats.length - 1];
            const minPerson = stats[0];
            this.attemptSwap(maxPerson, minPerson, null, nightShifts, limitDay, isLocked);
        }
    }
    
    attemptSwap(maxObj, minObj, targetShift, validShifts, limitDay, isLocked) {
        let swapped = false;
        const days = Array.from({length: limitDay}, (_, i) => i + 1);
        this.shuffleArray(days);
        for (const d of days) {
            if (isLocked(d, maxObj.id) || isLocked(d, minObj.id)) continue;
            const dateStr = this.getDateStr(d);
            const shiftMax = this.getShiftByDate(dateStr, maxObj.id);
            const shiftMin = this.getShiftByDate(dateStr, minObj.id);
            const maxHas = targetShift ? shiftMax === targetShift : validShifts.includes(shiftMax);
            const minHas = targetShift ? shiftMin === targetShift : validShifts.includes(shiftMin);
            if (maxHas && !minHas) {
                if (this.checkSwapValidity(d, maxObj.obj, shiftMax, shiftMin) &&
                    this.checkSwapValidity(d, minObj.obj, shiftMin, shiftMax)) {
                    this.updateShift(dateStr, maxObj.id, shiftMax, shiftMin);
                    this.updateShift(dateStr, minObj.id, shiftMin, shiftMax);
                    swapped = true;
                    break;
                }
            }
        }
    }

    applyPreSchedules() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const req = params[dateStr];
                if (req === 'REQ_OFF') this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                else if (req && req !== 'OFF' && !req.startsWith('!')) this.updateShift(dateStr, staff.id, 'OFF', req);
            }
        });
    }

    checkSwapValidity(day, staff, currentShift, newShift, looseMode = false) {
        const dateStr = this.getDateStr(day);
        if (!this.isValidAssignment(staff, dateStr, newShift)) return false;
        const scoreInfo = this.calculateScoreInfo(staff, dateStr, newShift);
        if (looseMode) {
            const params = staff.schedulingParams || {};
            if (params[dateStr] === '!' + newShift) return false;
            if (scoreInfo.totalScore < -900000) return false;
            return true;
        } else {
            return scoreInfo.totalScore > -50000;
        }
    }

    getOptimalShiftOrder(dailyNeeds) {
        const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
        const bundleWeights = new Map();
        shiftOrder.forEach(code => {
            const count = this.bundleStaff.filter(s => (s.packageType || s.prefs?.bundleShift) === code).length;
            bundleWeights.set(code, count);
        });
        shiftOrder.sort((a, b) => {
            const wA = bundleWeights.get(a) || 0;
            const wB = bundleWeights.get(b) || 0;
            if (wA !== wB) return wB - wA;
            return (dailyNeeds[b] || 0) - (dailyNeeds[a] || 0);
        });
        return shiftOrder;
    }

    sortCandidatesByPressure(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates);
        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];
            let pA = statsA.workPressure;
            let pB = statsB.workPressure;
            if (statsA.targetShift === shiftCode) pA = Math.max(pA, statsA.targetShiftPressure);
            if (statsB.targetShift === shiftCode) pB = Math.max(pB, statsB.targetShiftPressure);
            const diff = pB - pA;
            if (Math.abs(diff) > 0.05) return diff > 0 ? 1 : -1;
            const sA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const sB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            return sB - sA;
        });
    }

    optimizeDailyAllocation(day) {
        const dateStr = this.getDateStr(day);
        const offStaffs = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF' && !this.isPreRequestOff(s.id, dateStr));
        offStaffs.sort((a, b) => {
            const sA = this.staffStats[a.id];
            const sB = this.staffStats[b.id];
            return Math.max(sB.workPressure, sB.targetShiftPressure||0) - Math.max(sA.workPressure, sA.targetShiftPressure||0);
        });
        for (const highP of offStaffs) {
            const stats = this.staffStats[highP.id];
            const pressure = Math.max(stats.workPressure, stats.targetShiftPressure || 0);
            if (pressure < 0.7) continue;
            const targets = [];
            if (stats.targetShift && this.calculateScoreInfo(highP, dateStr, stats.targetShift).totalScore > -1000) targets.push(stats.targetShift);
            this.shiftCodes.forEach(c => {
                if (c !== 'OFF' && c !== 'REQ_OFF' && c !== stats.targetShift) {
                    if (this.calculateScoreInfo(highP, dateStr, c).totalScore > -1000) targets.push(c);
                }
            });
            for (const code of targets) {
                const uids = this.schedule[dateStr][code] || [];
                let bestTarget = null;
                let maxDiff = -999;
                for (const uid of uids) {
                    const lowP = this.staffList.find(s => s.id === uid);
                    if (!lowP || this.isPreRequestOff(lowP.id, dateStr)) continue;
                    const lowStats = this.staffStats[lowP.id];
                    const pLow = Math.max(lowStats.workPressure, lowStats.targetShiftPressure||0);
                    let diff = pressure - pLow;
                    if (stats.targetShift === code) diff += 0.3;
                    if (lowStats.targetShift === code) diff -= 0.3;
                    if (diff > 0.2 && diff > maxDiff) {
                        if (this.checkSwapValidity(day, highP, 'OFF', code) && this.checkSwapValidity(day, lowP, code, 'OFF')) {
                            bestTarget = lowP;
                            maxDiff = diff;
                        }
                    }
                }
                if (bestTarget) {
                    this.updateShift(dateStr, bestTarget.id, code, 'OFF');
                    this.updateShift(dateStr, highP.id, 'OFF', code);
                    break;
                }
            }
        }
    }

    calculateScoreInfo(staff, dateStr, shiftCode) {
        let score = 0;
        let details = []; // ✅ 修正：新增此行宣告，避免 ReferenceError
        const policy = this.rules.policy || {};
        const pressure = this.staffStats[staff.id]?.workPressure || 0;
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;
        score += pressure * 1000;
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const currentDayIdx = new Date(dateStr).getDate();
        let prevShift = 'OFF';
        if (currentDayIdx > 1) {
            const prevDateStr = this.getDateStr(currentDayIdx - 1);
            prevShift = this.getShiftByDate(prevDateStr, staff.id);
        }
        if (shiftCode !== 'OFF') { 
            if (prevShift !== 'OFF' && prevShift !== 'REQ_OFF') {
                if (consDays < this.minCons) score += 5000; 
                else if (consDays < (policy.maxConsDays || 6)) score += 500; 
                else score -= 2000; 
            }
        }
        const prefs = staff.prefs || {};
        const bundleShift = staff.packageType || prefs.bundleShift;
        let isPreferred = false;
        if (bundleShift === shiftCode) {
            score += 50000; 
            isPreferred = true;
            const stats = this.staffStats[staff.id];
            if (stats.targetQuota > 0 && (stats.workedTargetShifts / stats.targetQuota) < 0.8) score += 10000;
        }
        if (prefs.favShift === shiftCode) { score += 3000; isPreferred = true; }
        if (prefs.favShift2 === shiftCode) { score += 1000; isPreferred = true; }
        if (prefs.favShift3 === shiftCode) { score += 200; isPreferred = true; }
        if ((prefs.favShift || bundleShift) && !isPreferred) score -= 999999; 
        if (staff.schedulingParams?.[dateStr] === '!' + shiftCode) score -= 999999;

    // 🔥 新增：孤兒休懲罰與連休獎勵
    if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') {
        const day = parseInt(dateStr.split('-')[2]);
        const prevDay = day - 1;
        const nextDay = day + 1;
        
        const prevShift = prevDay >= 1 ? this.getShiftByDate(this.getDateStr(prevDay), staff.id) : null;
        const nextShift = nextDay <= this.daysInMonth ? this.getShiftByDate(this.getDateStr(nextDay), staff.id) : null;
        
        const prevIsWork = prevShift && prevShift !== 'OFF' && prevShift !== 'REQ_OFF';
        const nextIsWork = nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF';
        const prevIsOff = prevShift === 'OFF' || prevShift === 'REQ_OFF';
        const nextIsOff = nextShift === 'OFF' || nextShift === 'REQ_OFF';
        
        // 孤兒休（前後都是工作日）- 強烈懲罰
        if (prevIsWork && nextIsWork) {
            score -= 50;
            details.push(`孤兒休懲罰 -50`);
        }
        
        // 連休獎勵（至少一邊是 OFF）
        if (prevIsOff || nextIsOff) {
            score += 25;
            details.push(`連休獎勵 +25`);
            
            // 兩邊都是 OFF（三連休）- 額外獎勵
            if (prevIsOff && nextIsOff) {
                score += 15;
                details.push(`三連休額外獎勵 +15`);
            }
        }
    }
    
    // 🔥 新增：假日權重
    const day = parseInt(dateStr.split('-')[2]);
    const date = new Date(this.year, this.month - 1, day);
    const dayOfWeek = date.getDay();
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    
    if (isWeekend) {
        if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') {
            score += 15;
            details.push(`假日休假獎勵 +15`);
        } else {
            score -= 5;
            details.push(`假日上班小懲罰 -5`);
        }
    }
    
            return { totalScore: score, isPreferred: isPreferred };
    }

    classifyStaffByBundle() {
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (bundleShift) this.bundleStaff.push(staff);
            else this.nonBundleStaff.push(staff);
        });
    }

    resolveShortageWithBacktrack(currentDay, targetShift, gap) {
        let recovered = 0;
        for (let d = currentDay - 1; d >= Math.max(1, currentDay - this.backtrackDepth); d--) {
            if (gap <= 0) break;
            const pastDateStr = this.getDateStr(d);
            const currentDateStr = this.getDateStr(currentDay);
            const candidates = this.staffList.filter(s => this.getShiftByDate(currentDateStr, s.id) === 'OFF' && !this.isPreRequestOff(s.id, currentDateStr));
            this.sortCandidatesByPressure(candidates, currentDateStr, targetShift);
            for (const staff of candidates) {
                if (gap <= 0) break;
                if (this.attemptBacktrackForStaff(staff, currentDay, targetShift)) {
                    this.updateShift(currentDateStr, staff.id, 'OFF', targetShift);
                    gap--;
                    recovered++;
                }
            }
        }
        return recovered;
    }

    attemptBacktrackForStaff(staff, currentDay, targetShift) {
        const currentDateStr = this.getDateStr(currentDay);
        const scoreInfo = this.calculateScoreInfo(staff, currentDateStr, targetShift);
        if (scoreInfo.totalScore < -50000) return false;
        for (let d = currentDay - 1; d >= Math.max(1, currentDay - this.backtrackDepth); d--) {
            const pastDateStr = this.getDateStr(d);
            const pastShift = this.getShiftByDate(pastDateStr, staff.id);
            if (pastShift !== 'OFF' && pastShift !== 'REQ_OFF' && !this.isPreRequestOff(staff.id, pastDateStr)) {
                this.updateShift(pastDateStr, staff.id, pastShift, 'OFF');
                if (this.isValidAssignment(staff, currentDateStr, targetShift) && this.checkGroupMaxLimit(currentDay, staff, targetShift)) return true;
                else this.updateShift(pastDateStr, staff.id, 'OFF', pastShift);
            }
        }
        return false;
    }

    assignIfValid(day, staff, shiftCode) {
        const dateStr = this.getDateStr(day);
        const isValid = this.isValidAssignment(staff, dateStr, shiftCode);
        const isGroupValid = this.checkGroupMaxLimit(day, staff, shiftCode);
        if (isValid && isGroupValid) {
            this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
            return true;
        }
        return false;
    }

    isValidAssignment(staff, dateStr, shiftCode) {
        // 🔥 核心修正：不應直接 return true，必須確保 checkRestPeriod 始終通過
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        
        // 如果基礎校驗通過，直接返回 true
        if (baseValid) return true;
        
        // 如果基礎校驗失敗（通常是因為連續上班天數限制），檢查是否為長假人員特例
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        
        if (consDays + 1 > normalLimit) {
            const stats = this.staffStats[staff.id];
            if (stats?.isLongVacationer) {
                const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
                if (consDays + 1 <= longVacLimit) {
                    // 長假人員允許較長的連續上班，但仍須檢查休息時間
                    const currentDayIndex = new Date(dateStr).getDate();
                    let prevShift = 'OFF';
                    if (currentDayIndex > 1) {
                         const prevDateStr = this.getDateStr(currentDayIndex - 1);
                         prevShift = this.getShiftByDate(prevDateStr, staff.id);
                    } else if (currentDayIndex === 1) {
                        prevShift = this.lastMonthData?.[staff.id]?.lastShift || 'OFF';
                    }
                    
                    // 即使放寬連續天數，也絕不能放寬休息時間
                    if (!this.checkRestPeriod(prevShift, shiftCode)) return false; 
                    return true;
                }
            }
        }
        return false;
    }

    tryResolveConflict(day, staff, targetShift) {
        if (day === 1) return false;
        const dateStr = this.getDateStr(day);
        const prevDateStr = this.getDateStr(day - 1);
        const prevShift = this.getShiftByDate(prevDateStr, staff.id);
        if (this.checkRestPeriod(prevShift, targetShift)) return false; 
        let swapCandidates = this.staffList.filter(s => s.id !== staff.id && this.getShiftByDate(prevDateStr, s.id) === 'OFF' && !this.isPreRequestOff(s.id, prevDateStr));
        this.shuffleArray(swapCandidates);
        for (const candidate of swapCandidates) {
            if (this.isValidAssignment(candidate, prevDateStr, prevShift)) {
                this.updateShift(prevDateStr, candidate.id, 'OFF', prevShift);
                this.updateShift(prevDateStr, staff.id, prevShift, 'OFF');
                return true; 
            }
        }
        return false;
    }
    
    getDailyNeeds(day) {
        const dateStr = this.getDateStr(day);
        const date = new Date(this.year, this.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; 
        const needs = {};
        this.shiftCodes.forEach(code => {
            if(code === 'OFF' || code === 'REQ_OFF') return;
            if (this.rules.specificNeeds?.[dateStr]?.[code] !== undefined) needs[code] = this.rules.specificNeeds[dateStr][code];
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

    countSpecificShiftsUpTo(uid, dayLimit, targetShift) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            if (this.getShiftByDate(this.getDateStr(d), uid) === targetShift) count++;
        }
        return count;
    }

    getTotalShiftsUpTo(uid, dayLimit) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            const shift = this.getShiftByDate(this.getDateStr(d), uid);
            if (shift !== 'OFF' && shift !== 'REQ_OFF') count++;
        }
        return count;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // 🔥 關鍵修正：確保 UID 一致性與 Assignments 完整輸出
    formatResult() { 
        // 1. 建立標準矩陣 (給後台看)
        const res = {}; 
        for(let d = 1; d <= this.daysInMonth; d++){ 
            const ds = this.getDateStr(d); 
            res[ds] = {}; 
            this.shiftCodes.forEach(code => { 
                if (code === 'OFF') return; 
                const ids = this.schedule[ds][code] || []; 
                if(ids.length > 0) res[ds][code] = ids; 
            }); 
        } 
        
        // 2. 🔥 建立 Assignments 物件 (給前台看) - 確保 UID 一致性與資料完整性
        const assignments = {};
        this.staffList.forEach(staff => { 
            if (!staff.id) return;
            // 使用 trim() 確保 key 乾淨一致
            const safeUid = staff.id.trim();
            assignments[safeUid] = { preferences: staff.prefs || {} }; 
        });
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.staffList.forEach(staff => {
                if (!staff.id) return;
                const safeUid = staff.id.trim();
                const shift = this.getShiftByDate(dateStr, staff.id);
                // 🔥 確保所有班別都寫入，包括 OFF，讓前端明確知道狀態
                if (assignments[safeUid]) {
                    assignments[safeUid][`current_${d}`] = shift || 'OFF';
                }
            });
        }
        
        res.assignments = assignments;
        
        console.log(`✅ 排班結果已格式化：${Object.keys(assignments).length} 位員工，${this.daysInMonth} 天`);
        return res; 
    }
}
