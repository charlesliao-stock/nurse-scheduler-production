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
            // [修正] 將 V1 (Step 1 測試版) 改為方案 A
            { code: 'V1', name: '方案 A：Step 1 測試 (包班優先)', classType: 'V1' }, 
            { code: 'V3', name: '方案 B：標準排班 (V3)', classType: 'V3' },
            { code: 'V2', name: '方案 C：逐日推進 (V2)', classType: 'V2' },
            { code: 'V4', name: '方案 D：假日優先 (V4)', classType: 'V4' }
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
            if (day.E.length < 2) gapCount += (2 - day.E.length);
        });
        return { gapCount: gapCount };
    }
}
