// js/scheduler/SchedulerV2.js
// 🚀 最終定案版：每日資源再分配 (Daily Reallocation) + 爛班防護 + 通用回溯

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; 
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 3;
        this.avgWorkDays = 0; 
        
        // 讀取容許差異設定 (預設 2 天)
        this.tolerance = this.rules.fairness?.fairOffVar || 2;
        // 最少連續上班天數 (預設 2 天)
        this.minCons = this.rules.pattern?.minConsecutive || 2;
    }

    run() {
        console.log(`🚀 SchedulerV2 Reallocation Mode (Tolerance: ±${this.tolerance}).`);
        
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
            
            // 1. 每日檢討水位 (計算當下誰欠班、誰加班)
            this.calculateDailyWorkDebt(d);

            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            // 2. 正常填班 (填補缺額)
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 3. [核心] 每日資源再分配 (在進入下一天前，調整今日的貧富不均)
            this.optimizeDailyAllocation(d);

            // 4. 分段平衡 (每週大檢查)
            if (this.checkpoints.includes(d)) {
                this.postProcessBalancing(d);
            }
        }

        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // --- [核心功能] 每日資源再分配 (Reallocation) ---
    optimizeDailyAllocation(day) {
        const dateStr = this.getDateStr(day);
        
        // 1. 找出所有「今日排休 (OFF)」的人 -> 潛在的【貧窮戶】
        const offStaffs = this.staffList.filter(s => {
            const shift = this.getShiftByDate(dateStr, s.id);
            return (shift === 'OFF') && !this.isPreRequestOff(s.id, dateStr);
        });

        // 依照債務排序：欠班最多的人優先獲得分配權
        offStaffs.sort((a, b) => this.staffStats[b.id].workDebt - this.staffStats[a.id].workDebt);

        for (const poorStaff of offStaffs) {
            const poorDebt = this.staffStats[poorStaff.id].workDebt;
            
            // 如果這個人並不窮 (債務 <= 0)，不需要幫他搶班
            if (poorDebt <= 0) continue;

            // 2. 取得這個人的志願 (我們只幫他搶他願意上的班，避免爛班)
            const scoreInfo = this.calculateScoreInfo(poorStaff, dateStr, 'D'); // 取得偏好參考
            // 找出他所有的正面志願 (分數 > 0 的班別)
            const targetShifts = this.shiftCodes.filter(code => {
                if (code === 'OFF' || code === 'REQ_OFF') return false;
                const s = this.calculateScoreInfo(poorStaff, dateStr, code);
                // 嚴格過濾：必須不違反 Must，且分數不能太低 (代表是可接受的班)
                return s.totalScore > -1000; 
            });
            
            // 依照分數高低排序志願 (最想上的班優先搶)
            targetShifts.sort((a, b) => {
                return this.calculateScoreInfo(poorStaff, dateStr, b).totalScore - 
                       this.calculateScoreInfo(poorStaff, dateStr, a).totalScore;
            });

            // 3. 嘗試搶班
            for (const targetCode of targetShifts) {
                // 找出目前佔用這個班的人 -> 潛在的【富有戶】
                const assignedUids = this.schedule[dateStr][targetCode] || [];
                
                let bestTargetToSwap = null;
                let maxDebtDiff = -999;

                for (const uid of assignedUids) {
                    const richStaff = this.staffList.find(s => s.id === uid);
                    if (!richStaff || this.isPreRequestOff(richStaff.id, dateStr)) continue; 

                    const richDebt = this.staffStats[richStaff.id].workDebt;
                    const diff = poorDebt - richDebt; // 貧富差距

                    // 條件：差距超過容許值 (Tolerance)
                    if (diff > this.tolerance) {
                        if (diff > maxDebtDiff) {
                            // [關鍵] 雙重防護檢查：確保交換後，雙方都不會變成爛班
                            // 這裡使用 calculateScoreInfo 來判斷是否造成嚴重扣分
                            if (this.checkSwapValidity(day, poorStaff, 'OFF', targetCode) && 
                                this.checkSwapValidity(day, richStaff, targetCode, 'OFF')) {
                                bestTargetToSwap = richStaff;
                                maxDebtDiff = diff;
                            }
                        }
                    }
                }

                // 執行交換
                if (bestTargetToSwap) {
                    // console.log(`🔄 [再分配] Day ${day}: ${poorStaff.name} 接手 ${bestTargetToSwap.name} 的 ${targetCode}`);
                    this.updateShift(dateStr, bestTargetToSwap.id, targetCode, 'OFF'); 
                    this.updateShift(dateStr, poorStaff.id, 'OFF', targetCode); 
                    break; // 搶到一個班就夠了
                }
            }
        }
    }

    // --- 輔助：檢查交換是否造成爛班 (使用分數評估) ---
    checkSwapValidity(day, staff, currentShift, newShift) {
        const dateStr = this.getDateStr(day);
        
        // 1. 基礎合法性 (間隔、資格、工時)
        if (!this.isValidAssignment(staff, dateStr, newShift)) return false;

        // 2. 分數檢測 (利用 calculateScoreInfo 內建的連續性與志願判斷)
        // 如果新班別的分數極低 (例如違反 Must 或造成嚴重破碎)，則視為無效交換
        const scoreInfo = this.calculateScoreInfo(staff, dateStr, newShift);
        if (scoreInfo.totalScore < -50000) return false; // 違反 Must
        if (scoreInfo.totalScore < -2000) return false;  // 造成嚴重爛班 (如做一休一)

        return true;
    }

    // --- 填班邏輯 (含通用回溯) ---
    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        let candidates = this.staffList.filter(s => {
            return this.getShiftByDate(dateStr, s.id) === 'OFF';
        });

        // 排序：容許範圍內看分數，超出範圍看債務
        this.sortCandidatesBySmartDebt(candidates, dateStr, shiftCode);

        // 第一輪：直接填補
        for (const staff of candidates) {
            if (gap <= 0) break;

            const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
            // 嚴格合規：非志願 (Must) 跳過
            if (scoreInfo.totalScore < -50000) continue;

            if (this.assignIfValid(day, staff, shiftCode)) {
                gap--;
            } else {
                if (this.tryResolveConflict(day, staff, shiftCode)) {
                     if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }
        }
        
        // 第二輪：通用回溯填補 (缺額時啟動)
        if (gap > 0 && this.backtrackDepth > 0) {
            const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
            gap -= recovered;
        }

        if (gap > 0) {
            console.warn(`[缺口警示] ${dateStr} ${shiftCode} 尚缺 ${gap} 人`);
        }
    }

    // --- 分數計算 (爛班懲罰 + 80/20 + 嚴格志願) ---
    calculateScoreInfo(staff, dateStr, shiftCode) {
        let score = 0;
        const policy = this.rules.policy || {};
        const debt = this.staffStats[staff.id]?.workDebt || 0;
        
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;

        // 1. 連續性評分 (避免爛班)
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const currentDayIdx = new Date(dateStr).getDate();
        let prevShift = 'OFF';
        if (currentDayIdx > 1) {
            const prevDateStr = this.getDateStr(currentDayIdx - 1);
            prevShift = this.getShiftByDate(prevDateStr, staff.id);
        }

        if (shiftCode !== 'OFF') { // 如果評估的是上班
            if (prevShift !== 'OFF' && prevShift !== 'REQ_OFF') {
                // 延續獎勵：已經在上班了，鼓勵連上
                if (consDays < this.minCons) score += 5000; // 未達最少天數，強力加分
                else if (consDays < (policy.maxConsDays || 6)) score += 500; 
                else score -= 2000; // 快爆肝了
            } else {
                // 啟動成本：剛休完，除非欠班，否則不急著上
                if (debt < 1.0) score -= 300; 
            }
        }

        // 2. 志願與包班 (80/20)
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
                // 包班滿了或欠班，第二志願加分
                if (bundleRatio >= targetRatio || debt > 1.0) score += 3000; 
                else score += 500;
            } else {
                score += 500; 
            }
        }
        
        if (prefs.favShift3 === shiftCode) { score += 200; isPreferred = true; }

        // 3. 非志願懲罰 (嚴格執行 Must)
        const hasPreferences = prefs.favShift || prefs.favShift2 || prefs.bundleShift;
        const prefMode = policy.prioritizePref || 'must'; 
        
        if (hasPreferences && !isPreferred) {
            if (prefMode === 'must') score -= 999999; 
            else score -= 5000;
        }

        // 4. 排斥
        const params = staff.schedulingParams || {};
        const avoidMode = policy.prioritizeAvoid || 'must';
        if (params[dateStr] === '!' + shiftCode) {
             score -= (avoidMode === 'must') ? 999999 : 10000;
        }

        return { totalScore: score, isPreferred: isPreferred };
    }

    // --- 排序策略 ---
    sortCandidatesBySmartDebt(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates); 

        candidates.sort((a, b) => {
            const debtA = this.staffStats[a.id].workDebt;
            const debtB = this.staffStats[b.id].workDebt;
            const diff = debtA - debtB;

            // 超出容許差異 -> 強制優先
            if (diff > this.tolerance) return -1; 
            if (diff < -this.tolerance) return 1;

            // 範圍內 -> 分數決勝
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            
            return scoreB - scoreA; 
        });
    }

    // --- 通用回溯 (填補缺額用) ---
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
                // 嘗試回溯解鎖 (這裡也會檢查 Must)
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
        // 嚴格志願檢查：如果他不想上，回溯也沒用
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
                    // 檢查交換是否造成 Max 爛班
                    if (!this.checkSwapValidity(d, maxPerson.obj, shiftMax, shiftMin)) continue;
                    
                    // 檢查 Min 是否能接手 (含回溯嘗試)
                    let minCanTake = this.checkSwapValidity(d, minPerson.obj, shiftMin, shiftMax);
                    
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
            if (this.staffStats[s.id].isLongVacationer) debt += 3.0; 
            this.staffStats[s.id].workDebt = debt;
        });
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

    countSpecificShiftsUpTo(uid, dayLimit, targetShift) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            if (this.getShiftByDate(this.getDateStr(d), uid) === targetShift) count++;
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
