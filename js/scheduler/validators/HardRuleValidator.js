// js/scheduler/validators/HardRuleValidator.js
const HardRuleValidator = {

    validateMinGap11Hours: function(lastShift, currentShift, shiftTimeMap) {
        if (!lastShift || lastShift === 'OFF' || lastShift === 'REQ_OFF') return true;
        if (!currentShift || currentShift === 'OFF' || currentShift === 'REQ_OFF') return true;

        const last = shiftTimeMap[lastShift];
        const curr = shiftTimeMap[currentShift];

        if (!last || !curr) return true;

        const lastEnd = last.end;
        const currStart = curr.start;

        // 修正：統一跨日計算邏輯
        let gap = currStart - lastEnd;
        if (gap <= 0) { // 間隔 <= 0 代表跨日（隔天）
            gap += 24;
        }

        return gap >= 11;
    },

    /**
     * 驗證單週班別種類不超過2種（以下班時間區分）
     */
    validateMaxDiversity2: function(assignments, uid, day, newShift, rules, year, month) {
        const isDiversityCheckEnabled = (rules?.hard?.maxDiversity2 !== undefined) ? 
            rules.hard.maxDiversity2 : (rules?.hard?.maxDiversity3 !== false);

        if (!isDiversityCheckEnabled) return true;
        if (!newShift || newShift === 'OFF' || newShift === 'REQ_OFF') return true;

        const weekStartDay = rules.hard?.weekStartDay || 1;
        const weekStart = this.getWeekStart(day, year, month, weekStartDay);
        const daysInMonth = new Date(year, month, 0).getDate();
        const weekEnd = Math.min(weekStart + 6, daysInMonth);

        const categoriesThisWeek = new Set();
        for (let d = weekStart; d <= weekEnd; d++) {
            if (d === day) continue;
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                const category = this.getShiftCategory(shift, rules);
                if (category !== null) categoriesThisWeek.add(category);
            }
        }

        const newCategory = this.getShiftCategory(newShift, rules);
        if (newCategory !== null) categoriesThisWeek.add(newCategory);

        return categoriesThisWeek.size <= 2;
    },

    getShiftCategory: function(shiftCode, rules) {
        if (!shiftCode || shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return null;
        const shifts = rules.shifts || [];
        const shift = shifts.find(s => s.code === shiftCode);
        if (!shift || !shift.endTime) return null;
        const [hour] = shift.endTime.split(':').map(Number);
        return hour;
    },

    getWeekStart: function(day, year, month, weekStartDay) {
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        let daysFromWeekStart;
        if (weekStartDay === 1) {
            daysFromWeekStart = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);
        } else {
            daysFromWeekStart = dayOfWeek;
        }
        const weekStart = day - daysFromWeekStart;
        return Math.max(1, weekStart);
    },

    validateProtectPregnant: function(staff, shift, rules) {
        if (rules?.hard?.protectPregnant === false) return true;
        const params = staff.schedulingParams || {};
        const today = new Date();
        const isPregnant = params.isPregnant && params.pregnantExpiry && new Date(params.pregnantExpiry) >= today;
        if (!isPregnant) return true;
        return shift === 'OFF' || shift === 'REQ_OFF' || !this.isNightTimeShift(shift, rules);
    },

    validateProtectBreastfeeding: function(staff, shift, rules) {
        if (rules?.hard?.protectPregnant === false) return true;
        const params = staff.schedulingParams || {};
        const today = new Date();
        const isBreastfeeding = params.isBreastfeeding && params.breastfeedingExpiry && new Date(params.breastfeedingExpiry) >= today;
        if (!isBreastfeeding) return true;
        return shift === 'OFF' || shift === 'REQ_OFF' || !this.isNightTimeShift(shift, rules);
    },

    validateOffGapMax: function(assignments, uid, day, newShift, rules, daysInMonth, lastMonthData) {
        if (!rules?.hard?.offGapMax) return true;
        const maxGap = rules.hard.offGapMax || 12;
        if (newShift === 'OFF' || newShift === 'REQ_OFF') return true;

        let lastOffDay = null;
        for (let d = day - 1; d >= 1; d--) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                lastOffDay = d;
                break;
            }
        }

        if (lastOffDay === null && lastMonthData) {
            const lastMonthAssign = lastMonthData[uid] || {};
            const lastMonthDays = lastMonthData._daysInMonth || 31;
            for (let d = lastMonthDays; d >= 1; d--) {
                const s = lastMonthAssign[`last_${d}`] || lastMonthAssign[d];
                if (s === 'OFF' || s === 'REQ_OFF') {
                    lastOffDay = -(lastMonthDays - d);
                    break;
                }
            }
        }

        if (lastOffDay === null) return true;
        const workingDaysBetween = day - lastOffDay - 1;
        return workingDaysBetween <= maxGap;
    },

    validateConsecutiveWorkLimit: function(assignments, uid, day, newShift, rules) {
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

    isNightTimeShift: function(shiftCode, rules) {
        if (!shiftCode || shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return false;
        const shifts = rules.shifts || [];
        const shift = shifts.find(s => s.code === shiftCode);
        if (!shift || !shift.startTime || !shift.endTime) return false;

        const toMinutes = t => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };

        const start = toMinutes(shift.startTime);
        let end = toMinutes(shift.endTime);
        if (end <= start) end += 1440;

        const forbidStart = 22 * 60;
        const forbidEnd = 1440 + 6 * 60;

        return !(end <= forbidStart || start >= forbidEnd);
    },

    validateAll: function(staff, assignments, day, shift, lastShift, rules, shiftTimeMap, daysInMonth, year, month, lastMonthData) {
        const uid = staff.uid || staff.id;

        if (!this.validateMinGap11Hours(lastShift, shift, shiftTimeMap)) {
            return { valid: false, reason: '未滿11小時休息' };
        }
        if (!this.validateMaxDiversity2(assignments, uid, day, shift, rules, year, month)) {
            return { valid: false, reason: '週內班別超過2種' };
        }
        if (!this.validateProtectPregnant(staff, shift, rules)) {
            return { valid: false, reason: '孕婦不可排夜班 (22:00-06:00)' };
        }
        if (!this.validateProtectBreastfeeding(staff, shift, rules)) {
            return { valid: false, reason: '哺乳期不可排夜班 (22:00-06:00)' };
        }
        if (!this.validateConsecutiveWorkLimit(assignments, uid, day, shift, rules)) {
            return { valid: false, reason: '超過連續工作上限' };
        }
        if (!this.validateOffGapMax(assignments, uid, day, shift, rules, daysInMonth, lastMonthData)) {
            return { valid: false, reason: '超過OFF間隔上限' };
        }
        return { valid: true };
    }
};
console.log('✅ HardRuleValidator 已更新 (含 OFF 間隔 12 天 + 孕哺夜班 22-06 精確判斷)');
