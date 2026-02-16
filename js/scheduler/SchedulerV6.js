// js/scheduler/SchedulerV6.js
// V6: 混合式貪婪+基因演算法 (Hybrid Greedy+GA)

class SchedulerV6 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        console.log('⚡ SchedulerV6 初始化 (混合式貪婪+GA)');
        
        // 快取
        this.whitelistCache = {};
        this.assignments = {};
        this.dailyCount = {};
        
        // GA參數 (快速模式)
        this.gaPopulationSize = 25;
        this.gaGenerations = 60;
        this.gaCrossoverRate = 0.90;
        this.gaMutationRate = 0.02;
        
        this.initializeAssignments();
        this.initializeDailyCount();
    }
    
    initializeAssignments() {
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            this.assignments[uid] = { preferences: staff.preferences || {} };
        }
    }
    
    initializeDailyCount() {
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.dailyCount[day] = {};
            for (let shift of this.shifts) {
                this.dailyCount[day][shift.code] = 0;
            }
        }
    }
    
    /**
     * 主執行函式
     */
    run() {
        console.log('⚡ SchedulerV6 排班開始 (混合式)');
        const startTime = performance.now();
        
        try {
            // === 步驟1: 貪婪法快速建構初始解 ===
            console.log('\n🚀 步驟1: 貪婪法建構初始解 (1-2秒)');
            const greedySolution = this.greedyConstruction();
            const greedyFitness = this.evaluateSolutionFitness(greedySolution);
            console.log(`  ✅ 貪婪解適應度: ${greedyFitness.toFixed(1)}`);
            
            // === 步驟2: GA精煉優化 ===
            console.log('\n🧬 步驟2: GA精煉優化 (8-10秒)');
            const optimizedSolution = this.geneticOptimization(greedySolution);
            const optimizedFitness = this.evaluateSolutionFitness(optimizedSolution);
            console.log(`  ✅ 優化後適應度: ${optimizedFitness.toFixed(1)}`);
            
            // === 步驟3: 局部搜尋微調 ===
            console.log('\n🔍 步驟3: 局部搜尋微調 (1-2秒)');
            const finalSolution = this.localSearch(optimizedSolution);
            const finalFitness = this.evaluateSolutionFitness(finalSolution);
            console.log(`  ✅ 最終適應度: ${finalFitness.toFixed(1)}`);
            
            const endTime = performance.now();
            const executionTime = ((endTime - startTime) / 1000).toFixed(2);
            
            const improvement = ((finalFitness - greedyFitness) / Math.abs(greedyFitness) * 100).toFixed(1);
            console.log(`\n✅ SchedulerV6 完成: ${executionTime}秒`);
            console.log(`  改善幅度: ${improvement}%`);
            
            return this.convertToDateFormat(finalSolution);
            
        } catch (error) {
            console.error('❌ SchedulerV6 排班失敗:', error);
            throw error;
        }
    }
    
    /**
     * 步驟1: 貪婪法快速建構（類似V3階段1-2）
     */
    greedyConstruction() {
        console.log('  貪婪填班...');
        const solution = {};
        
        // 初始化
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            solution[uid] = {};
        }
        
        // 步驟0: 套用預班
        this.applyPreSchedule(solution);
        
        // 步驟1-2: 逐日填班+調整
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.fillDay(solution, day);
            this.adjustDay(solution, day);
        }
        
        console.log('  ✅ 貪婪解構建完成');
        return solution;
    }
    
    /**
     * 套用預班
     */
    applyPreSchedule(solution) {
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const params = staff.schedulingParams || {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                const preReq = params[key];
                if (preReq && preReq !== 'OFF') {
                    solution[uid][key] = preReq;
                }
            }
        }
    }
    
    /**
     * 填班（某天）
     */
    fillDay(solution, day) {
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const key = `current_${day}`;
            
            // 已有預班，跳過
            if (solution[uid][key]) continue;
            
            // 計算白名單
            const whitelist = this.calculateWhitelist(staff, day, solution);
            
            // 選擇班別
            const shift = this.selectShiftGreedy(whitelist, staff);
            solution[uid][key] = shift;
        }
    }
    
    /**
     * 調整某天（處理超額）
     */
    adjustDay(solution, day) {
        const dateStr = this.getDateKey(day);
        const dayOfWeek = this.getDayOfWeek(day);
        
        // 計算每個班別的需求和實際
        for (let shift of this.shifts) {
            let need = 0;
            if (this.specificNeeds[dateStr] && this.specificNeeds[dateStr][shift.code] !== undefined) {
                need = this.specificNeeds[dateStr][shift.code];
            } else {
                const key = `${shift.code}_${dayOfWeek}`;
                need = this.dailyNeeds[key] || 0;
            }
            
            let actual = 0;
            for (let staff of this.allStaff) {
                const uid = staff.uid || staff.id;
                if (solution[uid][`current_${day}`] === shift.code) {
                    actual++;
                }
            }
            
            // 超額處理
            if (actual > need) {
                const excess = actual - need;
                this.reduceShift(solution, day, shift.code, excess);
            }
        }
    }
    
    /**
     * 減少某班別的人數
     */
    reduceShift(solution, day, shiftCode, count) {
        const candidates = [];
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            if (solution[uid][`current_${day}`] === shiftCode) {
                // 計算總 OFF 數
                let offCount = 0;
                for (let d = 1; d <= this.daysInMonth; d++) {
                    const s = solution[uid][`current_${d}`];
                    if (!s || s === 'OFF' || s === 'REQ_OFF') {
                        offCount++;
                    }
                }
                
                candidates.push({ uid, offCount });
            }
        }
        
        // 按 OFF 數排序（少的優先改OFF）
        candidates.sort((a, b) => a.offCount - b.offCount);
        
        // 改為OFF
        for (let i = 0; i < Math.min(count, candidates.length); i++) {
            solution[candidates[i].uid][`current_${day}`] = 'OFF';
        }
    }
    
    /**
     * 計算白名單
     */
    calculateWhitelist(staff, day, solution) {
        const uid = staff.uid || staff.id;
        
        if (typeof WhitelistCalculator !== 'undefined') {
            return WhitelistCalculator.calculate(
                staff,
                solution,
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
        
        // 簡化版
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
     * 步驟2: GA精煉優化（短時間高效率）
     */
    geneticOptimization(initialSolution) {
        console.log('  GA精煉中...');
        
        // 初始化族群
        const population = [];
        
        // 種子: 貪婪解
        population.push(JSON.parse(JSON.stringify(initialSolution)));
        
        // 其他: 貪婪解的變異
        for (let i = 1; i < this.gaPopulationSize; i++) {
            const mutated = this.mutateIndividual(
                JSON.parse(JSON.stringify(initialSolution)),
                0.05 + Math.random() * 0.1
            );
            population.push(mutated);
        }
        
        // 演化
        let bestSolution = null;
        let bestFitness = -Infinity;
        const initialFitness = this.evaluateSolutionFitness(initialSolution);
        
        for (let gen = 1; gen <= this.gaGenerations; gen++) {
            // 評估適應度
            for (let individual of population) {
                individual.fitness = this.evaluateSolutionFitness(individual);
                
                if (individual.fitness > bestFitness) {
                    bestFitness = individual.fitness;
                    bestSolution = JSON.parse(JSON.stringify(individual));
                }
            }
            
            // 產生新族群
            const newPopulation = [];
            
            // 菁英
            const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
            newPopulation.push(JSON.parse(JSON.stringify(sorted[0])));
            newPopulation.push(JSON.parse(JSON.stringify(sorted[1])));
            
            // 交配+突變
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
                    offspring = this.mutateIndividual(offspring, this.gaMutationRate);
                }
                
                newPopulation.push(offspring);
            }
            
            population.splice(0, population.length, ...newPopulation);
            
            // 進度
            if (gen % 15 === 0 || gen === 1 || gen === this.gaGenerations) {
                console.log(`    世代 ${gen}/${this.gaGenerations}: 適應度 = ${bestFitness.toFixed(1)}`);
            }
        }
        
        const improvement = ((bestFitness - initialFitness) / Math.abs(initialFitness) * 100).toFixed(1);
        console.log(`  ✅ GA優化完成: 適應度提升 ${improvement}%`);
        
        return bestSolution;
    }
    
    /**
     * 步驟3: 局部搜尋（變域搜尋 VNS）
     */
    localSearch(solution) {
        console.log('  局部搜尋微調...');
        
        let current = JSON.parse(JSON.stringify(solution));
        let currentFitness = this.evaluateSolutionFitness(current);
        
        let improved = true;
        let iterations = 0;
        const maxIterations = 50;
        
        while (improved && iterations < maxIterations) {
            improved = false;
            
            // 鄰域1: 交換同一天兩人的班別
            const neighbor1 = this.swapShifts(current);
            const fitness1 = this.evaluateSolutionFitness(neighbor1);
            
            if (fitness1 > currentFitness) {
                current = neighbor1;
                currentFitness = fitness1;
                improved = true;
                iterations++;
                continue;
            }
            
            // 鄰域2: 移動某人某天的班別
            const neighbor2 = this.moveShift(current);
            const fitness2 = this.evaluateSolutionFitness(neighbor2);
            
            if (fitness2 > currentFitness) {
                current = neighbor2;
                currentFitness = fitness2;
                improved = true;
                iterations++;
                continue;
            }
            
            iterations++;
        }
        
        console.log(`  ✅ 局部搜尋完成: 迭代 ${iterations} 次`);
        return current;
    }
    
    /**
     * 鄰域操作1: 交換同一天兩人的班別
     */
    swapShifts(solution) {
        const neighbor = JSON.parse(JSON.stringify(solution));
        
        // 隨機選擇一天
        const day = Math.floor(Math.random() * this.daysInMonth) + 1;
        const key = `current_${day}`;
        
        // 隨機選擇兩人
        const staff1 = this.allStaff[Math.floor(Math.random() * this.allStaff.length)];
        const staff2 = this.allStaff[Math.floor(Math.random() * this.allStaff.length)];
        
        if (staff1 === staff2) return neighbor;
        
        const uid1 = staff1.uid || staff1.id;
        const uid2 = staff2.uid || staff2.id;
        
        // 交換
        const temp = neighbor[uid1][key];
        neighbor[uid1][key] = neighbor[uid2][key];
        neighbor[uid2][key] = temp;
        
        return neighbor;
    }
    
    /**
     * 鄰域操作2: 移動某人某天的班別
     */
    moveShift(solution) {
        const neighbor = JSON.parse(JSON.stringify(solution));
        
        // 隨機選擇一人
        const staff = this.allStaff[Math.floor(Math.random() * this.allStaff.length)];
        const uid = staff.uid || staff.id;
        
        // 隨機選擇一天
        const day = Math.floor(Math.random() * this.daysInMonth) + 1;
        const key = `current_${day}`;
        
        // 計算白名單
        const whitelist = this.calculateWhitelist(staff, day, neighbor);
        
        // 隨機選擇新班別
        const newShift = whitelist[Math.floor(Math.random() * whitelist.length)];
        neighbor[uid][key] = newShift;
        
        return neighbor;
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
    mutateIndividual(individual, rate) {
        const mutated = JSON.parse(JSON.stringify(individual));
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                if (Math.random() < rate) {
                    const key = `current_${day}`;
                    
                    // 跳過預班
                    const params = staff.schedulingParams || {};
                    const preReq = params[key];
                    if (preReq && preReq !== 'OFF') continue;
                    
                    // 隨機選擇
                    const whitelist = this.calculateWhitelist(staff, day, mutated);
                    const newShift = whitelist[Math.floor(Math.random() * whitelist.length)] || 'OFF';
                    mutated[uid][key] = newShift;
                }
            }
        }
        
        return mutated;
    }
    
    /**
     * 評估解的適應度
     */
    evaluateSolutionFitness(solution) {
        const hardViolations = this.calculateHardViolations(solution);
        const softViolations = this.calculateSoftViolations(solution);
        const staffing = this.calculateStaffing(solution);
        const preference = this.calculatePreference(solution);
        
        let fitness = 10000;
        fitness -= hardViolations * 1000;
        fitness -= softViolations * 50;
        fitness += staffing * 25;
        fitness += preference * 5;
        
        return fitness;
    }
    
    /**
     * 計算硬限制違規
     */
    calculateHardViolations(solution) {
        let violations = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = solution[uid]?.[`current_${day}`];
                const prevShift = solution[uid]?.[`current_${day - 1}`];
                
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
    calculateSoftViolations(solution) {
        let violations = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const prefs = staff.preferences || {};
            
            if (prefs.bundleShift) {
                let bundleCount = 0;
                let workDays = 0;
                
                for (let day = 1; day <= this.daysInMonth; day++) {
                    const shift = solution[uid]?.[`current_${day}`];
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
    calculateStaffing(solution) {
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
                    if (solution[uid]?.[`current_${day}`] === shift.code) {
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
    calculatePreference(solution) {
        let totalScore = 0;
        let maxScore = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const prefs = staff.preferences || {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = solution[uid]?.[`current_${day}`];
                
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
    convertToDateFormat(solution) {
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
                const shift = solution[uid]?.[`current_${day}`];
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

console.log('✅ SchedulerV6 已載入 (混合式貪婪+GA)');
