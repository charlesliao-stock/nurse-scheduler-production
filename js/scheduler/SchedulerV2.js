// js/scheduler/SchedulerV2.js
// 🚀 最終人性化平衡版：債務容許差異 (±2天) + 避免破碎班表

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; 
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 3;
        this.avgWorkDays = 0; 
        
        // 讀取容許差異設定，預設為 2 天
        this.tolerance = this.rules.fairness?.fairOffVar || 2;
        // 讀取最少連續上班天數，預設 2 天
        this.minCons = this.rules.pattern?.minConsecutive || 2;
    }

    run() {
        console.log(`🚀 SchedulerV2 Human-Centric Balance Mode Start (Tolerance: ±${this.tolerance}).`);
        
        this.applyPreSchedules();
        this.calculateProjectedStats(); 

        const segments = this.rules.aiParams?.balancingSegments || 1;
        if (segments > 1) {
            const interval = Math.floor(this.daysInMonth / segments);
            for (let i = 1; i < segments; i++) {
                this.checkpoints.push(i * interval);
            }
        }

        for (let d = 1; d <= this.daysInMonth; d++) {
            
            // 1. 每日檢討水位
            this.calculateDailyWorkDebt(d);

            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            // 2. 填班
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 3. 分段平衡
            if (this.checkpoints.includes(d)) {
                this.postProcessBalancing(d);
            }
        }

        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // --- 填班邏輯 ---
    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        let candidates = this.staffList.filter(s => {
            return this.getShiftByDate(dateStr, s.id) === 'OFF';
        });

        // [關鍵] 排序策略：在容許範圍內，優先考慮「班表連續性」與「志願」
        this.sortCandidatesBySmartDebt(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;

            const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
            
            // 嚴格合規：分數過低 (違反 Must) 則跳過
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

        if (gap > 0) {
            console.warn(`[缺口警示] ${dateStr} ${shiftCode} 尚缺 ${gap} 人`);
        }
    }

    // --- [核心修正] 智慧排序：容許差異 + 避免爛班 ---
    sortCandidatesBySmartDebt(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates); 

        candidates.sort((a, b) => {
            const debtA = this.staffStats[a.id].workDebt;
            const debtB = this.staffStats[b.id].workDebt;
            const diff = debtA - debtB;

            // 1. 檢查是否超出容許差異 (Tolerance)
            // 如果 A 比 B 欠更多班，且差距超過容許值 -> A 必須優先 (強制平衡)
            if (diff > this.tolerance) return -1; 
            // 如果 B 比 A 欠更多班，且差距超過容許值 -> B 必須優先
            if (diff < -this.tolerance) return 1;

            // 2. 在容許範圍內 (差距 <= 2天)，改用分數決勝負
            // 這裡的分數已經包含了「連續性獎勵」，能避免破碎班表
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            
            return scoreB - scoreA; // 分數高者優先
        });
    }

    // --- [核心修正] 分數計算：獎勵連續，懲罰破碎 ---
    calculateScoreInfo(staff, dateStr, shiftCode) {
        let score = 0;
        const policy = this.rules.policy || {};
        const debt = this.staffStats[staff.id]?.workDebt || 0;
        
        // 基礎亂數
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;

        // 取得連續上班狀況
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        // 取得前一天的班別
        const currentDayIdx = new Date(dateStr).getDate();
        let prevShift = 'OFF';
        if (currentDayIdx > 1) {
            const prevDateStr = this.getDateStr(currentDayIdx - 1);
            prevShift = this.getShiftByDate(prevDateStr, staff.id);
        }

        // --- 班表連續性評分 (避免爛班) ---
        if (prevShift !== 'OFF' && prevShift !== 'REQ_OFF') {
            // [延續獎勵]：如果昨天有上班
            if (consDays < this.minCons) {
                // 還沒達到最少天數(如2天)，強力加分，強迫他今天繼續上，避免「做一休一」
                score += 5000; 
            } else if (consDays < (policy.maxConsDays || 6)) {
                // 超過最少天數，但還沒爆肝，微量加分 (鼓勵集中上班，集中休假)
                score += 500; 
            } else {
                // 快爆肝了，扣分 (讓位給別人)
                score -= 2000;
            }
        } else {
            // [啟動成本]：如果昨天是休假 (今天上班等於開啟新戰線)
            // 除非真的欠班(Debt高)，否則我們傾向讓已經在上班的人續上
            score -= 200; 
        }

        // --- 80/20 與 志願 ---
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

    // --- 每日檢討 ---
    calculateDailyWorkDebt(currentDay) {
        let totalWorked = 0;
        this.staffList.forEach(s => {
            totalWorked += this.getTotalShiftsUpTo(s.id, currentDay - 1);
        });
        
        this.avgWorkDays = totalWorked / this.staffList.length;

        this.staffList.forEach(s => {
            const myWork = this.getTotalShiftsUpTo(s.id, currentDay - 1);
            let debt = this.avgWorkDays - myWork;
            if (this.staffStats[s.id].isLongVacationer) debt += 3.0; 
            this.staffStats[s.id].workDebt = debt;
        });
    }

    // --- 回溯 ---
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

            // 回溯時也採用智慧排序，避免為了補洞創造爛班
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

    // --- 平衡與其他 ---
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

            // 平衡時同樣遵守容許差異
            if (maxPerson.count - minPerson.count <= (this.tolerance || 1)) break; 

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

    // --- 基礎 ---
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
                isLongVacationer: reqOffCount >= longVacDays,
                initialRandom: Math.random(),
                workDebt: 0 
            };
        });
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

    isValidAssignment(staff, dateStr, shiftCode) {
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        if (baseValid) return true;

        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        
        if (consDays + 1 > normalLimit) {
            if (this.staffStats[staff.id]?.isLongVacationer) {
                const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
                if (consDays + 1 <= longVacLimit) {
                    const currentDayIndex = new Date(dateStr).getDate();
                    let prevShift = 'OFF';
                    if (currentDayIndex > 1) {
                         const prevDate = new Date(this.year, this.month - 1, currentDayIndex - 1);
                         const prevDateStr = `${this.year}-${String(this.month).padStart(2,'0')}-${String(prevDate.getDate()).padStart(2,'0')}`;
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
