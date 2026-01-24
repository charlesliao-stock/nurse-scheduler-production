// js/scheduler/SchedulerV2.js
// 🚀 最終完整版：暴力平衡 + 雙軌制配額 + 自動產生Assignments (修復員工端全OFF問題)

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
        console.log(`🚀 SchedulerV2 Full Brute-Force Mode Start.`);
        
        // 1. 預處理
        this.applyPreSchedules();
        
        // 2. 初始化並計算配額
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
            this.calculateDailyWorkPressure(d);
            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.getOptimalShiftOrder(dailyNeeds);

            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) this.fillShiftNeeds(d, shiftCode, count);
            }

            this.optimizeDailyAllocation(d);

            if (this.checkpoints.includes(d)) this.postProcessBalancing(d);
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
                targetQuota: 0      
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
        if (gap > 0) console.warn(`[缺口] ${dateStr} ${shiftCode} 尚缺 ${gap}`);
    }

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
                    } else if (currentDayIndex === 1) prevShift = this.lastMonthData?.[staff.id]?.lastShift || 'OFF';
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
        
        // 2. 建立 Assignments 物件 (給前台看) - 關鍵修復
        const assignments = {};
        this.staffList.forEach(staff => { assignments[staff.id] = { preferences: staff.prefs || {} }; });
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.staffList.forEach(staff => {
                const shift = this.getShiftByDate(dateStr, staff.id);
                assignments[staff.id][`current_${d}`] = shift;
            });
        }
        res.assignments = assignments;
        return res; 
    }
}
