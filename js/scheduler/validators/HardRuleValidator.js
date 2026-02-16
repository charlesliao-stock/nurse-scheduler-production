// js/scheduler/validators/HardRuleValidator.js

const HardRuleValidator = {
    
    validateMinGap11Hours: function(lastShift, currentShift, shiftTimeMap) {
        if (!lastShift || lastShift === 'OFF' || lastShift === 'REQ_OFF') return true;
        if (!currentShift || currentShift === 'OFF' || currentShift === 'REQ_OFF') return true;
        
        const last = shiftTimeMap[lastShift];
        const curr = shiftTimeMap[currentShift];
        
        if (!last || !curr) return true;
        
        let lastEnd = last.end;
        let currStart = curr.start;
        
        if (lastEnd < last.start) lastEnd += 24;
        if (currStart < lastEnd) currStart += 24;
        
        const gap = currStart - lastEnd;
        return gap >= 11;
    },
    
    /**
     * 驗證單週班別種類不超過2種（以下班時間區分）
     */
    validateMaxDiversity2: function(assignments, uid, day, newShift, rules, year, month) {
        // 相容舊版 maxDiversity3，優先使用新版 maxDiversity2
        const isDiversityCheckEnabled = (rules?.hard?.maxDiversity2 !== undefined) ? 
            rules.hard.maxDiversity2 : (rules?.hard?.maxDiversity3 !== false);
        
        if (!isDiversityCheckEnabled) return true;
        if (!newShift || newShift === 'OFF' || newShift === 'REQ_OFF') return true;
        
        const weekStartDay = rules.hard?.weekStartDay || 1;
        const weekStart = this.getWeekStart(day, year, month, weekStartDay);
        const daysInMonth = new Date(year, month, 0).getDate();
        const weekEnd = Math.min(weekStart + 6, daysInMonth);
        
        // 收集本週已排的班別分類（以下班時間）
        const categoriesThisWeek = new Set();
        
        for (let d = weekStart; d <= weekEnd; d++) {
            if (d === day) continue; // 不包含當天
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                const category = this.getShiftCategory(shift, rules);
                if (category !== null) {
                    categoriesThisWeek.add(category);
                }
            }
        }
        
        // 加入新班別的分類
        const newCategory = this.getShiftCategory(newShift, rules);
        if (newCategory !== null) {
            categoriesThisWeek.add(newCategory);
        }
        
        // 檢查是否超過2種
        return categoriesThisWeek.size <= 2;
    },
    
    /**
     * 取得班別分類（以下班時間的小時數）
     */
    getShiftCategory: function(shiftCode, rules) {
        if (!shiftCode || shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return null;
        
        const shifts = rules.shifts || [];
        const shift = shifts.find(s => s.code === shiftCode);
        
        if (!shift || !shift.endTime) return null;
        
        // 提取下班時間的小時數（忽略分鐘）
        const [hour] = shift.endTime.split(':').map(Number);
        return hour;
    },
    
    /**
     * 計算週的起始日（月內第幾天）
     */
    getWeekStart: function(day, year, month, weekStartDay) {
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay(); // 0=週日, 1=週一, ..., 6=週六
        
        // 計算距離週起始日的天數差
        let daysFromWeekStart;
        if (weekStartDay === 1) {
            // 週一起算
            daysFromWeekStart = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);
        } else {
            // 週日起算
            daysFromWeekStart = dayOfWeek;
        }
        
        const weekStart = day - daysFromWeekStart;
        return Math.max(1, weekStart);
    },
    
    validateProtectPregnant: function(staff, shift, rules) {
        if (!rules?.hard?.protectPregnant) return true;
        
        const params = staff.schedulingParams || {};
        const today = new Date();
        
        const isPregnant = params.isPregnant && 
                          params.pregnantExpiry && 
                          new Date(params.pregnantExpiry) >= today;
        
        if (!isPregnant) return true;
        
        return shift === 'OFF' || shift === 'REQ_OFF' || !this.isNightShift(shift, rules);
    },
    
    validateProtectBreastfeeding: function(staff, shift, rules) {
        if (!rules?.hard?.protectPregnant) return true;
        
        const params = staff.schedulingParams || {};
        const today = new Date();
        
        const isBreastfeeding = params.isBreastfeeding && 
                               params.breastfeedingExpiry && 
                               new Date(params.breastfeedingExpiry) >= today;
        
        if (!isBreastfeeding) return true;
        
        return shift === 'OFF' || shift === 'REQ_OFF' || !this.isNightShift(shift, rules);
    },
    
    validateTwoOffPerFortnight: function(assignments, uid, day, newShift, rules, daysInMonth) {
        if (!rules?.hard?.twoOffPerFortnight) return true;
        if (newShift !== 'OFF' && newShift !== 'REQ_OFF') return true;
        
        const fortnightStart = Math.max(1, day - 13);
        let offCount = 0;
        
        for (let d = fortnightStart; d <= day; d++) {
            const shift = (d === day) ? newShift : assignments[uid]?.[`current_${d}`];
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                offCount++;
            }
        }
        
        return offCount <= 2;
    },
    
    validateOffGapMax: function(assignments, uid, day, newShift, rules, daysInMonth) {
        if (!rules?.hard?.offGapMax) return true;
        
        const maxGap = rules.hard.offGapMax || 12;
        
        if (newShift === 'OFF' || newShift === 'REQ_OFF') return true;
        
        let lastOffDay = 0;
        for (let d = day - 1; d >= 1; d--) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                lastOffDay = d;
                break;
            }
        }
        
        if (lastOffDay === 0) return true;
        
        const gap = day - lastOffDay;
        return gap <= maxGap;
    },
    
    validateConsecutiveWorkLimit: function(assignments, uid, day, newShift, rules, daysInMonth) {
        if (!rules?.policy?.limitConsecutive) return true;
        if (newShift === 'OFF' || newShift === 'REQ_OFF') return true;
        
        const maxDays = rules.policy?.maxConsDays || 6;
        
        let consecutiveCount = 1;
        for (let d = day - 1; d >= 1; d--) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                consecutiveCount++;
            } else {
                break;
            }
        }
        
        return consecutiveCount <= maxDays;
    },
    
    isNightShift: function(shiftCode, rules) {
        if (!shiftCode || shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return false;
        
        const shifts = rules.shifts || [];
        const shift = shifts.find(s => s.code === shiftCode);
        
        if (!shift) return false;
        if (shift.isNight !== undefined) return shift.isNight;
        
        const start = this.parseTime(shift.startTime);
        return start >= 22 || start <= 6;
    },
    
    parseTime: function(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h + m / 60;
    },
    
    validateAll: function(staff, assignments, day, shift, lastShift, rules, shiftTimeMap, daysInMonth, year, month) {
        const uid = staff.uid || staff.id;
        
        if (!this.validateMinGap11Hours(lastShift, shift, shiftTimeMap)) {
            return { valid: false, reason: '未滿11小時休息' };
        }
        
        if (!this.validateMaxDiversity2(assignments, uid, day, shift, rules, year, month)) {
            return { valid: false, reason: '週內班別超過2種' };
        }
        
        if (!this.validateProtectPregnant(staff, shift, rules)) {
            return { valid: false, reason: '孕婦不可排夜班' };
        }
        
        if (!this.validateProtectBreastfeeding(staff, shift, rules)) {
            return { valid: false, reason: '哺乳期不可排夜班' };
        }
        
        if (!this.validateConsecutiveWorkLimit(assignments, uid, day, shift, rules, daysInMonth)) {
            return { valid: false, reason: '超過連續工作上限' };
        }
        
        if (!this.validateOffGapMax(assignments, uid, day, shift, rules, daysInMonth)) {
            return { valid: false, reason: '超過OFF間隔上限' };
        }
        
        return { valid: true };
    }
};

console.log('✅ HardRuleValidator 已載入 (單週2種班別限制)');
