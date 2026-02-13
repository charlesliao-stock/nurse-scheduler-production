// js/scheduler/SchedulerV3.js

class SchedulerV3 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        console.log('🚀 SchedulerV3 初始化');
        this.assignments = {};
        this.dailyCount = {};
        this.initializeAssignments();
        this.initializeDailyCount();
        this.calculateAvgOff();
    }
    
    initializeAssignments() {
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            this.assignments[uid] = {
                preferences: staff.preferences || {}
            };
        }
    }
    
    initializeDailyCount() {
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.dailyCount[day] = {};
            for (let shift of this.shifts) {
                this.dailyCount[day][shift.code] = 0;
            }
        }
    }
    
    calculateAvgOff() {
        const staffCount = this.allStaff.length;
        if (staffCount === 0) {
            this.rules.avgOff = 0;
            return;
        }
        
        let totalAvailableOff = 0;
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            const dayOfWeek = this.getDayOfWeek(day);
            let dailyNeedCount = 0;
            
            if (this.specificNeeds[dateStr]) {
                Object.values(this.specificNeeds[dateStr]).forEach(count => {
                    dailyNeedCount += (parseInt(count) || 0);
                });
            } else {
                this.shifts.forEach(s => {
                    const key = `${s.code}_${dayOfWeek}`;
                    dailyNeedCount += (this.dailyNeeds[key] || 0);
                });
            }
            totalAvailableOff += Math.max(0, staffCount - dailyNeedCount);
        }
        
        this.rules.avgOff = totalAvailableOff / staffCount;
        console.log(`   ℹ️ 平均休假天數: ${this.rules.avgOff.toFixed(1)}`);
    }
    
    run() {
        console.log('🤖 SchedulerV3 排班開始');
        try {
            this.step1_ApplyPreSchedule();
            this.step2_GlobalScheduling();
            this.step3_BalanceAdjustment();
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
                const preScheduled = params[key];
                if (preScheduled && preScheduled !== 'OFF') {
                    this.assignments[uid][key] = preScheduled;
                    this.dailyCount[day][preScheduled] = (this.dailyCount[day][preScheduled] || 0) + 1;
                }
            }
        }
    }
    
    step2_GlobalScheduling() {
        console.log('\n🎯 步驟 2: 全局需求導向排班');
        
        // 第一輪：排所有人的包班 (包班人員必須排滿，除非違反硬規則)
        this.fillShiftsByPriority('bundle');
        
        // 第二輪：排志願班 (優先滿足志願)
        this.fillShiftsByPriority('preference');
        
        // 第三輪：強制填補 (確保沒有紅字)
        this.fillShiftsByPriority('force');
        
        // 填補當天剩餘的人為 OFF
        for (let day = 1; day <= this.daysInMonth; day++) {
            for (let staff of this.allStaff) {
                const uid = staff.uid || staff.id;
                if (!this.assignments[uid][`current_${day}`]) {
                    this.assignments[uid][`current_${day}`] = 'OFF';
                }
            }
        }
    }

    fillShiftsByPriority(type) {
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
                    if (type === 'bundle') {
                        return prefs.bundleShift === shiftCode;
                    } else if (type === 'preference') {
                        // 志願班：排除有包班的人（因為包班已在第一輪處理），且必須是其志願之一
                        if (prefs.bundleShift) return false;
                        return prefs.favShift === shiftCode || prefs.favShift2 === shiftCode || prefs.favShift3 === shiftCode;
                    } else {
                        // 強制填補：排除有包班的人，其餘人只要符合硬規則就可排（即使不是其志願）
                        return !prefs.bundleShift;
                    }
                });

                // 檢查硬規則
                candidates = candidates.filter(staff => {
                    const whitelist = WhitelistCalculator.calculate(
                        staff, this.assignments, day, this.year, this.month,
                        this.rules, this.dailyCount[day], this.daysInMonth,
                        this.shiftTimeMap, this.lastMonthData
                    );
                    return whitelist.includes(shiftCode);
                });

                // 排序：
                candidates.sort((a, b) => {
                    // 1. 優先滿足包班人員的班次 (在 bundle 階段)
                    // 2. 對於志願和強制階段，優先選「目前上班天數最少」的人，以達成平衡
                    const workA = this.countWorkDays(this.assignments, a.uid || a.id, day - 1);
                    const workB = this.countWorkDays(this.assignments, b.uid || b.id, day - 1);
                    if (workA !== workB) return workA - workB;
                    
                    if (type === 'preference') {
                        const getScore = (s) => {
                            const p = s.preferences || {};
                            if (p.favShift === shiftCode) return 1;
                            if (p.favShift2 === shiftCode) return 2;
                            if (p.favShift3 === shiftCode) return 3;
                            return 4;
                        };
                        return getScore(a) - getScore(b);
                    }
                    return 0;
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

    step3_BalanceAdjustment() {
        console.log('\n⚖️ 步驟 3: 全局平衡調整');
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

console.log('✅ SchedulerV3 已載入 (全局優化版)');
