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
    
    run() {
        console.log('═══════════════════════════════════════');
        console.log('🤖 SchedulerV3 排班開始');
        console.log('═══════════════════════════════════════');
        
        const startTime = Date.now();
        
        try {
            this.step1_ApplyPreSchedule();
            
            this.step2_WhitelistScheduling();
            
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
        console.log('\n🎯 步驟 2: 白名單排班');
        
        let totalAssigned = 0;
        let totalSkipped = 0;
        
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
                
                const candidates = this.findCandidatesForShift(day, shiftCode);
                
                const assigned = Math.min(candidates.length, shortage);
                
                for (let i = 0; i < assigned; i++) {
                    const candidate = candidates[i];
                    const uid = candidate.uid || candidate.id;
                    
                    this.assignments[uid][`current_${day}`] = shiftCode;
                    this.dailyCount[day][shiftCode]++;
                    totalAssigned++;
                }
                
                if (assigned < shortage) {
                    totalSkipped += (shortage - assigned);
                }
            }
        }
        
        console.log(`   ✅ 已分配 ${totalAssigned} 個班次`);
        if (totalSkipped > 0) {
            console.log(`   ⚠️ 暫時跳過 ${totalSkipped} 個缺額（待後續處理）`);
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
                this.shiftTimeMap
            );
            
            if (whitelist.includes(shiftCode)) {
                const score = this.calculateCandidateScore(staff, day, shiftCode);
                candidates.push({
                    ...staff,
                    score: score
                });
            }
        }
        
        candidates.sort((a, b) => b.score - a.score);
        
        return candidates;
    }
    
    calculateCandidateScore(staff, day, shiftCode) {
        let score = 100;
        
        const prefs = staff.preferences || {};
        
        if (prefs.bundleShift === shiftCode) {
            score += 200;
        }
        
        if (prefs.favShift === shiftCode) {
            score += 100;
        } else if (prefs.favShift2 === shiftCode) {
            score += 50;
        } else if (prefs.favShift3 === shiftCode) {
            score += 30;
        }
        
        const params = staff.schedulingParams || {};
        if (params[`current_${day}`] === shiftCode) {
            score += 150;
        }
        
        if (staff.level === 'N4') {
            score += 20;
        } else if (staff.level === 'N3') {
            score += 15;
        } else if (staff.level === 'N2') {
            score += 10;
        } else if (staff.level === 'N1') {
            score += 5;
        }
        
        const uid = staff.uid || staff.id;
        let workCount = 0;
        for (let d = 1; d <= this.daysInMonth; d++) {
            const shift = this.assignments[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                workCount++;
            }
        }
        score -= workCount;
        
        return score;
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
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                if (!this.assignments[uid][key]) {
                    this.assignments[uid][key] = 'OFF';
                    systemOffCount++;
                }
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
        
        const result = BacktrackSolver.solve(
            this.assignments,
            this.gapList,
            this.allStaff,
            this.rules,
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
        
        const result = BalanceAdjuster.adjust(
            this.assignments,
            this.allStaff,
            this.rules,
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
