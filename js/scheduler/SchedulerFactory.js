// js/scheduler/SchedulerFactory.js

class SchedulerFactory {
    static create(strategyType, allStaff, year, month, lastMonthData, rules) {
        // 深拷貝資料，避免汙染原始資料
        const staffCopy = JSON.parse(JSON.stringify(allStaff));
        const rulesCopy = JSON.parse(JSON.stringify(rules || {}));
        
        console.log(`🏭 Factory 請求建立策略: ${strategyType}`);

        switch (strategyType) {
            case 'V1': 
                // 舊版標準排班
                if(typeof SchedulerV1 !== 'undefined') {
                    return new SchedulerV1(staffCopy, year, month, lastMonthData, rulesCopy);
                }
                break;
                
            case 'V2': 
                // 新版：模糊公平 + 回溯 (預設推薦)
                if(typeof SchedulerV2 !== 'undefined') {
                    return new SchedulerV2(staffCopy, year, month, lastMonthData, rulesCopy);
                }
                break;
            
            default:
                console.warn(`未知或未載入的策略 ${strategyType}，嘗試使用 V2`);
                if(typeof SchedulerV2 !== 'undefined') {
                    return new SchedulerV2(staffCopy, year, month, lastMonthData, rulesCopy);
                }
        }
        
        throw new Error(`無法建立排班器: ${strategyType} (請確認 js 檔案是否已載入)`);
    }
}
