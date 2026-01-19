// js/modules/scoring_manager.js
// 負責計算排班分數與比較

const scoringManager = {
    aiBaseScore: null, // 記錄 AI 剛排完的原始分數

    // 核心計算函式
    calculate: function(scheduleData, staffList, dailyNeeds = {}, shiftParams = {}) {
        // --- 設定權重 (依據您的需求) ---
        const weights = {
            efficiency: 40,   // 排班效率 (缺班率)
            fatigue: 25,      // 疲勞度 (連六、大夜接白)
            satisfaction: 20, // 滿意度 (預班)
            fairness: 10,     // 公平性 (休假數差異)
            cost: 5           // 成本控制
        };

        // 初始化分數結構
        let result = {
            totalScore: 0,
            maxScore: 100, 
            percentage: 0,
            details: { efficiency: 0, fatigue: 0, satisfaction: 0, fairness: 0, cost: 0 },
            raw: { shortage: 0, fatigueCount: 0, reqRate: 0, stdDev: 0 }
        };

        const daysInMonth = Object.keys(scheduleData).length; // 簡易判斷天數
        
        // --- 1. 排班效率 (Efficiency) - 40% ---
        // 計算缺額率：(總缺額 / 總需求人次)
        let totalNeeds = 0;
        let totalShortage = 0;
        
        // 遍歷每天
        // 注意：scheduleData 結構需為 { uid: { current_1: 'N', ... } } 轉置後的檢查
        // 這裡我們直接統計 assigned
        const dailyCounts = {}; // { day: { shift: count } }

        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            Object.keys(assign).forEach(key => {
                if(key.startsWith('current_')) {
                    const d = key.split('_')[1];
                    const shift = assign[key];
                    if(shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                        if(!dailyCounts[d]) dailyCounts[d] = {};
                        if(!dailyCounts[d][shift]) dailyCounts[d][shift] = 0;
                        dailyCounts[d][shift]++;
                    }
                }
            });
        });

        // 比對需求
        // 假設 dailyNeeds key 為 "N_0" (週日N班需求)
        // 這裡做一個簡化估算，若無 dailyNeeds 則視為滿分
        let hasNeedsData = Object.keys(dailyNeeds).length > 0;
        
        if (hasNeedsData) {
            // 這裡需要知道年份月份來推算星期，暫略，假設傳入的 scheduleData 足夠我們計算
            // 簡化邏輯：若有紅字 (前端 UI 統計的) 則扣分。
            // 為了精確，我們假設 shortage 是外部傳入或在此計算。
            // 這裡先給予一個基礎分，若外部有統計缺額數可傳入修正
        }
        
        // 暫定：若無嚴重缺額給 5 分 (邏輯需配合 dailyNeeds 結構細化)
        result.details.efficiency = 5; 


        // --- 2. 疲勞度 (Fatigue) - 25% ---
        // 違規：連上 > 6 天 或 N 接 D
        let fatigueViolations = 0;
        
        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            let cons = 0;
            let prevShift = null;
            
            // 跑 1~31 日
            for(let d=1; d<=31; d++) {
                const key = `current_${d}`;
                if(!assign[key] && d > daysInMonth) break; // 超出當月
                
                const shift = assign[key];
                const isWork = (shift && shift !== 'OFF' && shift !== 'REQ_OFF');
                
                // 連上檢查
                if(isWork) cons++;
                else cons = 0;
                
                if(cons > 6) fatigueViolations++;

                // N 接 D 檢查 (假設 N=N, D=D)
                if(prevShift === 'N' && shift === 'D') fatigueViolations++;
                
                prevShift = shift;
            }
        });

        // 評分：0次=5分, 1-2次=4分, 3-5次=3分, >5次=1分
        if (fatigueViolations === 0) result.details.fatigue = 5;
        else if (fatigueViolations <= 2) result.details.fatigue = 4;
        else if (fatigueViolations <= 5) result.details.fatigue = 3;
        else result.details.fatigue = 1;
        result.raw.fatigueCount = fatigueViolations;


        // --- 3. 滿意度 (Satisfaction) - 20% ---
        // 預班達成率 (REQ_OFF)
        let reqTotal = 0;
        let reqHit = 0;
        
        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            // 檢查該員的所有 current_X
            Object.keys(assign).forEach(key => {
                if(key.startsWith('current_')) {
                    // 這裡需要比對 "原始預班"，若 scheduleData 已經蓋掉了 REQ_OFF 變成 OFF
                    // 我們假設 REQ_OFF 會被保留在 assignments 中，或是從 user preferences 讀取
                    // 簡化：若 assign 中 value 為 REQ_OFF，視為達成 (因為系統邏輯是 REQ_OFF 不會被覆蓋)
                    // 若要更精準，需傳入 preRequests
                    if (assign[key] === 'REQ_OFF') {
                        reqTotal++;
                        reqHit++; // 目前系統邏輯 REQ_OFF 是鎖定的，所以達成率通常是 100%
                    }
                }
            });
            // 若有 "志願班別" (wish)，可在此加入計算
        });
        
        // 暫時給滿分，除非有被覆蓋的紀錄
        result.details.satisfaction = 5; 


        // --- 4. 公平性 (Fairness) - 10% ---
        // 休假天數標準差
        const offCounts = staffList.map(s => {
            const assign = scheduleData[s.uid] || {};
            let cnt = 0;
            Object.values(assign).forEach(v => {
                if(v === 'OFF' || v === 'REQ_OFF') cnt++;
            });
            return cnt;
        });
        
        const stdDev = this.getStdDev(offCounts);
        // <1.0=5分, <1.5=4分, <2.0=3分...
        if(stdDev < 1.0) result.details.fairness = 5;
        else if(stdDev < 1.5) result.details.fairness = 4;
        else if(stdDev < 2.0) result.details.fairness = 3;
        else result.details.fairness = 2;
        
        result.raw.stdDev = stdDev.toFixed(2);


        // --- 5. 成本 (Cost) - 5% ---
        result.details.cost = 4; // 暫定值


        // --- 總分計算 ---
        let weightedSum = 
            (result.details.efficiency * weights.efficiency) +
            (result.details.fatigue * weights.fatigue) +
            (result.details.satisfaction * weights.satisfaction) +
            (result.details.fairness * weights.fairness) +
            (result.details.cost * weights.cost);
            
        // 滿分基數 = 5分 * 100% = 500
        result.percentage = (weightedSum / 500 * 100).toFixed(1);

        return result;
    },

    setBase: function(score) { this.aiBaseScore = score; },

    getStdDev: function(arr) {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((a, b) => a + b) / arr.length;
        return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
    }
};
