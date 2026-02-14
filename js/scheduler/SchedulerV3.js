// js/scheduler/SchedulerV3.js

class SchedulerV3 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        console.log('🚀 SchedulerV3 初始化 (階段1全部填班 + 階段2調整OFF)');
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
            
            // 逐日處理：每天都執行「階段1 + 階段2」
            for (let day = 1; day <= this.daysInMonth; day++) {
                console.log(`\n📅 處理第 ${day} 天`);
                
                // 階段1：全部填班
                this.stage1_FillAllShifts(day);
                
                // 階段2：調整OFF
                this.stage2_AdjustOff(day);
            }
            
            // 步驟3：平衡調整 (微調，不違反包班/志願)
            this.step3_BalanceAdjustment();
            
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
                console.log(`    ❌ ${shiftCode} 班不足 ${shortage} 人，需要回溯處理`);
                // TODO: 回溯處理（後續實作）
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
        
        // 按總OFF數排序（少 → 多）
        candidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) {
                return a.totalOff - b.totalOff;
            }
            // 總OFF數相同時，隨機排序
            return Math.random() - 0.5;
        });
        
        // 選前 excess 個人改OFF
        for (let i = 0; i < excess && i < candidates.length; i++) {
            const uid = candidates[i].uid;
            console.log(`      → ${candidates[i].staff.name || uid} (總OFF=${candidates[i].totalOff}) 改為 OFF`);
            this.assignments[uid][key] = 'OFF';
            this.dailyCount[day][shiftCode]--;
        }
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
     * 步驟3：平衡調整（微調，不違反包班/志願）
     */
    step3_BalanceAdjustment() {
        console.log('\n⚖️ 步驟3：平衡調整');
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

console.log('✅ SchedulerV3 已載入 (階段1全部填班 + 階段2調整OFF)');
