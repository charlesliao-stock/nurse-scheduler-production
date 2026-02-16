// js/scheduler/SchedulerFactory.js

const SchedulerFactory = {
    
    create: function(strategyType, allStaff, year, month, lastMonthData, rules) {
        console.log(`🏭 SchedulerFactory: 建立排班引擎 (${strategyType})`);
        
        if (strategyType === 'V3') {
            return new SchedulerV3(allStaff, year, month, lastMonthData, rules);
        }
        
        if (strategyType === 'V4') {
            return new SchedulerV4(allStaff, year, month, lastMonthData, rules);
        }
        
        if (strategyType === 'V2') {
            console.warn('⚠️ V2 排班引擎已停用，自動切換為 V3');
            return new SchedulerV3(allStaff, year, month, lastMonthData, rules);
        }
        
        throw new Error(`不支援的排班策略: ${strategyType}`);
    },
    
    getSupportedStrategies: function() {
        return ['V3', 'V4'];
    },
    
    getDefaultStrategy: function() {
        return 'V3';
    },
    
    getStrategyDescription: function(strategyType) {
        const descriptions = {
            'V3': '🔄 四階段回溯法 - 實用穩定，速度快 (3-5秒)',
            'V4': '🧬 改良式基因演算法 - 品質最佳，多目標優化 (12-15秒)'
        };
        return descriptions[strategyType] || '未知策略';
    },
    
    validateRules: function(rules) {
        const required = ['shifts', 'dailyNeeds'];
        const missing = [];
        
        for (let field of required) {
            if (!rules[field]) {
                missing.push(field);
            }
        }
        
        if (missing.length > 0) {
            console.warn(`⚠️ 缺少必要的排班規則: ${missing.join(', ')}`);
        }
        
        return missing.length === 0;
    },
    
    validateStaff: function(staffList) {
        if (!Array.isArray(staffList) || staffList.length === 0) {
            console.error('❌ 人員清單無效');
            return false;
        }
        
        for (let staff of staffList) {
            if (!staff.uid && !staff.id) {
                console.error('❌ 人員資料缺少 uid/id');
                return false;
            }
            if (!staff.name && !staff.displayName) {
                console.error('❌ 人員資料缺少 name/displayName');
                return false;
            }
        }
        
        return true;
    },
    
    createWithValidation: function(strategyType, allStaff, year, month, lastMonthData, rules) {
        console.log('🔍 SchedulerFactory: 驗證資料...');
        
        if (!this.validateStaff(allStaff)) {
            throw new Error('人員資料驗證失敗');
        }
        
        if (!this.validateRules(rules)) {
            console.warn('⚠️ 排班規則不完整，可能影響排班結果');
        }
        
        if (!year || !month) {
            throw new Error('年月資料不完整');
        }
        
        console.log('✅ 資料驗證通過');
        console.log(`🎯 使用策略: ${this.getStrategyDescription(strategyType)}`);
        
        return this.create(strategyType, allStaff, year, month, lastMonthData, rules);
    }
};

console.log('✅ SchedulerFactory 已載入 (支援 V3, V4)');