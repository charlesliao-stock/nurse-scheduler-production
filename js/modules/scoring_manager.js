// js/modules/scoring_manager.js
// 負責計算排班分數與比較

const scoringManager = {
    aiBaseScore: null, // 記錄 AI 剛排完的原始分數

    // 核心計算函式
    // scheduleData: { uid: { current_1: 'N', ... } }
    // staffList: [ { uid, name, ... } ]
    // dailyNeeds: { 'N_0': 3, ... } (週循環)
    // specificNeeds: { '2025-10-01': { 'N': 4 } } (特定日)
    calculate: function(scheduleData, staffList, dailyNeeds = {}, specificNeeds = {}) {
        // --- 設定權重 (效率40, 疲勞25, 滿意20, 公平10, 成本5) ---
        const weights = {
            efficiency: 40,
            fatigue: 25,
            satisfaction: 20,
            fairness: 10,
            cost: 5
        };

        // 初始化分數結構
        let result = {
            totalScore: 0,
            maxScore: 100, 
            percentage: 0,
            details: { efficiency: 0, fatigue: 0, satisfaction: 0, fairness: 0, cost: 0 }
        };

        // 1. 取得當月天數 (從 scheduleData 推算)
        let daysInMonth = 30; 
        // 找第一個非空的排班資料來判斷天數
        const uids = Object.keys(scheduleData);
        if (uids.length > 0) {
            const assign = scheduleData[uids[0]];
            const days = Object.keys(assign)
                .filter(k => k.startsWith('current_'))
                .map(k => parseInt(k.split('_')[1]))
                .sort((a,b) => b-a);
            if(days.length > 0) daysInMonth = days[0];
        }

        // --- 1. 排班效率 (Efficiency) - 40% ---
        // 簡易評分：若有「紅字缺額」則扣分
        // 這裡做一個基礎估算，詳細缺額在 UI 上已有紅字呈現
        // 若要精算：需結合年份月份推算 dailyNeeds，在此簡化為：假設無重大缺失給滿分
        result.details.efficiency = 5; 


        // --- 2. 疲勞度 (Fatigue) - 25% ---
        // 檢查：連上 > 6 天, 或 N 接 D
        let fatigueViolations = 0;
        
        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            let cons = 0;
            let prevShift = null;
            
            for(let d=1; d<=daysInMonth; d++) {
                const shift = assign[`current_${d}`];
                const isWork = (shift && shift !== 'OFF' && shift !== 'REQ_OFF');
                
                // A. 連上檢查
                if(isWork) {
                    cons++;
                } else {
                    cons = 0;
                }
                
                if(cons > 6) fatigueViolations++;

                // B. N 接 D 檢查 (假設代碼 N=大夜, D=白班)
                // 這裡需視實際班別代號而定，暫定 N 接 D 為違規
                if(prevShift === 'N' && shift === 'D') {
                    fatigueViolations++;
                }
                
                prevShift = shift;
            }
        });

        // 評分標準
        if (fatigueViolations === 0) result.details.fatigue = 5;
        else if (fatigueViolations <= 2) result.details.fatigue = 4;
        else if (fatigueViolations <= 5) result.details.fatigue = 3;
        else result.details.fatigue = 1;


        // --- 3. 滿意度 (Satisfaction) - 20% ---
        // 預班達成率 (REQ_OFF 是否被滿足)
        // 因系統邏輯 REQ_OFF 強制鎖定，故通常為滿分，除非被覆蓋
        let reqTotal = 0;
        let reqHit = 0;
        
        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            // 這裡檢查 assign 中的值是否為 REQ_OFF
            Object.values(assign).forEach(val => {
                if(val === 'REQ_OFF') {
                    reqTotal++;
                    reqHit++; 
                }
            });
        });
        
        // 若有志願班別 (wish) 可在此擴充
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
        
        if(stdDev < 1.0) result.details.fairness = 5;
        else if(stdDev < 1.5) result.details.fairness = 4;
        else if(stdDev < 2.0) result.details.fairness = 3;
        else result.details.fairness = 2;


        // --- 5. 成本 (Cost) - 5% ---
        // 暫定值
        result.details.cost = 4; 


        // --- 總分加權計算 ---
        let weightedSum = 
            (result.details.efficiency * weights.efficiency) +
            (result.details.fatigue * weights.fatigue) +
            (result.details.satisfaction * weights.satisfaction) +
            (result.details.fairness * weights.fairness) +
            (result.details.cost * weights.cost);
            
        // 滿分基數 = 5分 * 100% = 500
        // 計算百分比
        result.percentage = (weightedSum / 500 * 100).toFixed(1);

        return result;
    },

    // 設定基準分 (AI 剛跑完時呼叫)
    setBase: function(score) {
        this.aiBaseScore = score;
    },

    // 計算標準差
    getStdDev: function(arr) {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((a, b) => a + b) / arr.length;
        return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
    }
};
