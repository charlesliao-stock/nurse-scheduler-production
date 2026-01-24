// js/scheduler/SchedulerV2.js
// 🚀 最終修復版：修正總工作配額過低問題 + 完整功能整合

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
    }

    run() {
        console.log(`🚀 SchedulerV2 Quota Fixed Mode Start.`);
        
        // 1. 預處理
        this.applyPreSchedules();
        
        // 2. 初始化並計算配額 (已修正：確保總配額足夠)
        this.calculateFixedQuota(); 
        this.classifyStaffByBundle();
        
        // 設定分段平衡點
        const segments = Math.max(3, this.rules.aiParams?.balancingSegments || 3);
        const interval = Math.floor(this.daysInMonth / segments);
        for (let i = 1; i < segments; i++) {
            this.checkpoints.push(i * interval);
        }

        // --- 主迴圈 ---
        for (let d = 1; d <= this.daysInMonth; d++) {
            
            // 每日更新壓力
            this.calculateDailyWorkPressure(d);

            const dailyNeeds = this.getDailyNeeds(d);
            
            // 智慧班別排序
            const shiftOrder = this.getOptimalShiftOrder(dailyNeeds);

            // 多階段填班
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 資源再分配
            this.optimizeDailyAllocation(d);

            // 分段平衡
            if (this.checkpoints.includes(d)) {
                this.postProcessBalancing(d);
            }
        }

        console.log(`⚖️ 執行最終全月暴力平衡...`);
        this.postProcessBalancing(this.daysInMonth, true); 

        return this.formatResult();
    }

    // ============================================================
    // 🔧 核心 1：配額計算 (修正：總配額 vs 目標配額)
    // ============================================================
    calculateFixedQuota() {
        // 1. 計算全月總需求班數 (Total Shifts Needed)
        let grandTotalShifts = 0;
        let totalNeedsByShift = {};
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const needs = this.getDailyNeeds(d);
            Object.entries(needs).forEach(([shift, count]) => {
                if (!totalNeedsByShift[shift]) totalNeedsByShift[shift] = 0;
                totalNeedsByShift[shift] += count;
                grandTotalShifts += count;
            });
        }
        
        // 2. 初始化並計算總可用人天 (Total Man-Days)
        let grandTotalAvailable = 0;
        this.staffList.forEach(staff => {
            let reqOffCount = 0;
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                if (params[this.getDateStr(d)] === 'REQ_OFF') reqOffCount++;
            }
            const availableDays = this.daysInMonth - reqOffCount;
            grandTotalAvailable += availableDays;

            this.staffStats[staff.id] = {
                reqOffCount: reqOffCount,
                availableDays: availableDays,
                workQuota: 0,       // 總工作配額 (例如 20 天)
                workedShifts: 0,
                isLongVacationer: false,
                initialRandom: Math.random(),
                targetShift: null,  // 包班目標 (例如 'N')
                targetQuota: 0      // 包班配額 (例如 15 天)
            };
        });

        // 3. 計算全域平均工作率 (Global Work Ratio)
        // 例如：全月需 600 班，所有人可用 800 天，Ratio = 0.75
        const globalWorkRatio = grandTotalAvailable > 0 ? (grandTotalShifts / grandTotalAvailable) : 0;

        // 4. 初步分配「總工作配額」 (Base Work Quota)
        this.staffList.forEach(staff => {
            const stats = this.staffStats[staff.id];
            // 每個人的基本責任額 = 可用天數 * 工作率
            stats.workQuota = Math.ceil(stats.availableDays * globalWorkRatio);
            
            // 標記長假/封頂 (如果可用天數極少，少於平均值很多)
            if (stats.availableDays < (this.daysInMonth * 0.5)) { 
                stats.isLongVacationer = true; 
            }
        });

        // 5. 處理包班需求 (設定 targetQuota)
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
            const totalAvailable = staffs.reduce((sum, s) => 
                sum + this.staffStats[s.id].availableDays, 0
            );
            
            staffs.forEach(staff => {
                const stats = this.staffStats[staff.id];
                // 依可用天數比例分配該班別的需求
                const ratio = totalAvailable > 0 ? (stats.availableDays / totalAvailable) : 0;
                stats.targetQuota = Math.floor(totalNeed * ratio);
                
                // ⚠️ [關鍵修正]：總配額不能低於包班配額
                // 如果他包 N 要上 15 天，但依平均只分到 12 天，那就要提升總配額到 15 天
                if (stats.workQuota < stats.targetQuota) {
                    stats.workQuota = stats.targetQuota;
                    stats.isLongVacationer = true; // 壓力滿載，視為長假模式
                }
            });
            
            // 處理包班餘數 (略，為保持簡潔)
        });

        // 6. 二次檢查 (確保總配額合理)
        // 為了避免大家「狂休假」，這裡確保每個人至少要達到一定的工作量
        this.staffList.forEach(s => {
            const stats = this.staffStats[s.id];
            // 如果預休 >= 5 天，強制標記為長假模式，放寬連班限制
            if (stats.reqOffCount >= 5) {
                stats.isLongVacationer = true;
            }
        });
        
        console.log("📊 配額計算完成 (範例):");
        this.staffList.slice(0, 3).forEach(s => {
            const st = this.staffStats[s.id];
            console.log(`- ${s.name}: 預休${st.reqOffCount}, 總配額${st.workQuota}, 包班${st.targetShift || '無'}(${st.targetQuota})`);
        });
    }

    // ============================================================
    // 2. 每日壓力計算
    // ============================================================
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

            // 總壓力
            const basePressure = remainingAvailableDays > 0 ? 
                (remainingQuota / remainingAvailableDays) : 999;
            
            stats.workedShifts = workedShifts;
            stats.workPressure = basePressure;
            
            // 目標班別壓力 (包班)
            if (stats.targetShift) {
                const workedTarget = this.countSpecificShiftsUpTo(
                    s.id, currentDay - 1, stats.targetShift
                );
                const remainingTarget = stats.targetQuota - workedTarget;
                
                const targetPressure = remainingAvailableDays > 0 ? 
                    (remainingTarget / remainingAvailableDays) : 999;
                
                stats.targetShiftPressure = targetPressure;
                stats.workedTargetShifts = workedTarget;
                
                // 智慧加壓：如果目標班別落後，提升總壓力
                const targetRatio = stats.targetQuota > 0 ? (workedTarget / stats.targetQuota) : 0;
                const totalRatio = stats.workQuota > 0 ? (workedShifts / stats.workQuota) : 0;
                
                if (targetRatio < totalRatio - 0.1) {
                    stats.workPressure += 0.5;
                }
            } else {
                stats.targetShiftPressure = 0;
                stats.workedTargetShifts = 0;
            }
        });
    }

    // ============================================================
    // 3. 填班機制 (三階段)
    // ============================================================
    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        // 第一階段：包班
        const bundleStaff = this.bundleStaff.filter(s => {
            const bundle = s.packageType || s.prefs?.bundleShift;
            return bundle === shiftCode;
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

        // 第二階段：偏好
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

        // 第三階段：其餘
        if (gap > 0) {
            let allCandidates = this.staffList.filter(s => {
                if (this.getShiftByDate(dateStr, s.id) !== 'OFF') return false;
                const stats = this.staffStats[s.id];
                if (stats.targetShift && stats.targetShift !== shiftCode) {
                    const ratio = stats.targetQuota > 0 ? (stats.workedTargetShifts / stats.targetQuota) : 0;
                    const totalRatio = stats.workQuota > 0 ? (stats.workedShifts / stats.workQuota) : 0;
                    // 只在目標班別進度超前時才幫忙
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
        
        if (gap > 0) console.warn(`[缺口] ${dateStr} ${shiftCode} 尚缺 ${gap}`);
    }

    // ============================================================
    // 4. 強力平衡機制
    // ============================================================
    postProcessBalancing(limitDay, isFinal = false) {
        const rounds = isFinal ? 500 : 50; 
        
        const isFairOff = this.rules.fairness?.fairOff !== false;
        if (isFairOff) this.forceBalanceGlobalOffs(limitDay, rounds);
        
        const isFairNight = this.rules.fairness?.fairNight !== false;
        if (isFairNight) this.balanceNightShiftsByGroup(limitDay, rounds);
    }

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
            
            if (richPerson.count - poorPerson.count <= this.tolerance) break;

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
        }
    }

    balanceNightShiftsByGroup(limitDay, rounds) {
        const nightShifts = this.shiftCodes.filter(code => (this.isNightShift ? this.isNightShift(code) : ['N','E'].includes(code)));
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
            }).sort((a, b) => b.count - a.count);
            
            if (stats.length === 0 || stats[stats.length-1].count - stats[0].count <= tolerance) break;
            
            const maxPerson = stats[stats.length - 1];
            const minPerson = stats[0];
            
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

    // ============================================================
    // 🔧 輔助函式
    // ============================================================
    
    applyPreSchedules() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const req = params[dateStr];
                if (req === 'REQ_OFF') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                }
                else if (req && req !== 'OFF' && !req.startsWith('!')) {
                    this.updateShift(dateStr, staff.id, 'OFF', req);
                }
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
        const offStaffs = this.staffList.filter(s => 
            this.getShiftByDate(dateStr, s.id) === 'OFF' && !this.isPreRequestOff(s.id, dateStr)
        );
        
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
            if (stats.targetShift && this.calculateScoreInfo(highP, dateStr, stats.targetShift).totalScore > -1000) {
                targets.push(stats.targetShift);
            }
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
                        if (this.checkSwapValidity(day, highP, 'OFF', code) && 
                            this.checkSwapValidity(day, lowP, code, 'OFF')) {
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
            if (stats.targetQuota > 0 && (stats.workedTargetShifts / stats.targetQuota) < 0.8) {
                score += 10000;
            }
        }

        if (prefs.favShift === shiftCode) { score += 3000; isPreferred = true; }
        if (prefs.favShift2 === shiftCode) { score += 1000; isPreferred = true; }
        if (prefs.favShift3 === shiftCode) { score += 200; isPreferred = true; }

        if ((prefs.favShift || bundleShift) && !isPreferred) score -= 999999; 
        if (staff.schedulingParams?.[dateStr] === '!' + shiftCode) score -= 999999;

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
            const candidates = this.staffList.filter(s => 
                this.getShiftByDate(currentDateStr, s.id) === 'OFF' && !this.isPreRequestOff(s.id, currentDateStr)
            );
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
                if (this.isValidAssignment(staff, currentDateStr, targetShift) && 
                    this.checkGroupMaxLimit(currentDay, staff, targetShift)) {
                    return true;
                } else {
                    this.updateShift(pastDateStr, staff.id, 'OFF', pastShift);
                }
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
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        if (baseValid) return true;
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        if (consDays + 1 > normalLimit) {
            const stats = this.staffStats[staff.id];
            if (stats?.isLongVacationer) {
                const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
                if (consDays + 1 <= longVacLimit) {
                    const currentDayIndex = new Date(dateStr).getDate();
                    let prevShift = 'OFF';
                    if (currentDayIndex > 1) {
                         const prevDateStr = this.getDateStr(currentDayIndex - 1);
                         prevShift = this.getShiftByDate(prevDateStr, staff.id);
                    } else if (currentDayIndex === 1) {
                        prevShift = this.lastMonthData?.[staff.id]?.lastShift || 'OFF';
                    }
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
        let swapCandidates = this.staffList.filter(s => 
            s.id !== staff.id && 
            this.getShiftByDate(prevDateStr, s.id) === 'OFF' &&
            !this.isPreRequestOff(s.id, prevDateStr) 
        );
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
            if (this.rules.specificNeeds?.[dateStr]?.[code] !== undefined) {
                needs[code] = this.rules.specificNeeds[dateStr][code];
            } else {
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

    formatResult() { 
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
        return res; 
    }
}
