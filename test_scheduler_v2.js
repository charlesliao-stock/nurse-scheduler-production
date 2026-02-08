// test_scheduler_v2.js
const BaseScheduler = require('./js/scheduler/BaseScheduler.js');
const SchedulerV2 = require('./js/scheduler/SchedulerV2.js');

const staffList = [
    { 
        id: 'staff_continue', 
        name: '延續班別同仁', 
        schedulingParams: { independence: 'independent' },
        preferences: { favShift: 'D' }
    }
];

// 上月 31 號是 E 班
const lastMonthData = {
    'staff_continue': { 'current_31': 'E' }
};

const rules = {
    shifts: [
        { code: 'D', startTime: '08:00', endTime: '16:00' },
        { code: 'E', startTime: '16:00', endTime: '00:00' },
        { code: 'N', startTime: '00:00', endTime: '08:00' }
    ],
    dailyNeeds: {
        'D_0': 1, 'D_1': 1, 'D_2': 1, 'D_3': 1, 'D_4': 1, 'D_5': 1, 'D_6': 1,
        'E_0': 1, 'E_1': 1, 'E_2': 1, 'E_3': 1, 'E_4': 1, 'E_5': 1, 'E_6': 1,
        'N_0': 1, 'N_1': 1, 'N_2': 1, 'N_3': 1, 'N_4': 1, 'N_5': 1, 'N_6': 1
    }
};

console.log("🚀 開始測試班別延續邏輯...");
const scheduler = new SchedulerV2(staffList, 2026, 2, lastMonthData, rules);
const result = scheduler.run();

console.log("\n--- 驗證結果 ---");
let day = 1;
while(day <= 7) {
    const ds = `2026-02-${String(day).padStart(2, '0')}`;
    let currentShift = 'OFF';
    for (let code in result[ds]) {
        if (result[ds][code].includes('staff_continue')) {
            currentShift = code;
            break;
        }
    }
    console.log(`第 ${day} 天班別: ${currentShift}`);
    if (currentShift === 'OFF') {
        console.log(`👉 在第 ${day} 天遇到了第一個 OFF，停止延續。`);
        break;
    } else if (currentShift !== 'E') {
        console.error(`❌ 錯誤：第 ${day} 天應該延續 E 班，卻排了 ${currentShift}`);
    }
    day++;
}

console.log("\n測試完成。");
