// js/scheduler/SchedulerV2.js
// 🚀 最終旗艦修正版 (Fixed): 補回遺失的 applyPreSchedules，確保預班能正確載入

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; // 分段平衡點
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 3; // 讀取回溯天數設定
    }

    run() {
        console.log(`🚀 SchedulerV2 Flagship Mode Start.`);
        
        // 1. 初始化
        this.applyPreSchedules(); // [修復] 這裡不會再報錯了
        this.calculateProjectedStats(); 

        // 2. 計算分段平衡檢查點 (Segmentation)
        const segments = this.rules.aiParams?.balancingSegments || 1;
        if (segments > 1) {
            const interval = Math.floor(this.daysInMonth / segments);
            for (let i = 1; i < segments; i++) {
                this.checkpoints.push(i * interval);
            }
            console.log(`📍 設定分段平衡點: ${this.checkpoints.join(', ')}`);
        }

        // 3. 逐日排班 (Main Loop)
        for (let d = 1; d <= this.daysInMonth; d++) {
            
            // [水位監控] 計算當日工作債務
            this.calculateDailyWorkDebt(d);

            const dailyNeeds = this.getDailyNeeds(d);
            
            // 隨機打亂班別順序
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            // 填補該日需求
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // [分段平衡機制]
            if (this.checkpoints.includes(d)) {
                console.log(`⚖️ 抵達分段點 Day ${d}，執行平衡微調...`);
                this.postProcessBalancing(d);
            }
        }

        // 4. 最終全月平衡
        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // --- [修復核心] 補回遺失的預班處理函式 ---
    applyPreSchedules() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const req = params[dateStr];
                // 處理預假 (REQ_OFF)
                if (req === 'REQ_OFF') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                }
                // 處理指定班 (如預排 D, N 等，且非 ! 開頭的排斥班)
                else if (req && req !== 'OFF' && !req.startsWith('!')) {
                    this.updateShift(dateStr, staff.id, 'OFF', req);
                }
            }
        });
    }

    // --- [核心邏輯 A] 水位監控與預判 ---

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
        // 計算全體平均已上班天數
        let totalWorked = 0;
        this.staffList.forEach(s => {
            totalWorked += this.getTotalShiftsUpTo(s.id, currentDay - 1);
        });
        const averageWork = totalWorked / this.staffList.length;

        this.staffList.forEach(s => {
            const myWork = this.getTotalShiftsUpTo(s.id, currentDay - 1);
            // 債務 > 0 代表上班太少，需要補班
            let debt = averageWork - myWork;

            // 長假人員加權：因為之後會休假，現在必須多上班
            if (this.staffStats[s.id].isLongVacationer) {
                debt += 2.5; 
            }
            this.staffStats[s.id].workDebt = debt;
        });
    }

    // --- [核心邏輯 B] 填班與決策 (含回溯) ---

    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        // 取得候選人 (目前是 OFF 的人)
        let candidates = this.staffList.filter(s => {
            return this.getShiftByDate(dateStr, s.id) === 'OFF';
        });

        // 依照「債務 > 分數」排序
        this.sortCandidatesByDebtAndScore(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;

            const debt = this.staffStats[staff.id].workDebt;
            const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
            
            let shouldAssign = false;

            // 決策樹：
            // 1. 欠班組 (Debt > -0.5)：優先排班。
            if (debt > -0.5) {
                shouldAssign = true; 
            } 
            // 2. 應休組 (Debt <= -0.5)：只有符合志願才幫忙補缺
            else {
                if (scoreInfo.isPreferred) {
                    shouldAssign = true; // 為了救急，且是我喜歡的班，可以上
                } else {
                    shouldAssign = false; // 既不欠班，又不喜歡，保持 OFF
                }
            }

            // 如果分數低到離譜 (例如 Must 模式下的非志願)，視為不應指派
            if (scoreInfo.totalScore < -50000) {
                shouldAssign = false;
            }

            if (shouldAssign) {
                if (this.assignIfValid(day, staff, shiftCode)) {
                    gap--;
                } else {
                    // 嘗試當日換班解決
                    if (this.tryResolveConflict(day, staff, shiftCode)) {
                         if (this.assignIfValid(day, staff, shiftCode)) gap--;
                    }
                }
            }
        }
        
        // [核心邏輯 C] 策略回溯 (Backtracking)
        // 如果還是有缺口，且設定允許回溯
        if (gap > 0 && this.backtrackDepth > 0) {
            const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
            gap -= recovered;
        }

        if (gap > 0) {
            console.warn(`[缺口警示] ${dateStr} ${shiftCode} 尚缺 ${gap} 人 (已回溯嘗試無法解決，等待下階段平衡)`);
        }
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

    // --- [核心邏輯 D] 回溯機制實作 ---
    
    resolveShortageWithBacktrack(currentDay, targetShift, gap) {
        let recovered = 0;
        // 往回找 N 天
        for (let d = currentDay - 1; d >= Math.max(1, currentDay - this.backtrackDepth); d--) {
            if (gap <= 0) break;
            const pastDateStr = this.getDateStr(d);
            const currentDateStr = this.getDateStr(currentDay);

            // 策略：釋放連續上班壓力
            // 找出今天 OFF 但被卡連續上班的人
            const candidates = this.staffList.filter(s => 
                this.getShiftByDate(currentDateStr, s.id) === 'OFF' &&
                !this.isPreRequestOff(s.id, currentDateStr)
            );

            for (const staff of candidates) {
                if (gap <= 0) break;
                
                // 檢查是否因為連續上班而被擋
                const consDays = this.getConsecutiveWorkDays(staff.id, currentDateStr);
                const limit = this.rules.policy?.maxConsDays || 6;
                
                if (consDays + 1 > limit) {
                    // 嘗試把他在過去(d日)的班改成 OFF
                    const pastShift = this.getShiftByDate(pastDateStr, staff.id);
                    if (pastShift !== 'OFF' && pastShift !== 'REQ_OFF') {
                        // 試探性修改
                        this.updateShift(pastDateStr, staff.id, pastShift, 'OFF');
                        
                        // 檢查現在能不能上 targetShift
                        if (this.assignIfValid(currentDay, staff, targetShift)) {
                            // 成功！
                            gap--;
                            recovered++;
                        } else {
                            // 失敗，改回來 (Backtrack revert)
                            this.updateShift(pastDateStr, staff.id, 'OFF', pastShift);
                        }
                    }
                }
            }
        }
        return recovered;
    }

    // --- 排序與分數 ---

    sortCandidatesByDebtAndScore(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates); 

        candidates.sort((a, b) => {
            const debtA = this.staffStats[a.id].workDebt;
            const debtB = this.staffStats[b.id].workDebt;

            // 1. 債務區間：欠債組(>0) 優先於 應休組(<=0)
            if (debtA > 0 && debtB <= 0) return -1; 
            if (debtB > 0 && debtA <= 0) return 1;  

            // 2. 同區間內，看分數 (志願符合度)
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            
            return scoreB - scoreA;
        });
    }

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

        // 志願
        if (prefs.favShift === shiftCode) { score += 1000; isPreferred = true; }
        else if (prefs.favShift2 === shiftCode) { score += 500; isPreferred = true; }
        else if (prefs.favShift3 === shiftCode) { score += 200; isPreferred = true; }

        // 包班
        const bundleShift = staff.packageType || prefs.bundleShift;
        const bundleMode = policy.prioritizeBundle || 'must';
        if (bundleShift === shiftCode) {
            score += (bundleMode === 'must') ? 5000 : 800;
            isPreferred = true;
        }

        // 非志願懲罰 (Strict)
        const hasPreferences = prefs.favShift || prefs.favShift2 || prefs.favShift3 || prefs.bundleShift;
        const prefMode = policy.prioritizePref || 'must';
        if (hasPreferences && !isPreferred) {
            if (prefMode === 'must') score -= 999999; // 毀滅性扣分
            else score -= 5000;
        }

        // 排斥
        const params = staff.schedulingParams || {};
        const avoidMode = policy.prioritizeAvoid || 'must';
        if (params[dateStr] === '!' + shiftCode) {
             score -= (avoidMode === 'must') ? 999999 : 10000;
        }

        return { totalScore: score, isPreferred: isPreferred };
    }

    // --- 輔助函式 ---

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
