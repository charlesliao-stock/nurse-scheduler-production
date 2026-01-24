// js/scheduler/SchedulerV2.js
// 🚀 最終完全體：包班/非包班雙軌制 + 精細化平衡 + 多階段填補 + 智慧壓力計算

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
        console.log(`🚀 SchedulerV2 Ultimate Fix Mode Start.`);
        
        this.applyPreSchedules();
        
        // 1. 初始化並計算配額 (區分包班/非包班)
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
            
            // 2. 每日更新壓力 (含目標班別壓力)
            this.calculateDailyWorkPressure(d);

            const dailyNeeds = this.getDailyNeeds(d);
            
            // 隨機班別順序，但通常 N 班需要先處理以確保包班優先權
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            // 將 N 班移到最前，確保包夜班的人先被滿足
            shiftOrder.sort((a, b) => (a === 'N' ? -1 : 1));

            // 3. 多階段填班
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 4. 資源再分配 (搶班機制)
            this.optimizeDailyAllocation(d);

            // 5. 分段平衡
            if (this.checkpoints.includes(d)) {
                this.postProcessBalancing(d);
            }
        }

        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // ============================================================
    // 🔧 核心 1：配額計算 (區分包班與非包班)
    // ============================================================
    calculateFixedQuota() {
        // 1. 計算每日各班別總需求
        let totalNeedsByShift = {};
        for (let d = 1; d <= this.daysInMonth; d++) {
            const needs = this.getDailyNeeds(d);
            Object.entries(needs).forEach(([shift, count]) => {
                if (!totalNeedsByShift[shift]) totalNeedsByShift[shift] = 0;
                totalNeedsByShift[shift] += count;
            });
        }
        
        // 2. 初始化員工統計
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
                targetShift: null,  // 目標班別
                targetQuota: 0      // 該班別配額
            };
        });

        // 3. 先分配包班人員的配額
        const bundleStaffByShift = {};
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (bundleShift) {
                if (!bundleStaffByShift[bundleShift]) {
                    bundleStaffByShift[bundleShift] = [];
                }
                bundleStaffByShift[bundleShift].push(staff);
                this.staffStats[staff.id].targetShift = bundleShift;
            }
        });
        
        // 為每個包班群組分配配額
        Object.entries(bundleStaffByShift).forEach(([shift, staffs]) => {
            const totalNeed = totalNeedsByShift[shift] || 0;
            const totalAvailable = staffs.reduce((sum, s) => 
                sum + this.staffStats[s.id].availableDays, 0
            );
            
            staffs.forEach(staff => {
                const stats = this.staffStats[staff.id];
                const ratio = stats.availableDays / totalAvailable;
                stats.targetQuota = Math.floor(totalNeed * ratio);
                
                // 小頂例外檢查 (Availability Capped)
                // 如果能上的天數 < 平均應上天數，視為封頂/長假
                const avgQuota = totalNeed / staffs.length;
                if (stats.availableDays <= avgQuota) {
                    stats.workQuota = stats.availableDays;
                    stats.targetQuota = stats.availableDays; // 包班者通常全上該班
                    stats.isLongVacationer = true;
                } else {
                    stats.workQuota = stats.targetQuota; // 暫定總配額 = 目標配額
                }
            });
            
            // 處理餘數 (分配給可用天數多的人)
            const allocated = staffs.reduce((sum, s) => 
                sum + this.staffStats[s.id].targetQuota, 0
            );
            const remainder = totalNeed - allocated;
            
            if (remainder > 0) {
                const sorted = [...staffs].sort((a, b) => 
                    this.staffStats[b.id].availableDays - this.staffStats[a.id].availableDays
                );
                for (let i = 0; i < remainder && i < sorted.length; i++) {
                    const stats = this.staffStats[sorted[i].id];
                    if (!stats.isLongVacationer) {
                        stats.targetQuota++;
                        stats.workQuota++;
                    }
                }
            }
        });

        // 4. 計算剩餘需求（扣除包班已分配）
        let remainingShifts = 0;
        Object.entries(totalNeedsByShift).forEach(([shift, total]) => {
            const bundleStaffs = bundleStaffByShift[shift] || [];
            const bundleAllocated = bundleStaffs.reduce((sum, s) => 
                sum + this.staffStats[s.id].targetQuota, 0
            );
            remainingShifts += Math.max(0, total - bundleAllocated);
        });
        
        // 5. 將剩餘需求平均分配給非包班人員
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
                let roundAllocated = 0;
                
                staffToAssign.forEach(staff => {
                    const stats = this.staffStats[staff.id];
                    
                    if (stats.availableDays <= avgQuota) {
                        stats.workQuota = stats.availableDays;
                        remainingShifts -= stats.availableDays;
                        stats.isLongVacationer = true;
                    } else {
                        stats.workQuota = avgQuota; // 暫存，下一輪可能覆蓋
                        nextRoundStaff.push(staff);
                    }
                });
                
                // 如果這輪沒人封頂，直接平分剩餘
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
        
        // 6. 二次檢查：預休很多也視為長假人員
        this.staffList.forEach(s => {
            if (this.staffStats[s.id].reqOffCount >= 5) {
                this.staffStats[s.id].isLongVacationer = true;
            }
        });
    }

    // ============================================================
    // 🔧 核心 2：每日壓力計算 (含目標班別壓力)
    // ============================================================
    calculateDailyWorkPressure(currentDay) {
        // const remainingTotalDays = this.daysInMonth - currentDay + 1; // 未使用

        this.staffList.forEach(s => {
            const stats = this.staffStats[s.id];
            const workedShifts = this.getTotalShiftsUpTo(s.id, currentDay - 1);
            const remainingQuota = stats.workQuota - workedShifts;
            
            // 計算剩餘可工作天數
            let remainingAvailableDays = 0;
            const params = s.schedulingParams || {};
            for(let d = currentDay; d <= this.daysInMonth; d++) {
                if (params[this.getDateStr(d)] !== 'REQ_OFF') {
                    remainingAvailableDays++;
                }
            }

            // 基本工作壓力
            const basePressure = remainingAvailableDays > 0 ? 
                (remainingQuota / remainingAvailableDays) : 999;
            
            stats.workedShifts = workedShifts;
            stats.workPressure = basePressure;
            
            // 如果是包班人員，額外計算該班別的壓力
            if (stats.targetShift) {
                const workedTarget = this.countSpecificShiftsUpTo(
                    s.id, currentDay - 1, stats.targetShift
                );
                const remainingTarget = stats.targetQuota - workedTarget;
                
                const targetPressure = remainingAvailableDays > 0 ? 
                    (remainingTarget / remainingAvailableDays) : 999;
                
                stats.targetShiftPressure = targetPressure;
                stats.workedTargetShifts = workedTarget;
                
                // 如果目標班別進度落後總進度，提高整體壓力 (強迫搶班)
                const targetRatio = stats.targetQuota > 0 ? 
                    (workedTarget / stats.targetQuota) : 0;
                const totalRatio = stats.workQuota > 0 ? 
                    (workedShifts / stats.workQuota) : 0;
                
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
    // 🔧 核心 3：填班機制 (三階段)
    // ============================================================
    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        // === 第一階段：包班人員優先 ===
        const bundleStaff = this.bundleStaff.filter(s => {
            const bundle = s.packageType || s.prefs?.bundleShift;
            return bundle === shiftCode;
        });
        
        if (bundleStaff.length > 0) {
            // 包班人員填補目標：盡量填滿 (或設為 80% 如有需要)
            const bundleTarget = Math.ceil(neededCount * 0.9); // 給予極高優先權
            const bundleGap = Math.min(gap, bundleTarget);
            
            let bundleCandidates = bundleStaff.filter(s => 
                this.getShiftByDate(dateStr, s.id) === 'OFF'
            );
            
            // 按目標班別壓力排序
            bundleCandidates.sort((a, b) => {
                const statsA = this.staffStats[a.id];
                const statsB = this.staffStats[b.id];
                
                // 比較目標壓力
                const diff = (statsB.targetShiftPressure || 0) - (statsA.targetShiftPressure || 0);
                if (Math.abs(diff) > 0.05) return diff; // 壓力大者先

                // 比較完成率
                const ratioA = statsA.targetQuota > 0 ? (statsA.workedTargetShifts / statsA.targetQuota) : 1;
                const ratioB = statsB.targetQuota > 0 ? (statsB.workedTargetShifts / statsB.targetQuota) : 1;
                return ratioA - ratioB; // 完成率低者先
            });

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

        // === 第二階段：有偏好的非包班人員 ===
        if (gap > 0) {
            let prefCandidates = this.nonBundleStaff.filter(s => {
                if (this.getShiftByDate(dateStr, s.id) !== 'OFF') return false;
                
                const prefs = s.prefs || {};
                return (prefs.favShift === shiftCode || 
                        prefs.favShift2 === shiftCode || 
                        prefs.favShift3 === shiftCode);
            });
            
            this.sortCandidatesByPressure(prefCandidates, dateStr, shiftCode);

            for (const staff of prefCandidates) {
                if (gap <= 0) break;
                
                const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
                if (scoreInfo.totalScore < -50000) continue;

                if (this.assignIfValid(day, staff, shiftCode)) {
                    gap--;
                } else if (this.tryResolveConflict(day, staff, shiftCode)) {
                    if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }
        }

        // === 第三階段：所有可行人員（含包班但進度超前者） ===
        if (gap > 0) {
            let allCandidates = this.staffList.filter(s => {
                if (this.getShiftByDate(dateStr, s.id) !== 'OFF') return false;
                
                const stats = this.staffStats[s.id];
                // 包班人員：只有在目標班別進度超前時才加入幫忙
                if (stats.targetShift && stats.targetShift !== shiftCode) {
                    const ratio = stats.targetQuota > 0 ? 
                        (stats.workedTargetShifts / stats.targetQuota) : 0;
                    const totalRatio = stats.workQuota > 0 ? 
                        (stats.workedShifts / stats.workQuota) : 0;
                    
                    // 目標班別進度超前 5% 以上
                    return ratio > totalRatio + 0.05;
                }
                return true;
            });
            
            this.sortCandidatesByPressure(allCandidates, dateStr, shiftCode);

            for (const staff of allCandidates) {
                if (gap <= 0) break;
                
                const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
                if (scoreInfo.totalScore < -50000) continue;

                if (this.assignIfValid(day, staff, shiftCode)) {
                    gap--;
                } else if (this.tryResolveConflict(day, staff, shiftCode)) {
                    if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }
        }
        
        // === 第四階段：回溯填補 ===
        if (gap > 0 && this.backtrackDepth > 0) {
            const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
            gap -= recovered;
        }
        
        if (gap > 0) {
            console.warn(`[缺口警示] ${dateStr} ${shiftCode} 尚缺 ${gap} 人`);
        }
    }

    // ============================================================
    // 🔧 核心 4：精細化平衡機制
    // ============================================================
    postProcessBalancing(limitDay) {
        const rounds = (this.rules.fairness?.balanceRounds || 100) * 2;
        
        // 1. 先平衡 OFF 數（所有人員）
        const isFairOff = this.rules.fairness?.fairOff !== false;
        if (isFairOff) {
            this.balanceShiftType('OFF', limitDay, rounds);
        }
        
        // 2. 分別平衡夜班數
        const isFairNight = this.rules.fairness?.fairNight !== false;
        if (isFairNight) {
            this.balanceNightShiftsByGroup(limitDay, rounds);
        }
    }

    balanceNightShiftsByGroup(limitDay, rounds) {
        // 找出所有夜班代碼
        const nightShifts = this.shiftCodes.filter(code => this.isNightShift(code));
        
        // 分群
        const groups = new Map();
        
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            
            if (bundleShift && nightShifts.includes(bundleShift)) {
                // 包班人員：按包班類型分組
                const key = `bundle_${bundleShift}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(staff);
            } else if (!bundleShift) {
                // 非包班人員：統一處理
                const key = 'non_bundle_night';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(staff);
            }
        });
        
        // 對每組分別平衡
        groups.forEach((staffGroup, groupKey) => {
            if (groupKey.startsWith('bundle_')) {
                // 包班人員：只平衡該特定夜班
                const targetShift = groupKey.replace('bundle_', '');
                this.balanceShiftTypeForGroup(targetShift, staffGroup, limitDay, rounds);
            } else {
                // 非包班人員：平衡所有夜班總數
                this.balanceTotalNightShiftsForGroup(nightShifts, staffGroup, limitDay, rounds);
            }
        });
    }

    // 平衡特定群組的特定班別
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
            
            if (stats.length === 0) break;
            const maxPerson = stats[0];
            const minPerson = stats[stats.length - 1];
            
            if (maxPerson.count - minPerson.count <= tolerance) break;
            
            let swapped = false;
            const days = Array.from({length: limitDay}, (_, i) => i + 1);
            this.shuffleArray(days);
            
            for (const d of days) {
                if (isLocked(d, maxPerson.id) || isLocked(d, minPerson.id)) continue;
                
                const dateStr = this.getDateStr(d);
                const shiftMax = this.getShiftByDate(dateStr, maxPerson.id);
                const shiftMin = this.getShiftByDate(dateStr, minPerson.id);
                
                // Max有目標班，Min沒有 -> 交換
                if (shiftMax === targetShift && shiftMin !== targetShift) {
                    if (this.checkSwapValidity(d, maxPerson.obj, shiftMax, shiftMin) &&
                        this.checkSwapValidity(d, minPerson.obj, shiftMin, shiftMax)) {
                        
                        this.updateShift(dateStr, maxPerson.id, shiftMax, shiftMin);
                        this.updateShift(dateStr, minPerson.id, shiftMin, shiftMax);
                        swapped = true;
                        break;
                    }
                }
            }
            if (!swapped) break;
        }
    }

    // 平衡非包班人員的總夜班數
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
            
            if (stats.length === 0) break;
            const maxPerson = stats[0];
            const minPerson = stats[stats.length - 1];
            
            if (maxPerson.count - minPerson.count <= tolerance) break;
            
            let swapped = false;
            const days = Array.from({length: limitDay}, (_, i) => i + 1);
            this.shuffleArray(days);
            
            for (const d of days) {
                if (isLocked(d, maxPerson.id) || isLocked(d, minPerson.id)) continue;
                
                const dateStr = this.getDateStr(d);
                const shiftMax = this.getShiftByDate(dateStr, maxPerson.id);
                const shiftMin = this.getShiftByDate(dateStr, minPerson.id);
                
                // Max有夜班，Min無夜班 -> 交換
                if (nightShifts.includes(shiftMax) && !nightShifts.includes(shiftMin)) {
                    if (this.checkSwapValidity(d, maxPerson.obj, shiftMax, shiftMin) &&
                        this.checkSwapValidity(d, minPerson.obj, shiftMin, shiftMax)) {
                        
                        this.updateShift(dateStr, maxPerson.id, shiftMax, shiftMin);
                        this.updateShift(dateStr, minPerson.id, shiftMin, shiftMax);
                        swapped = true;
                        break;
                    }
                }
            }
            if (!swapped) break;
        }
    }

    // --- 輔助：排序邏輯 ---
    sortCandidatesByPressure(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates);
        
        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];
            
            let pressureA = statsA.workPressure;
            let pressureB = statsB.workPressure;
            
            // 如果是目標班別，使用目標壓力比較
            if (statsA.targetShift === shiftCode) pressureA = Math.max(pressureA, statsA.targetShiftPressure);
            if (statsB.targetShift === shiftCode) pressureB = Math.max(pressureB, statsB.targetShiftPressure);
            
            const diff = pressureB - pressureA;
            if (Math.abs(diff) > 0.05) return diff > 0 ? 1 : -1;
            
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            return scoreB - scoreA;
        });
    }

    // --- 輔助：資源再分配 (使用綜合壓力) ---
    optimizeDailyAllocation(day) {
        const dateStr = this.getDateStr(day);
        const offStaffs = this.staffList.filter(s => 
            this.getShiftByDate(dateStr, s.id) === 'OFF' && !this.isPreRequestOff(s.id, dateStr)
        );

        // 按綜合壓力排序
        offStaffs.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];
            const maxP_A = Math.max(statsA.workPressure, statsA.targetShiftPressure || 0);
            const maxP_B = Math.max(statsB.workPressure, statsB.targetShiftPressure || 0);
            return maxP_B - maxP_A;
        });

        for (const highPressureStaff of offStaffs) {
            const stats = this.staffStats[highPressureStaff.id];
            const pressure = Math.max(stats.workPressure, stats.targetShiftPressure || 0);
            
            if (pressure < 0.7) continue;

            // 尋找可搶班別
            let targetShifts = [];
            if (stats.targetShift) {
                const s = this.calculateScoreInfo(highPressureStaff, dateStr, stats.targetShift);
                if (s.totalScore > -1000) targetShifts.push(stats.targetShift);
            }
            
            this.shiftCodes.forEach(code => {
                if (code === 'OFF' || code === 'REQ_OFF' || code === stats.targetShift) return;
                const s = this.calculateScoreInfo(highPressureStaff, dateStr, code);
                if (s.totalScore > -1000) targetShifts.push(code);
            });
            
            targetShifts.sort((a, b) => {
                return this.calculateScoreInfo(highPressureStaff, dateStr, b).totalScore - 
                       this.calculateScoreInfo(highPressureStaff, dateStr, a).totalScore;
            });

            for (const targetCode of targetShifts) {
                const assignedUids = this.schedule[dateStr][targetCode] || [];
                let bestSwapTarget = null;
                let maxBenefit = -999;

                for (const uid of assignedUids) {
                    const lowPressureStaff = this.staffList.find(s => s.id === uid);
                    if (!lowPressureStaff || this.isPreRequestOff(lowPressureStaff.id, dateStr)) continue;

                    const lowStats = this.staffStats[lowPressureStaff.id];
                    const lowPressure = Math.max(lowStats.workPressure, lowStats.targetShiftPressure || 0);
                    
                    let benefit = pressure - lowPressure;
                    if (stats.targetShift === targetCode) benefit += 0.3; // 搶回本命班加分
                    if (lowStats.targetShift === targetCode) benefit -= 0.3; // 對方本命班減分

                    if (benefit > 0.2 && benefit > maxBenefit) {
                        if (this.checkSwapValidity(day, highPressureStaff, 'OFF', targetCode) && 
                            this.checkSwapValidity(day, lowPressureStaff, targetCode, 'OFF')) {
                            bestSwapTarget = lowPressureStaff;
                            maxBenefit = benefit;
                        }
                    }
                }

                if (bestSwapTarget) {
                    this.updateShift(dateStr, bestSwapTarget.id, targetCode, 'OFF'); 
                    this.updateShift(dateStr, highPressureStaff.id, 'OFF', targetCode); 
                    break; 
                }
            }
        }
    }

    // --- 輔助：分類包班人員 ---
    classifyStaffByBundle() {
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (bundleShift) this.bundleStaff.push(staff);
            else this.nonBundleStaff.push(staff);
        });
    }

    // --- 輔助：判斷夜班 ---
    isNightShift(code) {
        return ['N', 'E', 'EN'].includes(code); // 根據實際代碼調整
    }

    // --- 其他標準方法 ---
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

        let prefs = {};
        if (staff.prefs) {
            if (staff.prefs[dateStr]) prefs = staff.prefs[dateStr];
            else if (staff.prefs.favShift || staff.prefs.bundleShift) prefs = staff.prefs;
        }

        let isPreferred = false;
        const bundleShift = staff.packageType || prefs.bundleShift;
        
        if (bundleShift === shiftCode) {
            score += 50000; 
            isPreferred = true;
            // 比例加權：如果還沒達標，額外加分
            const stats = this.staffStats[staff.id];
            if (stats.targetQuota > 0) {
                const ratio = stats.workedTargetShifts / stats.targetQuota;
                if (ratio < 0.8) score += 10000;
            }
        }

        if (prefs.favShift === shiftCode) { score += 3000; isPreferred = true; }
        if (prefs.favShift2 === shiftCode) { score += 1000; isPreferred = true; }
        if (prefs.favShift3 === shiftCode) { score += 200; isPreferred = true; }

        const hasPreferences = prefs.favShift || prefs.favShift2 || prefs.favShift3 || bundleShift;
        if (hasPreferences && !isPreferred) score -= 999999; 

        const params = staff.schedulingParams || {};
        if (params[dateStr] === '!' + shiftCode) score -= 999999;

        return { totalScore: score, isPreferred: isPreferred };
    }

    resolveShortageWithBacktrack(currentDay, targetShift, gap) {
        let recovered = 0;
        for (let d = currentDay - 1; d >= Math.max(1, currentDay - this.backtrackDepth); d--) {
            if (gap <= 0) break;
            const pastDateStr = this.getDateStr(d);
            const currentDateStr = this.getDateStr(currentDay);
            const candidates = this.staffList.filter(s => 
                this.getShiftByDate(currentDateStr, s.id) === 'OFF' &&
                !this.isPreRequestOff(s.id, currentDateStr)
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

    checkSwapValidity(day, staff, currentShift, newShift) {
        const dateStr = this.getDateStr(day);
        if (!this.isValidAssignment(staff, dateStr, newShift)) return false;
        const scoreInfo = this.calculateScoreInfo(staff, dateStr, newShift);
        if (scoreInfo.totalScore < -50000) return false; 
        if (scoreInfo.totalScore < -2000) return false;  
        return true;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
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

    balanceShiftType(targetShift, limitDay, rounds) {
        const isLocked = (d, uid) => {
             const dateStr = this.getDateStr(d);
             const s = this.staffList.find(x => x.id === uid);
             return s?.schedulingParams?.[dateStr] !== undefined; 
        };
        for (let r = 0; r < rounds; r++) {
            const stats = this.staffList.map(s => {
                let count = 0;
                for(let d=1; d<=limitDay; d++) {
                    if(this.getShiftByDate(this.getDateStr(d), s.id) === targetShift) count++;
                }
                return { id: s.id, count, obj: s };
            }).sort((a, b) => b.count - a.count);
            const maxPerson = stats[0];
            const minPerson = stats[stats.length - 1];
            if (maxPerson.count - minPerson.count <= this.tolerance) break; 
            let swapped = false;
            const days = Array.from({length: limitDay}, (_, i) => i + 1);
            this.shuffleArray(days);
            for (const d of days) {
                if (isLocked(d, maxPerson.id) || isLocked(d, minPerson.id)) continue;
                const dateStr = this.getDateStr(d);
                const shiftMax = this.getShiftByDate(dateStr, maxPerson.id); 
                const shiftMin = this.getShiftByDate(dateStr, minPerson.id); 
                let canSwap = false;
                if (targetShift !== 'OFF') {
                    if (shiftMax === targetShift && shiftMin !== targetShift) canSwap = true;
                } else {
                    if (shiftMax !== 'OFF' && shiftMin === 'OFF') canSwap = true;
                }
                if (canSwap) {
                    if (!this.isValidAssignment(maxPerson.obj, dateStr, shiftMin)) continue;
                    let minCanTake = this.isValidAssignment(minPerson.obj, dateStr, shiftMax);
                    if (!minCanTake && this.backtrackDepth > 0) {
                        if (this.attemptBacktrackForStaff(minPerson.obj, d, shiftMax)) {
                            minCanTake = true;
                        }
                    }
                    if (minCanTake) {
                        if(this.checkSwapValidity(d, maxPerson.obj, shiftMax, shiftMin) &&
                           this.checkSwapValidity(d, minPerson.obj, shiftMin, shiftMax)) {
                            this.updateShift(dateStr, maxPerson.id, shiftMax, shiftMin);
                            this.updateShift(dateStr, minPerson.id, shiftMin, shiftMax);
                            swapped = true;
                            break; 
                        }
                    }
                }
            }
            if (!swapped) break; 
        }
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
