// test_scheduler.js
// 模擬環境測試排班邏輯修正

const BaseScheduler = require('./js/scheduler/BaseScheduler.js');
const SchedulerV2 = require('./js/scheduler/SchedulerV2.js');

// 模擬資料
const staffList = [
    { 
        id: 'staff_pregnant', 
        name: '懷孕同仁', 
        schedulingParams: { 
            isPregnant: true, 
            pregnantExpiry: '2026-12-31',
            independence: 'independent'
        },
        preferences: { favShift: 'D' }
    },
    { 
        id: 'staff_normal', 
        name: '一般同仁', 
        schedulingParams: { independence: 'independent' },
        preferences: { favShift: 'E' }
    }
];

const lastMonthData = {
    'staff_pregnant': { 'current_31': 'D' },
    'staff_normal': { 'current_31': 'N' }
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

// 執行排班
console.log("🚀 開始測試 AI 排班...");
const scheduler = new SchedulerV2(staffList, 2026, 2, lastMonthData, rules);
const result = scheduler.run();

// 驗證結果
console.log("\n--- 驗證結果 ---");

// 1. 檢查懷孕同仁是否被排了小夜或大夜
let pregnantNightShifts = 0;
for (let d = 1; d <= 28; d++) {
    const ds = `2026-02-${String(d).padStart(2, '0')}`;
    for (let code in result[ds]) {
        if (result[ds][code].includes('staff_pregnant')) {
            if (code === 'E' || code === 'N') {
                pregnantNightShifts++;
                console.error(`❌ 錯誤：懷孕同仁在 ${ds} 被排了 ${code} 班`);
            }
        }
    }
}
if (pregnantNightShifts === 0) {
    console.log("✅ 成功：懷孕同仁未被安排小夜或大夜班");
}

// 2. 檢查跨月休息時間 (staff_normal 上月 31 號是大夜 N，1 號不能排白班 D)
const ds1 = '2026-02-01';
if (result[ds1]['D'] && result[ds1]['D'].includes('staff_normal')) {
    console.error("❌ 錯誤：一般同仁上月跨月休息不足，卻被排了白班 D");
} else {
    console.log("✅ 成功：跨月休息時間檢查生效");
}

console.log("\n測試完成。");
