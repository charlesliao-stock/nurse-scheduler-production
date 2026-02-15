// js/scheduler/validators/WhitelistCalculator.js

const WhitelistCalculator = {
    
    /**
     * 計算白名單 - 階段1用
     * @param {Object} staff - 人員資料
     * @param {Object} assignments - 當前排班結果
     * @param {Number} day - 當前日期
     * @param {Number} year - 年份
     * @param {Number} month - 月份
     * @param {Object} rules - 排班規則
     * @param {Object} dailyCount - 當日班別計數
     * @param {Number} daysInMonth - 本月天數
     * @param {Object} shiftTimeMap - 班別時間對照表
     * @param {Object} lastMonthData - 上月資料
     * @returns {Array} 白名單陣列
     */
    calculate: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};
        
        // === Step 1: 檢查預班 ===
        const key = `current_${day}`;
        const preScheduled = assignments[uid]?.[key];
        if (preScheduled) {
            return [preScheduled];
        }
        
        // === Step 2: 判斷是「階段1-1」還是「階段1-2」 ===
        const shouldContinueLastMonth = this.shouldContinueLastMonth(staff, assignments, day, lastMonthData);
        
        if (shouldContinueLastMonth) {
            // 階段1-1：延續上月班別
            return this.calculateStage1_1(staff, assignments, day, rules, shiftTimeMap, lastMonthData, daysInMonth);
        } else {
            // 階段1-2：正常排班邏輯
            return this.calculateStage1_2(staff, assignments, day, rules, shiftTimeMap, lastMonthData, daysInMonth);
        }
    },
    
    /**
     * 判斷是否應該「延續上月班別」
     * 條件：(當前日期 ≤ 7) AND (上月最後一天 ≠ OFF OR 本月還沒遇到第一個 OFF)
     */
    shouldContinueLastMonth: function(staff, assignments, day, lastMonthData) {
        if (day > 7) return false;
        
        const uid = staff.uid || staff.id;
        const lastShift = lastMonthData?.[uid]?.lastShift;
        
        // 如果上月最後一天是 OFF，直接進入階段1-2
        if (!lastShift || lastShift === 'OFF' || lastShift === 'REQ_OFF') {
            return false;
        }
        
        // 檢查本月1號到前一天是否已經遇到第一個 OFF
        for (let d = 1; d < day; d++) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                return false; // 已經遇到第一個 OFF，進入階段1-2
            }
        }
        
        return true; // 延續上月班別
    },
    
    /**
     * 階段1-1：延續上月班別
     * 白名單 = [上月班別, OFF]
     */
    calculateStage1_1: function(staff, assignments, day, rules, shiftTimeMap, lastMonthData, daysInMonth) {
        const uid = staff.uid || staff.id;
        
        // 1. 檢查連續上班天數
        const consecutiveDays = this.countConsecutiveWorkDays(staff, assignments, day, lastMonthData);
        const maxConsDays = rules?.policy?.maxConsDays || 7;
        if (consecutiveDays >= maxConsDays) {
            return ['OFF'];
        }
        
        // 2. 取得上月最後一天的班別
        const lastShift = lastMonthData?.[uid]?.lastShift;
        if (!lastShift || lastShift === 'OFF' || lastShift === 'REQ_OFF') {
            return ['OFF'];
        }
        
        // 3. 白名單 = [上月班別, OFF]
        let whitelist = [lastShift, 'OFF'];
        
        // 4. 檢查11小時休息（往前）
        if (rules.hard?.minGap11 !== false) {
            whitelist = this.filterByMinGap11Forward(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData);
        }
        
        // 5. 檢查11小時休息（往後）
        if (rules.hard?.minGap11 !== false && day < daysInMonth) {
            whitelist = this.filterByMinGap11Backward(whitelist, staff, assignments, day, shiftTimeMap, rules);
        }
        
        return whitelist;
    },
    
    /**
     * 階段1-2：正常排班邏輯
     * 初始白名單 = [所有單位可排的班別, OFF]
     * → 排除孕/哺禁班
     * → 排除11小時不足的班（往前）
     * → 排除11小時不足的班（往後，must模式）
     * → 保留包班或志願班
     */
    calculateStage1_2: function(staff, assignments, day, rules, shiftTimeMap, lastMonthData, daysInMonth) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};
        
        // === Step 2.2: 檢查連續上班天數 ===
        const consecutiveDays = this.countConsecutiveWorkDays(staff, assignments, day, lastMonthData);
        const maxConsDays = rules?.policy?.maxConsDays || 7;
        if (consecutiveDays >= maxConsDays) {
            return ['OFF'];
        }
        
        // === Step 2.3: 建立初始白名單 ===
        // 所有單位可排的班別
        const allShifts = (rules.shifts || [])
            .filter(s => s.isScheduleAvailable !== false)
            .map(s => s.code);
        
        let whitelist = [...allShifts, 'OFF'];
        
        // === Step 2.4.1: 排除孕/哺禁班 ===
        if (rules.hard?.protectPregnant !== false && (staff.isPregnant || staff.isBreastfeeding)) {
            whitelist = this.filterProtectPregnant(whitelist, shiftTimeMap, rules);
        }
        
        // === Step 2.4.2: 排除11小時休息不足的班（往前檢查）===
        if (rules.hard?.minGap11 !== false) {
            whitelist = this.filterByMinGap11Forward(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData);
        }
        
        // === Step 2.4.3: 排除11小時休息不足的班（往後檢查，must模式）===
        if (rules.hard?.minGap11 !== false && day < daysInMonth) {
            whitelist = this.filterByMinGap11Backward(whitelist, staff, assignments, day, shiftTimeMap, rules);
        }
        
        // === Step 2.4.4: 保留包班或志願班 ===
        if (prefs.bundleShift) {
            // 有包班：只保留包班 + OFF
            whitelist = whitelist.filter(s => s === prefs.bundleShift || s === 'OFF' || s === 'REQ_OFF');
        } else {
            // 有志願：只保留志願1/2/3 + OFF
            const favShifts = [];
            if (prefs.favShift) favShifts.push(prefs.favShift);
            if (prefs.favShift2) favShifts.push(prefs.favShift2);
            if (prefs.favShift3) favShifts.push(prefs.favShift3);
            
            if (favShifts.length > 0) {
                whitelist = whitelist.filter(s => 
                    favShifts.includes(s) || s === 'OFF' || s === 'REQ_OFF'
                );
            }
        }
        
        return whitelist;
    },
    
    /**
     * 過濾：11小時休息間隔（往前檢查：Day-1 → Day）
     */
    filterByMinGap11Forward: function(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        let prevShift = (day === 1) ? lastMonthData?.[uid]?.lastShift : assignments[uid]?.[`current_${day - 1}`];
        
        if (!prevShift || prevShift === 'OFF' || prevShift === 'REQ_OFF') return whitelist;
        
        const prevEnd = this.parseTime(shiftTimeMap[prevShift]?.endTime);
        if (prevEnd === null) return whitelist;
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            const currStart = this.parseTime(shiftTimeMap[shift]?.startTime);
            if (currStart === null) return true;
            let gap = currStart - prevEnd;
            if (gap < 0) gap += 24;
            return gap >= 11;
        });
    },
    
    /**
     * 過濾：11小時休息間隔（往後檢查：Day → Day+1）
     * 只在 must 模式下排除班別
     */
    filterByMinGap11Backward: function(whitelist, staff, assignments, day, shiftTimeMap, rules) {
        const uid = staff.uid || staff.id;
        const nextShift = assignments[uid]?.[`current_${day + 1}`];
        
        // 如果隔天沒有班或是OFF，不需要檢查
        if (!nextShift || nextShift === 'OFF' || nextShift === 'REQ_OFF') return whitelist;
        
        // 檢查承諾等級
        const commitmentLevel = rules?.policy?.prioritizePreReq || 'must';
        
        // 只在 must 模式下排除
        if (commitmentLevel !== 'must') {
            return whitelist; // 非must模式：保留所有班別，以當日需求為主
        }
        
        // must 模式：排除會違反隔天預班的班別
        const nextStart = this.parseTime(shiftTimeMap[nextShift]?.startTime);
        if (nextStart === null) return whitelist;
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            const currEnd = this.parseTime(shiftTimeMap[shift]?.endTime);
            if (currEnd === null) return true;
            let gap = nextStart - currEnd;
            if (gap < 0) gap += 24;
            return gap >= 11;
        });
    },
    
    /**
     * 過濾：孕婦/哺乳保護（不排大夜）
     */
    filterProtectPregnant: function(whitelist, shiftTimeMap, rules) {
        const nightStart = this.parseTime(rules.policy?.nightStart || '22:00');
        const nightEnd = this.parseTime(rules.policy?.nightEnd || '06:00');
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            const start = this.parseTime(shiftTimeMap[shift]?.startTime);
            if (start === null) return true;
            const isNight = (nightStart > nightEnd) ? (start >= nightStart || start <= nightEnd) : (start >= nightStart && start <= nightEnd);
            return !isNight;
        });
    },
    
    /**
     * 計算連續上班天數
     */
    countConsecutiveWorkDays: function(staff, assignments, day, lastMonthData) {
        const uid = staff.uid || staff.id;
        let count = 0;
        
        // 往前檢查本月的連續上班天數
        for (let d = day - 1; d >= 1; d--) {
            const s = assignments[uid]?.[`current_${d}`];
            if (!s || s === 'OFF' || s === 'REQ_OFF') break;
            count++;
        }
        
        // 如果本月從1號開始都在上班，繼續檢查上月
        if (count === day - 1 && lastMonthData?.[uid]) {
            const lastDays = ['last_31', 'last_30', 'last_29', 'last_28', 'last_27', 'last_26'];
            for (let k of lastDays) {
                const s = lastMonthData[uid][k];
                if (!s || s === 'OFF' || s === 'REQ_OFF') break;
                count++;
            }
        }
        
        return count;
    },
    
    /**
     * 解析時間字串為小時數
     */
    parseTime: function(timeStr) {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        return h + m / 60;
    }
};

console.log('✅ WhitelistCalculator 已載入 (階段1-1 + 階段1-2 + 雙向11小時檢查)');
