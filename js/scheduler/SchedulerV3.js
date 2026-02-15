// js/scheduler/SchedulerV3.js

class SchedulerV3 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        console.log('🚀 SchedulerV3 初始化 (階段1全部填班 + 階段2調整OFF + 階段3回溯1 + 階段4回溯2)');
        this.assignments = {};
        this.dailyCount = {};
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
            for (let shift of this.shifts) this.dailyCount[day][shift.code] = 0;
        }
    }
    
    run() {
        console.log('🤖 SchedulerV3 排班開始');
        try {
            // 步驟0：套用預班
            this.step0_ApplyPreSchedule();
            
            // 逐日處理：每天都執行「階段1 + 階段2 + 階段3 + 階段4」
            for (let day = 1; day <= this.daysInMonth; day++) {
                console.log(`\n📅 處理第 ${day} 天`);
                
                // 階段1：全部填班
                this.stage1_FillAllShifts(day);
                
                // 階段2：調整OFF
                this.stage2_AdjustOff(day);
                
                // 階段3：回溯1（補足不足）
                this.stage3_Backtrack1(day);
                
                // 階段4：回溯2（深度回溯）
                this.stage4_Backtrack2(day);
            }
            
            // 步驟5：平衡調整 (微調，不違反包班/志願)
            this.step5_BalanceAdjustment();
            
            return this.convertToDateFormat();
        } catch (error) {
            console.error('❌ SchedulerV3 排班失敗:', error);
            throw error;
        }
    }
    
    /**
     * 步驟0：套用預班
     */
    step0_ApplyPreSchedule() {
        console.log('\n📋 步驟0：套用預班');
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const params = staff.schedulingParams || {};
            for (let day = 1; day <= this.daysInMonth; day++) {
                const key = `current_${day}`;
                const pre = params[key];
                if (pre && pre !== 'OFF') {
                    this.assignments[uid][key] = pre;
                    this.dailyCount[day][pre] = (this.dailyCount[day][pre] || 0) + 1;
                }
            }
        }
    }
    
    /**
     * 階段1：全部填班（每個人都填，不管需求）
     */
    stage1_FillAllShifts(day) {
        console.log(`  🎯 階段1：填班（第 ${day} 天）`);
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const key = `current_${day}`;
            
            // 如果已經有預班，跳過
            if (this.assignments[uid][key]) {
                continue;
            }
            
            // 計算白名單
            const whitelist = WhitelistCalculator.calculate(
                staff,
                this.assignments,
                day,
                this.year,
                this.month,
                this.rules,
                this.dailyCount[day],
                this.daysInMonth,
                this.shiftTimeMap,
                this.lastMonthData
            );
            
            // Step 2.6：填入班別（按優先順序，不檢查是否已滿）
            const shift = this.selectShiftFromWhitelist(whitelist, staff);
            this.assignments[uid][key] = shift;
            
            // 更新計數
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                this.dailyCount[day][shift] = (this.dailyCount[day][shift] || 0) + 1;
            }
        }
    }
    
    /**
     * 從白名單中選擇班別（優先順序：包班 > 志願1 > 志願2 > 志願3 > OFF）
     */
    selectShiftFromWhitelist(whitelist, staff) {
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
     * 階段2：調整OFF（處理超額班別）
     */
    stage2_AdjustOff(day) {
        console.log(`  ⚖️ 階段2：調整OFF（第 ${day} 天）`);
        
        // 重新計算每個人的總OFF數（1號到31號）
        const totalOffCounts = this.calculateTotalOffCounts();
        
        // 取得當日需求
        const dateStr = this.getDateKey(day);
        const dayOfWeek = this.getDayOfWeek(day);
        const needsList = this.calculateDailyNeeds(day, dateStr, dayOfWeek);
        
        // 按班別順序處理：N → E → D
        const shiftOrder = this.getShiftOrderByPriority();
        
        for (let shiftCode of shiftOrder) {
            // 找到這個班別的需求
            const needItem = needsList.find(n => n.shift === shiftCode);
            if (!needItem) continue;
            
            const N1 = needItem.need; // 所需人數
            const N2 = this.dailyCount[day][shiftCode] || 0; // 實際人數
            
            console.log(`    班別 ${shiftCode}: 需要 ${N1} 人，實際 ${N2} 人`);
            
            // 情況A：剛好達標
            if (N1 === N2) {
                console.log(`    ✅ ${shiftCode} 班剛好達標`);
                continue;
            }
            
            // 情況B：超額
            if (N1 < N2) {
                const excess = N2 - N1;
                console.log(`    ⚠️ ${shiftCode} 班超額 ${excess} 人，開始調整`);
                this.adjustExcessShift(day, shiftCode, excess, totalOffCounts);
            }
            
            // 情況C：不足
            if (N1 > N2) {
                const shortage = N1 - N2;
                console.log(`    ❌ ${shiftCode} 班不足 ${shortage} 人`);
                // 階段3會處理
            }
        }
    }
    
    /**
     * 調整超額班別：選總OFF少的人改OFF
     */
    adjustExcessShift(day, shiftCode, excess, totalOffCounts) {
        const key = `current_${day}`;
        
        // 篩選排這個班的人
        const candidates = [];
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            if (this.assignments[uid][key] === shiftCode) {
                candidates.push({
                    uid: uid,
                    staff: staff,
                    totalOff: totalOffCounts[uid] || 0
                });
            }
        }
        
        // 排除不能選的人
        const validCandidates = candidates.filter(candidate => {
            return this.canChangeToOff(candidate.staff, day);
        });
        
        if (validCandidates.length === 0) {
            console.log(`      ⚠️ 沒有可以改OFF的人`);
            return;
        }
        
        // 按總OFF數排序（少 → 多）
        validCandidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) {
                return a.totalOff - b.totalOff;
            }
            // 總OFF數相同時，隨機排序
            return Math.random() - 0.5;
        });
        
        // 選前 excess 個人改OFF
        const toChange = Math.min(excess, validCandidates.length);
        for (let i = 0; i < toChange; i++) {
            const uid = validCandidates[i].uid;
            const staffName = validCandidates[i].staff.name || validCandidates[i].staff.displayName || uid;
            console.log(`      → ${staffName} (總OFF=${validCandidates[i].totalOff}) 改為 OFF`);
            this.assignments[uid][key] = 'OFF';
            this.dailyCount[day][shiftCode]--;
        }
    }
    
    /**
     * 檢查是否可以改OFF
     */
    canChangeToOff(staff, day) {
        const uid = staff.uid || staff.id;
        
        // 檢查1：連續上班天數 >= 2
        const consecutiveDays = this.countConsecutiveWorkDays(uid, day);
        if (consecutiveDays < 2) {
            return false; // 連續上班不足2天，不能改OFF
        }
        
        // 檢查2：避免單休
        const prevShift = this.assignments[uid]?.[`current_${day - 1}`];
        const nextShift = this.assignments[uid]?.[`current_${day + 1}`];
        
        const prevIsWork = prevShift && prevShift !== 'OFF' && prevShift !== 'REQ_OFF';
        const nextIsWork = nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF';
        
        if (prevIsWork && nextIsWork) {
            // 前後都有班，檢查承諾等級
            const commitmentLevel = this.rules?.policy?.prioritizePreReq || 'must';
            
            // 檢查隔天是否是預班
            const isNextDayPreReq = nextShift === 'REQ_OFF' || this.isPreScheduled(staff, day + 1);
            
            if (isNextDayPreReq && commitmentLevel === 'must') {
                return false; // 隔天有預班且must模式，不能改OFF
            } else if (!isNextDayPreReq) {
                return false; // 隔天不是預班，會造成單休
            }
            // 其他情況：隔天是預班但非must模式，可以改OFF
        }
        
        return true;
    }
    
    /**
     * 檢查某天是否是預班
     */
    isPreScheduled(staff, day) {
        const params = staff.schedulingParams || {};
        const preReq = params[`current_${day}`];
        return preReq && preReq !== 'OFF';
    }
    
    /**
     * 計算連續上班天數（從某天往前數）
     */
    countConsecutiveWorkDays(uid, upToDay) {
        let count = 0;
        for (let d = upToDay; d >= 1; d--) {
            const shift = this.assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                break;
            }
            count++;
        }
        
        // 如果本月從1號開始都在上班，繼續檢查上月
        if (count === upToDay && this.lastMonthData?.[uid]) {
            const lastDays = ['last_31', 'last_30', 'last_29', 'last_28', 'last_27', 'last_26'];
            for (let k of lastDays) {
                const s = this.lastMonthData[uid][k];
                if (!s || s === 'OFF' || s === 'REQ_OFF') break;
                count++;
            }
        }
        
        return count;
    }
    
    /**
     * 階段3：回溯1（從排班OFF的人中補足不足班別）
     */
    stage3_Backtrack1(day) {
        console.log(`  🔄 階段3：回溯1（第 ${day} 天）`);
        
        // 取得當日需求
        const dateStr = this.getDateKey(day);
        const dayOfWeek = this.getDayOfWeek(day);
        const needsList = this.calculateDailyNeeds(day, dateStr, dayOfWeek);
        
        // 按班別順序處理：N → E → D
        const shiftOrder = this.getShiftOrderByPriority();
        
        for (let shiftCode of shiftOrder) {
            // 找到這個班別的需求
            const needItem = needsList.find(n => n.shift === shiftCode);
            if (!needItem) continue;
            
            const N1 = needItem.need; // 所需人數
            const N2 = this.dailyCount[day][shiftCode] || 0; // 實際人數
            
            // 只處理不足的班別
            if (N1 <= N2) continue;
            
            const shortage = N1 - N2;
            console.log(`    🔍 ${shiftCode} 班不足 ${shortage} 人，嘗試回溯補足`);
            
            // 從排班OFF的人中找候選人
            const candidates = this.findBacktrack1Candidates(day, shiftCode);
            
            if (candidates.length === 0) {
                console.log(`    ❌ 沒有符合條件的候選人`);
                continue;
            }
            
            // 按優先順序排序
            candidates.sort((a, b) => {
                const prioA = this.getBacktrack1Priority(a.staff, shiftCode);
                const prioB = this.getBacktrack1Priority(b.staff, shiftCode);
                return prioB - prioA; // 高優先度在前
            });
            
            // 選人補班（允許部分補足）
            const toFill = Math.min(shortage, candidates.length);
            for (let i = 0; i < toFill; i++) {
                const uid = candidates[i].uid;
                const staffName = candidates[i].staff.name || candidates[i].staff.displayName || uid;
                console.log(`    ✅ ${staffName} 從 OFF 改為 ${shiftCode}`);
                this.assignments[uid][`current_${day}`] = shiftCode;
                this.dailyCount[day][shiftCode]++;
            }
            
            // 檢查是否完全補足
            const finalCount = this.dailyCount[day][shiftCode] || 0;
            if (finalCount < N1) {
                console.log(`    ⚠️ ${shiftCode} 班仍不足 ${N1 - finalCount} 人`);
            }
        }
    }
    
    /**
     * 找回溯1的候選人（排班OFF + 白名單有需求班）
     */
    findBacktrack1Candidates(day, shiftCode) {
        const candidates = [];
        
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const shift = this.assignments[uid]?.[`current_${day}`];
            
            // 只找排班OFF（不包含預班OFF）
            if (shift !== 'OFF') continue;
            
            // 計算白名單
            const whitelist = WhitelistCalculator.calculate(
                staff,
                this.assignments,
                day,
                this.year,
                this.month,
                this.rules,
                this.dailyCount[day],
                this.daysInMonth,
                this.shiftTimeMap,
                this.lastMonthData
            );
            
            // 檢查白名單是否包含需求班別
            if (whitelist.includes(shiftCode)) {
                candidates.push({
                    uid: uid,
                    staff: staff
                });
            }
        }
        
        return candidates;
    }
    
    /**
     * 計算回溯1的優先度
     */
    getBacktrack1Priority(staff, shiftCode) {
        const prefs = staff.preferences || {};
        
        // 包班匹配（包班=志願1）
        if (prefs.bundleShift === shiftCode || prefs.favShift === shiftCode) {
            return 100;
        }
        
        // 志願2匹配
        if (prefs.favShift2 === shiftCode) {
            return 80;
        }
        
        // 志願3匹配
        if (prefs.favShift3 === shiftCode) {
            return 60;
        }
        
        // 其他
        return 0;
    }
    
    /**
     * 階段4：回溯2（深度回溯，調整前幾天的排班）
     */
    stage4_Backtrack2(day) {
        console.log(`  🔙 階段4：回溯2（第 ${day} 天）`);
        
        // 檢查是否有缺額
        const shortages = this.getShortages(day);
        if (shortages.length === 0) {
            console.log(`    ✅ 無缺額，跳過階段4`);
            return;
        }
        
        // 取得回溯深度
        const backtrackDepth = this.rules?.aiParams?.backtrack_depth || 3;
        console.log(`    回溯深度: ${backtrackDepth} 天`);
        
        // 按班別優先度逐一處理缺額
        for (let shortage of shortages) {
            const shiftCode = shortage.shift;
            const need = shortage.need;
            
            console.log(`    處理 ${shiftCode} 班缺額 ${need} 人`);
            
            let resolved = false;
            
            // 逐步增加回溯深度
            for (let depth = 1; depth <= backtrackDepth && !resolved; depth++) {
                const adjustDay = day - depth;
                
                // 檢查是否在當月範圍內
                if (adjustDay < 1) {
                    console.log(`      ⚠️ 回溯 ${depth} 天超出當月範圍，跳過`);
                    continue;
                }
                
                console.log(`      嘗試回溯 ${depth} 天（調整 Day ${adjustDay}）`);
                
                // 嘗試調整這一天
                resolved = this.tryAdjustDay(adjustDay, day, shiftCode);
                
                if (resolved) {
                    console.log(`      ✅ 回溯 ${depth} 天成功`);
                    break;
                }
            }
            
            if (!resolved) {
                console.log(`    ❌ ${shiftCode} 班無法補足，需要管理者調整`);
            }
        }
    }
    
    /**
     * 取得當日缺額列表
     */
    getShortages(day) {
        const dateStr = this.getDateKey(day);
        const dayOfWeek = this.getDayOfWeek(day);
        const needsList = this.calculateDailyNeeds(day, dateStr, dayOfWeek);
        const shiftOrder = this.getShiftOrderByPriority();
        
        const shortages = [];
        for (let shiftCode of shiftOrder) {
            const needItem = needsList.find(n => n.shift === shiftCode);
            if (!needItem) continue;
            
            const N1 = needItem.need;
            const N2 = this.dailyCount[day][shiftCode] || 0;
            
            if (N1 > N2) {
                shortages.push({
                    shift: shiftCode,
                    need: N1 - N2
                });
            }
        }
        
        return shortages;
    }
    
    /**
     * 嘗試調整某一天來補足當前天的缺額
     */
    tryAdjustDay(adjustDay, currentDay, targetShift) {
        // 找adjustDay上班的人（逐一嘗試）
        const workingStaff = [];
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const shift = this.assignments[uid]?.[`current_${adjustDay}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                workingStaff.push({
                    uid: uid,
                    staff: staff,
                    shift: shift
                });
            }
        }
        
        // 逐一嘗試改每個人為OFF
        for (let item of workingStaff) {
            const uid = item.uid;
            const staff = item.staff;
            const originalShift = item.shift;
            
            // 找adjustDay的排班OFF人員（可以頂替）
            const replacement = this.findReplacement(adjustDay, originalShift);
            
            if (!replacement) {
                continue; // 找不到替補，嘗試下一個人
            }
            
            // 備份
            const backup = this.backupAssignments(adjustDay, currentDay);
            
            // 執行交換
            this.assignments[uid][`current_${adjustDay}`] = 'OFF';
            this.assignments[replacement.uid][`current_${adjustDay}`] = originalShift;
            
            // 重新執行adjustDay的階段2-3
            this.rerunStages23(adjustDay);
            
            // 檢查adjustDay是否有缺額
            const adjustDayShortages = this.getShortages(adjustDay);
            if (adjustDayShortages.length > 0) {
                // adjustDay產生缺額，失敗
                this.restoreAssignments(backup);
                continue;
            }
            
            // 重新執行adjustDay+1到currentDay的階段1-3
            for (let d = adjustDay + 1; d <= currentDay; d++) {
                this.rerunStages123(d);
            }
            
            // 檢查targetShift是否補足
            const dateStr = this.getDateKey(currentDay);
            const dayOfWeek = this.getDayOfWeek(currentDay);
            const needsList = this.calculateDailyNeeds(currentDay, dateStr, dayOfWeek);
            const needItem = needsList.find(n => n.shift === targetShift);
            
            if (needItem) {
                const N1 = needItem.need;
                const N2 = this.dailyCount[currentDay][targetShift] || 0;
                
                if (N2 >= N1) {
                    // 成功補足
                    return true;
                }
            }
            
            // 失敗，恢復
            this.restoreAssignments(backup);
        }
        
        return false;
    }
    
    /**
     * 找可以頂替的排班OFF人員
     */
    findReplacement(day, targetShift) {
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const shift = this.assignments[uid]?.[`current_${day}`];
            
            // 只找排班OFF
            if (shift !== 'OFF') continue;
            
            // 計算白名單
            const whitelist = WhitelistCalculator.calculate(
                staff,
                this.assignments,
                day,
                this.year,
                this.month,
                this.rules,
                this.dailyCount[day],
                this.daysInMonth,
                this.shiftTimeMap,
                this.lastMonthData
            );
            
            if (whitelist.includes(targetShift)) {
                return {
                    uid: uid,
                    staff: staff
                };
            }
        }
        
        return null;
    }
    
    /**
     * 備份assignments（從startDay到endDay）
     */
    backupAssignments(startDay, endDay) {
        const backup = {};
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            backup[uid] = {};
            for (let d = startDay; d <= endDay; d++) {
                const key = `current_${d}`;
                backup[uid][key] = this.assignments[uid][key];
            }
        }
        return backup;
    }
    
    /**
     * 恢復assignments
     */
    restoreAssignments(backup) {
        for (let uid in backup) {
            for (let key in backup[uid]) {
                this.assignments[uid][key] = backup[uid][key];
            }
        }
        
        // 重新計算dailyCount
        this.recalculateDailyCount();
    }
    
    /**
     * 重新計算dailyCount
     */
    recalculateDailyCount() {
        // 清空
        for (let day = 1; day <= this.daysInMonth; day++) {
            for (let shift of this.shifts) {
                this.dailyCount[day][shift.code] = 0;
            }
        }
        
        // 重新計算
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = this.assignments[uid]?.[`current_${day}`];
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    this.dailyCount[day][shift] = (this.dailyCount[day][shift] || 0) + 1;
                }
            }
        }
    }
    
    /**
     * 重新執行階段2-3
     */
    rerunStages23(day) {
        this.stage2_AdjustOff(day);
        this.stage3_Backtrack1(day);
    }
    
    /**
     * 重新執行階段1-3
     */
    rerunStages123(day) {
        // 清空當天的排班（保留預班）
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            const params = staff.schedulingParams || {};
            const preReq = params[`current_${day}`];
            
            if (!preReq || preReq === 'OFF') {
                // 沒有預班，清空
                delete this.assignments[uid][`current_${day}`];
            }
        }
        
        // 重新執行階段1-3
        this.stage1_FillAllShifts(day);
        this.stage2_AdjustOff(day);
        this.stage3_Backtrack1(day);
    }
    
    /**
     * 計算每個人的總OFF數（1號到31號）
     */
    calculateTotalOffCounts() {
        const counts = {};
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            let count = 0;
            for (let d = 1; d <= this.daysInMonth; d++) {
                const shift = this.assignments[uid]?.[`current_${d}`];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                    count++;
                }
            }
            counts[uid] = count;
        }
        return counts;
    }
    
    /**
     * 取得班別處理順序（大夜 → 小夜 → 白班）
     */
    getShiftOrderByPriority() {
        const order = [];
        
        // 大夜班（isNight = true）
        for (let shift of this.shifts) {
            if (shift.isNight === true) {
                order.push(shift.code);
            }
        }
        
        // 小夜班（isEvening = true）
        for (let shift of this.shifts) {
            if (shift.isEvening === true && shift.isNight !== true) {
                order.push(shift.code);
            }
        }
        
        // 白班（其他）
        for (let shift of this.shifts) {
            if (shift.isNight !== true && shift.isEvening !== true) {
                order.push(shift.code);
            }
        }
        
        return order;
    }
    
    /**
     * 步驟5：平衡調整（微調，不違反包班/志願）
     */
    step5_BalanceAdjustment() {
        console.log('\n⚖️ 步驟5：平衡調整');
        const rulesWithContext = { ...this.rules, year: this.year, month: this.month, lastMonthData: this.lastMonthData };
        BalanceAdjuster.adjust(this.assignments, this.allStaff, rulesWithContext, this.daysInMonth, this.shiftTimeMap);
    }
    
    /**
     * 計算當日需求
     */
    calculateDailyNeeds(day, dateStr, dayOfWeek) {
        const needsList = [];
        for (let shift of this.shifts) {
            let need = 0;
            if (this.specificNeeds[dateStr] && this.specificNeeds[dateStr][shift.code] !== undefined) {
                need = this.specificNeeds[dateStr][shift.code];
            } else {
                const key = `${shift.code}_${dayOfWeek}`;
                need = this.dailyNeeds[key] || 0;
            }
            if (need > 0) needsList.push({ shift: shift.code, need: need });
        }
        return needsList;
    }
    
    /**
     * 轉換為日期格式
     */
    convertToDateFormat() {
        const result = {};
        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = this.getDateKey(day);
            result[dateStr] = {};
            for (let shift of this.shifts) result[dateStr][shift.code] = [];
        }
        for (let staff of this.allStaff) {
            const uid = staff.uid || staff.id;
            for (let day = 1; day <= this.daysInMonth; day++) {
                const shift = this.assignments[uid][`current_${day}`];
                if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                    const dateStr = this.getDateKey(day);
                    if (result[dateStr][shift]) result[dateStr][shift].push(uid);
                }
            }
        }
        return result;
    }
}

console.log('✅ SchedulerV3 已載入 (階段1-4完整版)');
