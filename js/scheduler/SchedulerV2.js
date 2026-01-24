// js/scheduler/SchedulerV2.js
// 🚀 升級版：支援長假例外、多重公平性平衡、分段平衡

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.MAX_SWAP_ATTEMPTS = 5;
    }

    run() {
        console.log(`🚀 SchedulerV2 Advanced Mode Start.`);
        
        // 1. 初始化
        this.applyPreSchedules();

        // [新功能] 計算分段平衡檢查點
        const segments = this.rules.aiParams?.balancingSegments || 1;
        const checkpoints = [];
        if (segments > 1) {
            const interval = Math.floor(this.daysInMonth / segments);
            for (let i = 1; i < segments; i++) {
                checkpoints.push(i * interval);
            }
            console.log(`⚖️ 分段平衡點: ${checkpoints.join(', ')} 日`);
        }

        // 2. 逐日排班
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // [新功能] 執行分段平衡 (如果是檢查點)
            if (checkpoints.includes(d)) {
                console.log(`⚖️ 執行第 ${d} 日分段平衡...`);
                this.postProcessBalancing(d); // 傳入 d 代表只平衡到今天為止
            }
        }

        // 3. 最終全月平衡
        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
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

        candidates = this.sortCandidates(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;

            const isValid = this.isValidAssignment(staff, dateStr, shiftCode);
            const isGroupValid = this.checkGroupMaxLimit(day, staff, shiftCode);

            if (isValid && isGroupValid) {
                this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                gap--;
            } 
            else {
                if (gap > 0 && this.tryResolveConflict(day, staff, shiftCode)) {
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

    // 覆寫 isValidAssignment 以加入長假例外判斷
    isValidAssignment(staff, dateStr, shiftCode) {
        // 1. 呼叫 BaseScheduler 的基礎檢查 (間隔、規則等)
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        if (!baseValid) return false;

        // 2. [新功能] 長假排班例外檢查
        // 如果基礎檢查通過，但卡在「連續上班天數」，這裡做例外放寬
        // 注意：BaseScheduler 可能已經擋下了連續上班，所以我們要在這裡「重新檢查並放寬」
        
        // 取得目前連續天數
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        // 如果加上今天還沒超過一般上限，那就沒問題
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        if (consDays + 1 <= normalLimit) return true;

        // 如果超過一般上限，檢查是否符合「長假例外」
        const longVacDays = this.rules.policy?.longVacationDays || 7;
        const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
        
        if (consDays + 1 <= longVacLimit) {
            // 檢查是否剛休完長假 (往前找是否有連續 longVacDays 的 OFF)
            if (this.hasRecentLongVacation(staff.id, dateStr, longVacDays)) {
                // 符合例外條件，允許上班
                return true; 
            }
        }

        // 如果不符合例外，且 BaseScheduler 判定違規 (通常 BaseScheduler 會用 strict 模式)
        // 這裡回傳 false (因為前面 super 已經過了，代表不是其他硬規則擋的，而是連續上班擋的)
        // 為了保險，若 super 回傳 true 但這裡算出來連 7 天且無例外，要擋
        if (consDays + 1 > normalLimit) return false;

        return true;
    }

    // [新功能] 檢查是否有近期長假
    hasRecentLongVacation(uid, currentDateStr, threshold) {
        // 簡單實作：檢查過去 14 天內是否有連續 threshold 天的 OFF
        // 這裡可以根據實際定義調整搜尋範圍
        const currentDay = new Date(currentDateStr).getDate();
        let consecutiveOff = 0;
        
        // 往前檢查 (包含上個月)
        // 為了效能，這裡簡化檢查本月目前為止的狀況
        for (let d = currentDay - 1; d >= 1; d--) {
            const shift = this.getShiftByDate(this.getDateStr(d), uid);
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                consecutiveOff++;
                if (consecutiveOff >= threshold) return true;
            } else {
                consecutiveOff = 0;
            }
        }
        // 如果需要檢查上個月，需結合 lastMonthData，邏輯較複雜，暫略
        return false;
    }

    sortCandidates(staffList, dateStr, shiftCode) {
        return staffList.sort((a, b) => {
            const scoreA = this.calculateScore(a, dateStr, shiftCode);
            const scoreB = this.calculateScore(b, dateStr, shiftCode);
            return scoreB - scoreA; 
        });
    }

    calculateScore(staff, dateStr, shiftCode) {
        let score = 0;
        let prefs = {};
        if (staff.prefs) {
            if (staff.prefs[dateStr]) prefs = staff.prefs[dateStr];
            else if (staff.prefs.favShift || staff.prefs.bundleShift) prefs = staff.prefs;
        }
        
        const params = staff.schedulingParams || {};

        if (prefs.favShift === shiftCode) score += 1000;
        else if (prefs.favShift2 === shiftCode) score += 500;
        else if (prefs.favShift3 === shiftCode) score += 200;

        const bundleShift = staff.packageType || prefs.bundleShift;
        if (bundleShift === shiftCode) score += 800;

        if (params[dateStr] === '!' + shiftCode) score -= 2000; 

        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        score -= (consDays * 50);

        score -= (this.getTotalShifts(staff.id) * 10);

        return score;
    }

    tryResolveConflict(day, staff, targetShift) {
        if (day === 1) return false;
        const dateStr = this.getDateStr(day);
        const prevDateStr = this.getDateStr(day - 1);
        const prevShift = this.getShiftByDate(prevDateStr, staff.id);

        if (this.checkRestPeriod(prevShift, targetShift)) return false; 

        const swapCandidates = this.staffList.filter(s => 
            s.id !== staff.id && 
            this.getShiftByDate(prevDateStr, s.id) === 'OFF' &&
            !this.isPreRequestOff(s.id, prevDateStr) 
        );

        for (const candidate of swapCandidates) {
            if (this.isValidAssignment(candidate, prevDateStr, prevShift)) {
                this.updateShift(prevDateStr, candidate.id, 'OFF', prevShift);
                this.updateShift(prevDateStr, staff.id, prevShift, 'OFF');
                return true; 
            }
        }
        return false;
    }
    
    // [升級] 支援多重公平性平衡
    postProcessBalancing(limitDay) {
        const rounds = this.rules.fairness?.balanceRounds || 100;
        const isFairNight = this.rules.fairness?.fairNight !== false; // 預設開啟
        const isFairOff = this.rules.fairness?.fairOff !== false;     // 預設開啟

        // 1. 夜班平衡
        if (isFairNight) {
            this.balanceShiftType('N', limitDay, rounds);
        }

        // 2. 休假平衡 (OFF)
        // 休假平衡較特殊，是要讓 OFF 少的人變多，也就是把他的班換給 OFF 多的人
        if (isFairOff) {
            this.balanceShiftType('OFF', limitDay, rounds);
        }
    }

    balanceShiftType(targetShift, limitDay, rounds) {
        // Helper: 鎖定檢查
        const isLocked = (d, uid) => {
             const dateStr = this.getDateStr(d);
             const s = this.staffList.find(x => x.id === uid);
             return s?.schedulingParams?.[dateStr] !== undefined; 
        };

        for (let r = 0; r < rounds; r++) {
            // 統計該班別數量
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

            // 尋找交換機會
            let swapped = false;
            for (let d = 1; d <= limitDay; d++) {
                if (isLocked(d, maxPerson.id) || isLocked(d, minPerson.id)) continue;

                const dateStr = this.getDateStr(d);
                const shiftMax = this.getShiftByDate(dateStr, maxPerson.id);
                const shiftMin = this.getShiftByDate(dateStr, minPerson.id);

                // 邏輯 A: 平衡 'N' -> Max 是 N, Min 不是 N
                if (targetShift !== 'OFF') {
                    if (shiftMax !== targetShift || shiftMin === targetShift) continue;
                    
                    if (!this.isValidAssignment(minPerson.obj, dateStr, targetShift)) continue;
                    if (!this.isValidAssignment(maxPerson.obj, dateStr, shiftMin)) continue;

                    this.updateShift(dateStr, maxPerson.id, targetShift, shiftMin);
                    this.updateShift(dateStr, minPerson.id, shiftMin, targetShift);
                    swapped = true;
                } 
                // 邏輯 B: 平衡 'OFF' -> Max 是 OFF (休太多), Min 不是 OFF (休太少)
                // 我們要讓 Max 去上班(shiftMin), Min 來休假(OFF)
                else {
                    if (shiftMax !== 'OFF' || shiftMin === 'OFF') continue;

                    // Min 變成 OFF 一定合法 (除非當天必須上班? 暫不考慮)
                    // 重點是 Max 能不能去上 Min 的班 (shiftMin)
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
