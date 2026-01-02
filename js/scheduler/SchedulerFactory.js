// js/scheduler/SchedulerFactory.js
class SchedulerFactory {
    static create(strategyType, allStaff, year, month, lastMonthData, rules, shifts) {
        const staffCopy = JSON.parse(JSON.stringify(allStaff));
        const rulesCopy = JSON.parse(JSON.stringify(rules || {}));
        const shiftsCopy = JSON.parse(JSON.stringify(shifts || []));
        
        switch (strategyType) {
            case 'V1': return new SchedulerV1(staffCopy, year, month, lastMonthData, rulesCopy, shiftsCopy);
            case 'V2': return new SchedulerV2(staffCopy, year, month, lastMonthData, rulesCopy, shiftsCopy);
            case 'V3': return new SchedulerV3(staffCopy, year, month, lastMonthData, rulesCopy, shiftsCopy);
            case 'V4': return new SchedulerV4(staffCopy, year, month, lastMonthData, rulesCopy, shiftsCopy);
            default:
                console.warn(`未知策略 ${strategyType}，預設 V3`);
                return new SchedulerV3(staffCopy, year, month, lastMonthData, rulesCopy, shiftsCopy);
        }
    }
}
