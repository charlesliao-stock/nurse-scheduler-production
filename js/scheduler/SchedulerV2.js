// js/scheduler/SchedulerV2.js
// 🚀 進階排班引擎（完整修正版）
// ✅ 配合 BaseScheduler 的日期時間計算
// ✅ 嚴格遵守所有規則

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

    getOptimalShiftOrder(needs) {
        return Object.keys(needs)
            .filter(code => code !== 'OFF' && code !== 'REQ_OFF')
            .sort((a, b) => (needs[b] || 0) - (needs[a] || 0));
    }

    getShiftOrder() {
        return this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
    }

    getDailyNeeds(day) {
        const dateStr = this.getDateStr(day);
        const date = new Date(this.year, this.month - 1, day);
        const dayOfWeek = date.getDay();
        const dayIdx = (dayOfWeek + 6) % 7;
        
        const needs = {};
        
        if (this.rules.specificNeeds && this.rules.specificNeeds[dateStr]) {
            return this.rules.specificNeeds[dateStr];
        }
        
        if (this.rules.dailyNeeds) {
            this.shiftCodes.forEach(shiftCode => {
                if (shiftCode !== 'OFF' && shiftCode !== 'REQ_OFF') {
                    const key = `${shiftCode}_${dayIdx}`;
                    needs[shiftCode] = this.rules.dailyNeeds[key] || 0;
                }
            });
        }
        
        console.log(`📊 Day ${day} (${['日','一','二','三','四','五','六'][dayOfWeek]}) needs:`, needs);
        return needs;
    }

    run() {
        console.log('🚀 開始執行 SchedulerV2 排班...');
        console.log('📋 人員數量:', this.staffList.length);
        console.log('📅 排班月份:', `${this.year}-${this.month}`);
        console.log('📝 班別代碼:', this.shiftCodes);
        
        console.log('⏰ 步驟 1: 預填預假...');
        this.applyPreSchedules();
        
        console.log('⏰ 步驟 2: 開始逐日排班...');
        for (let d = 1; d <= this.daysInMonth; d++) {
            console.log(`\n--- 處理第 ${d} 天 ---`);
            this.fillDailyShifts(d);
        }

        console.log('\n⏰ 步驟 3: 優化休假分佈...');
        this.balanceOffDistribution();
        
        console.log('✅ 排班完成！');
        return this.schedule;
    }

    fillDailyShifts(day) {
        const dateStr = this.getDateStr(day);
        const needs = this.getDailyNeeds(day);
        
        if (!needs || Object.keys(needs).length === 0) {
            console.warn(`⚠️ Day ${day}: 沒有需求設定，跳過`);
            return;
        }
        
        const shiftOrder = this.getOptimalShiftOrder(needs);
        console.log(`📊 Day ${day} 班別排序:`, shiftOrder, '需求:', needs);

        shiftOrder.forEach(shiftCode => {
            let currentCount = this.schedule[dateStr][shiftCode]?.length || 0;
            let target = needs[shiftCode] || 0;
            let gap = target - currentCount;

            console.log(`   處理 ${shiftCode}: 目標=${target}, 現有=${currentCount}, 缺=${gap}`);

            if (gap <= 0) return;

            // 優先找包班人員
            const bundleCandidates = this.bundleStaff.filter(s => 
                (s.packageType || s.prefs?.bundleShift) === shiftCode && 
                this.getShiftByDate(dateStr, s.id) === 'OFF'
            );
            this.sortCandidatesByPressure(bundleCandidates, dateStr, shiftCode);
            
            console.log(`   包班候選人: ${bundleCandidates.length} 人`);
            for (const staff of bundleCandidates) {
                if (gap <= 0) break;
                if (this.assignIfValid(day, staff, shiftCode)) {
                    console.log(`   ✓ 分配包班人員: ${staff.name} → ${shiftCode}`);
                    gap--;
                }
            }

            // 其次找一般人員
            if (gap > 0) {
                const normalCandidates = this.staffList.filter(s => 
                    this.getShiftByDate(dateStr, s.id) === 'OFF' &&
                    !this.bundleStaff.includes(s)
                );
                this.sortCandidatesByPressure(normalCandidates, dateStr, shiftCode);
                
                console.log(`   一般候選人: ${normalCandidates.length} 人`);
                for (const staff of normalCandidates) {
                    if (gap <= 0) break;
                    if (this.assignIfValid(day, staff, shiftCode)) {
                        console.log(`   ✓ 分配一般人員: ${staff.name} → ${shiftCode}`);
                        gap--;
                    }
                }
            }

            // ✅ 若仍有缺口，嘗試嚴格的回溯優化
            if (gap > 0) {
                console.log(`   ⚠️ 仍缺 ${gap} 人，嘗試嚴格回溯...`);
                const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
                gap -= recovered;
                if (recovered > 0) {
                    console.log(`   ✓ 回溯成功找到 ${recovered} 人`);
                }
            }
            
            if (gap > 0) {
                console.warn(`   ❌ Day ${day} ${shiftCode} 最終仍缺 ${gap} 人！（所有候選人都不符合規則）`);
            }
        });
    }

    // ✅ 強化：回溯演算法也必須嚴格遵守規則
    resolveShortageWithBacktrack(currentDay, targetShift, gap) {
        let recovered = 0;
        const currentDateStr = this.getDateStr(currentDay);
        
        // ✅ 嚴格篩選：即使是回溯，也必須完全符合規則
        const candidates = this.staffList.filter(s => {
            if (this.getShiftByDate(currentDateStr, s.id) !== 'OFF') return false;
            if (this.isPreRequestOff(s.id, currentDateStr)) return false;
            if (!this.isValidAssignment(s, currentDateStr, targetShift)) return false;
            return true;
        });
        
        if (candidates.length === 0) {
            console.log(`      ⚠️ 沒有符合規則的候選人可以回溯`);
            return 0;
        }
        
        this.sortCandidatesByPressure(candidates, currentDateStr, targetShift);
        
        console.log(`      📋 回溯候選人（已過濾規則）: ${candidates.length} 人`);
        for (const staff of candidates) {
            if (gap <= 0) break;
            
            if (this.assignIfValid(currentDay, staff, targetShift)) {
                console.log(`      ✓ 回溯成功分配: ${staff.name} → ${targetShift}`);
                gap--;
                recovered++;
            }
        }
        
        return recovered;
    }

    balanceOffDistribution() {
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const offStaff = this.schedule[dateStr]['OFF'] || [];
            const workStaff = this.staffList.filter(s => !offStaff.includes(s.id));

            workStaff.forEach(ws => {
                const wsCons = this.getConsecutiveWorkDays(ws.id, dateStr);
                if (wsCons > this.minCons) {
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
        const policy = this.rules.policy || {};
        const pressure = this.staffStats[staff.id]?.workPressure || 0;
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;
        score += pressure * 1000;
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        
        // ✅ 使用新方法取得前一天班別
        const prevDate = this.getPreviousDate(dateStr);
        let prevShift = this.getShiftByDateStr(prevDate, staff.id);
        
        if (shiftCode !== 'OFF') { 
            if (prevShift !== 'OFF' && prevShift !== 'REQ_OFF') {
                if (consDays < this.minCons) score += 5000; 
                else if (consDays < (policy.maxConsDays || 6)) score += 500; 
                else score -= 2000; 
            }
            
            // ✅ 使用新方法檢查休息時間
            if (!this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, shiftCode, staff.name)) {
                score -= 999999;
            }

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
                        if (currentRatio < allowedRatio) {
                            score += (allowedRatio - currentRatio) * 10000;
                        } else {
                            score -= (currentRatio - allowedRatio) * 20000;
                        }
                    }
                }
            }

            // ✅ 使用新方法取得明天班別
            const nextDate = this.getNextDate(dateStr);
            const nextShift = this.getShiftByDateStr(nextDate, staff.id);
            
            if (nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
                if (!this.checkRestPeriodWithDate(dateStr, shiftCode, nextDate, nextShift, staff.name)) {
                    score -= 999999;
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
        if (bundleShift && shiftCode !== 'OFF' && shiftCode !== 'REQ_OFF' && shiftCode !== bundleShift) {
            score -= 999999;
        }
        
        if (staff.schedulingParams?.[dateStr] === '!' + shiftCode) score -= 999999;

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
            
            if (prevIsWork && nextIsWork) {
                score -= 50;
            }
            
            if (prevIsOff || nextIsOff) {
                score += 25;
                
                if (prevIsOff && nextIsOff) {
                    score += 15;
                }
            }
        }
        
        const day = parseInt(dateStr.split('-')[2]);
        const date = new Date(this.year, this.month - 1, day);
        const dayOfWeek = date.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        
        if (isWeekend) {
            if (shiftCode === 'OFF' || shiftCode === 'REQ_OFF') {
                score += 15;
            } else {
                score -= 5;
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
        
        console.log(`👥 包班人員: ${this.bundleStaff.length} 人`);
        console.log(`👥 非包班人員: ${this.nonBundleStaff.length} 人`);
    }

    assignIfValid(day, staff, shiftCode) {
        const dateStr = this.getDateStr(day);
        const isValid = this.isValidAssignment(staff, dateStr, shiftCode);
        const isGroupValid = this.checkGroupMaxLimit(day, staff, shiftCode);
        
        if (!isValid || !isGroupValid) {
            return false;
        }
        
        this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
        return true;
    }

    isValidAssignment(staff, dateStr, shiftCode) {
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        
        if (baseValid) return true;
        
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        
        if (consDays + 1 > normalLimit) {
            const stats = this.staffStats[staff.id];
            if (stats?.isLongVacationer) {
                const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
                if (consDays + 1 <= longVacLimit) {
                    const prevDate = this.getPreviousDate(dateStr);
                    const prevShift = this.getShiftByDateStr(prevDate, staff.id);
                    
                    if (!this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, shiftCode, staff.name)) {
                        return false; 
                    }
                    return true;
                }
            }
        }
        return false;
    }

    checkSwapValidity(day, staff, oldShift, newShift, isFinalOptimization = false) {
        const dateStr = this.getDateStr(day);
        
        this.updateShift(dateStr, staff.id, oldShift, newShift);
        const isValid = this.isValidAssignment(staff, dateStr, newShift);
        this.updateShift(dateStr, staff.id, newShift, oldShift);
        
        if (!isValid) return false;

        if (isFinalOptimization) {
            const prevDate = this.getPreviousDate(dateStr);
            const prevShift = this.getShiftByDateStr(prevDate, staff.id);
            
            const nextDate = this.getNextDate(dateStr);
            const nextShift = this.getShiftByDateStr(nextDate, staff.id);
            
            if (!this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, newShift, staff.name)) return false;
            if (nextShift && !this.checkRestPeriodWithDate(dateStr, newShift, nextDate, nextShift, staff.name)) return false;
        }

        return true;
    }

    checkGroupMaxLimit(day, staff, shiftCode) {
        return true;
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
