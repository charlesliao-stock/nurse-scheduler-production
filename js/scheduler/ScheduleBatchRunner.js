// js/scheduler/ScheduleBatchRunner.js

class ScheduleBatchRunner {
    constructor(allStaff, year, month, lastMonthData, rules, shifts) {
        this.allStaff = allStaff;
        this.year = year;
        this.month = month;
        this.lastMonthData = lastMonthData;
        this.rules = rules;
        this.shifts = shifts || [];
    }

    runAll() {
        // [修正] 暫時只執行 V1，並將其設為方案 A
        const strategies = [
            { code: 'V1', name: '方案 A：標準排班 (V1)', classType: 'V1' },
            // { code: 'V2', name: '方案 B：權重計分 (V2)', classType: 'V2' },
            // { code: 'V3', name: '方案 C：隨機優化 (V3)', classType: 'V3' },
            // { code: 'V4', name: '方案 D：規則窮舉 (V4)', classType: 'V4' }
        ];

        const results = [];

        strategies.forEach(strategy => {
            console.time(`Run ${strategy.code}`);
            try {
                // 工廠模式創建，傳入 shifts
                const scheduler = SchedulerFactory.create(
                    strategy.classType, 
                    this.allStaff, 
                    this.year, 
                    this.month, 
                    this.lastMonthData,
                    this.rules,
                    this.shifts
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
        Object.values(schedule).forEach(day => {
            if (day.N.length < 2) gapCount += (2 - day.N.length);
            if (day.E.length < 3) gapCount += (3 - day.E.length);
            if (day.D.length < 4) gapCount += (4 - day.D.length);
        });
        return { gapCount: gapCount };
    }
}
