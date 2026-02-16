// js/scheduler/SchedulerV5.js
// V5: 兩階段整數規劃+基因演算法 (Two-Phase IP+GA)

class SchedulerV5 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        console.log('🔢 SchedulerV5 初始化 (兩階段IP+GA)');
        
        // 快取
        this.whitelistCache = {};
        
        // GA參數 (階段2使用)
        this.gaPopulationSize = 30;
        this.gaGenerations = 80;
        this.gaCrossoverRate = 0.85;
        this.gaMutationRate = 0.03;
    }
    
    /**
     * 主執行函式
     */
    run() {
        console.log('🔢 SchedulerV5 排班開始 (兩階段法)');
        const startTime = performance.now();
        
        try {
            // === 階段1: 整數規劃排休假 ===
            console.log('\n📊 階段1: 整數規劃排休假');
            const offSchedule = this.stage1_IntegerProgramming();
            
            // === 階段2: 基因演算法派班 ===
            console.log('\n🧬 階段2: 基因演算法派班');
            const finalSchedule = this.stage2_GeneticAlgorithm(offSchedule);
            
            const endTime = performance.now();
            const executionTime = ((endTime - startTime) / 1000).toFixed(2);
            console.log(`\n✅ SchedulerV5 完成: ${executionTime}秒`);
            
            return this.convertToDateFormat(finalSchedule);
            
        } catch (error) {
            console.error('❌ SchedulerV5 排班失敗:', error);
            throw error;
        }
    }
    
    /**
     * 階段1: 使用整數規劃排休假
     * 目標: 公平分配休假，確保法定休假天數
     */
    stage1_IntegerProgramming() {
        console.log('  建立IP模型...');
        
        // 使用貪婪近似解（簡化版IP求解）
        // 未來可整合 Google OR-Tools 或 SCIP
        const offSchedule = this.greedyOffScheduling();
        
        console.log('  ✅ 階段1完成: 休假已排定');
        return offSchedule;
    }
    
    /**
     * 貪婪法排休假（IP的近似解）
     */
    greedyOffScheduling() {
        const offSchedule = {};
        
        // 初始化
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            offSchedule[uid] = {};
        }
        
        // 計算每人需要的休假天數
        const minOffDays = this.rules?.staff?.min_off_days || 8;
        const targetOffDays = {};
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const params = staff.schedulingParams || {};
            
            // 計算已有的預排休假
            let preOffCount = 0;
            for (let day = 1; day <= this.daysInMonth; day++) {
                const preReq = params[`current_${day}`];
                if (preReq === 'OFF' || preReq === 'REQ_OFF') {
                    preOffCount++;
                    offSchedule[uid][`current_${day}`] = 'OFF';
                }
            }
            
            // 計算還需要多少休假
            targetOffDays[uid] = Math.max(0, minOffDays - preOffCount);
        }
        
        // 按需求排序（需要休假多的人優先）
        const staffByNeed = this.allStaff
            .map(staff => ({
                uid: staff.uid || staff.id,
                staff: staff,
                needed: targetOffDays[staff.uid || staff.id]
            }))
            .sort((a, b) => b.needed - a.needed);
        
        // 逐人分配休假
        for (let item of staffByNeed) {
            const uid = item.uid;
            const needed = item.needed;
            
            if (needed === 0) continue;
            
            // 找到最適合休假的日期
            const candidates = [];
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                // 已經有休假，跳過
                if (offSchedule[uid][key] === 'OFF') continue;
                
                // 計算該日期排休的優先度
                const priority = this.calculateOffPriority(offSchedule, uid, day);
                candidates.push({ day, priority });
            }
            
            // 按優先度排序
            candidates.sort((a, b) => b.priority - a.priority);
            
            // 選擇前 needed 個日期
            for (let i = 0; i < Math.min(needed, candidates.length); i++) {
                const day = candidates[i].day;
                offSchedule[uid][`current_${day}`] = 'OFF';
            }
        }
        
        return offSchedule;
    }
    
    /**
     * 計算某日排休的優先度
     */
    calculateOffPriority(offSchedule, uid, day) {
        let priority = 50; // 基準分
        
        // 優先1: 避免單休（前後有休假更好）
        const prevDay = day - 1;
        const nextDay = day + 1;
        
        if (prevDay >= 1 && offSchedule[uid][`current_${prevDay}`] === 'OFF') {
            priority += 20;
        }
        if (nextDay <= this.daysInMonth && offSchedule[uid][`current_${nextDay}`] === 'OFF') {
            priority += 20;
        }
        
        // 優先2: 週末優先
        const dayOfWeek = this.getDayOfWeek(day);
        if (dayOfWeek === 0 || dayOfWeek === 6) { // 日或六
            priority += 15;
        }
        
        // 優先3: 已經連續上班較多天的，優先休假
        const consecutiveWork = this.countConsecutiveWorkInSchedule(offSchedule, uid, day - 1);
        priority += consecutiveWork * 5;
        
        // 優先4: 隨機擾動（避免過於規律）
        priority += Math.random() * 10;
        
        return priority;
    }
    
    /**
     * 計算連續上班天數（在offSchedule中）
     */
    countConsecutiveWorkInSchedule(offSchedule, uid, upToDay) {
        let count = 0;
        for (let d = upToDay; d >= 1; d--) {
            const key = `current_${d}`;
            if (offSchedule[uid][key] === 'OFF') {
                break;
            }
            count++;
        }
        return count;
    }
    
    /**
     * 階段2: 基於休假排程，使用GA分配班別
     */
    stage2_GeneticAlgorithm(offSchedule) {
        console.log('  啟動GA引擎...');
        
        // 初始化GA族群
        const population = [];
        
        for (let i = 0; i < this.gaPopulationSize; i++) {
            let individual;
            
            if (i === 0) {
                // 第1個: 貪婪解
                individual = this.generateGreedyIndividual(offSchedule);
            } else if (i < this.gaPopulationSize * 0.3) {
                // 前30%: 基於貪婪解的變異
                const base = this.generateGreedyIndividual(offSchedule);
                individual = this.mutateIndividual(base, offSchedule, 0.1);
            } else {
                // 其餘: 隨機
                individual = this.generateRandomIndividual(offSchedule);
            }
            
            population.push(individual);
        }
        
        // GA演化
        let bestSolution = null;
        let bestFitness = -Infinity;
        
        for (let gen = 1; gen <= this.gaGenerations; gen++) {
            // 評估適應度
            for (let individual of population) {
                individual.fitness = this.evaluateFitness(individual);
                
                if (individual.fitness > bestFitness) {
                    bestFitness = individual.fitness;
                    bestSolution = JSON.parse(JSON.stringify(individual));
                }
            }
            
            // 選擇、交配、突變
            const newPopulation = [];
            
            // 菁英保留
            const eliteCount = 2;
            const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
            for (let i = 0; i < eliteCount; i++) {
                newPopulation.push(JSON.parse(JSON.stringify(sorted[i])));
            }
            
            // 產生新個體
            while (newPopulation.length < this.gaPopulationSize) {
                const parent1 = this.tournamentSelection(population);
                const parent2 = this.tournamentSelection(population);
                
                let offspring;
                if (Math.random() < this.gaCrossoverRate) {
                    offspring = this.crossover(parent1, parent2);
                } else {
                    offspring = JSON.parse(JSON.stringify(parent1));
                }
                
                if (Math.random() < this.gaMutationRate) {
                    offspring = this.mutateIndividual(offspring, offSchedule, this.gaMutationRate);
                }
                
                newPopulation.push(offspring);
            }
            
            population.splice(0, population.length, ...newPopulation);
            
            // 輸出進度
            if (gen % 20 === 0 || gen === 1 || gen === this.gaGenerations) {
                console.log(`    世代 ${gen}/${this.gaGenerations}: 適應度 = ${bestFitness.toFixed(1)}`);
            }
        }
        
        console.log('  ✅ 階段2完成: 班別已分配');
        return bestSolution;
    }
    
    /**
     * 產生貪婪個體（基於offSchedule）
     */
    generateGreedyIndividual(offSchedule) {
        const individual = {};
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            individual[uid] = {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                // 如果已經是休假，直接複製
                if (offSchedule[uid][key] === 'OFF') {
                    individual[uid][key] = 'OFF';
                    continue;
                }
                
                // 檢查預班
                const params = staff.schedulingParams || {};
                const preReq = params[key];
                if (preReq && preReq !== 'OFF') {
                    individual[uid][key] = preReq;
                    continue;
                }
                
                // 計算白名單
                const whitelist = this.calculateWhitelist(staff, day, individual);
                
                // 貪婪選擇
                const shift = this.selectShiftGreedy(whitelist, staff);
                individual[uid][key] = shift;
            }
        }
        
        return individual;
    }
    
    /**
     * 產生隨機個體
     */
    generateRandomIndividual(offSchedule) {
        const individual = {};
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            individual[uid] = {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                // 如果已經是休假，直接複製
                if (offSchedule[uid][key] === 'OFF') {
                    individual[uid][key] = 'OFF';
                    continue;
                }
                
                // 檢查預班
                const params = staff.schedulingParams || {};
                const preReq = params[key];
                if (preReq && preReq !== 'OFF') {
                    individual[uid][key] = preReq;
                    continue;
                }
                
                // 隨機選擇
                const whitelist = this.calculateWhitelist(staff, day, individual);
                const shift = whitelist[Math.floor(Math.random() * whitelist.length)] || 'OFF';
                individual[uid][key] = shift;
            }
        }
        
        return individual;
    }
    
    /**
     * 計算白名單
     */
    calculateWhitelist(staff, day, individual) {
        const uid = staff.uid || staff.id;
        
        // 使用 WhitelistCalculator
        if (typeof WhitelistCalculator !== 'undefined') {
            return WhitelistCalculator.calculate(
                staff,
                individual,
                day,
                this.year,
                this.month,
                this.rules,
                {},
                this.daysInMonth,
                this.shiftTimeMap,
                this.lastMonthData
            );
        }
        
        // 簡化版白名單
        const whitelist = ['OFF'];
        for (let shift of this.shifts) {
            whitelist.push(shift.code);
        }
        return whitelist;
    }
    
    /**
     * 貪婪選擇班別
     */
    selectShiftGreedy(whitelist, staff) {
        const prefs = staff.preferences || {};
        
        if (prefs.bundleShift && whitelist.includes(prefs.bundleShift)) {
            return prefs.bundleShift;
        }
        if (prefs.favShift && whitelist.includes(prefs.favShift)) {
            return prefs.favShift;
        }
        if (prefs.favShift2 && whitelist.includes(prefs.favShift2)) {
            return prefs.favShift2;
        }
        if (prefs.favShift3 && whitelist.includes(prefs.favShift3)) {
            return prefs.favShift3;
        }
        
        return 'OFF';
    }
    
    /**
     * 評估適應度
     */
    evaluateFitness(individual) {
        const hardViolations = this.calculateHardViolations(individual);
        const softViolations = this.calculateSoftViolations(individual);
        const staffing = this.calculateStaffing(individual);
        const preference = this.calculatePreference(individual);
        
        let fitness = 10000;
        fitness -= hardViolations * 1000;
        fitness -= softViolations * 50;
        fitness += staffing * 30;
        fitness += preference * 5;
        
        return fitness;
    }
    
    /**
     * 錦標賽選擇
     */
    tournamentSelection(population) {
        const tournamentSize = 3;
        const candidates = [];
        
        for (let i = 0; i < tournamentSize; i++) {
            const idx = Math.floor(Math.random() * population.length);
            candidates.push(population[idx]);
        }
        
        candidates.sort((a, b) => b.fitness - a.fitness);
        return candidates[0];
    }
    
    /**
     * 交配
     */
    crossover(parent1, parent2) {
        const offspring = {};
        const crossoverPoint = Math.floor(Math.random() * this.daysInMonth) + 1;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            offspring[uid] = {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                if (day < crossoverPoint) {
                    offspring[uid][key] = parent1[uid]?.[key];
                } else {
                    offspring[uid][key] = parent2[uid]?.[key];
                }
            }
        }
        
        return offspring;
    }
    
    /**
     * 突變
     */
    mutateIndividual(individual, offSchedule, rate) {
        const mutated = JSON.parse(JSON.stringify(individual));
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                if (Math.random() < rate) {
                    const key = `current_${day}`;
                    
                    // 跳過休假日
                    if (offSchedule[uid][key] === 'OFF') continue;
                    
                    // 跳過預班
                    const params = staff.schedulingParams || {};
                    const preReq = params[key];
                    if (preReq && preReq !== 'OFF') continue;
                    
                    // 隨機選擇新班別
                    const whitelist = this.calculateWhitelist(staff, day, mutated);
                    const newShift = whitelist[Math.floor(Math.random() * whitelist.length)] || 'OFF';
                    mutated[uid][key] = newShift;
                }
            }
        }
        
        return mutated;
    }
    
    /**
     * 計算硬限制違規
     */
    calculateHardViolations(individual) {
        let violations = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                const prevShift = individual[uid]?.[`current_${day - 1}`];
                
                // 大夜後不能接白班/小夜
                if (this.isNightShift(prevShift) && shift && shift !== 'OFF' && !this.isNightShift(shift)) {
                    violations++;
                }
            }
        }
        
        return violations;
    }
    
    /**
     * 計算軟限制違規
     */
    calculateSoftViolations(individual) {
        let violations = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const prefs = staff.preferences || {};
            
            // 包班未滿足
            if (prefs.bundleShift) {
                let bundleCount = 0;
                let workDays = 0;
                
                for (let day = 1; day <= this.daysInMonth; day++) {
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
    }
    
    /**
     * 計算人力達成率
     */
    calculateStaffing(individual) {
        let totalNeeded = 0;
        let totalMet = 0;
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            const dayOfWeek = this.getDayOfWeek(day);
            
            for (let shift of this.shifts) {
                let need = 0;
                if (this.specificNeeds[dateStr] && this.specificNeeds[dateStr][shift.code] !== undefined) {
                    need = this.specificNeeds[dateStr][shift.code];
                } else {
                    const key = `${shift.code}_${dayOfWeek}`;
                    need = this.dailyNeeds[key] || 0;
                }
                
                if (need === 0) continue;
                
                let actual = 0;
                for (let staff of this.allStaff) {
                    const uid = staff.uid || staff.id;
                    const assignedShift = individual[uid]?.[`current_${day}`];
                    if (assignedShift === shift.code) {
                        actual++;
                    }
                }
                
                totalNeeded += need;
                totalMet += Math.min(actual, need);
            }
        }
        
        return totalNeeded > 0 ? (totalMet / totalNeeded) * 100 : 100;
    }
    
    /**
     * 計算偏好滿足度
     */
    calculatePreference(individual) {
        let totalScore = 0;
        let maxScore = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const prefs = staff.preferences || {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
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
    }
    
    /**
     * 轉換為日期格式
     */
    convertToDateFormat(individual) {
        const result = {};
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            result[dateStr] = {};
            for (let shift of this.shifts) {
                result[dateStr][shift.code] = [];
            }
        }
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    const dateStr = this.getDateKey(day);
                    if (result[dateStr][shift]) {
                        result[dateStr][shift].push(uid);
                    }
                }
            }
        }
        
        return result;
    }
}

console.log('✅ SchedulerV5 已載入 (兩階段IP+GA)');
