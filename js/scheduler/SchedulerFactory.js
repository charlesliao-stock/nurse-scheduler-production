/**
 * 排班策略工廠
 */
class SchedulerFactory {
    static create(strategyType, allStaff, year, month, lastMonthData, rules) {
        // 深拷貝 staffList，避免不同策略執行時汙染原始資料
        const staffCopy = JSON.parse(JSON.stringify(allStaff));
        
        // 深拷貝 rules
        const rulesCopy = JSON.parse(JSON.stringify(rules || {}));

        switch (strategyType) {
            case 'SHIFT_PRIORITY': // V3 (班別優先)
            case 'V3':
                return new SchedulerV3(staffCopy, year, month, lastMonthData, rulesCopy);
            
            // 未來可擴充 V1, V2, V4
            // case 'GLOBAL': return new SchedulerV1(...);
            
            default:
                console.warn(`未知策略 ${strategyType}，預設使用 V3`);
                return new SchedulerV3(staffCopy, year, month, lastMonthData, rulesCopy);
        }
    }
}
