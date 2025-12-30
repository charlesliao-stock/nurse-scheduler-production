/**
 * 批次排班執行器
 * 用途：一次執行多種演算法，供使用者選擇
 */
class ScheduleBatchRunner {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.allStaff = allStaff;
        this.year = year;
        this.month = month;
        this.lastMonthData = lastMonthData;
        this.rules = rules;
    }

    runAll() {
        const strategies = [
            // 目前只實作了 V3，先列出 V3，未來實作 V1/V2 後可在此加入
            { code: 'V3', name: '班別優先瀑布流 (推薦)', classType: 'SHIFT_PRIORITY' }
        ];

        const results = [];

        strategies.forEach(strategy => {
            console.time(`Run ${strategy.code}`);
            
            try {
                const scheduler = SchedulerFactory.create(
                    strategy.classType, 
                    this.allStaff, 
                    this.year, 
                    this.month, 
                    this.lastMonthData,
                    this.rules
                );

                const schedule = scheduler.run();
                const metrics = this.analyzeQuality(schedule);

                results.push({
                    info: strategy,
                    schedule: schedule,
                    metrics: metrics
                });
            } catch (e) {
                console.error(`策略 ${strategy.code} 執行失敗:`, e);
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
        // 簡易統計缺口
        Object.values(schedule).forEach(day => {
            // 假設需求 N:2, E:2
            // 實際應從 rules.dailyNeeds 讀取
            if (day.N.length < 2) gapCount += (2 - day.N.length);
            if (day.E.length < 2) gapCount += (2 - day.E.length);
        });

        return {
            gapCount: gapCount,
            fairnessScore: 90 // 暫時假資料
        };
    }
}
