// js/scheduler/SchedulerV3.js

class SchedulerV3 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        console.log('🚀 SchedulerV3 初始化 (絕對限制與平衡優化版)');
        this.assignments = {};
        this.dailyCount = {};
        this.initializeAssignments();
        this.initializeDailyCount();
    }
    
    initializeAssignments() {
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            this.assignments[uid] = { preferences: staff.preferences || {} };
        }
    }
    
    initializeDailyCount() {
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.dailyCount[day] = {};
            for (let shift of this.shifts) this.dailyCount[day][shift.code] = 0;
        }
    }
    
    run() {
        console.log('🤖 SchedulerV3 排班開始');
        try {
            // 1. 套用預班
            this.step1_ApplyPreSchedule();
            
            // 2. 核心排班：逐日進行，但每一天都嚴格遵守優先級
            this.step2_PriorityBasedScheduling();
            
            // 2.5 強制填補：針對還有缺額的班次，尋找符合硬規則的人填補 (不限志願，但包班人員除外)
            this.step2_5_ForceFillShortages();
            
            // 3. 填補剩餘 OFF
            this.step3_FillRemainingOff();
            
            // 4. 平衡調整 (僅在不違反包班/志願的前提下進行微調)
            this.step4_BalanceAdjustment();
            
            return this.convertToDateFormat();
        } catch (error) {
            console.error('❌ SchedulerV3 排班失敗:', error);
            throw error;
        }
    }
    
    step1_ApplyPreSchedule() {
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const params = staff.schedulingParams || {};
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                const pre = params[key];
                if (pre && pre !== 'OFF') {
                    this.assignments[uid][key] = pre;
                    this.dailyCount[day][pre] = (this.dailyCount[day][pre] || 0) + 1;
                }
            }
        }
    }
    
    step2_PriorityBasedScheduling() {
        console.log('\n🎯 步驟 2: 優先級導向排班 (需求優先 + 嚴格限制)');
        this.fillShiftsByLogic('priority');
    }

    step2_5_ForceFillShortages() {
        console.log('\n⚡ 步驟 2.5: 強制填補缺額 (不限志願，但守硬規則)');
        this.fillShiftsByLogic('force');
    }

    fillShiftsByLogic(mode) {
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            const dayOfWeek = this.getDayOfWeek(day);
            const needsList = this.calculateDailyNeeds(day, dateStr, dayOfWeek);
            
            for (let needItem of needsList) {
                const shiftCode = needItem.shift;
                const need = needItem.need;
                let current = this.dailyCount[day][shiftCode] || 0;
                
                if (current >= need) continue;

                let candidates = this.allStaff.filter(staff => {
                    const uid = staff.uid || staff.id;
                    if (this.assignments[uid][`current_${day}`]) return false;
                    
                    const prefs = staff.preferences || {};
                    
                    if (mode === 'priority') {
                        // 優先級模式：必須符合 WhitelistCalculator 的絕對限制 (包班或志願)
                        const whitelist = WhitelistCalculator.calculate(
                            staff, this.assignments, day, this.year, this.month,
                            this.rules, this.dailyCount[day], this.daysInMonth,
                            this.shiftTimeMap, this.lastMonthData
                        );
                        return whitelist.includes(shiftCode);
                    } else {
                        // 強制模式：排除包班人員，其餘人只要符合「硬規則」即可
                        if (prefs.bundleShift) return false;
                        
                        // 這裡我們手動檢查硬規則，不使用 WhitelistCalculator 的志願過濾
                        const consecutiveDays = WhitelistCalculator.countConsecutiveWorkDays(staff, this.assignments, day, this.lastMonthData);
                        if (consecutiveDays >= (this.rules?.policy?.maxConsDays || 6)) return false;
                        
                        // 檢查 11 小時休期間隔
                        const whitelistWithHardRules = WhitelistCalculator.filterByMinGap11([shiftCode], staff, this.assignments, day, this.shiftTimeMap, this.lastMonthData);
                        return whitelistWithHardRules.includes(shiftCode);
                    }
                });

                // 排序：上班天數少的人優先
                candidates.sort((a, b) => {
                    if (mode === 'priority') {
                        const prefA = a.preferences || {};
                        const prefB = b.preferences || {};
                        const isBundleA = prefA.bundleShift === shiftCode ? 0 : 1;
                        const isBundleB = prefB.bundleShift === shiftCode ? 0 : 1;
                        if (isBundleA !== isBundleB) return isBundleA - isBundleB;
                    }
                    
                    const workA = this.countWorkDays(this.assignments, a.uid || a.id, day - 1);
                    const workB = this.countWorkDays(this.assignments, b.uid || b.id, day - 1);
                    return workA - workB;
                });

                const toAssign = candidates.slice(0, need - current);
                for (let staff of toAssign) {
                    const uid = staff.uid || staff.id;
                    this.assignments[uid][`current_${day}`] = shiftCode;
                    this.dailyCount[day][shiftCode]++;
                }
            }
        }
    }

    step3_FillRemainingOff() {
        for (let day = 1; day <= this.daysInMonth; day++) {
            for (let staff of this.allStaff) {
                const uid = staff.uid || staff.id;
                if (!this.assignments[uid][`current_${day}`]) {
                    this.assignments[uid][`current_${day}`] = 'OFF';
                }
            }
        }
    }

    step4_BalanceAdjustment() {
        console.log('\n⚖️ 步驟 4: 平衡調整');
        const rulesWithContext = { ...this.rules, year: this.year, month: this.month, lastMonthData: this.lastMonthData };
        BalanceAdjuster.adjust(this.assignments, this.allStaff, rulesWithContext, this.daysInMonth, this.shiftTimeMap);
    }

    calculateDailyNeeds(day, dateStr, dayOfWeek) {
        const needsList = [];
        for (let shift of this.shifts) {
            let need = 0;
            if (this.specificNeeds[dateStr] && this.specificNeeds[dateStr][shift.code] !== undefined) {
                need = this.specificNeeds[dateStr][shift.code];
            } else {
                const key = `${shift.code}_${dayOfWeek}`;
                need = this.dailyNeeds[key] || 0;
            }
            if (need > 0) needsList.push({ shift: shift.code, need: need });
        }
        return needsList;
    }

    countWorkDays(assignments, uid, upToDay) {
        let count = 0;
        for (let d = 1; d <= upToDay; d++) {
            const val = assignments[uid]?.[`current_${d}`];
            if (val && val !== 'OFF' && val !== 'REQ_OFF') count++;
        }
        return count;
    }

    convertToDateFormat() {
        const result = {};
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            result[dateStr] = {};
            for (let shift of this.shifts) result[dateStr][shift.code] = [];
        }
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = this.assignments[uid][`current_${day}`];
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    const dateStr = this.getDateKey(day);
                    if (result[dateStr][shift]) result[dateStr][shift].push(uid);
                }
            }
        }
        return result;
    }
}

console.log('✅ SchedulerV3 已載入 (絕對限制與平衡優化版)');
