// js/scheduler/SchedulerV2.js
// 🚀 最終邏輯閉環版：總量管制 + 封頂例外放寬連班 + 絕對平均

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; 
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 3;
        
        this.tolerance = this.rules.fairness?.fairOffVar || 2; 
        this.minCons = this.rules.pattern?.minConsecutive || 2;
        
        this.bundleStaff = [];
        this.nonBundleStaff = [];
    }

    run() {
        console.log(`🚀 SchedulerV2 Final Logic Mode Start.`);
        
        this.applyPreSchedules();
        
        // 1. 計算配額並標記「封頂/長假人員」
        this.calculateFixedQuota(); 
        
        this.classifyStaffByBundle();
        
        const segments = Math.max(3, this.rules.aiParams?.balancingSegments || 3);
        const interval = Math.floor(this.daysInMonth / segments);
        for (let i = 1; i < segments; i++) {
            this.checkpoints.push(i * interval);
        }

        // --- 主迴圈 ---
        for (let d = 1; d <= this.daysInMonth; d++) {
            
            // 2. 每日更新壓力
            this.calculateDailyWorkPressure(d);

            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            // 3. 填班
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 4. 資源再分配
            this.optimizeDailyAllocation(d);

            if (this.checkpoints.includes(d)) {
                this.postProcessBalancing(d);
            }
        }

        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // 🔧 核心修正：計算配額並標記長假人員
    calculateFixedQuota() {
        let totalRequiredShifts = 0;
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const needs = this.getDailyNeeds(d);
            Object.values(needs).forEach(count => totalRequiredShifts += count);
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
                isLongVacationer: false, // 預設為否
                initialRandom: Math.random()
            };
        });

        // 平均分配
        let remainingShifts = totalRequiredShifts;
        let staffToAssign = [...this.staffList]; 
        
        for(let iter=0; iter<5; iter++) {
            if (staffToAssign.length === 0) break;
            
            const avgQuota = Math.ceil(remainingShifts / staffToAssign.length);
            let nextRoundStaff = [];
            
            staffToAssign.forEach(staff => {
                const stats = this.staffStats[staff.id];
                
                // [關鍵] 封頂檢查：如果可工作天數 <= 平均配額
                if (stats.availableDays <= avgQuota) {
                    // 1. 設定為全上
                    stats.workQuota = stats.availableDays;
                    remainingShifts -= stats.availableDays;
                    
                    // 2. [新增] 標記為長假人員 (因為他已經滿載了，需要放寬連班限制)
                    stats.isLongVacationer = true;
                    // console.log(`🏖️ ${staff.name} 觸發封頂例外 (可用${stats.availableDays} <= 配額${avgQuota})，標記為長假模式`);
                
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
        
        // 二次檢查：如果預休本身就很多 (例如 > 5天)，即使沒封頂，也視為長假人員，以防萬一
        this.staffList.forEach(s => {
            if (this.staffStats[s.id].reqOffCount >= 5) {
                this.staffStats[s.id].isLongVacationer = true;
            }
        });
    }

    calculateDailyWorkPressure(currentDay) {
        const remainingTotalDays = this.daysInMonth - currentDay + 1;

        this.staffList.forEach(s => {
            const stats = this.staffStats[s.id];
            const workedShifts = this.getTotalShiftsUpTo(s.id, currentDay - 1);
            const remainingQuota = stats.workQuota - workedShifts;
            
            let remainingAvailableDays = 0;
            const params = s.schedulingParams || {};
            for(let d = currentDay; d <= this.daysInMonth; d++) {
                if (params[this.getDateStr(d)] !== 'REQ_OFF') {
                    remainingAvailableDays++;
                }
            }

            const pressure = remainingAvailableDays > 0 ? (remainingQuota / remainingAvailableDays) : 999;
            stats.workedShifts = workedShifts;
            stats.workPressure = pressure;
        });
    }

    classifyStaffByBundle() {
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (bundleShift) this.bundleStaff.push(staff);
            else this.nonBundleStaff.push(staff);
        });
    }

    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        // 包班優先
        if (shiftCode === 'N') {
            const bundleNStaff = this.bundleStaff.filter(s => (s.packageType || s.prefs?.bundleShift) === 'N');
            if (bundleNStaff.length > 0) {
                const bundleQuota = Math.ceil(neededCount * 0.8);
                const bundleGap = Math.min(gap, bundleQuota);
                let bundleCandidates = bundleNStaff.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
                
                this.sortCandidatesByPressure(bundleCandidates, dateStr, shiftCode);

                for (const staff of bundleCandidates) {
                    if (bundleGap <= 0 || gap <= 0) break;
                    const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
                    if (scoreInfo.totalScore < -50000) continue; 

                    if (this.assignIfValid(day, staff, shiftCode)) {
                        gap--;
                    }
                }
            }
        }

        // 一般填補
        let candidates = this.staffList.filter(s => {
            if (this.getShiftByDate(dateStr, s.id) !== 'OFF') return false;
            const prefs = s.prefs || {};
            const bundleShift = s.packageType || prefs.bundleShift;
            return (bundleShift === shiftCode || prefs.favShift === shiftCode || prefs.favShift2 === shiftCode || prefs.favShift3 === shiftCode);
        });
        
        this.sortCandidatesByPressure(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;
            const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
            if (scoreInfo.totalScore < -50000) continue;

            if (this.assignIfValid(day, staff, shiftCode)) {
                gap--;
            } else {
                if (this.tryResolveConflict(day, staff, shiftCode)) {
                     if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }
        }
        
        if (gap > 0 && this.backtrackDepth > 0) {
            const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
            gap -= recovered;
        }
    }

    sortCandidatesByPressure(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates); 
        candidates.sort((a, b) => {
            const pressureA = this.staffStats[a.id].workPressure;
            const pressureB = this.staffStats[b.id].workPressure;
            const diff = pressureB - pressureA; 
            
            if (Math.abs(diff) > 0.05) return diff > 0 ? 1 : -1;
            
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            return scoreB - scoreA; 
        });
    }

    optimizeDailyAllocation(day) {
        const dateStr = this.getDateStr(day);
        
        const offStaffs = this.staffList.filter(s => 
            this.getShiftByDate(dateStr, s.id) === 'OFF' && !this.isPreRequestOff(s.id, dateStr)
        );

        offStaffs.sort((a, b) => this.staffStats[b.id].workPressure - this.staffStats[a.id].workPressure);

        for (const highPressureStaff of offStaffs) {
            const pressure = this.staffStats[highPressureStaff.id].workPressure;
            if (pressure < 0.7) continue; 

            const targetShifts = this.shiftCodes.filter(code => {
                if (code === 'OFF' || code === 'REQ_OFF') return false;
                const s = this.calculateScoreInfo(highPressureStaff, dateStr, code);
                return s.totalScore > -1000; 
            });
            
            targetShifts.sort((a, b) => {
                return this.calculateScoreInfo(highPressureStaff, dateStr, b).totalScore - 
                       this.calculateScoreInfo(highPressureStaff, dateStr, a).totalScore;
            });

            for (const targetCode of targetShifts) {
                const assignedUids = this.schedule[dateStr][targetCode] || [];
                
                let bestSwapTarget = null;
                let maxPressureDiff = -999;

                for (const uid of assignedUids) {
                    const lowPressureStaff = this.staffList.find(s => s.id === uid);
                    if (!lowPressureStaff || this.isPreRequestOff(lowPressureStaff.id, dateStr)) continue; 

                    const lowPressure = this.staffStats[lowPressureStaff.id].workPressure;
                    const diff = pressure - lowPressure;

                    if (diff > 0.2) { 
                        if (diff > maxPressureDiff) {
                            if (this.checkSwapValidity(day, highPressureStaff, 'OFF', targetCode) && 
                                this.checkSwapValidity(day, lowPressureStaff, targetCode, 'OFF')) {
                                bestSwapTarget = lowPressureStaff;
                                maxPressureDiff = diff;
                            }
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
            const currentDay = new Date(dateStr).getDate();
            const totalShiftsSoFar = this.getTotalShiftsUpTo(staff.id, currentDay - 1);
            const bundleShiftsSoFar = this.countSpecificShiftsUpTo(staff.id, currentDay - 1, bundleShift);
            const bundleRatio = (totalShiftsSoFar > 0) ? (bundleShiftsSoFar / totalShiftsSoFar) : 0;
            if (bundleRatio < 0.8) score += 10000; 
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

    // 🔧 核心修正：合法性檢查應用長假放寬
    isValidAssignment(staff, dateStr, shiftCode) {
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        if (baseValid) return true;

        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        
        if (consDays + 1 > normalLimit) {
            const stats = this.staffStats[staff.id];
            
            // [修正] 只要被標記為長假人員 (包含封頂者)，就允許放寬
            if (stats?.isLongVacationer) {
                const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
                
                // 只有當設定的長假上限真的比一般上限高時，才放行
                if (longVacLimit > normalLimit && consDays + 1 <= longVacLimit) {
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

    // === 其他輔助函數 ===
    
    countSystemOffsUpTo(uid, dayLimit) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            const shift = this.getShiftByDate(this.getDateStr(d), uid);
            if (shift === 'OFF') count++;
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

    countSpecificShiftsUpTo(uid, dayLimit, targetShift) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            if (this.getShiftByDate(this.getDateStr(d), uid) === targetShift) count++;
        }
        return count;
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

    postProcessBalancing(limitDay) {
        const rounds = (this.rules.fairness?.balanceRounds || 100) * 2; 
        const isFairNight = this.rules.fairness?.fairNight !== false; 
        if (isFairNight) this.balanceShiftType('N', limitDay, rounds);
        const isFairOff = this.rules.fairness?.fairOff !== false;     
        if (isFairOff) this.balanceShiftType('OFF', limitDay, rounds);
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
