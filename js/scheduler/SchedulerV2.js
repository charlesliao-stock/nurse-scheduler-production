// js/scheduler/SchedulerV2.js
// 🚀 最終完整版：層級排序 + 隨機亂數 + 強力交換填補

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 3;
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 50;
    }

    run() {
        console.log("🚀 SchedulerV2: 開始排班 (隨機亂數 + 回溯交換)");
        this.lockPreRequests();

        // 1. 初步排班 (Greedy)
        for (let d = 1; d <= this.daysInMonth; d++) {
            if (!this.solveDay(d, false)) {
                if (this.rules.policy?.enableRelaxation) {
                    this.clearDayAssignments(d); 
                    this.solveDay(d, true);
                }
            }
        }

        // 2. 針對缺額進行「強力交換填補」 (解決 1/1 缺額問題)
        this.fillGapsWithSwaps();

        // 3. 後處理平衡
        if (!this.rules.policy?.enableRelaxation) {
            this.postProcessBalancing();
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
        return true;
    }

    // 隨機亂數洗牌
    shuffleArray(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // 層級排序邏輯
    sortCandidates(staffList, dateStr, shiftCode) {
        // 先洗牌，確保隨機性
        const randomizedList = this.shuffleArray(staffList);
        
        const prevShiftMap = {};
        randomizedList.forEach(s => {
            prevShiftMap[s.id] = this.getYesterdayShift(s.id, dateStr);
        });

        return randomizedList.sort((a, b) => {
            // 1. 包班優先
            const isBundleA = (a.packageType === shiftCode || a.prefs?.bundleShift === shiftCode);
            const isBundleB = (b.packageType === shiftCode || b.prefs?.bundleShift === shiftCode);
            if (isBundleA !== isBundleB) return isBundleA ? -1 : 1;

            // 2. 指定預班優先
            const paramsA = a.schedulingParams?.[dateStr];
            const paramsB = b.schedulingParams?.[dateStr];
            const isReqA = (paramsA === shiftCode);
            const isReqB = (paramsB === shiftCode);
            if (isReqA !== isReqB) return isReqA ? -1 : 1;

            // 3. 連續班別優先 (相同班別連續)
            if (this.rules.pattern?.consecutivePref) {
                const prevA = prevShiftMap[a.id];
                const prevB = prevShiftMap[b.id];
                const isConsA = (prevA === shiftCode);
                const isConsB = (prevB === shiftCode);
                if (isConsA !== isConsB) return isConsA ? -1 : 1; 
            }

            // 4. 偏好優先
            const isPrefA = a.prefs?.[dateStr] && Object.values(a.prefs[dateStr]).includes(shiftCode);
            const isPrefB = b.prefs?.[dateStr] && Object.values(b.prefs[dateStr]).includes(shiftCode);
            if (isPrefA !== isPrefB) return isPrefA ? -1 : 1;

            // 5. 避開勿排
            const isAvoidA = (paramsA === '!' + shiftCode);
            const isAvoidB = (paramsB === '!' + shiftCode);
            if (isAvoidA !== isAvoidB) return isAvoidA ? 1 : -1;

            // 6. 分群公平性 (若都是非包班，比較夜班數)
            // 這裡簡單比較總班數，夜班平均化可再此擴充
            const countA = this.getTotalShifts(a.id);
            const countB = this.getTotalShifts(b.id);
            return countA - countB; 
        });
    }

    // 強力填補缺額邏輯
    fillGapsWithSwaps() {
        console.log("⚡ 啟動強力交換填補...");
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const needs = this.getDailyNeeds(d);

            for (const [targetShift, count] of Object.entries(needs)) {
                let currentCount = this.countStaff(d, targetShift);
                let gap = count - currentCount;

                if (gap > 0) {
                    // 找出當天 OFF 的人
                    const offStaffs = this.staffList.filter(s => 
                        this.getShiftByDate(dateStr, s.id) === 'OFF'
                    );
                    const candidates = this.shuffleArray(offStaffs);

                    for (const staff of candidates) {
                        if (gap <= 0) break;

                        // 1. 直接排
                        if (this.isValidAssignment(staff, dateStr, targetShift, true)) { 
                            this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                            gap--;
                            continue;
                        }

                        // 2. 交換昨天 (解決 11 小時問題)
                        if (this.rule_minGap11) {
                            const prevShift = this.getYesterdayShift(staff.id, dateStr);
                            if (!this.checkRestPeriod(prevShift, targetShift)) {
                                if (this.trySwapYesterday(staff, d, prevShift)) {
                                    if (this.isValidAssignment(staff, dateStr, targetShift, true)) {
                                        this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                                        gap--;
                                        continue;
                                    }
                                }
                            }
                        }

                        // 3. 製造斷點 (解決連上問題)
                        if (this.rule_limitConsecutive) {
                            const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
                            if (consDays >= (this.rule_maxConsDays || 6)) {
                                if (this.tryCreateBreak(staff, d)) {
                                    if (this.isValidAssignment(staff, dateStr, targetShift, true)) {
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
    }

    trySwapYesterday(targetStaff, currentDay, badShift) {
        if (currentDay <= 1) return false; 
        const prevDay = currentDay - 1;
        const prevDateStr = this.getDateStr(prevDay);

        const swapCandidates = this.staffList.filter(s => 
            s.id !== targetStaff.id && 
            this.getShiftByDate(prevDateStr, s.id) === 'OFF'
        );

        for (const candidate of swapCandidates) {
            if (this.isValidAssignment(candidate, prevDateStr, badShift, true)) {
                this.updateShift(prevDateStr, candidate.id, 'OFF', badShift);
                this.updateShift(prevDateStr, targetStaff.id, badShift, 'OFF');
                return true; 
            }
        }
        return false;
    }

    tryCreateBreak(targetStaff, currentDay) {
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
                if (this.isValidAssignment(candidate, dateStr, currentShift, true)) {
                    this.updateShift(dateStr, candidate.id, 'OFF', currentShift);
                    this.updateShift(dateStr, targetStaff.id, currentShift, 'OFF');
                    return true;
                }
            }
        }
        return false;
    }

    getTotalShifts(uid) {
        const counts = this.counters[uid];
        if (!counts) return 0;
        return Object.keys(counts).reduce((sum, key) => {
            return key !== 'OFF' ? sum + counts[key] : sum;
        }, 0);
    }
    
    lockPreRequests() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                if (params[dateStr] === 'REQ_OFF') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                }
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
            [...shifts[code]].forEach(uid => {
                this.updateShift(dateStr, uid, code, 'OFF');
            });
        });
    }

    postProcessBalancing() { }

    formatResult() {
        const result = {};
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            result[dateStr] = {};
            this.shiftCodes.forEach(code => {
                if(code === 'OFF') return;
                const staffIds = this.schedule[dateStr][code] || [];
                if(staffIds.length > 0) {
                    result[dateStr][code] = staffIds;
                }
            });
        }
        return result;
    }
}
