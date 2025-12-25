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
    const { staffList, shifts, preSchedules, year, month, daysInMonth } = data;
    
    // 定義需求 (這裡先簡化為固定需求，未來可從 Rules 讀取)
    // 假設每天需：白班(D) 2人, 小夜(E) 2人, 大夜(N) 2人
    const DEMAND = { 'D': 2, 'E': 2, 'N': 2 }; 
    const SHIFT_KEYS = Object.keys(shifts).filter(k => shifts[k].hours > 0); // 排除 OFF

    // 初始化排班表 (空表)
    let schedule = {};
    staffList.forEach(staff => {
        schedule[staff.id] = {};
        for (let d = 1; d <= daysInMonth; d++) {
            schedule[staff.id][d] = null; // null 代表尚未排班
        }
    });

    // ==========================================
    // Cycle 1: 硬規則與預班填入 (Hard Rules & Wishes)
    // ==========================================
    schedule = immer.produce(schedule, draft => {
        staffList.forEach(staff => {
            const staffId = staff.id;
            const wishes = preSchedules?.wishes?.[staffId] || {};

            for (let d = 1; d <= daysInMonth; d++) {
                // 1. 填入預班 (User Wishes) - 這是最高優先級
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

        SHIFT_KEYS.forEach(shiftCode => {
            // 計算目前該班別已有人數 (包含預班)
            let currentCount = countStaffOnShift(schedule, d, shiftCode);
            let needed = DEMAND[shiftCode] - currentCount;

            if (needed > 0) {
                // 從可用人員中挑選
                for (let i = 0; i < availableStaff.length; i++) {
                    if (needed <= 0) break;
                    
                    const staff = availableStaff[i];
                    
                    // 檢查規則 (Rules Check)
                    if (isValidAssignment(schedule, staff.id, d, shiftCode)) {
                        schedule[staff.id][d] = shiftCode; // 排入
                        
                        // 從可用名單移除
                        availableStaff.splice(i, 1);
                        i--; 
                        needed--;
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

// 檢查規則 (核心邏輯)
function isValidAssignment(schedule, staffId, day, shiftCode) {
    // 規則 1: N 接 D 禁止 (昨日是 N，今日不能是 D)
    if (day > 1) {
        const prevShift = schedule[staffId][day - 1];
        if (prevShift === 'N' && shiftCode === 'D') return false;
        // 小夜接白班也盡量避免 (E -> D)
        if (prevShift === 'E' && shiftCode === 'D') return false;
    }

    // 規則 2: 連續上班天數限制 (勞基法 7休1，這裡簡化為連6休1)
    // 往回推算連續上班天數
    let consecutiveDays = 0;
    for (let k = day - 1; k >= 1; k--) {
        if (schedule[staffId][k] !== 'OFF' && schedule[staffId][k] !== null) {
            consecutiveDays++;
        } else {
            break;
        }
    }
    // 如果已經連上 6 天，今天必須 OFF
    if (consecutiveDays >= 6 && shiftCode !== 'OFF') return false;

    return true;
}
