// js/scheduler/SchedulerV2_CompleteFix.js
// 🔧 完整修正版：工作配額制 + 包班獨立處理 + 分段平衡

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {}; 
        this.checkpoints = []; 
        this.backtrackDepth = this.rules.aiParams?.backtrack_depth || 5;
        
        this.tolerance = this.rules.fairness?.fairOffVar || 2;
        this.minCons = this.rules.pattern?.minConsecutive || 2;
        
        // 🔧 新增：包班人員分組
        this.bundleStaff = [];
        this.nonBundleStaff = [];
    }

    run() {
        console.log(`🚀 SchedulerV2 Complete Fix Version Start.`);
        
        this.applyPreSchedules();
        this.calculateWorkQuota(); // 🔧 改用工作配額制
        this.classifyStaffByBundle(); // 🔧 分類包班/非包班
        
        // 🔧 強制啟用分段平衡（每10天檢查一次）
        const segments = Math.max(3, this.rules.aiParams?.balancingSegments || 3);
        const interval = Math.floor(this.daysInMonth / segments);
        for (let i = 1; i < segments; i++) {
            this.checkpoints.push(i * interval);
        }
        console.log(`📍 檢查點設定在: ${this.checkpoints.join(', ')} 天`);

        // --- 主迴圈：逐日排班 ---
        for (let d = 1; d <= this.daysInMonth; d++) {
            
            // 1. 每日更新工作壓力（基於配額完成度）
            this.calculateDailyWorkPressure(d);

            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            this.shuffleArray(shiftOrder); 

            // 2. 正常填班
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }

            // 3. 資源再分配
            this.optimizeDailyAllocation(d);

            // 4. 分段平衡
            if (this.checkpoints.includes(d)) {
                console.log(`⚖️ 第${d}天執行分段平衡...`);
                this.postProcessBalancing(d);
            }
        }

        console.log(`⚖️ 執行最終全月平衡...`);
        this.postProcessBalancing(this.daysInMonth);

        return this.formatResult();
    }

    // 🔧 核心修正1：工作配額制
    calculateWorkQuota() {
        let totalAvailableDays = 0;
        let totalRequiredShifts = 0;

        // 1. 計算總可工作人天
        this.staffList.forEach(staff => {
            let reqOffCount = 0;
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                if (params[this.getDateStr(d)] === 'REQ_OFF') reqOffCount++;
            }
            const availableDays = this.daysInMonth - reqOffCount;
            totalAvailableDays += availableDays;

            this.staffStats[staff.id] = {
                reqOffCount: reqOffCount,
                availableDays: availableDays,
                workQuota: 0, // 待計算
                workedShifts: 0,
                initialRandom: Math.random()
            };
        });

        // 2. 計算總需求班數（簡化：假設每天需求總和）
        for (let d = 1; d <= this.daysInMonth; d++) {
            const needs = this.getDailyNeeds(d);
            Object.values(needs).forEach(count => {
                totalRequiredShifts += count;
            });
        }

        // 3. 分配工作配額
        const quotaRatio = totalRequiredShifts / totalAvailableDays;
        this.staffList.forEach(staff => {
            const quota = Math.round(this.staffStats[staff.id].availableDays * quotaRatio);
            this.staffStats[staff.id].workQuota = quota;
            
            console.log(`👤 ${staff.name}: 可工作${this.staffStats[staff.id].availableDays}天, 配額${quota}班`);
        });
    }

    // 🔧 核心修正2：分類包班/非包班人員
    classifyStaffByBundle() {
        this.staffList.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (bundleShift) {
                this.bundleStaff.push(staff);
            } else {
                this.nonBundleStaff.push(staff);
            }
        });
        console.log(`📦 包班人員: ${this.bundleStaff.length}人, 非包班: ${this.nonBundleStaff.length}人`);
    }

    // 🔧 核心修正3：每日工作壓力（取代債務）
    calculateDailyWorkPressure(currentDay) {
        const remainingDays = this.daysInMonth - currentDay + 1;

        this.staffList.forEach(s => {
            const stats = this.staffStats[s.id];
            const workedShifts = this.getTotalShiftsUpTo(s.id, currentDay - 1);
            const remainingQuota = stats.workQuota - workedShifts;
            
            // 壓力 = 剩餘配額 / 剩餘天數
            // 壓力越高 = 越需要上班
            const pressure = remainingDays > 0 ? (remainingQuota / remainingDays) : 0;
            
            stats.workedShifts = workedShifts;
            stats.workPressure = pressure;
        });
    }

    // 🔧 修正填班邏輯：包班優先處理
    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        // 🔧 步驟1：如果是夜班，優先用包N人員填滿80%
        if (shiftCode === 'N') {
            const bundleNStaff = this.bundleStaff.filter(s => {
                const bundleShift = s.packageType || s.prefs?.bundleShift;
                return bundleShift === 'N';
            });

            if (bundleNStaff.length > 0) {
                const bundleQuota = Math.ceil(neededCount * 0.8); // 80%配額
                const bundleGap = Math.min(gap, bundleQuota);
                
                let bundleCandidates = bundleNStaff.filter(s => 
                    this.getShiftByDate(dateStr, s.id) === 'OFF'
                );
                
                this.sortCandidatesByPressure(bundleCandidates, dateStr, shiftCode);

                for (const staff of bundleCandidates) {
                    if (bundleGap <= 0 || gap <= 0) break;
                    
                    const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
                    if (scoreInfo.totalScore < -50000) continue;

                    if (this.assignIfValid(day, staff, shiftCode)) {
                        gap--;
                    }
                }
            }
        }

        // 🔧 步驟2：用所有符合志願的人填補剩餘缺額
        let candidates = this.staffList.filter(s => {
            if (this.getShiftByDate(dateStr, s.id) !== 'OFF') return false;
            
            // 檢查是否在志願清單中
            const prefs = s.prefs || {};
            const bundleShift = s.packageType || prefs.bundleShift;
            const favShift = prefs.favShift;
            const favShift2 = prefs.favShift2;
            const favShift3 = prefs.favShift3;
            
            return (bundleShift === shiftCode || 
                    favShift === shiftCode || 
                    favShift2 === shiftCode || 
                    favShift3 === shiftCode);
        });
        
        this.sortCandidatesByPressure(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;
            const scoreInfo = this.calculateScoreInfo(staff, dateStr, shiftCode);
            if (scoreInfo.totalScore < -50000) continue;

            if (this.assignIfValid(day, staff, shiftCode)) {
                gap--;
            } else {
                if (this.tryResolveConflict(day, staff, shiftCode)) {
                     if (this.assignIfValid(day, staff, shiftCode)) gap--;
                }
            }
        }
        
        // 🔧 步驟3：回溯處理剩餘缺額
        if (gap > 0 && this.backtrackDepth > 0) {
            const recovered = this.resolveShortageWithBacktrack(day, shiftCode, gap);
            gap -= recovered;
        }

        if (gap > 0) {
            console.warn(`⚠️ 第${day}天 ${shiftCode}班 仍缺${gap}人`);
        }
    }

    // 🔧 修正排序：基於工作壓力
    sortCandidatesByPressure(candidates, dateStr, shiftCode) {
        this.shuffleArray(candidates); 
        candidates.sort((a, b) => {
            const pressureA = this.staffStats[a.id].workPressure;
            const pressureB = this.staffStats[b.id].workPressure;
            const diff = pressureB - pressureA; // 壓力高的排前面
            
            if (Math.abs(diff) > 0.1) return diff > 0 ? 1 : -1;
            
            // 壓力相近時，比較評分
            const scoreA = this.calculateScoreInfo(a, dateStr, shiftCode).totalScore;
            const scoreB = this.calculateScoreInfo(b, dateStr, shiftCode).totalScore;
            return scoreB - scoreA; 
        });
    }

    // 🔧 修正評分系統：包班權重最高
    calculateScoreInfo(staff, dateStr, shiftCode) {
        let score = 0;
        const policy = this.rules.policy || {};
        const pressure = this.staffStats[staff.id]?.workPressure || 0;
        
        score += (this.staffStats[staff.id]?.initialRandom || 0) * 10;

        // 🔧 工作壓力影響（取代債務）
        score += pressure * 1000; // 壓力轉換為分數

        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const currentDayIdx = new Date(dateStr).getDate();
        let prevShift = 'OFF';
        if (currentDayIdx > 1) {
            const prevDateStr = this.getDateStr(currentDayIdx - 1);
            prevShift = this.getShiftByDate(prevDateStr, staff.id);
        }

        // 連續上班模式
        if (shiftCode !== 'OFF') { 
            if (prevShift !== 'OFF' && prevShift !== 'REQ_OFF') {
                if (consDays < this.minCons) score += 5000; 
                else if (consDays < (policy.maxConsDays || 6)) score += 500; 
                else score -= 2000; 
            }
        }

        let prefs = {};
        if (staff.prefs) {
            if (staff.prefs[dateStr]) prefs = staff.prefs[dateStr];
            else if (staff.prefs.favShift || staff.prefs.bundleShift) prefs = staff.prefs;
        }

        let isPreferred = false;
        const bundleShift = staff.packageType || prefs.bundleShift;
        
        // 🔧 包班匹配：最高優先級（50000分）
        if (bundleShift === shiftCode) {
            score += 50000; 
            isPreferred = true;
            
            // 檢查包班比例
            const currentDay = new Date(dateStr).getDate();
            const totalShiftsSoFar = this.getTotalShiftsUpTo(staff.id, currentDay - 1);
            const bundleShiftsSoFar = this.countSpecificShiftsUpTo(staff.id, currentDay - 1, bundleShift);
            const bundleRatio = (totalShiftsSoFar > 0) ? (bundleShiftsSoFar / totalShiftsSoFar) : 0;
            
            if (bundleRatio < 0.8) score += 10000; // 比例不足，額外加分
        }

        // 第一志願
        if (prefs.favShift === shiftCode) { 
            score += 3000; 
            isPreferred = true; 
        }
        
        // 第二志願
        if (prefs.favShift2 === shiftCode) {
            score += 1000; 
            isPreferred = true;
        }
        
        // 第三志願
        if (prefs.favShift3 === shiftCode) { 
            score += 200; 
            isPreferred = true; 
        }

        // 🔧 非志願班別：嚴格拒絕
        const hasPreferences = prefs.favShift || prefs.favShift2 || prefs.favShift3 || bundleShift;
        if (hasPreferences && !isPreferred) {
            score -= 999999; // 絕對不排非志願班
        }

        // 避免特定班別
        const params = staff.schedulingParams || {};
        if (params[dateStr] === '!' + shiftCode) {
             score -= 999999;
        }

        return { totalScore: score, isPreferred: isPreferred };
    }

    // 🔧 修正資源再分配：基於壓力差異
    optimizeDailyAllocation(day) {
        const dateStr = this.getDateStr(day);
        
        const offStaffs = this.staffList.filter(s => {
            const shift = this.getShiftByDate(dateStr, s.id);
            return (shift === 'OFF') && !this.isPreRequestOff(s.id, dateStr);
        });

        // 依工作壓力由高到低排序（壓力高的想上班）
        offStaffs.sort((a, b) => 
            this.staffStats[b.id].workPressure - this.staffStats[a.id].workPressure
        );

        for (const highPressureStaff of offStaffs) {
            const pressure = this.staffStats[highPressureStaff.id].workPressure;
            
            // 壓力 < 0.5 表示不需要加班
            if (pressure < 0.5) continue;

            // 尋找他願意上的班
            const targetShifts = this.shiftCodes.filter(code => {
                if (code === 'OFF' || code === 'REQ_OFF') return false;
                const s = this.calculateScoreInfo(highPressureStaff, dateStr, code);
                return s.totalScore > -1000; 
            });
            
            targetShifts.sort((a, b) => {
                return this.calculateScoreInfo(highPressureStaff, dateStr, b).totalScore - 
                       this.calculateScoreInfo(highPressureStaff, dateStr, a).totalScore;
            });

            for (const targetCode of targetShifts) {
                const assignedUids = this.schedule[dateStr][targetCode] || [];
                
                let bestSwapTarget = null;
                let maxPressureDiff = -999;

                for (const uid of assignedUids) {
                    const lowPressureStaff = this.staffList.find(s => s.id === uid);
                    if (!lowPressureStaff || this.isPreRequestOff(lowPressureStaff.id, dateStr)) continue; 

                    const lowPressure = this.staffStats[lowPressureStaff.id].workPressure;
                    const diff = pressure - lowPressure;

                    // 壓力差 > 0.3 才考慮交換
                    if (diff > 0.3) {
                        if (diff > maxPressureDiff) {
                            if (this.checkSwapValidity(day, highPressureStaff, 'OFF', targetCode) && 
                                this.checkSwapValidity(day, lowPressureStaff, targetCode, 'OFF')) {
                                bestSwapTarget = lowPressureStaff;
                                maxPressureDiff = diff;
                            }
                        }
                    }
                }

                if (bestSwapTarget) {
                    this.updateShift(dateStr, bestSwapTarget.id, targetCode, 'OFF'); 
                    this.updateShift(dateStr, highPressureStaff.id, 'OFF', targetCode); 
                    break; 
                }
            }
        }
    }

    // 🔧 增強平衡機制：分別平衡包班和總休假
    postProcessBalancing(limitDay) {
        const rounds = (this.rules.fairness?.balanceRounds || 100) * 2; 
        
        // 1. 平衡包班人員的包班比例
        this.balanceBundleRatio(limitDay, rounds);
        
        // 2. 平衡夜班數（全體）
        const isFairNight = this.rules.fairness?.fairNight !== false; 
        if (isFairNight) this.balanceShiftType('N', limitDay, rounds);
        
        // 3. 平衡總休假數
        const isFairOff = this.rules.fairness?.fairOff !== false;     
        if (isFairOff) this.balanceShiftType('OFF', limitDay, rounds);
    }

    // 🔧 新增：平衡包班比例
    balanceBundleRatio(limitDay, rounds) {
        const bundleGroups = {};
        
        // 按包班類型分組
        this.bundleStaff.forEach(staff => {
            const bundleShift = staff.packageType || staff.prefs?.bundleShift;
            if (!bundleGroups[bundleShift]) bundleGroups[bundleShift] = [];
            bundleGroups[bundleShift].push(staff);
        });

        // 逐組平衡
        Object.entries(bundleGroups).forEach(([shiftCode, staffs]) => {
            console.log(`📦 平衡 ${shiftCode} 包班，共 ${staffs.length} 人`);
            
            for (let r = 0; r < rounds; r++) {
                const stats = staffs.map(s => {
                    const total = this.getTotalShiftsUpTo(s.id, limitDay);
                    const bundle = this.countSpecificShiftsUpTo(s.id, limitDay, shiftCode);
                    const ratio = total > 0 ? (bundle / total) : 0;
                    return { id: s.id, ratio, total, bundle, obj: s };
                }).sort((a, b) => a.ratio - b.ratio);

                const minPerson = stats[0];
                const maxPerson = stats[stats.length - 1];
                
                if (minPerson.ratio >= 0.75) break; // 所有人都達標

                // 嘗試調整比例最低的人
                let adjusted = false;
                const days = Array.from({length: limitDay}, (_, i) => i + 1);
                this.shuffleArray(days);
                
                for (const d of days) {
                    const dateStr = this.getDateStr(d);
                    const currentShift = this.getShiftByDate(dateStr, minPerson.id);
                    
                    // 如果他上的不是包班，試著換成包班
                    if (currentShift !== shiftCode && currentShift !== 'OFF' && currentShift !== 'REQ_OFF') {
                        if (!this.isPreRequestOff(minPerson.id, dateStr)) {
                            if (this.checkSwapValidity(d, minPerson.obj, currentShift, shiftCode)) {
                                this.updateShift(dateStr, minPerson.id, currentShift, shiftCode);
                                adjusted = true;
                                break;
                            }
                        }
                    }
                }
                
                if (!adjusted) break;
            }
        });
    }

    balanceShiftType(targetShift, limitDay, rounds) {
        const isLocked = (d, uid) => {
             const dateStr = this.getDateStr(d);
             const s = this.staffList.find(x => x.id === uid);
             return s?.schedulingParams?.[dateStr] !== undefined; 
        };
        
        for (let r = 0; r < rounds; r++) {
            const stats = this.staffList.map(s => {
                let count = 0;
                for(let d=1; d<=limitDay; d++) {
                    if(this.getShiftByDate(this.getDateStr(d), s.id) === targetShift) count++;
                }
                return { id: s.id, count, obj: s };
            }).sort((a, b) => b.count - a.count);
            
            const maxPerson = stats[0];
            const minPerson = stats[stats.length - 1];
            
            if (maxPerson.count - minPerson.count <= this.tolerance) break; 
            
            let swapped = false;
            const days = Array.from({length: limitDay}, (_, i) => i + 1);
            this.shuffleArray(days);
            
            for (const d of days) {
                if (isLocked(d, maxPerson.id) || isLocked(d, minPerson.id)) continue;
                
                const dateStr = this.getDateStr(d);
                const shiftMax = this.getShiftByDate(dateStr, maxPerson.id); 
                const shiftMin = this.getShiftByDate(dateStr, minPerson.id); 
                
                let canSwap = false;
                if (targetShift !== 'OFF') {
                    if (shiftMax === targetShift && shiftMin !== targetShift) canSwap = true;
                } else {
                    if (shiftMax !== 'OFF' && shiftMin === 'OFF') canSwap = true;
                }
                
                if (canSwap) {
                    if (!this.isValidAssignment(maxPerson.obj, dateStr, shiftMin)) continue;
                    
                    let minCanTake = this.isValidAssignment(minPerson.obj, dateStr, shiftMax);
                    if (!minCanTake && this.backtrackDepth > 0) {
                        if (this.attemptBacktrackForStaff(minPerson.obj, d, shiftMax)) {
                            minCanTake = true;
                        }
                    }
                    
                    if (minCanTake) {
                        if(this.checkSwapValidity(d, maxPerson.obj, shiftMax, shiftMin) &&
                           this.checkSwapValidity(d, minPerson.obj, shiftMin, shiftMax)) {
                            this.updateShift(dateStr, maxPerson.id, shiftMax, shiftMin);
                            this.updateShift(dateStr, minPerson.id, shiftMin, shiftMax);
                            swapped = true;
                            break; 
                        }
                    }
                }
            }
            
            if (!swapped) break; 
        }
    }

    // === 以下為保持不變的輔助函數 ===

    countSystemOffsUpTo(uid, dayLimit) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            const shift = this.getShiftByDate(this.getDateStr(d), uid);
            if (shift === 'OFF') count++;
        }
        return count;
    }

    isValidAssignment(staff, dateStr, shiftCode) {
        const baseValid = super.isValidAssignment(staff, dateStr, shiftCode);
        if (baseValid) return true;

        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        const normalLimit = this.rules.policy?.maxConsDays || 6;
        
        if (consDays + 1 > normalLimit) {
            const stats = this.staffStats[staff.id];
            const isLongVacationer = stats?.reqOffCount >= 7;
            
            if (isLongVacationer) {
                const longVacLimit = this.rules.policy?.longVacationWorkLimit || 7;
                if (consDays + 1 <= longVacLimit) {
                    const currentDayIndex = new Date(dateStr).getDate();
                    let prevShift = 'OFF';
                    if (currentDayIndex > 1) {
                         const prevDateStr = this.getDateStr(currentDayIndex - 1);
                         prevShift = this.getShiftByDate(prevDateStr, staff.id);
                    } else if (currentDayIndex === 1) {
                        prevShift = this.lastMonthData?.[staff.id]?.lastShift || 'OFF';
                    }
                    if (!this.checkRestPeriod(prevShift, shiftCode)) return false; 
                    return true;
                }
            }
        }
        return false;
    }

    checkSwapValidity(day, staff, currentShift, newShift) {
        const dateStr = this.getDateStr(day);
        if (!this.isValidAssignment(staff, dateStr, newShift)) return false;
        const scoreInfo = this.calculateScoreInfo(staff, dateStr, newShift);
        if (scoreInfo.totalScore < -50000) return false; 
        if (scoreInfo.totalScore < -2000) return false;  
        return true;
    }

    resolveShortageWithBacktrack(currentDay, targetShift, gap) {
        let recovered = 0;
        for (let d = currentDay - 1; d >= Math.max(1, currentDay - this.backtrackDepth); d--) {
            if (gap <= 0) break;
            const pastDateStr = this.getDateStr(d);
            const currentDateStr = this.getDateStr(currentDay);
            const candidates = this.staffList.filter(s => 
                this.getShiftByDate(currentDateStr, s.id) === 'OFF' &&
                !this.isPreRequestOff(s.id, currentDateStr)
            );
            this.sortCandidatesByPressure(candidates, currentDateStr, targetShift);
            for (const staff of candidates) {
                if (gap <= 0) break;
                if (this.attemptBacktrackForStaff(staff, currentDay, targetShift)) {
                    this.updateShift(currentDateStr, staff.id, 'OFF', targetShift);
                    gap--;
                    recovered++;
                }
            }
        }
        return recovered;
    }

    attemptBacktrackForStaff(staff, currentDay, targetShift) {
        const currentDateStr = this.getDateStr(currentDay);
        const scoreInfo = this.calculateScoreInfo(staff, currentDateStr, targetShift);
        if (scoreInfo.totalScore < -50000) return false;

        for (let d = currentDay - 1; d >= Math.max(1, currentDay - this.backtrackDepth); d--) {
            const pastDateStr = this.getDateStr(d);
            const pastShift = this.getShiftByDate(pastDateStr, staff.id);
            if (pastShift !== 'OFF' && pastShift !== 'REQ_OFF' && !this.isPreRequestOff(staff.id, pastDateStr)) {
                this.updateShift(pastDateStr, staff.id, pastShift, 'OFF');
                if (this.isValidAssignment(staff, currentDateStr, targetShift) && 
                    this.checkGroupMaxLimit(currentDay, staff, targetShift)) {
                    return true;
                } else {
                    this.updateShift(pastDateStr, staff.id, 'OFF', pastShift);
                }
            }
        }
        return false;
    }

    countSpecificShiftsUpTo(uid, dayLimit, targetShift) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            if (this.getShiftByDate(this.getDateStr(d), uid) === targetShift) count++;
        }
        return count;
    }

    applyPreSchedules() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const req = params[dateStr];
                if (req === 'REQ_OFF') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                }
                else if (req && req !== 'OFF' && !req.startsWith('!')) {
                    this.updateShift(dateStr, staff.id, 'OFF', req);
                }
            }
        });
    }

    getTotalShiftsUpTo(uid, dayLimit) {
        let count = 0;
        for (let d = 1; d <= dayLimit; d++) {
            const shift = this.getShiftByDate(this.getDateStr(d), uid);
            if (shift !== 'OFF' && shift !== 'REQ_OFF') count++;
        }
        return count;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    assignIfValid(day, staff, shiftCode) {
        const dateStr = this.getDateStr(day);
        const isValid = this.isValidAssignment(staff, dateStr, shiftCode);
        const isGroupValid = this.checkGroupMaxLimit(day, staff, shiftCode);
        if (isValid && isGroupValid) {
            this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
            return true;
        }
        return false;
    }

    tryResolveConflict(day, staff, targetShift) {
        if (day === 1) return false;
        const dateStr = this.getDateStr(day);
        const prevDateStr = this.getDateStr(day - 1);
        const prevShift = this.getShiftByDate(prevDateStr, staff.id);
        if (this.checkRestPeriod(prevShift, targetShift)) return false; 
        let swapCandidates = this.staffList.filter(s => 
            s.id !== staff.id && 
            this.getShiftByDate(prevDateStr, s.id) === 'OFF' &&
            !this.isPreRequestOff(s.id, prevDateStr) 
        );
        this.shuffleArray(swapCandidates);
        for (const candidate of swapCandidates) {
            if (this.isValidAssignment(candidate, prevDateStr, prevShift)) {
                this.updateShift(prevDateStr, candidate.id, 'OFF', prevShift);
                this.updateShift(prevDateStr, staff.id, prevShift, 'OFF');
                return true; 
            }
        }
        return false;
    }
    
    getDailyNeeds(day) {
        const dateStr = this.getDateStr(day);
        const date = new Date(this.year, this.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; 
        const needs = {};
        this.shiftCodes.forEach(code => {
            if(code === 'OFF' || code === 'REQ_OFF') return;
            if (this.rules.specificNeeds?.[dateStr]?.[code] !== undefined) {
                needs[code] = this.rules.specificNeeds[dateStr][code];
            } else {
                const key = `${code}_${dayIdx}`;
                const val = this.rules.dailyNeeds?.[key];
                if (val > 0) needs[code] = val;
            }
        });
        return needs;
    }

    checkGroupMaxLimit(day, staff, shiftCode) {
        if (!this.rules.groupLimits) return true;
        const group = staff.group; 
        if (!group) return true;
        const limit = this.rules.groupLimits[group]?.[shiftCode]?.max;
        if (limit === undefined || limit === null || limit === '') return true;
        let currentCount = 0;
        const dateStr = this.getDateStr(day);
        const assignedUids = this.schedule[dateStr][shiftCode] || [];
        assignedUids.forEach(uid => {
            const s = this.staffList.find(st => st.id === uid);
            if (s && s.group === group) currentCount++;
        });
        return currentCount < limit;
    }

    formatResult() { 
        const res = {}; 
        for(let d = 1; d <= this.daysInMonth; d++){ 
            const ds = this.getDateStr(d); 
            res[ds] = {}; 
            this.shiftCodes.forEach(code => { 
                if (code === 'OFF') return; 
                const ids = this.schedule[ds][code] || []; 
                if(ids.length > 0) res[ds][code] = ids; 
            }); 
        } 
        return res; 
    }
}
