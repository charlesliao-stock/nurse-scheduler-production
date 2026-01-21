// js/modules/scoring_manager.js
// 🚀 最終修正版：動態讀取設定、精確計算人力缺口 (應排 vs 實排)

const scoringManager = {
    aiBaseScore: null,     
    currentSettings: null, 

    loadSettings: async function(unitId) {
        if(!unitId) { this.currentSettings = this.getDefaultSettings(); return; }
        try {
            const doc = await db.collection('units').doc(unitId).get();
            const data = doc.data();
            if(doc.exists && data && data.scoreSettings) {
                this.currentSettings = this.ensureSettingsStructure(data.scoreSettings);
            } else {
                this.currentSettings = this.getDefaultSettings();
            }
        } catch(e) { console.error(e); this.currentSettings = this.getDefaultSettings(); }
    },

    ensureSettingsStructure: function(s) {
        const d = this.getDefaultSettings();
        return {
            weights: s.weights || d.weights,
            thresholds: s.thresholds || d.thresholds,
            enables: s.enables || d.enables,
            tiers: s.tiers || d.tiers
        };
    },

    setBase: function(score) { this.aiBaseScore = (score?.total) ? score.total : score; },
    getScoreDiff: function(currentScore) {
        if (this.aiBaseScore === null || typeof currentScore !== 'number') return null;
        return Math.round((currentScore - this.aiBaseScore) * 10) / 10;
    },

    // --- 核心計算 ---
    // 這裡我們需要 dailyNeeds 來計算缺口，但原本架構 scheduleData 只有 assignments
    // 為了解決此問題，我們嘗試從 scheduleData 外部傳入 needs，或者在此進行估算
    // 最佳解：在 calculate 時傳入 dailyNeeds。
    // 如果 schedule_editor_manager 沒有傳 dailyNeeds，我們會嘗試從 data 恢復，或忽略此項
    
    calculate: function(scheduleData, staffList, year, month, extraData = {}) {
        const settings = this.currentSettings || this.getDefaultSettings();
        const enables = settings.enables || {};
        const thresholds = settings.thresholds || {}; 
        const daysInMonth = new Date(year, month, 0).getDate();
        
        // 取得每日需求設定 (若有傳入)
        // extraData 應該由外部傳入 { dailyNeeds: ... }
        // 為了相容舊呼叫方式，這裡做個防呆
        let dailyNeeds = {};
        if (extraData && extraData.dailyNeeds) {
            dailyNeeds = extraData.dailyNeeds;
        } else {
            // 如果沒傳，嘗試從全域或 DOM 獲取 (這是不好的做法，但為了救急)
            // 建議 schedule_editor_manager.js 的 updateScheduleScore 修改呼叫方式
            if (typeof scheduleEditorManager !== 'undefined' && scheduleEditorManager.data) {
                dailyNeeds = scheduleEditorManager.data.dailyNeeds || {};
            }
        }

        const structure = {
            fairness: { label: "1. 公平性指標", subs: { hoursDiff: "工時差異", nightDiff: "夜班差異", holidayDiff: "假日差異" }},
            satisfaction: { label: "2. 滿意度指標", subs: { wishRate: "預班願望達成率" }},
            fatigue: { label: "3. 疲勞度指標", subs: { consWork: "連續上班限制" }},
            efficiency: { label: "4. 效率指標", subs: { shortageRate: "人力缺口率" }},
            cost: { label: "5. 成本指標", subs: { overtimeRate: "加班費控管" }}
        };

        let grandTotalScore = 0;
        let grandTotalMax = 0;
        const resultDetails = {};

        for (let catKey in structure) {
            const catConfig = structure[catKey];
            const subResults = [];
            let catScore = 0;
            let catMax = 0;

            for (let subKey in catConfig.subs) {
                if (enables[subKey]) {
                    const weight = parseFloat(thresholds[subKey] || 0);
                    
                    // 傳入 dailyNeeds 給子計算
                    const rawTierScore = this.calculateSubItemRaw(subKey, scheduleData, staffList, year, month, daysInMonth, settings, dailyNeeds);
                    const actualScore = (rawTierScore / 5) * weight;

                    subResults.push({
                        key: subKey, label: catConfig.subs[subKey],
                        score: Math.round(actualScore * 10) / 10,
                        max: weight, tier: rawTierScore
                    });

                    catScore += actualScore;
                    catMax += weight;
                }
            }

            resultDetails[catKey] = {
                label: catConfig.label,
                score: Math.round(catScore * 10) / 10,
                max: catMax,
                subs: subResults
            };

            grandTotalScore += catScore;
            grandTotalMax += catMax;
        }

        return {
            total: Math.round(grandTotalScore * 10) / 10,
            maxTotal: grandTotalMax,
            details: resultDetails
        };
    },

    calculateSubItemRaw: function(subKey, scheduleData, staffList, year, month, days, settings, dailyNeeds) {
        const tiers = settings.tiers || {};
        
        // 公平性
        if (subKey === 'hoursDiff') {
            const hours = staffList.map(s => this.sumWorkHours(scheduleData[s.uid]));
            return this.getScoreByTier(this.getStdDev(hours), tiers.hoursDiff);
        }
        if (subKey === 'nightDiff') {
            const counts = staffList.map(s => this.countShifts(scheduleData[s.uid], ['N', 'EN', 'AN', 'MN']));
            return this.getScoreByTier(Math.max(...counts) - Math.min(...counts), tiers.nightDiff);
        }
        if (subKey === 'holidayDiff') {
            const holidayOffs = staffList.map(s => this.countHolidayOff(scheduleData[s.uid], year, month, days));
            return this.getScoreByTier(Math.max(...holidayOffs) - Math.min(...holidayOffs), tiers.holidayDiff);
        }

        // 滿意度
        if (subKey === 'wishRate') {
            let totalReq = 0, hit = 0;
            staffList.forEach(s => {
                const params = s.schedulingParams || {};
                for (let d=1; d<=days; d++) {
                    if (params[`current_${d}`] === 'REQ_OFF') {
                        totalReq++;
                        const val = scheduleData[s.uid]?.[`current_${d}`];
                        if (!val || val === 'OFF' || val === 'REQ_OFF') hit++;
                    }
                }
            });
            const failRate = totalReq === 0 ? 0 : ((totalReq - hit) / totalReq) * 100;
            return this.getScoreByTier(failRate, tiers.wishRate);
        }

        // 疲勞度
        if (subKey === 'consWork') {
            let totalVio = 0;
            staffList.forEach(s => {
                let cons = 0;
                for (let d=1; d<=days; d++) {
                    const shift = scheduleData[s.uid]?.[`current_${d}`];
                    if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                        cons++; if (cons > 6) totalVio++;
                    } else cons = 0;
                }
            });
            return this.getScoreByTier(totalVio, tiers.consWork);
        }

        // [關鍵修正]：人力缺口率 (Shortage Rate)
        // 邏輯：累加每天每班別的 (需求人數 - 實際人數)
        if (subKey === 'shortageRate') {
            let totalShortage = 0; // 總缺額 (人次)
            let totalRequired = 0; // 總需求 (人次)

            // 統計每日實際排班狀況
            // 結構: actualCounts[day][shiftCode] = count
            const actualCounts = {};
            for(let d=1; d<=days; d++) actualCounts[d] = {};

            staffList.forEach(s => {
                const assign = scheduleData[s.uid] || {};
                for(let d=1; d<=days; d++) {
                    const code = assign[`current_${d}`];
                    if(code && code !== 'OFF' && code !== 'REQ_OFF') {
                        if(!actualCounts[d][code]) actualCounts[d][code] = 0;
                        actualCounts[d][code]++;
                    }
                }
            });

            // 比對需求
            // dailyNeeds key 格式: "ShiftCode_DayOfWeek" (例如 "D_1")
            // 我們需要反向遍歷：對於每一天，檢查所有班別的需求
            
            // 找出所有出現過的班別代號 (從 dailyNeeds 的 key 解析)
            const shiftCodes = new Set();
            Object.keys(dailyNeeds).forEach(k => {
                const code = k.split('_')[0];
                if(code) shiftCodes.add(code);
            });

            for (let d = 1; d <= days; d++) {
                const dayOfWeek = new Date(year, month - 1, d).getDay(); // 0-6
                
                shiftCodes.forEach(code => {
                    const needKey = `${code}_${dayOfWeek}`;
                    const required = parseInt(dailyNeeds[needKey]) || 0;
                    const actual = actualCounts[d][code] || 0;

                    if (required > 0) {
                        totalRequired += required;
                        if (actual < required) {
                            totalShortage += (required - actual);
                        }
                    }
                });
            }

            // 若完全沒有設定需求，視為無缺口 (滿分)
            if (totalRequired === 0) return 5;

            // 計算缺口率 %
            const shortageRate = (totalShortage / totalRequired) * 100;

            // 使用「設定檔中的 Tiers」來決定分數，而不是寫死
            return this.getScoreByTier(shortageRate, tiers.shortageRate);
        }

        if (subKey === 'overtimeRate') return 5; 

        return 3;
    },

    getScoreByTier: function(value, tierList) {
        // 如果沒有設定 tier，回傳預設 3
        if (!tierList || !Array.isArray(tierList) || tierList.length === 0) return 3;
        
        // 排序：假設 limit 是下限 (>= limit)，則由大到小排序找出第一個符合的
        // 或者：假設 limit 是上限？通常是 "數值 >= X 得分 Y"
        // 您的設定介面是 "下限 (>=)"
        
        const sorted = [...tierList].sort((a, b) => b.limit - a.limit);
        for (let t of sorted) {
            if (value >= t.limit) return t.score;
        }
        // 如果比最小的 limit 還小 (例如缺口率 0.5%，最小 limit 是 1%)
        // 通常這代表極佳，回傳列表最高分 (通常是最後一個或第一個，視排序而定)
        // 這裡回傳 sorted 中分數最高的
        return Math.max(...tierList.map(t => t.score));
    },

    getStdDev: function(array) {
        const n = array.length; if (n <= 1) return 0;
        const mean = array.reduce((a, b) => a + b) / n;
        return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
    },
    sumWorkHours: function(assign) {
        if (!assign) return 0;
        return Object.values(assign).filter(v => v && v !== 'OFF' && v !== 'REQ_OFF').length * 8;
    },
    countShifts: function(assign, codes) {
        if (!assign) return 0;
        return Object.values(assign).filter(v => codes.includes(v)).length;
    },
    countHolidayOff: function(assign, year, month, days) {
        if (!assign) return 0;
        let count = 0;
        for (let d=1; d<=days; d++) {
            const date = new Date(year, month - 1, d);
            const day = date.getDay();
            if (day === 0 || day === 6) { 
                const v = assign[`current_${d}`];
                if (!v || v === 'OFF' || v === 'REQ_OFF') count++;
            }
        }
        return count;
    },
    getDefaultSettings: function() {
        return { weights: {}, enables: {}, thresholds: {}, tiers: {} };
    }
};
