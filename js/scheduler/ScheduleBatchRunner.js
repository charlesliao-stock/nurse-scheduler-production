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
            { code: 'V3', name: '方案 A：班別優先 (推薦)', classType: 'V3' },
            { code: 'V1', name: '方案 B：全域均衡 (公平)', classType: 'V1' },
            { code: 'V2', name: '方案 C：逐日推進 (保守)', classType: 'V2' },
            { code: 'V4', name: '方案 D：假日優先', classType: 'V4' }
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
                console.error(e);
                results.push({ info: strategy, error: e.message, schedule: {}, metrics: { gapCount: 999 } });
            }
            console.timeEnd(`Run ${strategy.code}`);
        });
        return results;
    }

    analyzeQuality(schedule) {
        let gapCount = 0;
        let totalOff = 0;
        let staffCount = 0;

        // 計算缺口
        const days = Object.values(schedule);
        days.forEach(day => {
            // 這裡簡單假設缺口，實際應使用 dailyNeeds
            if (day.N.length < 2) gapCount += (2 - day.N.length);
            if (day.E.length < 2) gapCount += (2 - day.E.length);
        });

        return { gapCount: gapCount };
    }
}
