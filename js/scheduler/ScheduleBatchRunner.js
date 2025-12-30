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
        const strategies = [
            { code: 'V3', name: '方案 A：班別優先 (推薦)', classType: 'V3' }, // 瀑布流
            { code: 'V1', name: '方案 B：全域均衡', classType: 'V1' },        // 公平型
            { code: 'V2', name: '方案 C：逐日推進', classType: 'V2' },        // 保守型
            { code: 'V4', name: '方案 D：假日優先', classType: 'V4' }         // 困難日型
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
        // 簡易統計缺口 (可改進為讀取 dailyNeeds)
        Object.values(schedule).forEach(day => {
            // 預設 N, E 至少 2 人，D 至少 5 人 (僅作參考，實際依 rules 為準)
            // 這裡簡單回傳缺口總數作為參考
            if (day.N.length < 2) gapCount += (2 - day.N.length);
            if (day.E.length < 2) gapCount += (2 - day.E.length);
        });

        return { gapCount: gapCount };
    }
}
