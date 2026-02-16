// js/scheduler/SchedulerV4.js
// 改良式基因演算法 (Enhanced Genetic Algorithm)

class SchedulerV4 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        console.log('🧬 SchedulerV4 初始化 (改良式基因演算法)');
        
        // GA參數 (針對護理排班優化)
        this.populationSize = this.calculatePopulationSize();
        this.generations = 150;
        this.crossoverRate = 0.80;
        this.initialMutationRate = 0.05;
        this.mutationRate = this.initialMutationRate;
        this.eliteCount = 3;
        this.tournamentSize = 5;
        
        this.population = [];
        this.bestSolution = null;
        this.bestFitness = -Infinity;
        this.fitnessHistory = [];
        
        this.assignments = {};
        this.dailyCount = {};
        this.initializeStructures();
    }
    
    initializeStructures() {
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            this.assignments[uid] = { preferences: staff.preferences || {} };
        }
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.dailyCount[day] = {};
            for (let shift of this.shifts) {
                this.dailyCount[day][shift.code] = 0;
            }
        }
    }
    
    calculatePopulationSize() {
        const staffCount = this.allStaff.length;
        if (staffCount <= 20) return 50;
        if (staffCount <= 30) return 75;
        return 100;
    }
    
    run() {
        console.log('🧬 SchedulerV4 排班開始 (基因演算法)');
        console.log(`  族群大小: ${this.populationSize}, 世代數: ${this.generations}`);
        
        try {
            // 步驟1: 初始化族群
            this.initializePopulation();
            
            // 步驟2: 演化循環
            for (let gen = 1; gen <= this.generations; gen++) {
                // 2.1 評估適應度
                this.evaluateFitness();
                
                // 2.2 選擇菁英
                const elites = this.selectElites();
                
                // 2.3 產生新族群
                const newPopulation = [...elites];
                
                while (newPopulation.length < this.populationSize) {
                    // 錦標賽選擇
                    const parent1 = this.tournamentSelection();
                    const parent2 = this.tournamentSelection();
                    
                    // 交配
                    let offspring;
                    if (Math.random() < this.crossoverRate) {
                        offspring = this.crossover(parent1, parent2);
                    } else {
                        offspring = this.deepCopy(parent1);
                    }
                    
                    // 突變
                    if (Math.random() < this.mutationRate) {
                        offspring = this.mutate(offspring);
                    }
                    
                    // 修復違規
                    offspring = this.repair(offspring);
                    
                    newPopulation.push(offspring);
                }
                
                this.population = newPopulation;
                
                // 2.4 適應性調整突變率
                this.mutationRate = this.initialMutationRate * (1 - gen / this.generations);
                
                // 2.5 記錄歷史
                this.fitnessHistory.push(this.bestFitness);
                
                // 2.6 輸出進度
                if (gen % 30 === 0 || gen === 1) {
                    console.log(`  世代 ${gen}/${this.generations}: 最佳適應度 = ${this.bestFitness.toFixed(2)}, 突變率 = ${(this.mutationRate * 100).toFixed(1)}%`);
                }
            }
            
            console.log(`✅ SchedulerV4 完成: 最終適應度 = ${this.bestFitness.toFixed(2)}`);
            
            // 步驟3: 返回最佳解
            return this.convertToDateFormat(this.bestSolution);
            
        } catch (error) {
            console.error('❌ SchedulerV4 排班失敗:', error);
            throw error;
        }
    }
    
    /**
     * 初始化族群
     */
    initializePopulation() {
        console.log('  初始化族群...');
        
        for (let i = 0; i < this.populationSize; i++) {
            let individual;
            
            if (i === 0) {
                // 第1個個體: 使用貪婪法產生 (高品質種子)
                individual = this.generateGreedyIndividual();
            } else if (i < this.populationSize * 0.3) {
                // 前30%: 基於貪婪解的變異
                const base = this.generateGreedyIndividual();
                individual = this.mutate(base, 0.1);
            } else {
                // 其餘: 隨機產生 (多樣性)
                individual = this.generateRandomIndividual();
            }
            
            this.population.push(individual);
        }
        
        console.log(`  ✅ 族群初始化完成: ${this.populationSize} 個個體`);
    }
    
    /**
     * 貪婪法產生初始解
     */
    generateGreedyIndividual() {
        const individual = {};
        const tempDailyCount = this.createEmptyDailyCount();
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            individual[uid] = {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                // 檢查預班
                const params = staff.schedulingParams || {};
                const preReq = params[key];
                if (preReq && preReq !== 'OFF') {
                    individual[uid][key] = preReq;
                    if (preReq !== 'REQ_OFF') {
                        tempDailyCount[day][preReq]++;
                    }
                    continue;
                }
                
                // 計算白名單
                const whitelist = this.calculateWhitelist(staff, day, individual);
                
                // 貪婪選擇 (優先包班/志願)
                const shift = this.selectShiftGreedy(whitelist, staff);
                individual[uid][key] = shift;
                
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    tempDailyCount[day][shift]++;
                }
            }
        }
        
        return individual;
    }
    
    /**
     * 隨機產生個體
     */
    generateRandomIndividual() {
        const individual = {};
        const tempDailyCount = this.createEmptyDailyCount();
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            individual[uid] = {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                // 檢查預班
                const params = staff.schedulingParams || {};
                const preReq = params[key];
                if (preReq && preReq !== 'OFF') {
                    individual[uid][key] = preReq;
                    if (preReq !== 'REQ_OFF') {
                        tempDailyCount[day][preReq]++;
                    }
                    continue;
                }
                
                // 計算白名單
                const whitelist = this.calculateWhitelist(staff, day, individual);
                
                // 隨機選擇
                const shift = whitelist[Math.floor(Math.random() * whitelist.length)] || 'OFF';
                individual[uid][key] = shift;
                
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    tempDailyCount[day][shift]++;
                }
            }
        }
        
        return individual;
    }
    
    /**
     * 計算白名單
     */
    calculateWhitelist(staff, day, individual) {
        const uid = staff.uid || staff.id;
        const tempAssignments = { ...this.assignments };
        tempAssignments[uid] = individual[uid] || {};
        
        return WhitelistCalculator.calculate(
            staff,
            tempAssignments,
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
    
    /**
     * 貪婪選擇班別
     */
    selectShiftGreedy(whitelist, staff) {
        const prefs = staff.preferences || {};
        
        // 包班優先
        if (prefs.bundleShift && whitelist.includes(prefs.bundleShift)) {
            return prefs.bundleShift;
        }
        
        // 志願1
        if (prefs.favShift && whitelist.includes(prefs.favShift)) {
            return prefs.favShift;
        }
        
        // 志願2
        if (prefs.favShift2 && whitelist.includes(prefs.favShift2)) {
            return prefs.favShift2;
        }
        
        // 志願3
        if (prefs.favShift3 && whitelist.includes(prefs.favShift3)) {
            return prefs.favShift3;
        }
        
        // 最後選 OFF
        return 'OFF';
    }
    
    /**
     * 評估適應度
     */
    evaluateFitness() {
        for (let individual of this.population) {
            if (individual.fitness !== undefined) continue;
            
            // 計算各項指標
            const metrics = this.calculateMetrics(individual);
            
            // 適應度函數 (多目標加權)
            individual.fitness = 0;
            individual.fitness -= metrics.hardViolations * 1000;  // 硬限制權重最高
            individual.fitness -= metrics.softViolations * 100;   // 軟限制次之
            individual.fitness += metrics.fairness * 10;          // 公平性
            individual.fitness += metrics.preference * 5;         // 偏好
            individual.fitness += metrics.staffingRate * 20;      // 人力達成率
            
            individual.metrics = metrics;
            
            // 更新最佳解
            if (individual.fitness > this.bestFitness) {
                this.bestFitness = individual.fitness;
                this.bestSolution = this.deepCopy(individual);
            }
        }
    }
    
    /**
     * 計算各項指標
     */
    calculateMetrics(individual) {
        const metrics = {
            hardViolations: 0,
            softViolations: 0,
            fairness: 0,
            preference: 0,
            staffingRate: 0
        };
        
        // 計算硬限制違規
        metrics.hardViolations = this.countHardViolations(individual);
        
        // 計算軟限制違規
        metrics.softViolations = this.countSoftViolations(individual);
        
        // 計算公平性 (休假天數的標準差)
        metrics.fairness = this.calculateFairnessScore(individual);
        
        // 計算偏好滿足度
        metrics.preference = this.calculatePreferenceScore(individual);
        
        // 計算人力達成率
        metrics.staffingRate = this.calculateStaffingRate(individual);
        
        return metrics;
    }
    
    /**
     * 計算硬限制違規數
     */
    countHardViolations(individual) {
        let violations = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            // 檢查連續上班天數
            for (let day = 1; day <= this.daysInMonth; day++) {
                const consecutiveWork = this.countConsecutiveWorkInIndividual(individual, uid, day);
                const maxConsecutive = this.rules?.staff?.max_consecutive_work || 6;
                if (consecutiveWork > maxConsecutive) {
                    violations++;
                }
            }
            
            // 檢查連續夜班
            for (let day = 1; day <= this.daysInMonth; day++) {
                const consecutiveNight = this.countConsecutiveNightInIndividual(individual, uid, day);
                const maxNight = this.rules?.staff?.max_consecutive_night || 3;
                if (consecutiveNight > maxNight) {
                    violations++;
                }
            }
        }
        
        return violations;
    }
    
    /**
     * 計算軟限制違規數
     */
    countSoftViolations(individual) {
        let violations = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            // 檢查單休
            for (let day = 2; day < this.daysInMonth; day++) {
                const prev = individual[uid]?.[`current_${day-1}`];
                const curr = individual[uid]?.[`current_${day}`];
                const next = individual[uid]?.[`current_${day+1}`];
                
                const prevIsWork = prev && prev !== 'OFF' && prev !== 'REQ_OFF';
                const currIsOff = !curr || curr === 'OFF' || curr === 'REQ_OFF';
                const nextIsWork = next && next !== 'OFF' && next !== 'REQ_OFF';
                
                if (prevIsWork && currIsOff && nextIsWork) {
                    violations++;
                }
            }
        }
        
        return violations;
    }
    
    /**
     * 計算公平性分數
     */
    calculateFairnessScore(individual) {
        const offCounts = [];
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            let offDays = 0;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                    offDays++;
                }
            }
            
            offCounts.push(offDays);
        }
        
        // 計算標準差
        const mean = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
        const variance = offCounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / offCounts.length;
        const stdDev = Math.sqrt(variance);
        
        // 標準差越小，公平性越高
        return Math.max(0, 100 - stdDev * 10);
    }
    
    /**
     * 計算偏好滿足度
     */
    calculatePreferenceScore(individual) {
        let totalMatches = 0;
        let totalDays = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const prefs = staff.preferences || {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    totalDays++;
                    
                    if (shift === prefs.bundleShift || shift === prefs.favShift) {
                        totalMatches += 1.0;
                    } else if (shift === prefs.favShift2) {
                        totalMatches += 0.7;
                    } else if (shift === prefs.favShift3) {
                        totalMatches += 0.5;
                    }
                }
            }
        }
        
        return totalDays > 0 ? (totalMatches / totalDays) * 100 : 0;
    }
    
    /**
     * 計算人力達成率
     */
    calculateStaffingRate(individual) {
        let totalNeeded = 0;
        let totalMet = 0;
        
        const tempDailyCount = this.calculateDailyCountFromIndividual(individual);
        
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
                
                if (need > 0) {
                    totalNeeded += need;
                    const actual = tempDailyCount[day][shift.code] || 0;
                    totalMet += Math.min(actual, need);
                }
            }
        }
        
        return totalNeeded > 0 ? (totalMet / totalNeeded) * 100 : 100;
    }
    
    /**
     * 選擇菁英
     */
    selectElites() {
        const sorted = [...this.population].sort((a, b) => b.fitness - a.fitness);
        return sorted.slice(0, this.eliteCount).map(ind => this.deepCopy(ind));
    }
    
    /**
     * 錦標賽選擇
     */
    tournamentSelection() {
        const candidates = [];
        for (let i = 0; i < this.tournamentSize; i++) {
            const idx = Math.floor(Math.random() * this.population.length);
            candidates.push(this.population[idx]);
        }
        
        candidates.sort((a, b) => b.fitness - a.fitness);
        return candidates[0];
    }
    
    /**
     * 交配 (兩點交叉)
     */
    crossover(parent1, parent2) {
        const offspring = {};
        
        // 隨機選擇兩個交叉點
        const point1 = Math.floor(Math.random() * this.daysInMonth) + 1;
        const point2 = Math.floor(Math.random() * this.daysInMonth) + 1;
        const [start, end] = [Math.min(point1, point2), Math.max(point1, point2)];
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            offspring[uid] = {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                if (day < start || day > end) {
                    offspring[uid][key] = parent1[uid][key];
                } else {
                    offspring[uid][key] = parent2[uid][key];
                }
            }
        }
        
        return offspring;
    }
    
    /**
     * 突變
     */
    mutate(individual, customRate = null) {
        const rate = customRate !== null ? customRate : this.mutationRate;
        const mutated = this.deepCopy(individual);
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                if (Math.random() < rate) {
                    const key = `current_${day}`;
                    
                    // 跳過預班
                    const params = staff.schedulingParams || {};
                    const preReq = params[key];
                    if (preReq && preReq !== 'OFF') continue;
                    
                    // 計算白名單
                    const whitelist = this.calculateWhitelist(staff, day, mutated);
                    
                    // 隨機選擇新班別
                    const newShift = whitelist[Math.floor(Math.random() * whitelist.length)] || 'OFF';
                    mutated[uid][key] = newShift;
                }
            }
        }
        
        delete mutated.fitness;
        delete mutated.metrics;
        
        return mutated;
    }
    
    /**
     * 修復違規
     */
    repair(individual) {
        // 簡單修復: 不需要複雜的修復邏輯，交由適應度函數懲罰
        return individual;
    }
    
    /**
     * 輔助函數
     */
    createEmptyDailyCount() {
        const count = {};
        for (let day = 1; day <= this.daysInMonth; day++) {
            count[day] = {};
            for (let shift of this.shifts) {
                count[day][shift.code] = 0;
            }
        }
        return count;
    }
    
    calculateDailyCountFromIndividual(individual) {
        const count = this.createEmptyDailyCount();
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    count[day][shift] = (count[day][shift] || 0) + 1;
                }
            }
        }
        
        return count;
    }
    
    countConsecutiveWorkInIndividual(individual, uid, upToDay) {
        let count = 0;
        for (let d = upToDay; d >= 1; d--) {
            const shift = individual[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                count++;
            } else {
                break;
            }
        }
        return count;
    }
    
    countConsecutiveNightInIndividual(individual, uid, upToDay) {
        let count = 0;
        for (let d = upToDay; d >= 1; d--) {
            const shift = individual[uid]?.[`current_${d}`];
            if (shift && this.isNightShift(shift)) {
                count++;
            } else {
                break;
            }
        }
        return count;
    }
    
    deepCopy(obj) {
        return JSON.parse(JSON.stringify(obj));
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

console.log('✅ SchedulerV4 已載入 (改良式基因演算法)');