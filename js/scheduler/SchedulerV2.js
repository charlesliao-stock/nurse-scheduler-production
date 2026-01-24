// js/scheduler/SchedulerV2.js
// 🚀 80/20 法則版：包班不再是死板的限制，而是動態的比例控制

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; 
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 3;
        this.avgWorkDays = 0; 
    }

    run() {
        console.log(`🚀 SchedulerV2 80/20 Mix Mode Start.`);
        
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
            
            // 1. 更新當日的水位 (債務狀況)
            this.calculateDailyWorkDebt(d);

            const dailyNeeds = this.getDailyNeeds(d);
            
            // 隨機打亂填班順序
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            if (this.checkpoints.includes(d)) {
                this.postProcessBalancing(d);
            }
        }

        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // --- 統計與水位 ---
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

    // --- 填班邏輯 ---
    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        let candidates = this.staffList.filter(s => {
            return this.getShiftByDate(dateStr, s.id) === 'OFF';
        });

        // 依照債務排序 (欠最多的排前面)
        this.sortCandidatesByDebt(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;

            const debt = this.staffStats[staff.id].workDebt;
            const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
            
            let shouldAssign = false;

            // 1. 赤貧戶 (欠班嚴重 > 2) -> 強制上班
            if (debt > 2.0) {
                // 只要不是被排斥(!X)或極度非志願，就得上
                if (scoreInfo.totalScore > -500000) shouldAssign = true;
            }
            // 2. 暴發戶 (加班太多 < -2) -> 強制休息
            else if (debt < -2.0) {
                shouldAssign = false; 
            } 
            // 3. 一般戶
            else {
                // 只要有欠債 (> -0.5)，且分數是正的 (志願/包班/第二志願)，就排
                if (debt > -0.5) {
                    // 這裡放寬標準：只要是 Preferred (含包班與第二志願) 或是欠債夠多
                    if (scoreInfo.isPreferred || debt > 1.0) shouldAssign = true;
                }
                else {
                    // 不欠債，只有完全符合高分偏好才排
                    if (scoreInfo.isPreferred && scoreInfo.totalScore > 500) shouldAssign = true;
                }
            }

            if (shouldAssign) {
                if (this.assignIfValid(day, staff, shiftCode)) {
                    gap--;
                } else {
                    if (this.tryResolveConflict(day, staff, shiftCode)) {
                         if (this.assignIfValid(day, staff, shiftCode)) gap--;
                    }
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

    // --- 排序與分數 (80/20 邏輯核心) ---

    calculateScoreInfo(staff, dateStr, shiftCode) {
        let score = 0;
        const policy = this.rules.policy || {};
        
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;

        let prefs = {};
        if (staff.prefs) {
            if (staff.prefs[dateStr]) prefs = staff.prefs[dateStr];
            else if (staff.prefs.favShift || staff.prefs.bundleShift) prefs = staff.prefs;
        }

        let isPreferred = false;
        
        // --- 1. 取得該員目前已排班數與包班數 (計算比例) ---
        const bundleShift = staff.packageType || prefs.bundleShift;
        const currentDay = new Date(dateStr).getDate();
        
        // 取得目前為止的總上班數
        const totalShiftsSoFar = this.getTotalShiftsUpTo(staff.id, currentDay - 1);
        // 取得目前為止的包班上班數
        let bundleShiftsSoFar = 0;
        if (bundleShift) {
            bundleShiftsSoFar = this.countSpecificShiftsUpTo(staff.id, currentDay - 1, bundleShift);
        }

        // 計算目前的包班率 (防除以0)
        const bundleRatio = (totalShiftsSoFar > 0) ? (bundleShiftsSoFar / totalShiftsSoFar) : 0;
        const targetRatio = 0.8; // 80%

        // --- 2. 評分邏輯 ---

        // A. 包班分數
        if (bundleShift === shiftCode) {
            isPreferred = true;
            // 如果包班率還沒到 80%，全力搶包班
            if (bundleRatio < targetRatio) {
                score += 5000; 
            } else {
                // 已經超過 80% 了，分數稍微降低，給別人一點機會，也給第二志願一點機會
                score += 2000;
            }
        }

        // B. 志願分數 (含第二志願)
        if (prefs.favShift === shiftCode) { score += 1000; isPreferred = true; }
        
        // [關鍵] 第二志願 - 80/20 調控
        if (prefs.favShift2 === shiftCode) {
            isPreferred = true;
            if (bundleShift) {
                // 如果是包班人員，且包班率已經太高 (>80%)，大幅提升第二志願權重
                // 讓他可以排入第二志願，避免死守包班卻搶不到，導致 OFF
                if (bundleRatio >= targetRatio) {
                    score += 3000; // 比超過比例的包班(2000)還高！
                } else {
                    score += 500; // 還是以包班為主
                }
            } else {
                score += 500; // 一般人的第二志願
            }
        }
        
        if (prefs.favShift3 === shiftCode) { score += 200; isPreferred = true; }

        // C. 非志願處理
        const hasPreferences = prefs.favShift || prefs.favShift2 || prefs.bundleShift;
        
        // 如果這個班「既不是包班，也不是志願1/2/3」
        if (hasPreferences && !isPreferred) {
            // 讀取設定，如果是 'must'，則嚴格禁止
            // 但現在我們有了「工作債務」邏輯，如果是赤貧戶，外部會忽略這個負分
            if (policy.prioritizePref === 'must') score -= 999999;
            else score -= 5000;
        }

        // D. 排斥與連續上班
        const params = staff.schedulingParams || {};
        const avoidMode = policy.prioritizeAvoid || 'must';
        if (params[dateStr] === '!' + shiftCode) {
             score -= (avoidMode === 'must') ? 999999 : 10000;
        }

        return { totalScore: score, isPreferred: isPreferred };
    }

    // --- 輔助函式 ---

    sortCandidatesByDebt(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates); 

        candidates.sort((a, b) => {
            const debtA = this.staffStats[a.id].workDebt;
            const debtB = this.staffStats[b.id].workDebt;

            // 債務優先 (差距 > 1.0 視為顯著差異)
            if (Math.abs(debtA - debtB) > 1.0) {
                return debtB - debtA;
            }
            
            // 債務差不多，看分數 (80/20 邏輯在 calculateScoreInfo 裡發揮作用)
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            return scoreB - scoreA;
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
            this.shuffleArray(days);

            for (const d of days) {
                if (isLocked(d, maxPerson.id) || isLocked(d, minPerson.id)) continue;
                const dateStr = this.getDateStr(d);
                const shiftMax = this.getShiftByDate(dateStr, maxPerson.id);
                const shiftMin = this.getShiftByDate(dateStr, minPerson.id);

                if (targetShift !== 'OFF') {
                    if (shiftMax !== targetShift || shiftMin === targetShift) continue;
                    if (!this.isValidAssignment(minPerson.obj, dateStr, targetShift)) continue;
                    if (!this.isValidAssignment(maxPerson.obj, dateStr, shiftMin)) continue;
                    this.updateShift(dateStr, maxPerson.id, targetShift, shiftMin);
                    this.updateShift(dateStr, minPerson.id, shiftMin, targetShift);
                    swapped = true;
                } else {
                    if (shiftMax !== 'OFF' || shiftMin === 'OFF') continue;
                    if (!this.isValidAssignment(maxPerson.obj, dateStr, shiftMin)) continue;
                    this.updateShift(dateStr, maxPerson.id, 'OFF', shiftMin);
                    this.updateShift(dateStr, minPerson.id, shiftMin, 'OFF');
                    swapped = true;
                }
                if (swapped) break; 
            }
            if (!swapped) break; 
        }
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

            for (const staff of candidates) {
                if (gap <= 0) break;
                const consDays = this.getConsecutiveWorkDays(staff.id, currentDateStr);
                const limit = this.rules.policy?.maxConsDays || 6;
                
                if (consDays + 1 > limit) {
                    const pastShift = this.getShiftByDate(pastDateStr, staff.id);
                    if (pastShift !== 'OFF' && pastShift !== 'REQ_OFF') {
                        this.updateShift(pastDateStr, staff.id, pastShift, 'OFF');
                        if (this.assignIfValid(currentDay, staff, targetShift)) {
                            gap--;
                            recovered++;
                        } else {
                            this.updateShift(pastDateStr, staff.id, 'OFF', pastShift);
                        }
                    }
                }
            }
        }
        return recovered;
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
