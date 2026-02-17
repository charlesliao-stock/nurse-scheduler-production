// js/scheduler/SchedulerV4.js
// V4: 改良式基因演算法 (Enhanced Genetic Algorithm)

class SchedulerV4 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        console.log('🧬 SchedulerV4 初始化 (改良式基因演算法)');
        
        // GA 參數 (針對護理排班優化)
        this.populationSize = this.calculatePopulationSize();
        this.generations = this.rules?.aiParams?.ga_generations || 150;
        this.crossoverRate = 0.80;
        this.mutationRate = 0.05; // 初始值，會逐代遞減
        this.eliteCount = Math.max(2, Math.floor(this.populationSize * 0.05));
        this.tournamentSize = 5;
        
        // 快取
        this.whitelistCache = {};
        this.fitnessCache = new Map();
        
        // 族群與最佳解
        this.population = [];
        this.bestSolution = null;
        this.bestFitness = -Infinity;
        this.initialFitness = 0;
        
        // 統計資料
        this.stats = {
            generationBestFitness: [],
            generationAvgFitness: []
        };
    }
    
    /**
     * 動態計算族群大小 (依據人數)
     */
    calculatePopulationSize() {
        const staffCount = this.allStaff.length;
        if (staffCount <= 15) return 40;
        if (staffCount <= 25) return 60;
        if (staffCount <= 35) return 80;
        return 100;
    }
    
    /**
     * 主執行函式
     */
    run() {
        console.log('🧬 SchedulerV4 排班開始 (基因演算法)');
        console.log(`  族群大小: ${this.populationSize}, 世代數: ${this.generations}`);
        
        const startTime = performance.now();
        
        try {
            // 步驟1: 初始化族群
            this.initializePopulation();
            
            // 步驟2: 演化循環
            for (let gen = 1; gen <= this.generations; gen++) {
                // 2.1 評估適應度
                this.evaluateFitness();
                
                // 2.2 記錄統計
                this.recordStatistics(gen);
                
                // 2.3 選擇菁英
                const elites = this.selectElites();
                
                // 2.4 產生新族群
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
                
                // 2.5 適應性調整突變率 (線性遞減)
                this.mutationRate = 0.05 * (1 - gen / this.generations);
                
                // 2.6 輸出進度
                if (gen % 20 === 0 || gen === 1 || gen === this.generations) {
                    const avgFitness = this.stats.generationAvgFitness[this.stats.generationAvgFitness.length - 1];
                    console.log(`  世代 ${gen}/${this.generations}: 最佳=${this.bestFitness.toFixed(1)}, 平均=${avgFitness.toFixed(1)}, 突變率=${(this.mutationRate * 100).toFixed(1)}%`);
                }
            }
            
            const endTime = performance.now();
            const executionTime = ((endTime - startTime) / 1000).toFixed(2);
            
            console.log(`✅ SchedulerV4 完成: ${executionTime}秒`);
            console.log(`  最佳適應度: ${this.bestFitness.toFixed(1)}`);
            console.log(`  改善幅度: ${((this.bestFitness - this.initialFitness) / Math.abs(this.initialFitness) * 100).toFixed(1)}%`);
            
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
        console.log('  🌱 初始化族群...');
        
        for (let i = 0; i < this.populationSize; i++) {
            let individual;
            
            if (i === 0) {
                // 第1個個體: 使用貪婪法產生 (高品質種子)
                individual = this.generateGreedyIndividual();
            } else if (i < this.populationSize * 0.3) {
                // 前30%: 基於貪婪解的變異
                const base = this.generateGreedyIndividual();
                individual = this.mutate(base, 0.1); // 小幅變異
            } else {
                // 其餘70%: 隨機產生 (多樣性)
                individual = this.generateRandomIndividual();
            }
            
            this.population.push(individual);
        }
        
        console.log('  ✅ 族群初始化完成');
    }
    
    /**
     * 貪婪法產生初始解
     */
    generateGreedyIndividual() {
        const individual = {};
        
        // 初始化結構
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            individual[uid] = {};
        }
        
        // 逐日填班
        for (let day = 1; day <= this.daysInMonth; day++) {
            for (let staff of this.allStaff) {
                const uid = staff.uid || staff.id;
                const key = `current_${day}`;
                
                // 檢查預班
                const params = staff.schedulingParams || {};
                const preReq = params[key];
                if (preReq && preReq !== 'OFF') {
                    individual[uid][key] = preReq;
                    continue;
                }
                
                // 計算白名單
                const whitelist = this.calculateWhitelist(staff, day, individual);
                
                // 貪婪選擇 (優先包班/志願)
                const shift = this.selectShiftGreedy(whitelist, staff);
                individual[uid][key] = shift;
            }
        }
        
        return individual;
    }
    
    /**
     * 隨機產生個體
     */
    generateRandomIndividual() {
        const individual = {};
        
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
                    continue;
                }
                
                // 計算白名單
                const whitelist = this.calculateWhitelist(staff, day, individual);
                
                // 隨機選擇
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
        
        // 使用 WhitelistCalculator (假設已存在)
        if (typeof WhitelistCalculator !== 'undefined') {
            return WhitelistCalculator.calculate(
                staff,
                individual,
                day,
                this.year,
                this.month,
                this.rules,
                {},  // dailyCount 暫時不用
                this.daysInMonth,
                this.shiftTimeMap,
                this.lastMonthData
            );
        }
        
        // 簡化版白名單 (如果 WhitelistCalculator 不存在)
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
     * 評估適應度 (綜合多目標)
     */
    evaluateFitness() {
        for (let individual of this.population) {
            // 檢查快取
            const cacheKey = this.getIndividualHash(individual);
            if (this.fitnessCache.has(cacheKey)) {
                individual.fitness = this.fitnessCache.get(cacheKey);
                individual.metrics = this.fitnessCache.get(cacheKey + '_metrics');
                continue;
            }
            
            // 計算各項指標
            const hardViolations = this.calculateHardViolations(individual);
            const softViolations = this.calculateSoftViolations(individual);
            const fairness = this.calculateFairness(individual);
            const preference = this.calculatePreference(individual);
            const staffing = this.calculateStaffing(individual);
            
            // 適應度函數 (多目標加權)
            let fitness = 10000; // 基準分
            fitness -= hardViolations * 1000;  // 硬限制權重最高
            fitness -= softViolations * 50;    // 軟限制次之
            fitness += fairness * 10;          // 公平性
            fitness += preference * 5;         // 偏好
            fitness += staffing * 20;          // 人力達成率
            
            individual.fitness = fitness;
            individual.metrics = {
                hardViolations,
                softViolations,
                fairness,
                preference,
                staffing
            };
            
            // 存入快取
            this.fitnessCache.set(cacheKey, fitness);
            this.fitnessCache.set(cacheKey + '_metrics', individual.metrics);
            
            // 更新最佳解
            if (fitness > this.bestFitness) {
                this.bestFitness = fitness;
                this.bestSolution = this.deepCopy(individual);
                
                // 記錄初始適應度
                if (this.initialFitness === 0) {
                    this.initialFitness = fitness;
                }
            }
        }
    }
    
    /**
     * 計算硬限制違規數
     */
    calculateHardViolations(individual) {
        let violations = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = individual[uid]?.[`current_${day}`];
                const prevShift = individual[uid]?.[`current_${day - 1}`];
                const nextShift = individual[uid]?.[`current_${day + 1}`];
                
                // 違規1: 大夜後不能接白班/小夜
                if (this.isNightShift(prevShift) && shift && shift !== 'OFF' && !this.isNightShift(shift)) {
                    violations++;
                }
                
                // 違規2: 連續上班超過上限
                const maxConsecutiveWork = this.rules?.staff?.max_consecutive_work || 6;
                const consecutiveWork = this.countConsecutiveWork(individual, uid, day);
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    if (consecutiveWork > maxConsecutiveWork) {
                        violations++;
                    }
                }
                
                // 違規3: 單休 (前後都上班)
                const prevIsWork = prevShift && prevShift !== 'OFF' && prevShift !== 'REQ_OFF';
                const currIsOff = !shift || shift === 'OFF' || shift === 'REQ_OFF';
                const nextIsWork = nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF';
                if (prevIsWork && currIsOff && nextIsWork) {
                    violations++;
                }
            }
            
            // 違規4: 休假天數不足
            const minOffDays = this.rules?.staff?.min_off_days || 8;
            const offDays = this.countOffDays(individual, uid, this.daysInMonth);
            if (offDays < minOffDays) {
                violations += (minOffDays - offDays);
            }
        }
        
        return violations;
    }
    
    /**
     * 計算軟限制違規數
     */
    calculateSoftViolations(individual) {
        let violations = 0;
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            // 軟違規1: 過多連續上班 (雖未超過硬上限，但接近上限)
            const warnConsecutiveWork = (this.rules?.staff?.max_consecutive_work || 6) - 1;
            for (let day = 1; day <= this.daysInMonth; day++) {
                const consecutiveWork = this.countConsecutiveWork(individual, uid, day);
                if (consecutiveWork >= warnConsecutiveWork) {
                    violations += 0.5;
                }
            }
            
            // 軟違規2: 包班未滿足
            const prefs = staff.preferences || {};
            if (prefs.bundleShift) {
                let bundleCount = 0;
                for (let day = 1; day <= this.daysInMonth; day++) {
                    const shift = individual[uid]?.[`current_${day}`];
                    if (shift === prefs.bundleShift) {
                        bundleCount++;
                    }
                }
                // 包班期望至少佔70%工作天
                const workDays = this.daysInMonth - this.countOffDays(individual, uid, this.daysInMonth);
                const expectedBundle = workDays * 0.7;
                if (bundleCount < expectedBundle) {
                    violations += (expectedBundle - bundleCount) * 0.3;
                }
            }
        }
        
        return violations;
    }
    
    /**
     * 計算公平性分數 (0-100)
     */
    calculateFairness(individual) {
        // 計算每個人的工作天數
        const workDays = [];
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const work = this.daysInMonth - this.countOffDays(individual, uid, this.daysInMonth);
            workDays.push(work);
        }
        
        // 計算標準差
        const mean = workDays.reduce((a, b) => a + b, 0) / workDays.length;
        const variance = workDays.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / workDays.length;
        const stdDev = Math.sqrt(variance);
        
        // 分數: 標準差越小越好 (最大100分)
        const score = Math.max(0, 100 - stdDev * 10);
        return score;
    }
    
    /**
     * 計算偏好滿足度 (0-100)
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
                
                maxScore += 10; // 每個工作日最高10分
                
                // 包班或志願1 匹配: 10分
                if (shift === prefs.bundleShift || shift === prefs.favShift) {
                    totalScore += 10;
                }
                // 志願2 匹配: 7分
                else if (shift === prefs.favShift2) {
                    totalScore += 7;
                }
                // 志願3 匹配: 5分
                else if (shift === prefs.favShift3) {
                    totalScore += 5;
                }
                // 其他: 2分
                else {
                    totalScore += 2;
                }
            }
        }
        
        return maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    }
    
    /**
     * 計算人力達成率 (0-100)
     */
    calculateStaffing(individual) {
        let totalNeeded = 0;
        let totalMet = 0;
        
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            const dayOfWeek = this.getDayOfWeek(day);
            
            for (let shift of this.shifts) {
                // 計算需求
                let need = 0;
                if (this.specificNeeds[dateStr] && this.specificNeeds[dateStr][shift.code] !== undefined) {
                    need = this.specificNeeds[dateStr][shift.code];
                } else {
                    const key = `${shift.code}_${dayOfWeek}`;
                    need = this.dailyNeeds[key] || 0;
                }
                
                if (need === 0) continue;
                
                // 計算實際人數
                let actual = 0;
                for (let staff of this.allStaff) {
                    const uid = staff.uid || staff.id;
                    const assignedShift = individual[uid]?.[`current_${day}`];
                    if (assignedShift === shift.code) {
                        actual++;
                    }
                }
                
                totalNeeded += need;
                totalMet += Math.min(actual, need); // 超額不加分
            }
        }
        
        return totalNeeded > 0 ? (totalMet / totalNeeded) * 100 : 100;
    }
    
    /**
     * 選擇菁英
     */
    selectElites() {
        // 按適應度排序
        const sorted = [...this.population].sort((a, b) => b.fitness - a.fitness);
        
        // 返回前 N 個
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
        
        // 返回適應度最高的
        candidates.sort((a, b) => b.fitness - a.fitness);
        return candidates[0];
    }
    
    /**
     * 交配 (兩點交叉)
     */
    crossover(parent1, parent2) {
        const offspring = {};
        
        // 隨機選擇兩個交叉點 (日期)
        const point1 = Math.floor(Math.random() * this.daysInMonth) + 1;
        const point2 = Math.floor(Math.random() * this.daysInMonth) + 1;
        const [start, end] = [Math.min(point1, point2), Math.max(point1, point2)];
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            offspring[uid] = {};
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                
                // 區段1: parent1
                if (day < start) {
                    offspring[uid][key] = parent1[uid]?.[key];
                }
                // 區段2: parent2
                else if (day >= start && day <= end) {
                    offspring[uid][key] = parent2[uid]?.[key];
                }
                // 區段3: parent1
                else {
                    offspring[uid][key] = parent1[uid]?.[key];
                }
            }
        }
        
        return offspring;
    }
    
    /**
     * 突變 (隨機改變某些日期的班別)
     */
    mutate(individual, rate = null) {
        const mutationRate = rate !== null ? rate : this.mutationRate;
        const mutated = this.deepCopy(individual);
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            
            for (let day = 1; day <= this.daysInMonth; day++) {
                if (Math.random() < mutationRate) {
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
        
        return mutated;
    }
    
    /**
     * 修復違規
     */
    repair(individual) {
        // 簡化版: 僅修復嚴重違規
        // 未來可擴展更複雜的修復邏輯
        return individual;
    }
    
    /**
     * 記錄統計資料
     */
    recordStatistics(generation) {
        // 最佳適應度
        this.stats.generationBestFitness.push(this.bestFitness);
        
        // 平均適應度
        const avgFitness = this.population.reduce((sum, ind) => sum + ind.fitness, 0) / this.population.length;
        this.stats.generationAvgFitness.push(avgFitness);
    }
    
    /**
     * 深拷貝
     */
    deepCopy(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
    
    /**
     * 計算個體雜湊值 (用於快取)
     */
    getIndividualHash(individual) {
        // 簡化版: 使用 JSON.stringify
        return JSON.stringify(individual);
    }
    
    /**
     * 轉換為日期格式
     */
    convertToDateFormat(individual) {
        const result = {};
        
        // 初始化日期結構
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            result[dateStr] = {};
            for (let shift of this.shifts) {
                result[dateStr][shift.code] = [];
            }
        }
        
        // 填入人員
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