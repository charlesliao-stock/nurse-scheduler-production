// js/scheduler/SchedulerV2.js
// 🚀 AI 升級版：加入強力回溯交換 (Gap Filling with Deep Swaps)

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 3;
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 50;
    }

    run() {
        console.log("🚀 SchedulerV2: 開始排班 (含回溯交換優化)");
        this.lockPreRequests();

        // 1. 初步排班 (Greedy + Simple Backtrack)
        for (let d = 1; d <= this.daysInMonth; d++) {
            if (!this.solveDay(d, false)) {
                if (this.rules.policy?.enableRelaxation) {
                    this.clearDayAssignments(d); 
                    this.solveDay(d, true);
                }
            }
        }

        // 2. 🔥 關鍵修正：針對缺額進行「強力交換填補」
        // 這會解決 1/1 明明有人力卻缺額的問題
        this.fillGapsWithSwaps();

        // 3. 後處理平衡
        if (!this.rules.policy?.enableRelaxation) {
            this.postProcessBalancing();
        }

        return this.formatResult();
    }

    // ... (solveDay, sortCandidates, lockPreRequests, etc. 保持與上一版相同，省略以節省篇幅) ...
    // 請保留上一版完整的 solveDay, sortCandidates, getTotalShifts, lockPreRequests, getDailyNeeds, getAvailableStaff, clearDayAssignments
    
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
        
        for (const [code, count] of Object.entries(needs)) {
            if (this.countStaff(day, code) < count) return false;
        }
        return true;
    }

    sortCandidates(staffList, dateStr, shiftCode) {
        const randomizedList = this.shuffleArray(staffList);
        return randomizedList.sort((a, b) => {
            const isBundleA = (a.packageType === shiftCode || a.prefs?.bundleShift === shiftCode);
            const isBundleB = (b.packageType === shiftCode || b.prefs?.bundleShift === shiftCode);
            if (isBundleA && !isBundleB) return -1; 
            if (!isBundleA && isBundleB) return 1;  

            const paramsA = a.schedulingParams?.[dateStr];
            const paramsB = b.schedulingParams?.[dateStr];
            const isReqA = (paramsA === shiftCode);
            const isReqB = (paramsB === shiftCode);
            if (isReqA && !isReqB) return -1;
            if (!isReqA && isReqB) return 1;

            const isPrefA = a.prefs?.[dateStr] && Object.values(a.prefs[dateStr]).includes(shiftCode);
            const isPrefB = b.prefs?.[dateStr] && Object.values(b.prefs[dateStr]).includes(shiftCode);
            if (isPrefA && !isPrefB) return -1;
            if (!isPrefA && isPrefB) return 1;
            
            const isAvoidA = (paramsA === '!' + shiftCode);
            const isAvoidB = (paramsB === '!' + shiftCode);
            if (isAvoidA && !isAvoidB) return 1; 
            if (!isAvoidA && isAvoidB) return -1;

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

    getTotalShifts(uid) {
        const counts = this.counters[uid];
        if (!counts) return 0;
        return Object.keys(counts).reduce((sum, key) => {
            return key !== 'OFF' ? sum + counts[key] : sum;
        }, 0);
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

    // ==========================================
    // 🔥 新增：強力填補缺額邏輯 (Deep Gap Filling)
    // ==========================================
    fillGapsWithSwaps() {
        console.log("⚡ 啟動強力交換填補...");
        
        // 掃描每一天
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const needs = this.getDailyNeeds(d);

            // 檢查該日每個班別是否有缺額
            for (const [targetShift, count] of Object.entries(needs)) {
                let currentCount = this.countStaff(d, targetShift);
                let gap = count - currentCount;

                if (gap > 0) {
                    console.log(`📅 ${dateStr} 缺 ${gap} 個 ${targetShift}，嘗試交換調度...`);
                    
                    // 嘗試填補這個缺口
                    // 策略：找出當天休假 (OFF) 的人，看能不能讓他上這個班
                    // 如果不能上，看是因為「昨天」還是「明天」卡住，然後嘗試去改昨天或明天的班
                    
                    const offStaffs = this.staffList.filter(s => 
                        this.getShiftByDate(dateStr, s.id) === 'OFF'
                    );

                    // 隨機打亂，增加多樣性
                    const candidates = this.shuffleArray(offStaffs);

                    for (const staff of candidates) {
                        if (gap <= 0) break;

                        // 1. 直接嘗試：如果可以直接排進去，就排
                        if (this.isValidAssignment(staff, dateStr, targetShift, true)) { // 開啟救火模式檢查
                            this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                            gap--;
                            continue;
                        }

                        // 2. 進階嘗試：解決「間隔不足」問題 (11小時)
                        // 假設因為「昨天」上晚班導致今天不能上早班 -> 嘗試把昨天的班換掉
                        if (this.rule_minGap11) {
                            const prevShift = this.getYesterdayShift(staff.id, dateStr);
                            if (!this.checkRestPeriod(prevShift, targetShift)) {
                                // 發現是昨天的班卡住，嘗試修改昨天的班
                                if (this.trySwapYesterday(staff, d, prevShift)) {
                                    // 昨天換成功了，再次檢查今天能不能排
                                    if (this.isValidAssignment(staff, dateStr, targetShift, true)) {
                                        this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                                        gap--;
                                        continue;
                                    }
                                }
                            }
                        }

                        // 3. 進階嘗試：解決「連上天數」問題
                        // 如果因為連上太多天，嘗試把前幾天其中一天換成 OFF
                        if (this.rule_limitConsecutive) {
                            const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
                            if (consDays >= (this.rule_maxConsDays || 6)) {
                                // 嘗試把前 2-3 天的某一天排休
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

    // 嘗試交換該員「昨天」的班別 (例如把 N 換成 OFF 或 D，讓他今天能上早班)
    trySwapYesterday(targetStaff, currentDay, badShift) {
        if (currentDay <= 1) return false; // 第一天無法動上個月
        const prevDay = currentDay - 1;
        const prevDateStr = this.getDateStr(prevDay);

        // 找出昨天是 OFF 的其他人
        const swapCandidates = this.staffList.filter(s => 
            s.id !== targetStaff.id && 
            this.getShiftByDate(prevDateStr, s.id) === 'OFF'
        );

        for (const candidate of swapCandidates) {
            // 檢查：如果把 badShift 給這個候選人，是否合法？
            if (this.isValidAssignment(candidate, prevDateStr, badShift, true)) {
                // 檢查：如果把 targetStaff 昨天改成 OFF，是否合法？ (通常 OFF 都合法，除非缺額)
                // 這裡簡化：假設昨天該班別不缺人，或者我們允許短期缺額以滿足今天
                
                // 執行交換
                // 1. 候選人 OFF -> badShift
                this.updateShift(prevDateStr, candidate.id, 'OFF', badShift);
                // 2. 目標員工 badShift -> OFF
                this.updateShift(prevDateStr, targetStaff.id, badShift, 'OFF');
                
                console.log(`🔄 [回溯交換] ${prevDateStr}: ${targetStaff.name}(${badShift}->OFF), ${candidate.name}(OFF->${badShift})`);
                return true; 
            }
        }
        return false;
    }

    // 嘗試在該員的前幾天製造一個 OFF (打斷連上)
    tryCreateBreak(targetStaff, currentDay) {
        // 往前找 2~4 天，試著把其中一班換給別人
        for (let i = 2; i <= 4; i++) {
            const checkDay = currentDay - i;
            if (checkDay < 1) continue;
            const dateStr = this.getDateStr(checkDay);
            const currentShift = this.getShiftByDate(dateStr, targetStaff.id);
            
            if (currentShift === 'OFF' || currentShift === 'REQ_OFF') continue;

            // 找替死鬼
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

    postProcessBalancing() {
        // 簡單平衡，若需要複雜交換可在此實作
    }

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
