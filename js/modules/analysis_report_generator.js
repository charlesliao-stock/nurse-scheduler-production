// AI 分析報告生成模組
// 負責根據統計資料生成分析報告和改進建議

const analysisReportGenerator = {
    
    // --- 1. 生成分析報告 ---
    /**
     * 根據統計資料生成完整的分析報告
     * @param {Object} statistics - 統計資料
     * @returns {Object} 分析報告
     */
    generateReport: function(statistics) {
        if (!statistics) return null;
        
        const insights = [];
        const recommendations = [];
        
        // 分析缺班率
        this.analyzeVacancyRate(statistics, insights, recommendations);
        
        // 分析修正率
        this.analyzeAdjustmentRate(statistics, insights, recommendations);
        
        // 分析班表評分變化
        this.analyzeScoreChange(statistics, insights, recommendations);
        
        // 分析換班原因
        this.analyzeExchangeReasons(statistics, insights, recommendations);
        
        // 組合報告
        const report = {
            period: statistics.period,
            generatedAt: new Date().toISOString(),
            summary: this.generateSummary(statistics),
            insights: insights,
            recommendations: recommendations,
            statistics: statistics
        };
        
        return report;
    },
    
    // --- 2. 生成報告摘要 ---
    generateSummary: function(statistics) {
        const summary = {
            schedulingAttempts: statistics.schedulingAttempts,
            schedulingTime: statistics.schedulingTime,
            originalScore: statistics.originalScore,
            currentScore: statistics.currentScore,
            scoreImprovement: statistics.scoreImprovement,
            overallVacancyRate: statistics.vacancyStats.overall,
            adjustmentRate: statistics.adjustmentStats.adjustmentRate,
            totalExchanges: statistics.exchangeStats.totalExchanges
        };
        
        return summary;
    },
    
    // --- 3. 缺班率分析 ---
    analyzeVacancyRate: function(statistics, insights, recommendations) {
        const vacancyRate = statistics.vacancyStats.overall;
        const byShift = statistics.vacancyStats.byShift;
        
        if (vacancyRate > 10) {
            insights.push({
                category: 'vacancy_analysis',
                severity: 'critical',
                message: `整體缺班率達 ${vacancyRate}%，超過警戒線（10%），需要立即改善`,
                details: {
                    rate: vacancyRate,
                    threshold: 10
                }
            });
            
            recommendations.push(
                `🔴 缺班率過高：建議檢查排班邏輯，特別是人力配置是否足夠`,
                `🔴 建議增加排班人力或調整班別需求`
            );
        } else if (vacancyRate > 5) {
            insights.push({
                category: 'vacancy_analysis',
                severity: 'warning',
                message: `整體缺班率為 ${vacancyRate}%，需要持續監控`,
                details: {
                    rate: vacancyRate,
                    threshold: 5
                }
            });
            
            recommendations.push(
                `⚠️ 缺班率偏高：建議優化排班邏輯`
            );
        } else {
            insights.push({
                category: 'vacancy_analysis',
                severity: 'info',
                message: `整體缺班率為 ${vacancyRate}%，保持良好狀態`,
                details: {
                    rate: vacancyRate
                }
            });
        }
        
        // 分析各班別缺班率
        Object.keys(byShift).forEach(shiftCode => {
            const shiftData = byShift[shiftCode];
            if (shiftData.rate > 10) {
                insights.push({
                    category: 'shift_vacancy_analysis',
                    severity: 'warning',
                    message: `${shiftCode}班缺班率達 ${shiftData.rate}%，建議檢查該班別排班邏輯`,
                    details: {
                        shift: shiftCode,
                        rate: shiftData.rate,
                        vacancies: shiftData.vacancies,
                        required: shiftData.required
                    }
                });
                
                recommendations.push(
                    `⚠️ ${shiftCode}班缺班率過高：建議增加該班別人力或優化排班`
                );
            }
        });
    },
    
    // --- 4. 修正率分析 ---
    analyzeAdjustmentRate: function(statistics, insights, recommendations) {
        const adjustmentRate = statistics.adjustmentStats.adjustmentRate;
        const byReason = statistics.adjustmentStats.byReason;
        
        if (adjustmentRate > 15) {
            insights.push({
                category: 'adjustment_analysis',
                severity: 'critical',
                message: `修正率達 ${adjustmentRate}%，超過警戒線（15%），排班邏輯需要優化`,
                details: {
                    rate: adjustmentRate,
                    threshold: 15,
                    totalAdjustments: statistics.adjustmentStats.totalAdjustments
                }
            });
            
            recommendations.push(
                `🔴 調整班次過多：建議檢查排班規則，特別是「接班」和「單休」規則`,
                `🔴 建議優化排班算法以減少後期調整`
            );
        } else if (adjustmentRate > 10) {
            insights.push({
                category: 'adjustment_analysis',
                severity: 'warning',
                message: `修正率為 ${adjustmentRate}%，需要持續監控`,
                details: {
                    rate: adjustmentRate,
                    totalAdjustments: statistics.adjustmentStats.totalAdjustments
                }
            });
            
            recommendations.push(
                `⚠️ 調整班次偏多：建議優化排班邏輯`
            );
        } else {
            insights.push({
                category: 'adjustment_analysis',
                severity: 'info',
                message: `修正率為 ${adjustmentRate}%，保持良好狀態`,
                details: {
                    rate: adjustmentRate,
                    totalAdjustments: statistics.adjustmentStats.totalAdjustments
                }
            });
        }
        
        // 分析調整原因分布
        if (byReason.vacancy.count > 0) {
            const vacancyPercentage = (byReason.vacancy.count / statistics.adjustmentStats.totalAdjustments * 100).toFixed(1);
            insights.push({
                category: 'adjustment_reason_analysis',
                severity: 'info',
                message: `因缺額調整的班次占 ${vacancyPercentage}%`,
                details: {
                    reason: 'vacancy',
                    count: byReason.vacancy.count,
                    percentage: vacancyPercentage
                }
            });
        }
        
        if (byReason.scheduling.count > 0) {
            const schedulingPercentage = (byReason.scheduling.count / statistics.adjustmentStats.totalAdjustments * 100).toFixed(1);
            insights.push({
                category: 'adjustment_reason_analysis',
                severity: 'info',
                message: `因排班不順調整的班次占 ${schedulingPercentage}%`,
                details: {
                    reason: 'scheduling',
                    count: byReason.scheduling.count,
                    percentage: schedulingPercentage
                }
            });
        }
    },
    
    // --- 5. 班表評分變化分析 ---
    analyzeScoreChange: function(statistics, insights, recommendations) {
        const improvement = statistics.scoreImprovement;
        const currentScore = statistics.currentScore;
        
        if (improvement > 0) {
            insights.push({
                category: 'score_analysis',
                severity: 'info',
                message: `班表評分從 ${statistics.originalScore} 分提升至 ${currentScore} 分，提升 ${improvement} 分`,
                details: {
                    originalScore: statistics.originalScore,
                    currentScore: currentScore,
                    improvement: improvement
                }
            });
            
            recommendations.push(
                `✅ 班表品質有所改善，調整效果良好`
            );
        } else if (improvement < 0) {
            insights.push({
                category: 'score_analysis',
                severity: 'warning',
                message: `班表評分從 ${statistics.originalScore} 分下降至 ${currentScore} 分，下降 ${Math.abs(improvement)} 分`,
                details: {
                    originalScore: statistics.originalScore,
                    currentScore: currentScore,
                    improvement: improvement
                }
            });
            
            recommendations.push(
                `⚠️ 班表品質有所下降：建議檢查調整是否合理`
            );
        } else {
            insights.push({
                category: 'score_analysis',
                severity: 'info',
                message: `班表評分保持在 ${currentScore} 分`,
                details: {
                    originalScore: statistics.originalScore,
                    currentScore: currentScore,
                    improvement: 0
                }
            });
        }
    },
    
    // --- 6. 換班原因分析 ---
    analyzeExchangeReasons: function(statistics, insights, recommendations) {
        const totalExchanges = statistics.exchangeStats.totalExchanges;
        const byReason = statistics.exchangeStats.byReason;
        
        if (totalExchanges === 0) {
            insights.push({
                category: 'exchange_analysis',
                severity: 'info',
                message: '本月無換班申請',
                details: {
                    totalExchanges: 0
                }
            });
            return;
        }
        
        insights.push({
            category: 'exchange_analysis',
            severity: 'info',
            message: `本月共有 ${totalExchanges} 次換班申請`,
            details: {
                totalExchanges: totalExchanges
            }
        });
        
        // 找出主要換班原因
        let maxReason = null;
        let maxCount = 0;
        
        Object.keys(byReason).forEach(reason => {
            if (byReason[reason].count > maxCount) {
                maxCount = byReason[reason].count;
                maxReason = reason;
            }
        });
        
        if (maxReason && maxCount > 0) {
            const reasonMap = {
                'unit_staffing_adjustment': '單位人力調整',
                'public_holiday': '公假',
                'sick_leave': '病假',
                'bereavement': '喪假',
                'support': '支援',
                'personal_factors': '個人因素',
                'other': '其他'
            };
            
            const percentage = (maxCount / totalExchanges * 100).toFixed(1);
            insights.push({
                category: 'exchange_reason_analysis',
                severity: 'info',
                message: `主要換班原因是「${reasonMap[maxReason]}」，占 ${percentage}%`,
                details: {
                    reason: maxReason,
                    count: maxCount,
                    percentage: percentage
                }
            });
            
            if (maxReason === 'unit_staffing_adjustment' && percentage > 30) {
                recommendations.push(
                    `⚠️ 單位人力調整類換班占比過高（${percentage}%）：建議優化人力調度`
                );
            }
            
            if (maxReason === 'personal_factors' && percentage > 30) {
                recommendations.push(
                    `⚠️ 個人因素類換班占比過高（${percentage}%）：建議加強員工溝通`
                );
            }
        }
    },
    
    // --- 7. 保存報告到資料庫 ---
    saveReportToDatabase: async function(scheduleId, report) {
        try {
            await db.collection('schedules').doc(scheduleId).update({
                analysisReport: report,
                reportGeneratedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('✅ 分析報告已保存');
            return true;
        } catch (e) {
            console.error('❌ 保存報告失敗:', e);
            throw e;
        }
    },
    
    // --- 8. 從資料庫讀取報告 ---
    getReportFromDatabase: async function(scheduleId) {
        try {
            const doc = await db.collection('schedules').doc(scheduleId).get();
            if (doc.exists && doc.data().analysisReport) {
                return doc.data().analysisReport;
            }
            return null;
        } catch (e) {
            console.error('❌ 讀取報告失敗:', e);
            throw e;
        }
    }
};
