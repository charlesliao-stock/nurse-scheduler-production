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
        
        if (strategyType === 'V5') {
            return new SchedulerV5(allStaff, year, month, lastMonthData, rules);
        }
        
        if (strategyType === 'V6') {
            return new SchedulerV6(allStaff, year, month, lastMonthData, rules);
        }
        
        if (strategyType === 'V2') {
            console.warn('⚠️ V2 排班引擎已停用，自動切換為 V3');
            return new SchedulerV3(allStaff, year, month, lastMonthData, rules);
        }
        
        throw new Error(`不支援的排班策略: ${strategyType}`);
    },
    
    getSupportedStrategies: function() {
        return ['V3', 'V4', 'V5', 'V6'];
    },
    
    getDefaultStrategy: function() {
        return 'V3';
    },
    
    getStrategyDescription: function(strategyType) {
        const descriptions = {
            'V3': '🔄 四階段回溯法 - 實用穩定，速度快 (3-5秒)',
            'V4': '🧬 改良式基因演算法 - 品質最佳，多目標優化 (12-15秒)',
            'V5': '🔢 兩階段IP+GA - 公平性最優，休假均衡 (10-12秒)',
            'V6': '⚡ 混合式貪婪+GA - 速度與品質平衡 (8-10秒)'
        };
        return descriptions[strategyType] || '未知策略';
    },
    
    getStrategyCharacteristics: function(strategyType) {
        const characteristics = {
            'V3': {
                speed: 5,
                quality: 3,
                fairness: 3,
                preference: 4,
                stability: 5,
                executionTime: '3-5秒',
                bestFor: '日常使用，快速排班',
                algorithm: '回溯搜尋 + 貪婪法'
            },
            'V4': {
                speed: 2,
                quality: 5,
                fairness: 4,
                preference: 5,
                stability: 4,
                executionTime: '12-15秒',
                bestFor: '高質量需求，多目標優化',
                algorithm: '改良式基因演算法'
            },
            'V5': {
                speed: 3,
                quality: 4,
                fairness: 5,
                preference: 4,
                stability: 4,
                executionTime: '10-12秒',
                bestFor: '公平性優先，休假均衡',
                algorithm: '整數規劃 + 基因演算法'
            },
            'V6': {
                speed: 4,
                quality: 4,
                fairness: 3,
                preference: 4,
                stability: 4,
                executionTime: '8-10秒',
                bestFor: '速度與品質的平衡',
                algorithm: '貪婪法 + GA + 局部搜尋'
            }
        };
        return characteristics[strategyType] || null;
    },
    
    compareStrategies: function() {
        const strategies = this.getSupportedStrategies();
        const comparison = [];
        
        for (let strategy of strategies) {
            comparison.push({
                version: strategy,
                description: this.getStrategyDescription(strategy),
                characteristics: this.getStrategyCharacteristics(strategy)
            });
        }
        
        return comparison;
    },
    
    recommendStrategy: function(requirements) {
        // requirements = { prioritySpeed, priorityQuality, priorityFairness, staffCount }
        
        if (!requirements) {
            return 'V3'; // 預設
        }
        
        const { prioritySpeed, priorityQuality, priorityFairness, staffCount } = requirements;
        
        // 策略選擇邏輯
        if (prioritySpeed && staffCount > 30) {
            return 'V6'; // 大規模且要求速度
        }
        
        if (priorityQuality) {
            return 'V4'; // 追求最高品質
        }
        
        if (priorityFairness) {
            return 'V5'; // 追求公平性
        }
        
        if (staffCount <= 15) {
            return 'V3'; // 小規模，V3已足夠
        }
        
        if (staffCount <= 25) {
            return 'V6'; // 中規模，平衡選擇
        }
        
        return 'V4'; // 大規模，品質優先
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
    },
    
    /**
     * 批次執行多個策略（用於比較）
     */
    runMultiple: async function(strategies, allStaff, year, month, lastMonthData, rules) {
        console.log(`📦 SchedulerFactory: 批次執行 ${strategies.length} 個策略`);
        
        const results = [];
        
        for (let strategy of strategies) {
            try {
                console.log(`\n${'='.repeat(60)}`);
                console.log(`正在執行: ${strategy}`);
                console.log('='.repeat(60));
                
                const startTime = performance.now();
                const scheduler = this.create(strategy, allStaff, year, month, lastMonthData, rules);
                const schedule = scheduler.run();
                const endTime = performance.now();
                
                const executionTime = ((endTime - startTime) / 1000).toFixed(2);
                
                // 計算指標
                const metrics = this.calculateMetrics(schedule, scheduler, allStaff, rules);
                
                results.push({
                    strategy: strategy,
                    success: true,
                    schedule: schedule,
                    executionTime: executionTime,
                    metrics: metrics,
                    description: this.getStrategyDescription(strategy)
                });
                
                console.log(`✅ ${strategy} 完成: ${executionTime}秒`);
                
            } catch (error) {
                console.error(`❌ ${strategy} 失敗:`, error.message);
                results.push({
                    strategy: strategy,
                    success: false,
                    error: error.message,
                    executionTime: 0,
                    metrics: null
                });
            }
        }
        
        return results;
    },
    
    /**
     * 計算排班結果的指標
     */
    calculateMetrics: function(schedule, scheduler, allStaff, rules) {
        // 轉換為個體格式（便於計算）
        const individual = this.scheduleToIndividual(schedule, allStaff, scheduler.daysInMonth);
        
        // 計算各項指標
        const hardViolations = this.countHardViolations(individual, allStaff, scheduler);
        const softViolations = this.countSoftViolations(individual, allStaff, scheduler);
        const staffingRate = this.calculateStaffingRate(individual, allStaff, scheduler, rules);
        const preferenceScore = this.calculatePreferenceScore(individual, allStaff, scheduler);
        const fairnessScore = this.calculateFairnessScore(individual, allStaff, scheduler);
        
        return {
            hardViolations: hardViolations,
            softViolations: softViolations,
            staffingRate: staffingRate.toFixed(1) + '%',
            preferenceScore: preferenceScore.toFixed(1) + '%',
            fairnessScore: fairnessScore.toFixed(1) + '%',
            overallScore: this.calculateOverallScore({
                hardViolations,
                softViolations,
                staffingRate,
                preferenceScore,
                fairnessScore
            }).toFixed(1)
        };
    },
    
    /**
     * 將日期格式轉換為個體格式
     */
    scheduleToIndividual: function(schedule, allStaff, daysInMonth) {
        const individual = {};
        
        for (let staff of allStaff) {
            const uid = staff.uid || staff.id;
            individual[uid] = {};
        }
        
        for (let dateStr in schedule) {
            const day = parseInt(dateStr.split('-')[2]);
            const daySchedule = schedule[dateStr];
            
            for (let shiftCode in daySchedule) {
                const staffList = daySchedule[shiftCode];
                for (let uid of staffList) {
                    individual[uid][`current_${day}`] = shiftCode;
                }
            }
        }
        
        return individual;
    },
    
    countHardViolations: function(individual, allStaff, scheduler) {
        let violations = 0;
        
        for (let staff of allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= scheduler.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                const prevShift = individual[uid]?.[`current_${day - 1}`];
                
                if (scheduler.isNightShift(prevShift) && shift && shift !== 'OFF' && !scheduler.isNightShift(shift)) {
                    violations++;
                }
            }
        }
        
        return violations;
    },
    
    countSoftViolations: function(individual, allStaff, scheduler) {
        let violations = 0;
        
        for (let staff of allStaff) {
            const uid = staff.uid || staff.id;
            const prefs = staff.preferences || {};
            
            if (prefs.bundleShift) {
                let bundleCount = 0;
                let workDays = 0;
                
                for (let day = 1; day <= scheduler.daysInMonth; day++) {
                    const shift = individual[uid]?.[`current_${day}`];
                    if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                        workDays++;
                        if (shift === prefs.bundleShift) {
                            bundleCount++;
                        }
                    }
                }
                
                const expectedBundle = workDays * 0.7;
                if (bundleCount < expectedBundle) {
                    violations += (expectedBundle - bundleCount) * 0.3;
                }
            }
        }
        
        return violations;
    },
    
    calculateStaffingRate: function(individual, allStaff, scheduler, rules) {
        let totalNeeded = 0;
        let totalMet = 0;
        
        for (let day = 1; day <= scheduler.daysInMonth; day++) {
            const dateStr = scheduler.getDateKey(day);
            const dayOfWeek = scheduler.getDayOfWeek(day);
            
            for (let shift of scheduler.shifts) {
                let need = 0;
                if (scheduler.specificNeeds[dateStr] && scheduler.specificNeeds[dateStr][shift.code] !== undefined) {
                    need = scheduler.specificNeeds[dateStr][shift.code];
                } else {
                    const key = `${shift.code}_${dayOfWeek}`;
                    need = scheduler.dailyNeeds[key] || 0;
                }
                
                if (need === 0) continue;
                
                let actual = 0;
                for (let staff of allStaff) {
                    const uid = staff.uid || staff.id;
                    if (individual[uid]?.[`current_${day}`] === shift.code) {
                        actual++;
                    }
                }
                
                totalNeeded += need;
                totalMet += Math.min(actual, need);
            }
        }
        
        return totalNeeded > 0 ? (totalMet / totalNeeded) * 100 : 100;
    },
    
    calculatePreferenceScore: function(individual, allStaff, scheduler) {
        let totalScore = 0;
        let maxScore = 0;
        
        for (let staff of allStaff) {
            const uid = staff.uid || staff.id;
            const prefs = staff.preferences || {};
            
            for (let day = 1; day <= scheduler.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') continue;
                
                maxScore += 10;
                
                if (shift === prefs.bundleShift || shift === prefs.favShift) {
                    totalScore += 10;
                } else if (shift === prefs.favShift2) {
                    totalScore += 7;
                } else if (shift === prefs.favShift3) {
                    totalScore += 5;
                } else {
                    totalScore += 2;
                }
            }
        }
        
        return maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    },
    
    calculateFairnessScore: function(individual, allStaff, scheduler) {
        const workDays = [];
        
        for (let staff of allStaff) {
            const uid = staff.uid || staff.id;
            let work = 0;
            
            for (let day = 1; day <= scheduler.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    work++;
                }
            }
            
            workDays.push(work);
        }
        
        const mean = workDays.reduce((a, b) => a + b, 0) / workDays.length;
        const variance = workDays.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / workDays.length;
        const stdDev = Math.sqrt(variance);
        
        return Math.max(0, 100 - stdDev * 10);
    },
    
    calculateOverallScore: function(metrics) {
        let score = 100;
        score -= metrics.hardViolations * 20;
        score -= metrics.softViolations * 2;
        score += (metrics.staffingRate - 80) * 0.5;
        score += (metrics.preferenceScore - 50) * 0.3;
        score += (metrics.fairnessScore - 50) * 0.2;
        
        return Math.max(0, Math.min(100, score));
    }
};

console.log('✅ SchedulerFactory 已載入 (支援 V3, V4, V5, V6)');
