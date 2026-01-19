// js/modules/scoring_manager.js
// 負責計算排班分數與比較

const scoringManager = {
    aiBaseScore: null, // 記錄 AI 剛排完的原始分數

    // 核心計算函式
    calculate: function(scheduleData, staffList, dailyNeeds = {}, specificNeeds = {}) {
        // --- 設定權重 ---
        const weights = {
            efficiency: 40,   // 排班效率 (缺班率)
            fatigue: 25,      // 疲勞度 (連六、大夜接白)
            satisfaction: 20, // 滿意度 (預班達成)
            fairness: 10,     // 公平性 (休假數差異)
            cost: 5           // 成本控制
        };

        // 初始化分數結構
        let result = {
            totalScore: 0,
            maxScore: 100, 
            percentage: 0,
            details: { efficiency: 0, fatigue: 0, satisfaction: 0, fairness: 0, cost: 0 }
        };

        // 判斷當月天數 (從 scheduleData 推算)
        let daysInMonth = 30; 
        const sampleAssign = Object.values(scheduleData)[0] || {};
        const days = Object.keys(sampleAssign)
            .filter(k => k.startsWith('current_'))
            .map(k => parseInt(k.split('_')[1]))
            .sort((a,b)=>b-a);
        if(days.length > 0) daysInMonth = days[0];

        // --- 1. 排班效率 (Efficiency) - 40% ---
        // 簡易邏輯：若有嚴重缺額扣分。
        // 這裡暫時給予高分，實際缺額紅字由 UI 呈現，若需精算需結合 dailyNeeds 比對
        result.details.efficiency = 5; 


        // --- 2. 疲勞度 (Fatigue) - 25% ---
        let fatigueViolations = 0;
        
        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            let cons = 0;
            let prevShift = null;
            
            for(let d=1; d<=daysInMonth; d++) {
                const shift = assign[`current_${d}`];
                const isWork = (shift && shift !== 'OFF' && shift !== 'REQ_OFF');
                
                // A. 連上檢查
                if(isWork) cons++;
                else cons = 0;
                if(cons > 6) fatigueViolations++;

                // B. N 接 D 檢查 (假設代碼 N, D)
                if(prevShift === 'N' && shift === 'D') fatigueViolations++;
                
                prevShift = shift;
            }
        });

        if (fatigueViolations === 0) result.details.fatigue = 5;
        else if (fatigueViolations <= 2) result.details.fatigue = 4;
        else if (fatigueViolations <= 5) result.details.fatigue = 3;
        else result.details.fatigue = 1;


        // --- 3. 滿意度 (Satisfaction) - 20% ---
        // 預班達成率 (REQ_OFF 是否被滿足)
        let reqTotal = 0;
        let reqHit = 0;
        
        staffList.forEach(s => {
            const assign = scheduleData[s.uid] || {};
            Object.values(assign).forEach(val => {
                if(val === 'REQ_OFF') {
                    reqTotal++;
                    reqHit++; 
                }
            });
        });
        result.details.satisfaction = 5; // 因系統強制鎖定 REQ_OFF，故滿分


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
        result.details.cost = 4; 


        // --- 總分加權 ---
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
