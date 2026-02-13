
const fs = require('fs');
const path = require('path');

// Mock environment
global.BaseScheduler = class {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.allStaff = allStaff || [];
        this.year = year;
        this.month = month;
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.shifts = rules.shifts || [];
        this.dailyNeeds = rules.dailyNeeds || {};
        this.specificNeeds = rules.specificNeeds || {};
        this.shiftTimeMap = this.buildShiftTimeMap();
    }
    buildShiftTimeMap() {
        const map = {};
        this.shifts.forEach(s => {
            map[s.code] = {
                startTime: s.startTime,
                endTime: s.endTime,
                duration: s.duration || 8
            };
        });
        return map;
    }
    getDateKey(day) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    getDayOfWeek(day) {
        const date = new Date(this.year, this.month - 1, day);
        const jsDay = date.getDay();
        return (jsDay === 0) ? 6 : jsDay - 1;
    }
    countOffDays(assignments, uid, upToDay) {
        let count = 0;
        for (let d = 1; d <= upToDay; d++) {
            const val = assignments[uid]?.[`current_${d}`];
            if (!val || val === 'OFF' || val === 'REQ_OFF') {
                count++;
            }
        }
        return count;
    }
    countConsecutiveWork(assignments, uid, upToDay) {
        let count = 0;
        for (let d = upToDay; d >= 1; d--) {
            const val = assignments[uid]?.[`current_${d}`];
            if (val && val !== 'OFF' && val !== 'REQ_OFF') {
                count++;
            } else {
                break;
            }
        }
        return count;
    }
};

// Load components
const WhitelistCalculatorContent = fs.readFileSync('/home/ubuntu/nurse-scheduler-production/js/scheduler/validators/WhitelistCalculator.js', 'utf8');
eval(WhitelistCalculatorContent.replace('const WhitelistCalculator =', 'global.WhitelistCalculator ='));

const BacktrackSolverContent = fs.readFileSync('/home/ubuntu/nurse-scheduler-production/js/scheduler/algorithms/BacktrackSolver.js', 'utf8');
eval(BacktrackSolverContent.replace('const BacktrackSolver =', 'global.BacktrackSolver ='));

const BalanceAdjusterContent = fs.readFileSync('/home/ubuntu/nurse-scheduler-production/js/scheduler/algorithms/BalanceAdjuster.js', 'utf8');
eval(BalanceAdjusterContent.replace('const BalanceAdjuster =', 'global.BalanceAdjuster ='));

const SchedulerV3Content = fs.readFileSync('/home/ubuntu/nurse-scheduler-production/js/scheduler/SchedulerV3.js', 'utf8');
eval(SchedulerV3Content.replace('class SchedulerV3 extends BaseScheduler', 'global.SchedulerV3 = class extends global.BaseScheduler'));

// Simulation Data
const staff = [
    { id: 'S1', name: '張敬俐', preferences: { favShift: 'D' } },
    { id: 'S2', name: '李易霖', preferences: { favShift: 'D' } },
    { id: 'S3', name: '巫宇涵', preferences: { favShift: 'D' } },
    { id: 'S4', name: '廖苡凱', preferences: { favShift: 'D' } },
    { id: 'S5', name: '簡嘉瑩', preferences: { favShift: 'D' } },
    { id: 'S6', name: '劉芝吟', preferences: { bundleShift: 'E', favShift: 'E' } },
    { id: 'S7', name: '林珈琪', preferences: { bundleShift: 'N', favShift: 'N' } },
    { id: 'S8', name: '高郁惠', preferences: { bundleShift: 'N', favShift: 'N' } },
    { id: 'S9', name: '陳皓芸', preferences: { bundleShift: 'E', favShift: 'E' } },
    { id: 'S10', name: '曾郁云', preferences: { favShift: 'N' } },
    { id: 'S11', name: '郭力瑄', preferences: { favShift: 'D' } },
    { id: 'S12', name: '許辰佑', preferences: { favShift: 'E' } }
];

const shifts = [
    { code: 'D', startTime: '08:00', endTime: '16:00' },
    { code: 'E', startTime: '16:00', endTime: '00:00' },
    { code: 'N', startTime: '00:00', endTime: '08:00' }
];

// Daily needs: D:2, E:2, N:2 (Total 6 per day)
const dailyNeeds = {};
for (let i = 0; i < 7; i++) {
    dailyNeeds[`D_${i}`] = 2;
    dailyNeeds[`E_${i}`] = 2;
    dailyNeeds[`N_${i}`] = 2;
}

const rules = {
    shifts: shifts,
    dailyNeeds: dailyNeeds,
    specificNeeds: {},
    hard: { minGap11: true },
    policy: { maxConsDays: 6 }
};

const scheduler = new global.SchedulerV3(staff, 2026, 1, {}, rules);
const result = scheduler.run();

// Analyze result
console.log('\n--- 排班結果分析 ---');
const staffOffCounts = {};
staff.forEach(s => {
    let offCount = 0;
    for (let day = 1; day <= 31; day++) {
        const dateKey = `2026-01-${String(day).padStart(2, '0')}`;
        let assigned = false;
        for (let shift of shifts) {
            if (result[dateKey][shift.code].includes(s.id)) {
                assigned = true;
                break;
            }
        }
        if (!assigned) offCount++;
    }
    staffOffCounts[s.name] = offCount;
});

console.table(staffOffCounts);

const dailyShortage = [];
for (let day = 1; day <= 31; day++) {
    const dateKey = `2026-01-${String(day).padStart(2, '0')}`;
    let dayShortage = 0;
    for (let shift of shifts) {
        const assigned = result[dateKey][shift.code].length;
        const need = 2;
        if (assigned < need) dayShortage += (need - assigned);
    }
    if (dayShortage > 0) dailyShortage.push({ day, shortage: dayShortage });
}

console.log('\n--- 每日缺額 ---');
if (dailyShortage.length === 0) {
    console.log('✅ 所有人力需求均滿足');
} else {
    console.table(dailyShortage);
}
