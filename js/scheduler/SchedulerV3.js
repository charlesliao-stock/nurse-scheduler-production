// js/scheduler/SchedulerV3.js

class SchedulerV3 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        console.log('🚀 SchedulerV3 初始化');
        console.log(`   人員數: ${allStaff.length}`);
        console.log(`   年月: ${year}/${month}`);
        console.log(`   天數: ${this.daysInMonth}`);
        
        this.assignments = {};
        this.dailyCount = {};
        this.gapList = [];
        
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
        console.log('═══════════════════════════════════════');
        console.log('🤖 SchedulerV3 排班開始');
        console.log('═══════════════════════════════════════');
        
        const startTime = Date.now();
        
        try {
            this.step1_ApplyPreSchedule();
            
            this.step2_WhitelistScheduling();
            
            this.step2_5_ForceFillNeeds();
            
            this.step3_FillGaps();
            
            this.step4_ManageSystemOff();
            
            this.step5_BacktrackIfNeeded();
            
            this.step6_BalanceAdjustment();
            
            const duration = Date.now() - startTime;
            
            console.log('═══════════════════════════════════════');
            console.log(`✅ SchedulerV3 排班完成 (${(duration/1000).toFixed(2)}秒)`);
            console.log('═══════════════════════════════════════');
            
            return this.convertToDateFormat();
            
        } catch (error) {
            console.error('❌ SchedulerV3 排班失敗:', error);
            throw error;
        }
    }
    
    step1_ApplyPreSchedule() {
        console.log('\n📋 步驟 1: 套用預班資料');
        
        let preScheduleCount = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const params = staff.schedulingParams || {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                const preScheduled = params[key];
                
                if (preScheduled && preScheduled !== 'OFF') {
                    this.assignments[uid][key] = preScheduled;
                    this.dailyCount[day][preScheduled] = (this.dailyCount[day][preScheduled] || 0) + 1;
                    preScheduleCount++;
                }
            }
        }
        
        console.log(`   ✅ 已套用 ${preScheduleCount} 個預班`);
    }
    
    step2_WhitelistScheduling() {
        console.log('\n🎯 步驟 2: 白名單排班 (優先包班與志願班)');
        
        let totalAssigned = 0;
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            const dayOfWeek = this.getDayOfWeek(day);
            const needsList = this.calculateDailyNeeds(day, dateStr, dayOfWeek);
            
            for (let needItem of needsList) {
                const shiftCode = needItem.shift;
                const need = needItem.need;
                const current = this.dailyCount[day][shiftCode] || 0;
                const shortage = need - current;
                
                if (shortage <= 0) continue;
                
                // 這裡的 candidates 已經按 優先級(包班>志願1>2>3) 排序
                const candidates = this.findCandidatesForShift(day, shiftCode);
                
                // 只取需要的數量
                const toAssign = candidates.slice(0, shortage);
                
                for (let candidate of toAssign) {
                    const uid = candidate.uid || candidate.id;
                    this.assignments[uid][`current_${day}`] = shiftCode;
                    this.dailyCount[day][shiftCode]++;
                    totalAssigned++;
                }
            }
        }
        
        console.log(`   ✅ 已分配 ${totalAssigned} 個班次`);
    }

    step2_5_ForceFillNeeds() {
        console.log('\n⚡ 步驟 2.5: 強制填補人力缺口 (不限志願，但守規則)');
        
        let forceAssigned = 0;
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            const dayOfWeek = this.getDayOfWeek(day);
            const needsList = this.calculateDailyNeeds(day, dateStr, dayOfWeek);
            
            for (let needItem of needsList) {
                const shiftCode = needItem.shift;
                const need = needItem.need;
                let current = this.dailyCount[day][shiftCode] || 0;
                
                while (current < need) {
                    // 尋找任何符合硬規則的人（不論其志願）
                    const potentialStaff = this.allStaff.filter(staff => {
                        const uid = staff.uid || staff.id;
                        if (this.assignments[uid][`current_${day}`]) return false;
                        
                        const whitelist = WhitelistCalculator.calculate(
                            staff, this.assignments, day, this.year, this.month,
                            this.rules, this.dailyCount[day], this.daysInMonth,
                            this.shiftTimeMap, this.lastMonthData
                        );
                        return whitelist.includes(shiftCode);
                    });
                    
                    if (potentialStaff.length === 0) break;
                    
                    // 優先選休假多的人來填補
                    potentialStaff.sort((a, b) => {
                        const offA = this.countOffDays(this.assignments, a.uid || a.id, day - 1);
                        const offB = this.countOffDays(this.assignments, b.uid || b.id, day - 1);
                        return offB - offA;
                    });
                    
                    const chosen = potentialStaff[0];
                    const uid = chosen.uid || chosen.id;
                    this.assignments[uid][`current_${day}`] = shiftCode;
                    this.dailyCount[day][shiftCode]++;
                    current++;
                    forceAssigned++;
                }
            }
        }
        
        if (forceAssigned > 0) {
            console.log(`   ✅ 強制分配了 ${forceAssigned} 個班次以滿足人力需求`);
        } else {
            console.log(`   ✅ 無需強制分配`);
        }
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
            
            if (need > 0) {
                needsList.push({ shift: shift.code, need: need });
            }
        }
        
        return needsList;
    }
    
    findCandidatesForShift(day, shiftCode) {
        const candidates = [];
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            if (this.assignments[uid][`current_${day}`]) {
                continue;
            }
            
            const whitelist = WhitelistCalculator.calculate(
                staff,
                this.assignments,
                day,
                this.year,
                this.month,
                this.rules,
                this.dailyCount[day],
                this.daysInMonth,
                this.shiftTimeMap,
                this.lastMonthData
            );
            
            if (whitelist.includes(shiftCode)) {
                candidates.push(staff);
            }
        }
        
        const tier0 = []; // 包班人員
        const tier1 = []; // 第一志願
        const tier2 = []; // 第二志願
        const tier3 = []; // 第三志願
        const tierOther = []; // 其他
        
        for (let staff of candidates) {
            const prefs = staff.preferences || {};
            
            if (prefs.bundleShift === shiftCode) {
                tier0.push(staff);
            } else if (prefs.favShift === shiftCode) {
                tier1.push(staff);
            } else if (prefs.favShift2 === shiftCode) {
                tier2.push(staff);
            } else if (prefs.favShift3 === shiftCode) {
                tier3.push(staff);
            } else {
                tierOther.push(staff);
            }
        }
        
        const sortByOffCount = (list) => {
            return list.sort((a, b) => {
                const uidA = a.uid || a.id;
                const uidB = b.uid || b.id;
                const offA = this.countOffDays(this.assignments, uidA, day - 1);
                const offB = this.countOffDays(this.assignments, uidB, day - 1);
                
                if (offA !== offB) {
                    return offB - offA;
                }
                
                const consA = this.countConsecutiveWork(this.assignments, uidA, day - 1);
                const consB = this.countConsecutiveWork(this.assignments, uidB, day - 1);
                
                if (consA !== consB) {
                    return consA - consB;
                }
                
                return Math.random() - 0.5;
            });
        };
        
        sortByOffCount(tier0);
        sortByOffCount(tier1);
        sortByOffCount(tier2);
        sortByOffCount(tier3);
        sortByOffCount(tierOther);
        
        return [...tier0, ...tier1, ...tier2, ...tier3, ...tierOther];
    }
    
    countConsecutiveWork(assignments, uid, upToDay) {
        let count = 0;
        for (let d = upToDay; d >= 1; d--) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                break;
            }
            count++;
        }
        return count;
    }
    
    step3_FillGaps() {
        console.log('\n🔍 步驟 3: 檢查缺額');
        
        this.gapList = [];
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            const dayOfWeek = this.getDayOfWeek(day);
            
            const needsList = this.calculateDailyNeeds(day, dateStr, dayOfWeek);
            
            for (let needItem of needsList) {
                const shiftCode = needItem.shift;
                const need = needItem.need;
                const current = this.dailyCount[day][shiftCode] || 0;
                
                if (current < need) {
                    for (let i = 0; i < (need - current); i++) {
                        this.gapList.push({
                            day: day,
                            date: dateStr,
                            shift: shiftCode,
                            need: need,
                            current: current
                        });
                    }
                }
            }
        }
        
        if (this.gapList.length > 0) {
            console.log(`   ⚠️ 發現 ${this.gapList.length} 個缺額`);
        } else {
            console.log(`   ✅ 無缺額`);
        }
    }
    
    step4_ManageSystemOff() {
        console.log('\n💤 步驟 4: 管理系統 OFF');
        
        let systemOffCount = 0;
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            const key = `current_${day}`;
            
            const availableStaff = this.allStaff.filter(staff => {
                const uid = staff.uid || staff.id;
                return !this.assignments[uid][key];
            });

            if (availableStaff.length === 0) continue;

            availableStaff.sort((a, b) => {
                const uidA = a.uid || a.id;
                const uidB = b.uid || b.id;
                const offA = this.countOffDays(this.assignments, uidA, day - 1);
                const offB = this.countOffDays(this.assignments, uidB, day - 1);
                
                if (offA !== offB) {
                    return offA - offB;
                }
                return Math.random() - 0.5;
            });

            for (let staff of availableStaff) {
                const uid = staff.uid || staff.id;
                this.assignments[uid][key] = 'OFF';
                systemOffCount++;
            }
        }
        
        console.log(`   ✅ 已填入 ${systemOffCount} 個系統 OFF`);
    }
    
    step5_BacktrackIfNeeded() {
        console.log('\n🔄 步驟 5: 回溯求解');
        
        if (this.gapList.length === 0) {
            console.log(`   ✅ 無需回溯`);
            return;
        }
        
        const rulesWithContext = {
            ...this.rules,
            year: this.year,
            month: this.month,
            lastMonthData: this.lastMonthData
        };
        
        const result = BacktrackSolver.solve(
            this.assignments,
            this.gapList,
            this.allStaff,
            rulesWithContext,
            this.dailyCount,
            this.daysInMonth,
            this.shiftTimeMap
        );
        
        console.log(`   ✅ 回溯完成: 解決 ${result.solved.length} 個, 失敗 ${result.failed.length} 個`);
        
        if (result.failed.length > 0) {
            console.warn(`   ⚠️ 以下缺額無法解決:`);
            result.failed.forEach(gap => {
                console.warn(`      - ${gap.date} ${gap.shift}`);
            });
        }
    }
    
    step6_BalanceAdjustment() {
        console.log('\n⚖️ 步驟 6: 平衡調整');
        
        const rulesWithContext = {
            ...this.rules,
            year: this.year,
            month: this.month,
            lastMonthData: this.lastMonthData
        };

        const result = BalanceAdjuster.adjust(
            this.assignments,
            this.allStaff,
            rulesWithContext,
            this.daysInMonth,
            this.shiftTimeMap
        );
        
        console.log(`   ✅ 平衡調整完成: ${result.improved} 次改善`);
    }
    
    convertToDateFormat() {
        const result = {};
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            result[dateStr] = {};
            
            for (let shift of this.shifts) {
                result[dateStr][shift.code] = [];
            }
        }
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                const shift = this.assignments[uid][key];
                
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    const dateStr = this.getDateKey(day);
                    if (result[dateStr][shift]) {
                        result[dateStr][shift].push(uid);
                    }
                }
            }
        }
        
        return result;
    }
}

console.log('✅ SchedulerV3 已載入');
