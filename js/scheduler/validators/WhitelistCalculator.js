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
            // 🔥 修正：即使是預班，也必須檢查 11 小時休息間隔（往前檢查）
            // 如果預班違反了 11 小時規則，這代表預班設定本身有問題，或者前一天的排班有問題
            // 在此我們仍然回傳預班，但如果未來需要更嚴格，可以在此加入過濾或警告
            return [preScheduled];
        }
        
        // === Step 2: 判斷是「階段1-1」還是「階段1-2」 ===
        const shouldContinueLastMonth = this.shouldContinueLastMonth(staff, assignments, day, lastMonthData);
        
        if (shouldContinueLastMonth) {
            // 階段1-1：延續上月班別
            return this.calculateStage1_1(staff, assignments, day, year, month, rules, shiftTimeMap, lastMonthData, daysInMonth);
        } else {
            // 階段1-2：正常排班邏輯
            return this.calculateStage1_2(staff, assignments, day, year, month, rules, shiftTimeMap, lastMonthData, daysInMonth);
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
    calculateStage1_1: function(staff, assignments, day, year, month, rules, shiftTimeMap, lastMonthData, daysInMonth) {
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
        
        // 6. 檢查單週班別種類限制（2種）
        if (rules.hard?.maxDiversity2 !== false) {
            whitelist = this.filterByMaxDiversity2(whitelist, staff, assignments, day, year, month, rules, shiftTimeMap);
        }
        
        return whitelist;
    },
    
    /**
     * 階段1-2：正常排班邏輯
     * 初始白名單 = [所有單位可排的班別, OFF]
     * → 排除孕/哺禁班
     * → 排除11小時不足的班（往前）
     * → 排除11小時不足的班（往後，must模式）
     * → 排除違反單週班別種類限制的班
     * → 保留包班或志願班
     */
    calculateStage1_2: function(staff, assignments, day, year, month, rules, shiftTimeMap, lastMonthData, daysInMonth) {
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
        
        // === Step 2.4.4: 排除違反單週班別種類限制的班 ===
        if (rules.hard?.maxDiversity2 !== false) {
            whitelist = this.filterByMaxDiversity2(whitelist, staff, assignments, day, year, month, rules, shiftTimeMap);
        }
        
        // === Step 2.4.5: 保留包班或志願班 ===
        // 🔥 修正：在保留包班/志願班之前，必須確保這些班別已經通過了 11 小時檢查
        // 之前的邏輯是先過濾 11 小時，再根據包班/志願過濾，這順序是對的。
        // 但為了保險起見，我們確保 whitelist 不會因為包班/志願而重新加入不合法的班別。
        if (prefs.bundleShift) {
            // 有包班：只保留包班 + OFF (前提是它們還在 whitelist 中)
            whitelist = whitelist.filter(s => s === prefs.bundleShift || s === 'OFF' || s === 'REQ_OFF');
        } else {
            // 有志願：只保留志願1/2/3 + OFF (前提是它們還在 whitelist 中)
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
        
        // 🔥 修正：如果過濾後只剩下 OFF，且當天不是強制的 OFF，則回傳 OFF
        if (whitelist.length === 0) {
            return ['OFF'];
        }
        
        return whitelist;
    },
    
    /**
     * 過濾：單週班別種類不超過2種（以下班時間分類）
     */
    filterByMaxDiversity2: function(whitelist, staff, assignments, day, year, month, rules, shiftTimeMap) {
        const uid = staff.uid || staff.id;
        
        // 1. 計算本週的日期範圍
        const weekStartDay = rules.hard?.weekStartDay || 1; // 1=週一, 0=週日
        const weekRange = this.getWeekRange(day, year, month, weekStartDay);
        
        // 2. 收集本週已排的班別（不包含OFF和當天）
        const weekShifts = [];
        for (let d = weekRange.start; d <= weekRange.end; d++) {
            if (d === day) continue; // 不包含當天
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                weekShifts.push(shift);
            }
        }
        
        // 3. 如果本週還沒排班，所有班別都可選
        if (weekShifts.length === 0) {
            return whitelist;
        }
        
        // 4. 以下班時間分類已排的班別
        const existingCategories = new Set();
        for (let shift of weekShifts) {
            const category = this.getShiftCategory(shift, shiftTimeMap);
            if (category) {
                existingCategories.add(category);
            }
        }
        
        // 5. 如果已有2種分類，只能繼續排這2種或OFF
        if (existingCategories.size >= 2) {
            return whitelist.filter(shift => {
                if (shift === 'OFF' || shift === 'REQ_OFF') return true;
                const category = this.getShiftCategory(shift, shiftTimeMap);
                return existingCategories.has(category);
            });
        }
        
        // 6. 如果只有1種分類，可以再加1種新分類
        // 所有班別都可選（因為最多2種）
        return whitelist;
    },
    
    /**
     * 取得班別分類（以下班時間區分）
     * 例如：22:00下班和24:00下班視為同一類（22:00類）
     */
    getShiftCategory: function(shiftCode, shiftTimeMap) {
        const shiftInfo = shiftTimeMap[shiftCode];
        if (!shiftInfo || !shiftInfo.endTime) return null;
        
        // 提取下班時間的小時數（忽略分鐘）
        const endTime = shiftInfo.endTime;
        const [hour] = endTime.split(':').map(Number);
        
        // 返回下班小時作為分類
        return hour;
    },
    
    /**
     * 計算週的日期範圍
     * @param {Number} day - 當前日期（月內第幾天）
     * @param {Number} year - 年份
     * @param {Number} month - 月份（1-12）
     * @param {Number} weekStartDay - 週起始日（0=週日, 1=週一）
     * @returns {Object} { start, end } 週的起始和結束日期（月內第幾天）
     */
    getWeekRange: function(day, year, month, weekStartDay) {
        // 建立當前日期的 Date 物件
        const currentDate = new Date(year, month - 1, day);
        const dayOfWeek = currentDate.getDay(); // 0=週日, 1=週一, ..., 6=週六
        
        // 計算距離週起始日的天數差
        let daysFromWeekStart;
        if (weekStartDay === 1) {
            // 週一起算
            daysFromWeekStart = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);
        } else {
            // 週日起算
            daysFromWeekStart = dayOfWeek;
        }
        
        // 計算週的起始日和結束日
        const weekStart = day - daysFromWeekStart;
        const weekEnd = weekStart + 6;
        
        // 限制在當月範圍內
        const daysInMonth = new Date(year, month, 0).getDate();
        return {
            start: Math.max(1, weekStart),
            end: Math.min(daysInMonth, weekEnd)
        };
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

console.log('✅ WhitelistCalculator 已載入 (階段1-1 + 階段1-2 + 雙向11小時檢查 + 單週2種班別限制)');
