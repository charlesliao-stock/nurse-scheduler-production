// 系統統計管理模組
// 負責計算和管理排班系統的各項統計指標

const systemStatisticsCalculator = {
    currentStatistics: null,
    
    // --- 1. 缺班率計算 ---
    calculateVacancyRate: function(scheduleData, staffList, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const dailyNeeds = scheduleData.dailyNeeds || {};
        const specificNeeds = scheduleData.specificNeeds || {};
        
        const stats = {
            overall: 0,
            totalVacancies: 0,
            totalRequired: 0,
            byShift: {}
        };
        
        // 取得所有不重複的班別代碼
        const shiftCodes = new Set();
        
        // 1. 從 dailyNeeds 取得
        Object.keys(dailyNeeds).forEach(key => {
            const shiftCode = key.split('_')[0];
            if (shiftCode) shiftCodes.add(shiftCode);
        });

        // 2. 從 specificNeeds 取得
        Object.values(specificNeeds).forEach(sn => {
            if (sn.shiftCode) shiftCodes.add(sn.shiftCode);
        });

        // 3. 從 assignments 取得 (Fallback)
        const assignments = scheduleData.assignments || {};
        Object.values(assignments).forEach(userAssign => {
            Object.values(userAssign).forEach(shift => {
                if (shift && shift !== 'OFF' && shift !== 'None') shiftCodes.add(shift);
            });
        });
        
        shiftCodes.forEach(shiftCode => {
            let totalRequiredForShift = 0;
            let totalVacanciesForShift = 0;

            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const dateObj = new Date(year, month - 1, d);
                const jsDay = dateObj.getDay();
                const dayOfWeek = (jsDay === 0) ? 6 : jsDay - 1; 
                
                // 優先檢查特定日期需求 (specificNeeds)
                let dailyRequired = 0;
                const hasSpecific = Object.values(specificNeeds).some(sn => sn.date === dateStr && sn.shiftCode === shiftCode);
                
                if (hasSpecific) {
                    Object.values(specificNeeds).forEach(sn => {
                        if (sn.date === dateStr && sn.shiftCode === shiftCode) {
                            dailyRequired += (parseInt(sn.count) || 0);
                        }
                    });
                } else {
                    // 使用常規週需求
                    const needKey = `${shiftCode}_${dayOfWeek}`;
                    dailyRequired = parseInt(dailyNeeds[needKey]) || 0;
                }
                
                totalRequiredForShift += dailyRequired;

                // 實際數
                let dailyActual = 0;
                const assignKey = `current_${d}`;
                Object.keys(assignments).forEach(uid => {
                    if (assignments[uid]?.[assignKey] === shiftCode) {
                        dailyActual++;
                    }
                });

                // 如果當天實際人數小於需求人數，則計入缺班
                if (dailyActual < dailyRequired) {
                    totalVacanciesForShift += (dailyRequired - dailyActual);
                }
            }
            
            const vacancies = totalVacanciesForShift;
            const vacancyRate = totalRequiredForShift > 0 ? (vacancies / totalRequiredForShift * 100) : 0;
            
            stats.byShift[shiftCode] = {
                rate: Math.round(vacancyRate * 10) / 10,
                vacancies: vacancies,
                required: totalRequiredForShift
            };
            
            stats.totalVacancies += vacancies;
            stats.totalRequired += totalRequiredForShift;
        });
        
        stats.overall = stats.totalRequired > 0 
            ? Math.round((stats.totalVacancies / stats.totalRequired * 100) * 10) / 10 
            : 0;
        
        return stats;
    },
    
    // --- 2. 修正率計算 (🔥 重構：基於 V0 與當前班表的差異) ---
    calculateAdjustmentRate: function(originalSchedule, currentSchedule, year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const v0 = currentSchedule.v0Assignments || {}; // AI 原始排班 (V0)
        const current = currentSchedule.assignments || {}; // 當前排班
        const adjustments = currentSchedule.adjustments || []; // 調整紀錄
        
        let totalRequired = 0;
        // 1. 計算總需求天數 (作為分母)
        const dailyNeeds = currentSchedule.dailyNeeds || {};
        Object.values(dailyNeeds).forEach(val => {
            totalRequired += (parseInt(val) || 0);
        });
        totalRequired = Math.round(totalRequired * (daysInMonth / 7));
        
        if (totalRequired === 0) {
            // 如果沒有需求設定，嘗試從實際排班總數估算
            Object.values(current).forEach(userAssign => {
                Object.values(userAssign).forEach(shift => {
                    if (shift && shift !== 'OFF' && !shift.startsWith('REQ_')) totalRequired++;
                });
            });
        }

        // 2. 計算實際差異天數 (Diff Count)
        let diffCount = 0;
        if (Object.keys(v0).length > 0) {
            Object.keys(current).forEach(uid => {
                const v0User = v0[uid] || {};
                const currentUser = current[uid] || {};
                
                for (let d = 1; d <= daysInMonth; d++) {
                    const key = `current_${d}`;
                    if (v0User[key] !== currentUser[key]) {
                        // 排除預班 (REQ_OFF) 的變動，只計算 AI 排出的班別變動
                        if (v0User[key] !== 'REQ_OFF' && currentUser[key] !== 'REQ_OFF') {
                            diffCount++;
                        }
                    }
                }
            });
        } else {
            // 如果沒有 V0，則退而求其次使用手動調整計數
            diffCount = currentSchedule.adjustmentCount || 0;
        }

        const stats = {
            totalAdjustments: diffCount,
            adjustmentRate: 0,
            byReason: {
                'unit_staffing_adjustment': { count: 0, percentage: 0 },
                'personal_factors': { count: 0, percentage: 0 },
                'rule_violation_fix': { count: 0, percentage: 0 },
                'fairness_adjustment': { count: 0, percentage: 0 },
                'other': { count: 0, percentage: 0 }
            }
        };

        // 3. 統計調整原因
        adjustments.forEach(adj => {
            const reason = adj.reason || 'other';
            if (stats.byReason[reason]) {
                stats.byReason[reason].count++;
            } else {
                stats.byReason['other'].count++;
            }
        });

        // 4. 計算百分比
        const totalRecorded = adjustments.length;
        if (totalRecorded > 0) {
            Object.keys(stats.byReason).forEach(reason => {
                stats.byReason[reason].percentage = 
                    Math.round((stats.byReason[reason].count / totalRecorded * 100) * 10) / 10;
            });
        }
        
        stats.adjustmentRate = totalRequired > 0 
            ? Math.round((diffCount / totalRequired * 100) * 10) / 10 
            : 0;
        
        return stats;
    },
    
    // --- 3. 換班統計 ---
    calculateExchangeStats: function(exchanges) {
        const stats = {
            totalExchanges: 0,
            byReason: {
                'unit_staffing_adjustment': { count: 0, percentage: 0 },
                'public_holiday': { count: 0, percentage: 0 },
                'sick_leave': { count: 0, percentage: 0 },
                'bereavement': { count: 0, percentage: 0 },
                'support': { count: 0, percentage: 0 },
                'personal_factors': { count: 0, percentage: 0 },
                'other': { count: 0, percentage: 0 }
            }
        };
        
        const approvedExchanges = exchanges.filter(ex => ex.status === 'approved');
        stats.totalExchanges = approvedExchanges.length;
        
        approvedExchanges.forEach(ex => {
            const reason = ex.reasonCategory || 'other';
            if (stats.byReason[reason]) {
                stats.byReason[reason].count++;
            }
        });
        
        if (stats.totalExchanges > 0) {
            Object.keys(stats.byReason).forEach(reason => {
                stats.byReason[reason].percentage = 
                    Math.round((stats.byReason[reason].count / stats.totalExchanges * 100) * 10) / 10;
            });
        }
        
        return stats;
    },
    
    // --- 4. 統計資料聚合 ---
    aggregateStatistics: async function(scheduleData, staffList, exchanges, year, month) {
        try {
            const vacancyStats = this.calculateVacancyRate(scheduleData, staffList, year, month);
            const adjustmentStats = this.calculateAdjustmentRate(scheduleData, scheduleData, year, month);
            const exchangeStats = this.calculateExchangeStats(exchanges);
            
            const originalScore = scheduleData.originalScore || 0;
            const currentScore = scheduleData.currentScore || 0;
            
            const statistics = {
                period: `${year}-${String(month).padStart(2, '0')}`,
                generatedAt: new Date().toISOString(),
                schedulingAttempts: scheduleData.schedulingAttempts || 1,
                schedulingTime: scheduleData.schedulingTime || 0,
                originalScore: originalScore,
                currentScore: currentScore,
                scoreImprovement: currentScore - originalScore,
                ruleCompliance: scheduleData.ruleCompliance || 0,
                vacancyStats: vacancyStats,
                adjustmentStats: adjustmentStats,
                exchangeStats: exchangeStats
            };
            
            this.currentStatistics = statistics;
            return statistics;
            
        } catch (e) {
            console.error('統計聚合失敗:', e);
            throw e;
        }
    },
    
    // --- 6. 格式化統計資料用於顯示 ---
    formatStatisticsForDisplay: function(statistics) {
        if (!statistics) return null;
        
        return {
            period: statistics.period,
            schedulingAttempts: statistics.schedulingAttempts,
            schedulingTime: `${(statistics.schedulingTime || 0).toFixed(2)}秒`,
            originalScore: `${statistics.originalScore}分`,
            currentScore: `${statistics.currentScore}分`,
            scoreImprovement: statistics.scoreImprovement >= 0 
                ? `+${statistics.scoreImprovement}分` 
                : `${statistics.scoreImprovement}分`,
            overallVacancyRate: `${statistics.vacancyStats.overall}%`,
            vacancyByShift: statistics.vacancyStats.byShift,
            totalAdjustments: statistics.adjustmentStats.totalAdjustments,
            adjustmentRate: `${statistics.adjustmentStats.adjustmentRate}%`,
            adjustmentByReason: statistics.adjustmentStats.byReason,
            totalExchanges: statistics.exchangeStats.totalExchanges,
            exchangeByReason: statistics.exchangeStats.byReason
        };
    }
};
