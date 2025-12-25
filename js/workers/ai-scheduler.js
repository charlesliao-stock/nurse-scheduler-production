// js/workers/ai-scheduler.js

// 引入 Immer.js 以便處理不可變狀態 (透過 CDN)
importScripts('https://cdn.jsdelivr.net/npm/immer@9.0.21/dist/immer.umd.production.min.js');

self.onmessage = function(e) {
    const { type, payload } = e.data;

    if (type === 'START_AI') {
        try {
            console.log("[AI Worker] 接收到任務，開始運算...");
            const result = runScheduler(payload);
            self.postMessage({ type: 'SUCCESS', result });
        } catch (error) {
            self.postMessage({ type: 'ERROR', message: error.message });
        }
    }
};

/**
 * 核心排班演算法
 * @param {object} data - 包含 staffList, shifts, preSchedules, daysInMonth, rules
 */
function runScheduler(data) {
    const { staffList, shifts, preSchedules, daysInMonth } = data;
    
    // 定義每日人力需求 (之後可做成動態設定)
    // 假設每天需：白班(2), 小夜(2), 大夜(2) - 這只是範例邏輯
    const DEMAND = { 'D': 2, 'E': 2, 'N': 2 }; 
    
    // 取得有效的班別代號 (排除休假)
    const WORK_SHIFTS = Object.values(shifts)
        .filter(s => s.hours > 0)
        .map(s => s.code);

    // 初始化排班表 (空表)
    let schedule = {};
    staffList.forEach(staff => {
        schedule[staff.id] = {};
        for (let d = 1; d <= daysInMonth; d++) {
            schedule[staff.id][d] = null; // null 代表尚未排班
        }
    });

    // ==========================================
    // Cycle 1: 優先填入預班 (Hard Rules & Wishes)
    // ==========================================
    schedule = immer.produce(schedule, draft => {
        staffList.forEach(staff => {
            const staffId = staff.id;
            const wishes = preSchedules?.wishes?.[staffId] || {};

            for (let d = 1; d <= daysInMonth; d++) {
                // 1. 填入預班 (User Wishes)
                if (wishes[d]) {
                    draft[staffId][d] = wishes[d];
                }
            }
        });
    });

    // ==========================================
    // Cycle 2: 填補缺口 (Fill Gaps)
    // ==========================================
    // 簡單的隨機貪婪演算法 (Random Greedy)
    
    for (let d = 1; d <= daysInMonth; d++) {
        // 取得當天還沒排班的人員，並隨機打亂 (洗牌) 以示公平
        let availableStaff = staffList.filter(s => schedule[s.id][d] === null);
        availableStaff = shuffleArray(availableStaff);

        WORK_SHIFTS.forEach(shiftCode => {
            // 該班別設定 (用來檢查屬性)
            const shiftConfig = shifts[shiftCode];

            // 計算目前該班別已有人數 (包含預班)
            let currentCount = countStaffOnShift(schedule, d, shiftCode);
            let needed = (DEMAND[shiftCode] || 0) - currentCount;

            if (needed > 0) {
                // 從可用人員中挑選
                for (let i = 0; i < availableStaff.length; i++) {
                    if (needed <= 0) break;
                    
                    const staff = availableStaff[i];
                    
                    // 檢查規則 (Rules Check)
                    // 1. 檢查人員屬性 (如: 懷孕不排夜班)
                    if (checkStaffConstraints(staff, shiftConfig)) {
                        // 2. 檢查排班邏輯 (如: 不可 N 接 D)
                        if (isValidAssignment(schedule, staff.id, d, shiftCode, shifts)) {
                            schedule[staff.id][d] = shiftCode; // 排入
                            
                            // 從可用名單移除
                            availableStaff.splice(i, 1);
                            i--; 
                            needed--;
                        }
                    }
                }
            }
        });

        // 剩下的人全部排 OFF (休假)
        availableStaff.forEach(staff => {
            schedule[staff.id][d] = 'OFF';
        });
    }

    return schedule;
}

// --- 輔助函式 ---

// 洗牌演算法 (Fisher-Yates)
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 計算當天某班別的人數
function countStaffOnShift(schedule, day, shiftCode) {
    let count = 0;
    Object.values(schedule).forEach(s => {
        if (s[day] === shiftCode) count++;
    });
    return count;
}

// 檢查人員屬性限制
function checkStaffConstraints(staff, shiftConfig) {
    // 規則: 懷孕者不排夜班 (Night)
    if (staff.isPregnant && shiftConfig.category === 'Night') {
        return false;
    }
    return true;
}

// 檢查排班邏輯 (核心邏輯)
function isValidAssignment(schedule, staffId, day, shiftCode, allShifts) {
    // 規則 1: N 接 D 禁止 (昨日是 N，今日不能是 D)
    if (day > 1) {
        const prevCode = schedule[staffId][day - 1];
        if (prevCode) {
            const prevShift = allShifts[prevCode];
            const currShift = allShifts[shiftCode];

            // 如果昨天是夜班 (Night)，今天是日班 (Day)，禁止
            if (prevShift?.category === 'Night' && currShift?.category === 'Day') {
                return false;
            }
        }
    }

    // 規則 2: 連續上班天數限制 (勞基法 7休1，這裡設定連 6 天後必須休)
    let consecutiveDays = 0;
    for (let k = day - 1; k >= 1; k--) {
        const code = schedule[staffId][k];
        // 如果不是 OFF 且不是 null，視為上班
        if (code && code !== 'OFF') {
            consecutiveDays++;
        } else {
            break;
        }
    }
    
    // 如果已經連上 6 天，今天不能再排班 (除非是 OFF)
    if (consecutiveDays >= 6 && shiftCode !== 'OFF') {
        return false;
    }

    return true;
}
