// js/scheduler/SchedulerFactory.js

class SchedulerFactory {
    static create(strategyType, allStaff, year, month, lastMonthData, rules) {
        // 深拷貝資料，避免汙染原始資料
        const staffCopy = JSON.parse(JSON.stringify(allStaff));
        const rulesCopy = JSON.parse(JSON.stringify(rules || {}));
        
        console.log(`🏭 Factory 請求建立策略: ${strategyType}`);

        // [清理] 移除 V1 邏輯，統一使用 V2
        if(typeof SchedulerV2 !== 'undefined') {
            return new SchedulerV2(staffCopy, year, month, lastMonthData, rulesCopy);
        }
        
        throw new Error(`無法建立排班器: SchedulerV2 未載入`);
    }
}

