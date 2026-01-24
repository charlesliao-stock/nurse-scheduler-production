// js/scheduler/SchedulerV2.js
// 🚀 最終嚴格智慧版：通用回溯 + 嚴格志願 + 平衡微調深度整合

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; 
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 3;
        this.avgWorkDays = 0; 
    }

    run() {
        console.log(`🚀 SchedulerV2 Smart Balanced Mode Start.`);
        
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
            
            // 1. 水位監控 (作為排序依據)
            this.calculateDailyWorkDebt(d);

            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            // 2. 每日填班
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 3. 分段平衡 (含回溯微調)
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

        // 排序：欠債多的優先，但必須符合志願
        this.sortCandidatesByDebt(candidates, dateStr, shiftCode);

        // 第一輪：正常填補
        for (const staff of candidates) {
            if (gap <= 0) break;

            const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
            
            // [嚴格合規] 若違反 Must，直接跳過，絕不強迫
            if (scoreInfo.totalScore < -50000) continue;

            if (this.assignIfValid(day, staff, shiftCode)) {
                gap--;
            } else {
                // 嘗試當日換班
                if (this.tryResolveConflict(day, staff, shiftCode)) {
                     if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }
        }
        
        // 第二輪：回溯填補 (針對想上但被卡住的人)
        if (gap > 0 && this.backtrackDepth > 0) {
            // 這裡的回溯會檢查是否符合 Must，不符合的不會被抓來回溯
            const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
            gap -= recovered;
        }

        if (gap > 0) {
            // 盡力了，留給管理者
            console.warn(`[缺口警示] ${dateStr} ${shiftCode} 尚缺 ${gap} 人`);
        }
    }

    // --- [核心] 單人回溯嘗試 (通用型) ---
    // 嘗試修改某員工過去幾天的班表(改為OFF)，以解鎖今天的班
    attemptBacktrackForStaff(staff, currentDay, targetShift) {
        const currentDateStr = this.getDateStr(currentDay);
        
        // 1. 意願檢查：如果他不想上這個班(Must)，就別費工回溯了
        const scoreInfo = this.calculateScoreInfo(staff, currentDateStr, targetShift);
        if (scoreInfo.totalScore < -50000) return false;

        // 2. 往回搜尋可犧牲的班
        for (let d = currentDay - 1; d >= Math.max(1, currentDay - this.backtrackDepth); d--) {
            const pastDateStr = this.getDateStr(d);
            const pastShift = this.getShiftByDate(pastDateStr, staff.id);

            // 只動上班日，不動 OFF/REQ_OFF/預排
            if (pastShift !== 'OFF' && pastShift !== 'REQ_OFF' && !this.isPreRequestOff(staff.id, pastDateStr)) {
                
                // 試探：過去改 OFF
                this.updateShift(pastDateStr, staff.id, pastShift, 'OFF');
                
                // 驗證：今天能不能上了？
                if (this.isValidAssignment(staff, currentDateStr, targetShift) && 
                    this.checkGroupMaxLimit(currentDay, staff, targetShift)) {
                    // 成功解鎖！
                    // 注意：這裡只負責「解鎖」，不負責「填入」，填入由呼叫者執行
                    // 但因為 updateShift 已經改了過去，如果呼叫者不填入，需要還原。
                    // 為簡化，我們假設成功就代表願意犧牲過去。
                    return true;
                } else {
                    // 失敗，還原
                    this.updateShift(pastDateStr, staff.id, 'OFF', pastShift);
                }
            }
        }
        return false;
    }

    // --- [核心] 群體回溯 (用於填補缺口) ---
    resolveShortageWithBacktrack(currentDay, targetShift, gap) {
        let recovered = 0;
        const dateStr = this.getDateStr(currentDay);
        
        const candidates = this.staffList.filter(s => 
            this.getShiftByDate(dateStr, s.id) === 'OFF' &&
            !this.isPreRequestOff(s.id, dateStr)
        );

        // 優先找欠班多且願意上的人
        this.sortCandidatesByDebt(candidates, dateStr, targetShift);

        for (const staff of candidates) {
            if (gap <= 0) break;
            
            // 呼叫通用回溯函式
            if (this.attemptBacktrackForStaff(staff, currentDay, targetShift)) {
                // 回溯成功，現在可以填班了
                this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                gap--;
                recovered++;
            }
        }
        return recovered;
    }

    // --- 平衡與微調 (整合回溯) ---
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

            if (maxPerson.count - minPerson.count <= 1) break; 

            let swapped = false;
            const days = Array.from({length: limitDay}, (_, i) => i + 1);
            this.shuffleArray(days); // 亂數搜尋交換點

            for (const d of days) {
                if (isLocked(d, maxPerson.id) || isLocked(d, minPerson.id)) continue;
                const dateStr = this.getDateStr(d);
                
                const shiftMax = this.getShiftByDate(dateStr, maxPerson.id); // 高工時者當天的班
                const shiftMin = this.getShiftByDate(dateStr, minPerson.id); // 低工時者當天的班

                // 邏輯：Max(Work) -> Min(OFF) 的交換
                // 如果目標是平衡 N，則找 Max 上 N 的那天
                // 如果目標是平衡 OFF，則找 Max 上班(非OFF) 的那天
                let canSwap = false;

                if (targetShift !== 'OFF') {
                    if (shiftMax === targetShift && shiftMin !== targetShift) canSwap = true;
                } else {
                    if (shiftMax !== 'OFF' && shiftMin === 'OFF') canSwap = true;
                }

                if (canSwap) {
                    // 檢查 Min 能不能吃下 shiftMax
                    // 檢查 Max 能不能吃下 shiftMin (通常是 OFF)
                    
                    // 1. 檢查 Max 轉 Min 的班 (通常變 OFF) -> 幾乎總是可行，除非有最低工時限制
                    if (!this.isValidAssignment(maxPerson.obj, dateStr, shiftMin)) continue;

                    // 2. 檢查 Min 轉 Max 的班 (接手工作)
                    let minCanTake = this.isValidAssignment(minPerson.obj, dateStr, shiftMax);
                    
                    // [回溯整合] 如果 Min 不能接，試著回溯 Min 的過去來解鎖
                    if (!minCanTake && this.backtrackDepth > 0) {
                        if (this.attemptBacktrackForStaff(minPerson.obj, d, shiftMax)) {
                            minCanTake = true; // 回溯成功，現在可以接了
                        }
                    }

                    if (minCanTake) {
                        // 執行交換
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

    // --- 分數與排序 (移除強制豁免，回歸嚴格 Must) ---
    calculateScoreInfo(staff, dateStr, shiftCode) {
        let score = 0;
        const policy = this.rules.policy || {};
        const debt = this.staffStats[staff.id]?.workDebt || 0;
        
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;

        let prefs = {};
        if (staff.prefs) {
            if (staff.prefs[dateStr]) prefs = staff.prefs[dateStr];
            else if (staff.prefs.favShift || staff.prefs.bundleShift) prefs = staff.prefs;
        }

        let isPreferred = false;
        
        // 包班與 80/20
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

        // 志願分數
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

        // 非志願懲罰 (嚴格執行 Must)
        const hasPreferences = prefs.favShift || prefs.favShift2 || prefs.bundleShift;
        const prefMode = policy.prioritizePref || 'must'; 
        
        if (hasPreferences && !isPreferred) {
            // 這裡不再有貧窮豁免權
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

    sortCandidatesByDebt(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates); 

        candidates.sort((a, b) => {
            const debtA = this.staffStats[a.id].workDebt;
            const debtB = this.staffStats[b.id].workDebt;

            if (Math.abs(debtA - debtB) > 1.0) {
                return debtB - debtA;
            }
            
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            return scoreB - scoreA;
        });
    }

    // --- 基礎設施 ---
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

    calculateDailyWorkDebt(currentDay) {
        let totalWorked = 0;
        this.staffList.forEach(s => {
            totalWorked += this.getTotalShiftsUpTo(s.id, currentDay - 1);
        });
        
        this.avgWorkDays = totalWorked / this.staffList.length;

        this.staffList.forEach(s => {
            const myWork = this.getTotalShiftsUpTo(s.id, currentDay - 1);
            let debt = this.avgWorkDays - myWork;

            if (this.staffStats[s.id].isLongVacationer) {
                debt += 3.0; 
            }
            this.staffStats[s.id].workDebt = debt;
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
