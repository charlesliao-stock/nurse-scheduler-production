// js/scheduler/SchedulerV2.js
// 🚀 最終校正版：邏輯歸位 (長假歸長假，平衡歸平衡) + 總休假數平衡法

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; 
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 3;
        this.avgTotalOffs = 0; // 改為追蹤「平均總休假數」
        
        this.tolerance = this.rules.fairness?.fairOffVar || 2;
        this.minCons = this.rules.pattern?.minConsecutive || 2;
    }

    run() {
        console.log(`🚀 SchedulerV2 Corrected Logic Mode Start.`);
        
        this.applyPreSchedules();
        this.calculateProjectedStats(); 

        const segments = this.rules.aiParams?.balancingSegments || 1;
        if (segments > 1) {
            const interval = Math.floor(this.daysInMonth / segments);
            for (let i = 1; i < segments; i++) {
                this.checkpoints.push(i * interval);
            }
        }

        // --- 主迴圈：逐日排班 ---
        for (let d = 1; d <= this.daysInMonth; d++) {
            
            // 1. 每日結算水位 (計算誰休太多，誰休太少)
            this.calculateDailyOffDebt(d);

            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            // 2. 正常填班
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 3. 資源再分配 (每日排班後的例行公事)
            this.optimizeDailyAllocation(d);

            // 4. 分段平衡 (週期性大檢查)
            if (this.checkpoints.includes(d)) {
                this.postProcessBalancing(d);
            }
        }

        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // --- [修正邏輯] 計算「休假債務」 ---
    // 邏輯：誰的 (預休 + 已排休) 越多，誰就越該上班 (Debt 越高)
    calculateDailyOffDebt(currentDay) {
        let grandTotalOffs = 0;
        
        // 1. 計算全體目前的總休假數 (包含預休)
        this.staffList.forEach(s => {
            const sysOffs = this.countSystemOffsUpTo(s.id, currentDay - 1); // 目前為止的排休
            const reqOffs = this.staffStats[s.id]?.reqOffCount || 0;        // 整個月的預休
            grandTotalOffs += (sysOffs + reqOffs);
        });
        
        this.avgTotalOffs = grandTotalOffs / this.staffList.length;

        // 2. 計算每個人的債務
        this.staffList.forEach(s => {
            const sysOffs = this.countSystemOffsUpTo(s.id, currentDay - 1);
            const reqOffs = this.staffStats[s.id]?.reqOffCount || 0;
            const myTotalOffs = sysOffs + reqOffs;

            // 債務 = 我的總休假 - 平均總休假
            // 正值：我休太多了 -> 欠班 (Debt > 0) -> 優先排班
            // 負值：我休太少了 -> 加班 (Debt < 0) -> 優先休假
            
            // 係數 1.0：完全反應休假天數的差異 (鍾淑英多預休1天，債務就多1.0)
            let debt = (myTotalOffs - this.avgTotalOffs) * 1.0;

            this.staffStats[s.id].workDebt = debt;
        });
    }

    // --- 每日資源再分配 (Reallocation) ---
    optimizeDailyAllocation(day) {
        const dateStr = this.getDateStr(day);
        
        // 找出今日排休(OFF)的人 (潛在的欠班者/貧窮戶)
        // 注意：這裡不包含 REQ_OFF，因為預休不能動
        const offStaffs = this.staffList.filter(s => {
            const shift = this.getShiftByDate(dateStr, s.id);
            return (shift === 'OFF') && !this.isPreRequestOff(s.id, dateStr);
        });

        // 依債務由高到低排序 (休越多的人，Debt 越高，越想上班)
        offStaffs.sort((a, b) => this.staffStats[b.id].workDebt - this.staffStats[a.id].workDebt);

        for (const poorStaff of offStaffs) {
            const poorDebt = this.staffStats[poorStaff.id].workDebt;
            
            // 如果債務 <= 0 (代表他休假比平均少)，不用幫他搶班
            if (poorDebt <= 0) continue;

            // 尋找他願意上的班
            const targetShifts = this.shiftCodes.filter(code => {
                if (code === 'OFF' || code === 'REQ_OFF') return false;
                const s = this.calculateScoreInfo(poorStaff, dateStr, code);
                // 嚴格遵守志願 (不塞爛班)
                return s.totalScore > -1000; 
            });
            
            // 優先搶高分志願
            targetShifts.sort((a, b) => {
                return this.calculateScoreInfo(poorStaff, dateStr, b).totalScore - 
                       this.calculateScoreInfo(poorStaff, dateStr, a).totalScore;
            });

            for (const targetCode of targetShifts) {
                const assignedUids = this.schedule[dateStr][targetCode] || [];
                
                let bestTargetToSwap = null;
                let maxDebtDiff = -999;

                for (const uid of assignedUids) {
                    const richStaff = this.staffList.find(s => s.id === uid);
                    if (!richStaff || this.isPreRequestOff(richStaff.id, dateStr)) continue; 

                    const richDebt = this.staffStats[richStaff.id].workDebt;
                    const diff = poorDebt - richDebt; // 差異：我比你多休幾天？

                    // 差異超過容許值，啟動交換
                    if (diff > this.tolerance) {
                        if (diff > maxDebtDiff) {
                            if (this.checkSwapValidity(day, poorStaff, 'OFF', targetCode) && 
                                this.checkSwapValidity(day, richStaff, targetCode, 'OFF')) {
                                bestTargetToSwap = richStaff;
                                maxDebtDiff = diff;
                            }
                        }
                    }
                }

                if (bestTargetToSwap) {
                    this.updateShift(dateStr, bestTargetToSwap.id, targetCode, 'OFF'); 
                    this.updateShift(dateStr, poorStaff.id, 'OFF', targetCode); 
                    break; 
                }
            }
        }
    }

    // --- 填班邏輯 ---
    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
        
        // 排序：債務優先 (休越多的人排前面)
        this.sortCandidatesBySmartDebt(candidates, dateStr, shiftCode);

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

    // --- 輔助：計算系統排休天數 ---
    countSystemOffsUpTo(uid, dayLimit) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            const shift = this.getShiftByDate(this.getDateStr(d), uid);
            if (shift === 'OFF') count++;
        }
        return count;
    }

    // --- 驗證與檢查 (長假邏輯僅在此處生效) ---
    isValidAssignment(staff, dateStr, shiftCode) {
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        if (baseValid) return true;

        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        
        // [長假邏輯]：僅放寬連續上班限制
        if (consDays + 1 > normalLimit) {
            // 檢查是否為長假人員 (定義：預休 > 7天，或自訂規則)
            const isLongVacationer = this.staffStats[staff.id]?.isLongVacationer;
            if (isLongVacationer) {
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

    // --- 其他標準函式 (保持不變) ---
    calculateProjectedStats() {
        this.staffList.forEach(staff => {
            let reqOffCount = 0;
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                if (params[this.getDateStr(d)] === 'REQ_OFF') reqOffCount++;
            }
            const longVacDays = this.rules.policy?.longVacationDays || 7;
            this.staffStats[staff.id] = {
                reqOffCount: reqOffCount,
                isLongVacationer: reqOffCount >= longVacDays, // 僅作為標記
                initialRandom: Math.random(),
                workDebt: 0 
            };
        });
    }

    checkSwapValidity(day, staff, currentShift, newShift) {
        const dateStr = this.getDateStr(day);
        if (!this.isValidAssignment(staff, dateStr, newShift)) return false;
        const scoreInfo = this.calculateScoreInfo(staff, dateStr, newShift);
        if (scoreInfo.totalScore < -50000) return false; 
        if (scoreInfo.totalScore < -2000) return false;  
        return true;
    }

    calculateScoreInfo(staff, dateStr, shiftCode) {
        let score = 0;
        const policy = this.rules.policy || {};
        const debt = this.staffStats[staff.id]?.workDebt || 0;
        
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;

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
            } else {
                if (debt < 1.0) score -= 300; 
            }
        }

        let prefs = {};
        if (staff.prefs) {
            if (staff.prefs[dateStr]) prefs = staff.prefs[dateStr];
            else if (staff.prefs.favShift || staff.prefs.bundleShift) prefs = staff.prefs;
        }

        let isPreferred = false;
        const bundleShift = staff.packageType || prefs.bundleShift;
        const currentDay = new Date(dateStr).getDate();
        const totalShiftsSoFar = this.getTotalShiftsUpTo(staff.id, currentDay - 1);
        let bundleShiftsSoFar = 0;
        if (bundleShift) bundleShiftsSoFar = this.countSpecificShiftsUpTo(staff.id, currentDay - 1, bundleShift);
        const bundleRatio = (totalShiftsSoFar > 0) ? (bundleShiftsSoFar / totalShiftsSoFar) : 0;
        const targetRatio = 0.8;

        if (bundleShift === shiftCode) {
            isPreferred = true;
            if (bundleRatio < targetRatio) score += 5000; 
            else score += 2000;
        }

        if (prefs.favShift === shiftCode) { score += 1000; isPreferred = true; }
        
        if (prefs.favShift2 === shiftCode) {
            isPreferred = true;
            if (bundleShift) {
                if (bundleRatio >= targetRatio || debt > 1.0) score += 3000; 
                else score += 500;
            } else {
                score += 500; 
            }
        }
        
        if (prefs.favShift3 === shiftCode) { score += 200; isPreferred = true; }

        const hasPreferences = prefs.favShift || prefs.favShift2 || prefs.bundleShift;
        const prefMode = policy.prioritizePref || 'must'; 
        
        if (hasPreferences && !isPreferred) {
            if (prefMode === 'must') score -= 999999; 
            else score -= 5000;
        }

        const params = staff.schedulingParams || {};
        const avoidMode = policy.prioritizeAvoid || 'must';
        if (params[dateStr] === '!' + shiftCode) {
             score -= (avoidMode === 'must') ? 999999 : 10000;
        }

        return { totalScore: score, isPreferred: isPreferred };
    }

    sortCandidatesBySmartDebt(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates); 
        candidates.sort((a, b) => {
            const debtA = this.staffStats[a.id].workDebt;
            const debtB = this.staffStats[b.id].workDebt;
            const diff = debtA - debtB;
            if (diff > this.tolerance) return -1; 
            if (diff < -this.tolerance) return 1;
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            return scoreB - scoreA; 
        });
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
            this.sortCandidatesBySmartDebt(candidates, currentDateStr, targetShift);
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
        const isFairOff = this.rules.fairness?.fairOff !== false;     
        if (isFairNight) this.balanceShiftType('N', limitDay, rounds);
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

    countSpecificShiftsUpTo(uid, dayLimit, targetShift) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            if (this.getShiftByDate(this.getDateStr(d), uid) === targetShift) count++;
        }
        return count;
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
