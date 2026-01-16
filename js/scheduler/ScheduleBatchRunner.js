// js/scheduler/ScheduleBatchRunner.js

class ScheduleBatchRunner {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.allStaff = allStaff;
        this.year = year;
        this.month = month;
        this.lastMonthData = lastMonthData;
        this.rules = rules;
    }

    runAll() {
        // [清理] 移除不存在的 V1，專注於 V2 方案
        const strategies = [
            { code: 'V2', name: 'AI 智慧排班 (V2)', classType: 'V2' }
        ];

        const results = [];

        strategies.forEach(strategy => {
            console.time(`Run ${strategy.code}`);
            try {
                // 工廠模式創建
                const scheduler = SchedulerFactory.create(
                    strategy.classType, 
                    this.allStaff, 
                    this.year, 
                    this.month, 
                    this.lastMonthData,
                    this.rules
                );

                const schedule = scheduler.run();
                
                results.push({
                    info: strategy,
                    schedule: schedule,
                    metrics: this.analyzeQuality(schedule)
                });

            } catch (e) {
                console.error(`Strategy ${strategy.code} failed:`, e);
                results.push({
                    info: strategy,
                    error: e.message,
                    schedule: {},
                    metrics: { gapCount: 999 }
                });
            }
            console.timeEnd(`Run ${strategy.code}`);
        });

        return results;
    }

    analyzeQuality(schedule) {
        let gapCount = 0;
        // 統計人力缺口
        Object.keys(schedule).forEach(dateStr => {
            const dayData = schedule[dateStr];
            // 這裡應根據 rules.dailyNeeds 動態計算，此處為簡化範例
            // 實際邏輯已在 SchedulerV2 內部處理並列印統計
        });
        return { gapCount: gapCount };
    }
}
