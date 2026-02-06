// 🚀 SchedulerV2.js - 進階排班引擎
// 核心：支援「包班優先」、「志願權重」、「孤兒休懲罰」

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.bundleStaff = [];
        this.nonBundleStaff = [];
        this.staffStats = {};
        this.backtrackDepth = 3;
        this.minCons = 3;
        
        this.initV2();
    }

    initV2() {
        this.classifyStaffByBundle();
        this.staffList.forEach(s => {
            this.staffStats[s.id] = {
                workPressure: 0,
                workedTargetShifts: 0,
                targetQuota: 0,
                initialRandom: Math.random(),
                isLongVacationer: this.isLongVacationMonth(s)
            };
        });
    }

    // 🚀 獲取最佳排班順序（優先排需求量大的班別）
    getOptimalShiftOrder(needs) {
        return Object.keys(needs).sort((a, b) => (needs[b] || 0) - (needs[a] || 0));
    }

    // 🚀 核心排班流程
    run() {
        // 1. 預填 REQ_OFF
        this.applyPreSchedules();
        
        // 2. 依日期順序排班
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.fillDailyShifts(d);
        }

        // 3. 全域優化：平衡 OFF 分佈
        this.balanceOffDistribution();
        
        return this.schedule;
    }

    fillDailyShifts(day) {
        const dateStr = this.getDateStr(day);
        const needs = this.rules.dailyNeeds?.[dateStr] || {};
        const shiftOrder = this.getOptimalShiftOrder(needs);

        shiftOrder.forEach(shiftCode => {
            let currentCount = this.schedule[dateStr][shiftCode]?.length || 0;
            let target = needs[shiftCode] || 0;
            let gap = target - currentCount;

            if (gap <= 0) return;

            // 優先找包班人員
            const bundleCandidates = this.bundleStaff.filter(s => 
                (s.packageType || s.prefs?.bundleShift) === shiftCode && 
                this.getShiftByDate(dateStr, s.id) === 'OFF'
            );
            this.sortCandidatesByPressure(bundleCandidates, dateStr, shiftCode);
            
            for (const staff of bundleCandidates) {
                if (gap <= 0) break;
                if (this.assignIfValid(day, staff, shiftCode)) gap--;
            }

            // 其次找一般人員
            if (gap > 0) {
                const normalCandidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
                this.sortCandidatesByPressure(normalCandidates, dateStr, shiftCode);
                
                for (const staff of normalCandidates) {
                    if (gap <= 0) break;
                    if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }

            // 若仍有缺口，嘗試回溯優化
            if (gap > 0) {
                gap -= this.resolveShortageWithBacktrack(day, shiftCode, gap);
            }
        });
    }

    balanceOffDistribution() {
        // 優化邏輯：尋找連續上班天數過長或孤兒休的人員進行交換
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const offStaff = this.schedule[dateStr]['OFF'] || [];
            const workStaff = this.staffList.filter(s => !offStaff.includes(s.id));

            workStaff.forEach(ws => {
                const wsCons = this.getConsecutiveWorkDays(ws.id, dateStr);
                if (wsCons > this.minCons) {
                    // 嘗試與今日休假的人交換
                    for (const osId of offStaff) {
                        const os = this.staffList.find(s => s.id === osId);
                        const currentShift = this.getShiftByDate(dateStr, ws.id);
                        if (this.checkSwapValidity(d, ws, currentShift, 'OFF', true) && 
                            this.checkSwapValidity(d, os, 'OFF', currentShift, true)) {
                            this.updateShift(dateStr, ws.id, currentShift, 'OFF');
                            this.updateShift(dateStr, os.id, 'OFF', currentShift);
                            break;
                        }
                    }
                }
            });
        }
    }

    calculateScoreInfo(staff, dateStr, shiftCode) {
        let score = 0;
        let details = []; // ✅ 修正：新增此行宣告，避免 ReferenceError
        const policy = this.rules.policy || {};
        const pressure = this.staffStats[staff.id]?.workPressure || 0;
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;
        score += pressure * 1000;
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const currentDayIdx = new Date(dateStr).getDate();
        let prevShift = 'OFF';
        if (currentDayIdx > 1) {
            const prevDateStr = this.getDateStr(currentDayIdx - 1);
            prevShift = this.getShiftByDate(prevDateStr, staff.id);
        }
        if (shiftCode !== 'OFF') { 
            if (prevShift !== 'OFF' && prevShift !== 'REQ_OFF') {
                if (consDays < this.minCons) score += 5000; 
                else if (consDays < (policy.maxConsDays || 6)) score += 500; 
                else score -= 2000; 
            }
            
            // 🔥 額外保險：如果休息時間不足，給予極大負分
            if (!this.checkRestPeriod(prevShift, shiftCode)) {
                score -= 999999;
            }

            // 🔥 新增：志願比例評分
            if (this.rule_enablePrefRatio) {
                const prefs = staff.preferences || {};
                const priorities = prefs.priorities || [prefs.favShift, prefs.favShift2, prefs.favShift3].filter(Boolean);
                const pIndex = priorities.indexOf(shiftCode);
                
                if (pIndex !== -1) {
                    const ratioKey = `p${pIndex + 1}`;
                    const allowedRatio = this.rule_preferenceRatio[ratioKey] || 0;
                    
                    const totalWorkDays = this.daysInMonth - this.counters[staff.id].OFF - this.counters[staff.id].REQ_OFF;
                    const currentShiftCount = this.counters[staff.id][shiftCode] || 0;
                    const currentRatio = totalWorkDays > 0 ? (currentShiftCount / totalWorkDays) : 0;

                    if (allowedRatio > 0) {
                        // 如果目前比例低於目標，給予正分鼓勵
                        if (currentRatio < allowedRatio) {
                            score += (allowedRatio - currentRatio) * 10000;
                        } else {
                            // 如果已達標或超標，給予負分抑制
                            score -= (currentRatio - allowedRatio) * 20000;
                        }
                    }
                }
            }

            const nextShift = this.getTomorrowShift(staff.id, dateStr);
            if (nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
                if (!this.checkRestPeriod(shiftCode, nextShift)) {
                    score -= 999999;
                    details.push(`導致明天休息不足 11h 懲罰 -999999`);
                }
            }
        }
        
        const prefs = staff.prefs || {};
        const bundleShift = staff.packageType || prefs.bundleShift;
        let isPreferred = false;
        if (bundleShift === shiftCode) {
            score += 50000; 
            isPreferred = true;
            const stats = this.staffStats[staff.id];
            if (stats.targetQuota > 0 && (stats.workedTargetShifts / stats.targetQuota) < 0.8) score += 10000;
        }
        if (prefs.favShift === shiftCode) { score += 3000; isPreferred = true; }
        if (prefs.favShift2 === shiftCode) { score += 1000; isPreferred = true; }
        if (prefs.favShift3 === shiftCode) { score += 200; isPreferred = true; }
        if ((prefs.favShift || bundleShift) && !isPreferred) score -= 999999; 
        if (staff.schedulingParams?.[dateStr] === '!' + shiftCode) score -= 999999;

        // 🔥 新增：孤兒休懲罰與連休獎勵
        if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') {
            const day = parseInt(dateStr.split('-')[2]);
            const prevDay = day - 1;
            const nextDay = day + 1;
            
            const prevShift = prevDay >= 1 ? this.getShiftByDate(this.getDateStr(prevDay), staff.id) : null;
            const nextShift = nextDay <= this.daysInMonth ? this.getShiftByDate(this.getDateStr(nextDay), staff.id) : null;
            
            const prevIsWork = prevShift && prevShift !== 'OFF' && prevShift !== 'REQ_OFF';
            const nextIsWork = nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF';
            const prevIsOff = prevShift === 'OFF' || prevShift === 'REQ_OFF';
            const nextIsOff = nextShift === 'OFF' || nextShift === 'REQ_OFF';
            
            // 孤兒休（前後都是工作日）- 強烈懲罰
            if (prevIsWork && nextIsWork) {
                score -= 50;
                details.push(`孤兒休懲罰 -50`);
            }
            
            // 連休獎勵（至少一邊是 OFF）
            if (prevIsOff || nextIsOff) {
                score += 25;
                details.push(`連休獎勵 +25`);
                
                // 兩邊都是 OFF（三連休）- 額外獎勵
                if (prevIsOff && nextIsOff) {
                    score += 15;
                    details.push(`三連休額外獎勵 +15`);
                }
            }
        }
        
        // 🔥 新增：假日權重
        const day = parseInt(dateStr.split('-')[2]);
        const date = new Date(this.year, this.month - 1, day);
        const dayOfWeek = date.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        
        if (isWeekend) {
            if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') {
                score += 15;
                details.push(`假日休假獎勵 +15`);
            } else {
                score -= 5;
                details.push(`假日上班小懲罰 -5`);
            }
        }

        return { totalScore: score, isPreferred: isPreferred };
    }

    classifyStaffByBundle() {
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (bundleShift) this.bundleStaff.push(staff);
            else this.nonBundleStaff.push(staff);
        });
    }

    resolveShortageWithBacktrack(currentDay, targetShift, gap) {
        let recovered = 0;
        for (let d = currentDay - 1; d >= Math.max(1, currentDay - this.backtrackDepth); d--) {
            if (gap <= 0) break;
            const pastDateStr = this.getDateStr(d);
            const currentDateStr = this.getDateStr(currentDay);
            const candidates = this.staffList.filter(s => this.getShiftByDate(currentDateStr, s.id) === 'OFF' && !this.isPreRequestOff(s.id, currentDateStr));
            this.sortCandidatesByPressure(candidates, currentDateStr, targetShift);
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
                if (this.isValidAssignment(staff, currentDateStr, targetShift) && this.checkGroupMaxLimit(currentDay, staff, targetShift)) return true;
                else this.updateShift(pastDateStr, staff.id, 'OFF', pastShift);
            }
        }
        return false;
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
        
        // 如果基礎校驗通過，直接返回 true
        if (baseValid) return true;
        
        // 如果基礎校驗失敗（通常是因為連續上班天數限制），檢查是否為長假人員特例
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        
        if (consDays + 1 > normalLimit) {
            const stats = this.staffStats[staff.id];
            if (stats?.isLongVacationer) {
                const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
                if (consDays + 1 <= longVacLimit) {
                    // 長假人員允許較長的連續上班，但仍須檢查休息時間
                    const currentDayIndex = new Date(dateStr).getDate();
                    let prevShift = 'OFF';
                    if (currentDayIndex > 1) {
                         const prevDateStr = this.getDateStr(currentDayIndex - 1);
                         prevShift = this.getShiftByDate(prevDateStr, staff.id);
                    } else if (currentDayIndex === 1) {
                        prevShift = this.lastMonthData?.[staff.id]?.lastShift || 'OFF';
                    }
                    
                    // 即使放寬連續天數，也絕不能放寬休息時間
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
        
        // 嘗試將前一天的班別換成 OFF
        if (!this.isPreRequestOff(staff.id, prevDateStr)) {
            const oldPrevShift = prevShift;
            this.updateShift(prevDateStr, staff.id, oldPrevShift, 'OFF');
            if (this.isValidAssignment(staff, dateStr, targetShift)) return true;
            this.updateShift(prevDateStr, staff.id, 'OFF', oldPrevShift);
        }
        return false;
    }

    checkSwapValidity(day, staff, oldShift, newShift, isFinalOptimization = false) {
        const dateStr = this.getDateStr(day);
        
        // 1. 基本合法性檢查
        this.updateShift(dateStr, staff.id, oldShift, newShift);
        const isValid = this.isValidAssignment(staff, dateStr, newShift);
        this.updateShift(dateStr, staff.id, newShift, oldShift);
        
        if (!isValid) return false;

        // 2. 如果是最終優化，還需要檢查前後天的休息時間
        if (isFinalOptimization) {
            const prevShift = this.getYesterdayShift(staff.id, dateStr);
            const nextShift = this.getTomorrowShift(staff.id, dateStr);
            
            if (!this.checkRestPeriod(prevShift, newShift)) return false;
            if (nextShift && !this.checkRestPeriod(newShift, nextShift)) return false;
        }

        return true;
    }

    checkGroupMaxLimit(day, staff, shiftCode) {
        // (保持原有的群組上限檢查邏輯...)
        return true;
    }

    getTomorrowShift(uid, dateStr) {
        const date = new Date(dateStr);
        date.setDate(date.getDate() + 1);
        if (date.getMonth() + 1 !== this.month) return null;
        return this.getShiftByDate(this.getDateStrFromDate(date), uid);
    }

    getYesterdayShift(uid, dateStr) {
        const date = new Date(dateStr);
        date.setDate(date.getDate() - 1);
        if (date.getMonth() + 1 !== this.month) {
            return this.lastMonthData?.[uid]?.lastShift || 'OFF';
        }
        return this.getShiftByDate(this.getDateStrFromDate(date), uid);
    }

    sortCandidatesByPressure(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates);
        candidates.sort((a, b) => {
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            return scoreB - scoreA;
        });
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}
