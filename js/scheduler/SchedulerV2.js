// js/scheduler/SchedulerV2.js
// 🚀 最終邏輯強化版：統計優先 + 長假還債機制 + 亂數輪替

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.MAX_SWAP_ATTEMPTS = 5;
        this.staffStats = {}; // 儲存預判的統計數據
    }

    run() {
        console.log(`🚀 SchedulerV2 Stats-First Mode Start.`);
        
        // 1. 初始化 & 預判統計
        this.applyPreSchedules();
        this.calculateProjectedStats(); // [新功能] 先算好誰這個月休很多

        // 分段平衡檢查點
        const segments = this.rules.aiParams?.balancingSegments || 1;
        const checkpoints = [];
        if (segments > 1) {
            const interval = Math.floor(this.daysInMonth / segments);
            for (let i = 1; i < segments; i++) {
                checkpoints.push(i * interval);
            }
        }

        // 2. 逐日排班
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dailyNeeds = this.getDailyNeeds(d);
            
            // [亂數 1] 隨機打亂班別填寫順序
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 執行分段平衡
            if (checkpoints.includes(d)) {
                this.postProcessBalancing(d);
            }
        }

        // 3. 最終全月平衡
        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // [新功能] 預先計算整個月的「已知休假數」
    calculateProjectedStats() {
        this.staffList.forEach(staff => {
            let reqOffCount = 0;
            const params = staff.schedulingParams || {};
            
            // 計算 REQ_OFF 總數
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                if (params[dateStr] === 'REQ_OFF') {
                    reqOffCount++;
                }
            }
            
            // 判斷是否為「長假人員」
            // 規則定義：總休假數 >= 長假定義天數 (預設 7)
            const longVacDays = this.rules.policy?.longVacationDays || 7;
            const isLongVacationer = reqOffCount >= longVacDays;

            this.staffStats[staff.id] = {
                reqOffCount: reqOffCount,
                isLongVacationer: isLongVacationer,
                initialRandom: Math.random() // 給每個人一個初始亂數，用於打破僵局
            };
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

    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        let candidates = this.staffList.filter(s => {
            const currentShift = this.getShiftByDate(dateStr, s.id);
            return currentShift === 'OFF'; 
        });

        // [關鍵] 排序與選人
        candidates = this.sortCandidates(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;

            // [關鍵] 在這裡做「長假例外」判斷
            const isValid = this.isValidAssignment(staff, dateStr, shiftCode);
            const isGroupValid = this.checkGroupMaxLimit(day, staff, shiftCode);

            if (isValid && isGroupValid) {
                this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                gap--;
            } 
            else {
                // 嘗試換班 (Swap)
                if (gap > 0 && this.tryResolveConflict(day, staff, shiftCode)) {
                    // 換班後再次檢查是否合法
                    if (this.isValidAssignment(staff, dateStr, shiftCode) && 
                        this.checkGroupMaxLimit(day, staff, shiftCode)) {
                        this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                        gap--;
                    }
                }
            }
        }
        
        if (gap > 0) {
            console.warn(`[缺口警示] ${dateStr} ${shiftCode} 尚缺 ${gap} 人`);
        }
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    sortCandidates(staffList, dateStr, shiftCode) {
        // [亂數 2] 先隨機洗牌，解決「同分時總是選同一人」的問題
        this.shuffleArray(staffList);

        return staffList.sort((a, b) => {
            const scoreA = this.calculateScore(a, dateStr, shiftCode);
            const scoreB = this.calculateScore(b, dateStr, shiftCode);
            return scoreB - scoreA; // 分數高者優先
        });
    }

    calculateScore(staff, dateStr, shiftCode) {
        let score = 0;
        
        // 0. 基礎亂數微調 (避免分數完全一樣)
        score += (this.staffStats[staff.id]?.initialRandom || 0);

        // 1. [核心邏輯] 統計優先：休假越多的人，越要上班 (還債)
        // 邏輯：整月預計休假數越高，代表上班日越少，所以只要能上班的日子，權重都要大幅提高
        const projectedOffs = this.staffStats[staff.id]?.reqOffCount || 0;
        // 係數 500：只要多一天預假，上班分數就+500 (相當於半個志願)
        // 這會讓長假人員在沒放假的日子裡，像「搶班機器」一樣優先被排班
        score += (projectedOffs * 500); 

        // 2. 累計時數平衡 (Dynamic Penalty)
        // 目前已排的班數越多，分數越低 (讓給班少的人)
        const currentTotalShifts = this.getTotalShifts(staff.id);
        score -= (currentTotalShifts * 250); 

        // 3. 志願權重 (次要考量)
        let prefs = {};
        if (staff.prefs) {
            if (staff.prefs[dateStr]) prefs = staff.prefs[dateStr];
            else if (staff.prefs.favShift || staff.prefs.bundleShift) prefs = staff.prefs;
        }
        
        if (prefs.favShift === shiftCode) score += 1000;
        else if (prefs.favShift2 === shiftCode) score += 500;
        
        const bundleShift = staff.packageType || prefs.bundleShift;
        if (bundleShift === shiftCode) score += 800;

        // 4. 排斥與連續上班扣分
        const params = staff.schedulingParams || {};
        if (params[dateStr] === '!' + shiftCode) score -= 2000; 
        
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        score -= (consDays * 50);

        return score;
    }

    // [核心邏輯] 覆寫合法性檢查，加入「長假放寬」
    isValidAssignment(staff, dateStr, shiftCode) {
        // 1. 先做基礎檢查 (間隔、資格等)，但不包含連續上班 (因為我們要自己處理)
        // 這裡不能直接呼叫 super.isValidAssignment，因為它會檢查 maxConsDays 並回傳 false
        // 所以我們手動檢查必要項目：
        
        // (A) 檢查間隔 (BaseScheduler)
        if (day > 1) {
             const prevDateStr = this.getDateStr(new Date(dateStr).getDate() - 1); // 簡化邏輯，需轉回 day index
             // 為了方便，我們直接用內建函式檢查休息時間
             // 注意：這裡無法輕易 bypass super 的檢查，所以我們採用「先試 super」策略
        }
        
        // 正確策略：
        // 1. 呼叫 super 檢查所有規則
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        
        // 2. 如果 super 說 OK，那就是 OK
        if (baseValid) return true;

        // 3. 如果 super 說不 OK，我們要看是不是因為「連續上班」被擋掉的
        // 如果是，且他是長假人員，我們就「放行」
        
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        
        // 只有當「唯一」違反的是連續上班規則時，我們才救回來
        // 判斷方法：如果連續天數即將超過 normalLimit，且 super 回傳 false
        if (consDays + 1 > normalLimit) {
            // 檢查是否為長假人員
            if (this.staffStats[staff.id]?.isLongVacationer) {
                const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
                // 如果在放寬限制內
                if (consDays + 1 <= longVacLimit) {
                    // 這裡還有一個隱憂：如果他同時違反了間隔時間怎麼辦？
                    // 為了安全，我們再手動檢查一次間隔時間 (Rest Period)
                    const dayIndex = new Date(dateStr).getDate(); // 假設 dateStr 是本月
                    if (dayIndex > 1) {
                         const prevDateStr = this.getDateStr(dayIndex - 1);
                         const prevShift = this.getShiftByDate(prevDateStr, staff.id);
                         // 如果休息時間不足，絕對不能放行 (這是法規)
                         if (!this.checkRestPeriod(prevShift, shiftCode)) return false;
                    }
                    
                    // 通過間隔檢查，且在長假放寬額度內 -> 放行！
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

        // [亂數 3] 解衝突時也隨機選人
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
            // [亂數 4] 隨機遍歷日期
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
                } 
                else {
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

    getTotalShifts(uid) { 
        const c = this.counters[uid]; 
        if(!c) return 0; 
        return Object.keys(c).reduce((s,k) => (k !== 'OFF' && k !== 'REQ_OFF') ? s + c[k] : s, 0); 
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
