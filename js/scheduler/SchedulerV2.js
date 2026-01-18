// js/scheduler/SchedulerV2.js
// 🚀 最終修正版：每日即時回溯 + 嚴格遵守救火開關 + 分段平衡

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 3;
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 50;
        
        // 分段平衡設定 (1-6)
        this.balancingSegments = this.rules.aiParams?.balancingSegments || 1;
    }

    run() {
        // 動態計算檢查點
        let checkpoints = [];
        if (this.balancingSegments > 1) {
            const interval = Math.floor(this.daysInMonth / this.balancingSegments);
            for (let i = 1; i < this.balancingSegments; i++) checkpoints.push(interval * i);
        }

        console.log(`🚀 SchedulerV2: 開始排班 (每日即時回溯, 平衡段數: ${this.balancingSegments})`);
        this.lockPreRequests();

        // 取得管理者設定的救火開關 (絕對權威)
        const userAllowRelax = this.rules.policy?.enableRelaxation === true;

        // --- 每日迴圈 (Day 1 -> 30) ---
        for (let d = 1; d <= this.daysInMonth; d++) {
            
            // 1. 初步排班 (正向填入)
            // 先嘗試嚴格模式
            if (!this.solveDay(d, false)) {
                // 如果失敗且「管理者有開啟救火」，才嘗試放寬
                if (userAllowRelax) {
                    this.clearDayAssignments(d); 
                    this.solveDay(d, true);
                }
            }

            // 2. 🔥 每日即時檢測與回溯 (針對當日缺額立即補救)
            // 傳入 userAllowRelax，確保補救時也不會偷跑規則
            this.checkAndFillGap(d, userAllowRelax);

            // 3. 分段平衡 (若今天是檢查點，且不在救火模式下)
            if (checkpoints.includes(d) && !userAllowRelax) {
                // console.log(`⚖️ 分段平衡 (${d}/${this.daysInMonth})`);
                this.postProcessBalancing(d);
            }
        }

        // 4. 月底最終平衡 (非救火模式才做)
        if (!userAllowRelax) {
            this.postProcessBalancing(this.daysInMonth);
        }

        return this.formatResult();
    }

    solveDay(day, isRelaxMode) {
        const dateStr = this.getDateStr(day);
        const needs = this.getDailyNeeds(day);
        const staffPool = this.getAvailableStaff(day);

        for (const [shiftCode, count] of Object.entries(needs)) {
            let needed = count - this.countStaff(day, shiftCode);
            if (needed <= 0) continue;

            const candidates = this.sortCandidates(staffPool, dateStr, shiftCode);

            for (const staff of candidates) {
                if (needed <= 0) break;
                if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') continue;

                if (this.isValidAssignment(staff, dateStr, shiftCode, isRelaxMode)) {
                    this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                    needed--;
                }
            }
        }
        
        // 檢查是否滿足需求 (回傳 true/false 供 run() 判斷是否啟動救火)
        for (const [code, count] of Object.entries(needs)) {
            if (this.countStaff(day, code) < count) return false;
        }
        return true;
    }

    // ------------------------------------------------------
    // 🔥 每日即時回溯 (解決 "有兵卻排不進去" 的問題)
    // ------------------------------------------------------
    checkAndFillGap(day, allowRelax) {
        const needs = this.getDailyNeeds(day);
        const dateStr = this.getDateStr(day);
        
        for (const [targetShift, count] of Object.entries(needs)) {
            let currentCount = this.countStaff(day, targetShift);
            let gap = count - currentCount;

            if (gap > 0) {
                // 找出當天 OFF 的人 (潛在救兵)
                const offStaffs = this.staffList.filter(s => 
                    this.getShiftByDate(dateStr, s.id) === 'OFF'
                );
                // 洗牌增加隨機性
                const candidates = this.shuffleArray(offStaffs);

                for (const staff of candidates) {
                    if (gap <= 0) break;

                    // 1. 直接填入 (嚴格遵守 allowRelax)
                    if (this.isValidAssignment(staff, dateStr, targetShift, allowRelax)) { 
                        this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                        gap--;
                        continue;
                    }

                    // 2. 回溯交換：解決「11小時光間隔」問題 (卡昨天)
                    if (this.rules.hard?.minGap11) {
                        const prevShift = this.getYesterdayShift(staff.id, dateStr);
                        // 如果是因為昨天上太晚
                        if (!this.checkRestPeriod(prevShift, targetShift)) {
                            // 嘗試把昨天換掉
                            if (this.trySwapYesterday(staff, day, prevShift, allowRelax)) {
                                // 昨天換成功了，再試一次今天
                                if (this.isValidAssignment(staff, dateStr, targetShift, allowRelax)) {
                                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                                    gap--;
                                    continue;
                                }
                            }
                        }
                    }

                    // 3. 回溯交換：解決「連續上班」問題 (卡前幾天)
                    if (this.rules.policy?.limitConsecutive) {
                        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
                        // 這裡會呼叫 BaseScheduler 的 isLongVacationMonth 正確判斷上限
                        let limit = this.rules.policy.maxConsDays || 6;
                        if (this.isLongVacationMonth(staff)) {
                            limit = this.rules.policy.longVacationWorkLimit || 7;
                        }

                        // 如果在非救火模式下超標 (且救火沒開)，才嘗試解
                        // 如果救火已開，isValidAssignment 本來就會過，不會進到這裡
                        if (consDays >= limit) {
                            // 嘗試在前 2~4 天製造斷點
                            if (this.tryCreateBreak(staff, day, allowRelax)) {
                                if (this.isValidAssignment(staff, dateStr, targetShift, allowRelax)) {
                                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                                    gap--;
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    trySwapYesterday(targetStaff, currentDay, badShift, allowRelax) {
        if (currentDay <= 1) return false; 
        const prevDay = currentDay - 1;
        const prevDateStr = this.getDateStr(prevDay);

        const swapCandidates = this.staffList.filter(s => 
            s.id !== targetStaff.id && 
            this.getShiftByDate(prevDateStr, s.id) === 'OFF'
        );

        for (const candidate of swapCandidates) {
            // 檢查候選人能否接手 badShift (遵守 allowRelax)
            if (this.isValidAssignment(candidate, prevDateStr, badShift, allowRelax)) {
                this.updateShift(prevDateStr, candidate.id, 'OFF', badShift);
                this.updateShift(prevDateStr, targetStaff.id, badShift, 'OFF');
                return true; 
            }
        }
        return false;
    }

    tryCreateBreak(targetStaff, currentDay, allowRelax) {
        // 往前找 2~4 天
        for (let i = 2; i <= 4; i++) {
            const checkDay = currentDay - i;
            if (checkDay < 1) continue;
            const dateStr = this.getDateStr(checkDay);
            const currentShift = this.getShiftByDate(dateStr, targetStaff.id);
            
            if (currentShift === 'OFF' || currentShift === 'REQ_OFF') continue;

            const candidates = this.staffList.filter(s => 
                s.id !== targetStaff.id && 
                this.getShiftByDate(dateStr, s.id) === 'OFF'
            );

            for (const candidate of candidates) {
                if (this.isValidAssignment(candidate, dateStr, currentShift, allowRelax)) {
                    this.updateShift(dateStr, candidate.id, 'OFF', currentShift);
                    this.updateShift(dateStr, targetStaff.id, currentShift, 'OFF');
                    return true;
                }
            }
        }
        return false;
    }

    // ------------------------------------------------------
    // 排序與平衡邏輯
    // ------------------------------------------------------
    sortCandidates(staffList, dateStr, shiftCode) {
        const randomizedList = this.shuffleArray(staffList);
        const prevShiftMap = {};
        randomizedList.forEach(s => {
            prevShiftMap[s.id] = this.getYesterdayShift(s.id, dateStr);
        });

        return randomizedList.sort((a, b) => {
            const isBundleA = (a.packageType === shiftCode || a.prefs?.bundleShift === shiftCode);
            const isBundleB = (b.packageType === shiftCode || b.prefs?.bundleShift === shiftCode);
            if (isBundleA !== isBundleB) return isBundleA ? -1 : 1;

            const paramsA = a.schedulingParams?.[dateStr];
            const paramsB = b.schedulingParams?.[dateStr];
            const isReqA = (paramsA === shiftCode);
            const isReqB = (paramsB === shiftCode);
            if (isReqA !== isReqB) return isReqA ? -1 : 1;

            if (this.rules.pattern?.consecutivePref) {
                const prevA = prevShiftMap[a.id];
                const prevB = prevShiftMap[b.id];
                const isConsA = (prevA === shiftCode);
                const isConsB = (prevB === shiftCode);
                if (isConsA !== isConsB) return isConsA ? -1 : 1; 
            }

            const isPrefA = a.prefs?.[dateStr] && Object.values(a.prefs[dateStr]).includes(shiftCode);
            const isPrefB = b.prefs?.[dateStr] && Object.values(b.prefs[dateStr]).includes(shiftCode);
            if (isPrefA !== isPrefB) return isPrefA ? -1 : 1;

            const isAvoidA = (paramsA === '!' + shiftCode);
            const isAvoidB = (paramsB === '!' + shiftCode);
            if (isAvoidA !== isAvoidB) return isAvoidA ? 1 : -1;

            // 簡單勞逸平衡 (夜班/包班分群比較可在此擴充)
            const countA = this.getTotalShifts(a.id);
            const countB = this.getTotalShifts(b.id);
            return countA - countB; 
        });
    }

    shuffleArray(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    postProcessBalancing(limitDay) {
        const tolerance = this.rules.fairness?.fairOffVar || 2;
        const maxRounds = this.rules.fairness?.balanceRounds || 100;
        const currentTolerance = (limitDay < this.daysInMonth) ? tolerance + 1 : tolerance;

        for (let round = 0; round < maxRounds; round++) {
            const staffStats = this.staffList.map(s => {
                let offCount = 0;
                for(let d=1; d<=limitDay; d++) {
                    const shift = this.getShiftByDate(this.getDateStr(d), s.id);
                    if(shift === 'OFF' || shift === 'REQ_OFF') offCount++;
                }
                return { uid: s.id, offCount: offCount, staffObj: s };
            });

            staffStats.sort((a, b) => a.offCount - b.offCount);
            const poor = staffStats[0]; 
            const rich = staffStats[staffStats.length - 1]; 

            if ((rich.offCount - poor.offCount) <= currentTolerance) return;

            let swapSuccess = false;
            const days = Array.from({length: limitDay}, (_, i) => i + 1);
            this.shuffleArray(days);

            for (const d of days) {
                const dateStr = this.getDateStr(d);
                const shiftRich = this.getShiftByDate(dateStr, rich.uid);
                const shiftPoor = this.getShiftByDate(dateStr, poor.uid);

                if (shiftRich === 'OFF' && shiftPoor !== 'OFF' && shiftPoor !== 'REQ_OFF' && !this.isLocked(dateStr, poor.uid)) {
                    const targetShift = shiftPoor; 
                    // 平衡交換絕不使用救火模式 (false)
                    const canRichWork = this.isValidAssignment(rich.staffObj, dateStr, targetShift, false);
                    const canPoorRest = this.isValidAssignment(poor.staffObj, dateStr, 'OFF', false);

                    if (canRichWork && canPoorRest) {
                        this.updateShift(dateStr, rich.uid, 'OFF', targetShift);
                        this.updateShift(dateStr, poor.uid, targetShift, 'OFF');
                        swapSuccess = true;
                        break; 
                    }
                }
            }
            if (!swapSuccess) {}
        }
    }

    // ------------------------------------------------------
    // 基礎輔助函式
    // ------------------------------------------------------
    getTotalShifts(uid) {
        const counts = this.counters[uid];
        if (!counts) return 0;
        return Object.keys(counts).reduce((sum, key) => { return key !== 'OFF' ? sum + counts[key] : sum; }, 0);
    }
    
    lockPreRequests() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                if (params[dateStr] === 'REQ_OFF') { this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF'); }
            }
        });
    }

    getDailyNeeds(day) {
        const date = new Date(this.year, this.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; 
        const needs = {};
        this.shiftCodes.forEach(code => {
            if(code === 'OFF' || code === 'REQ_OFF') return;
            const key = `${code}_${dayIdx}`;
            const val = this.rules.dailyNeeds?.[key] || 0;
            if (val > 0) needs[code] = val;
        });
        return needs;
    }

    getAvailableStaff(day) {
        const dateStr = this.getDateStr(day);
        return this.staffList.filter(s => {
            const currentShift = this.getShiftByDate(dateStr, s.id);
            return currentShift === 'OFF' || currentShift === null;
        });
    }
    
    clearDayAssignments(day) {
        const dateStr = this.getDateStr(day);
        const shifts = this.schedule[dateStr];
        Object.keys(shifts).forEach(code => {
            if (code === 'OFF') return; 
            [...shifts[code]].forEach(uid => { this.updateShift(dateStr, uid, code, 'OFF'); });
        });
    }

    isLocked(dateStr, uid) {
        const staff = this.staffList.find(s => s.id === uid);
        return staff?.schedulingParams?.[dateStr] === 'REQ_OFF';
    }

    formatResult() {
        const result = {};
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            result[dateStr] = {};
            this.shiftCodes.forEach(code => {
                if(code === 'OFF') return;
                const staffIds = this.schedule[dateStr][code] || [];
                if(staffIds.length > 0) result[dateStr][code] = staffIds;
            });
        }
        return result;
    }
}
