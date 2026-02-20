// js/scheduler/validators/WhitelistCalculator.js
const WhitelistCalculator = {
    /**
     * 計算白名單 - 階段1用
     */
    calculate: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};

        // === Step 1: 檢查預班 ===
        const key = `current_${day}`;
        const preScheduled = assignments[uid]?.[key];
        if (preScheduled) {
            // 注意：預班在 manager 端已進行 11 小時與孕哺夜班檢查
            return [preScheduled];
        }

        // === Step 2: 判斷是「階段1-1」還是「階段1-2」 ===
        const shouldContinueLastMonth = this.shouldContinueLastMonth(staff, assignments, day, lastMonthData);
        if (shouldContinueLastMonth) {
            return this.calculateStage1_1(staff, assignments, day, year, month, rules, shiftTimeMap, lastMonthData, daysInMonth);
        } else {
            return this.calculateStage1_2(staff, assignments, day, year, month, rules, shiftTimeMap, lastMonthData, daysInMonth);
        }
    },

    shouldContinueLastMonth: function(staff, assignments, day, lastMonthData) {
        if (day > 7) return false;
        const uid = staff.uid || staff.id;
        const lastShift = lastMonthData?.[uid]?.lastShift;
        if (!lastShift || lastShift === 'OFF' || lastShift === 'REQ_OFF') return false;
        for (let d = 1; d < day; d++) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') return false;
        }
        return true;
    },

    calculateStage1_1: function(staff, assignments, day, year, month, rules, shiftTimeMap, lastMonthData, daysInMonth) {
        const uid = staff.uid || staff.id;
        const consecutiveDays = this.countConsecutiveWorkDays(staff, assignments, day, lastMonthData);
        const maxConsDays = rules?.policy?.maxConsDays || 7;
        if (consecutiveDays >= maxConsDays) return ['OFF'];

        const lastShift = lastMonthData?.[uid]?.lastShift;
        if (!lastShift || lastShift === 'OFF' || lastShift === 'REQ_OFF') return ['OFF'];

        let whitelist = [lastShift, 'OFF'];

        if (rules.hard?.minGap11 !== false) {
            whitelist = this.filterByMinGap11Forward(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData);
        }
        if (rules.hard?.minGap11 !== false && day < daysInMonth) {
            whitelist = this.filterByMinGap11Backward(whitelist, staff, assignments, day, shiftTimeMap, rules);
        }
        if (rules.hard?.maxDiversity2 !== false) {
            whitelist = this.filterByMaxDiversity2(whitelist, staff, assignments, day, year, month, rules, shiftTimeMap);
        }
        return whitelist;
    },

    calculateStage1_2: function(staff, assignments, day, year, month, rules, shiftTimeMap, lastMonthData, daysInMonth) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};

        const consecutiveDays = this.countConsecutiveWorkDays(staff, assignments, day, lastMonthData);
        const maxConsDays = rules?.policy?.maxConsDays || 7;
        if (consecutiveDays >= maxConsDays) return ['OFF'];

        const allShifts = (rules.shifts || [])
            .filter(s => s.isScheduleAvailable !== false)
            .map(s => s.code);
        let whitelist = [...allShifts, 'OFF'];

        // 孕婦/哺乳保護 (統一讀取 schedulingParams)
        const params = staff.schedulingParams || {};
        const today = new Date();
        const isPregnantNow = params.isPregnant && params.pregnantExpiry && new Date(params.pregnantExpiry) >= today;
        const isBreastfeedingNow = params.isBreastfeeding && params.breastfeedingExpiry && new Date(params.breastfeedingExpiry) >= today;

        if (rules.hard?.protectPregnant !== false && (isPregnantNow || isBreastfeedingNow)) {
            whitelist = this.filterProtectPregnant(whitelist, shiftTimeMap, rules);
        }

        if (rules.hard?.minGap11 !== false) {
            whitelist = this.filterByMinGap11Forward(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData);
        }
        if (rules.hard?.minGap11 !== false && day < daysInMonth) {
            whitelist = this.filterByMinGap11Backward(whitelist, staff, assignments, day, shiftTimeMap, rules);
        }
        if (rules.hard?.maxDiversity2 !== false) {
            whitelist = this.filterByMaxDiversity2(whitelist, staff, assignments, day, year, month, rules, shiftTimeMap);
        }

        if (prefs.bundleShift) {
            whitelist = whitelist.filter(s => s === prefs.bundleShift || s === 'OFF' || s === 'REQ_OFF');
        } else {
            const favShifts = [];
            if (prefs.favShift) favShifts.push(prefs.favShift);
            if (prefs.favShift2) favShifts.push(prefs.favShift2);
            if (prefs.favShift3) favShifts.push(prefs.favShift3);
            if (favShifts.length > 0) {
                whitelist = whitelist.filter(s => favShifts.includes(s) || s === 'OFF' || s === 'REQ_OFF');
            }
        }

        if (whitelist.length === 0) return ['OFF'];
        return whitelist;
    },

    filterByMaxDiversity2: function(whitelist, staff, assignments, day, year, month, rules, shiftTimeMap) {
        const uid = staff.uid || staff.id;
        const weekStartDay = rules.hard?.weekStartDay || 1;
        const weekRange = this.getWeekRange(day, year, month, weekStartDay);
        const weekShifts = [];
        for (let d = weekRange.start; d <= weekRange.end; d++) {
            if (d === day) continue;
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') weekShifts.push(shift);
        }
        if (weekShifts.length === 0) return whitelist;

        const existingCategories = new Set();
        for (let shift of weekShifts) {
            const cat = this.getShiftCategory(shift, shiftTimeMap);
            if (cat !== null) existingCategories.add(cat);
        }

        if (existingCategories.size >= 2) {
            return whitelist.filter(s => {
                if (s === 'OFF' || s === 'REQ_OFF') return true;
                const cat = this.getShiftCategory(s, shiftTimeMap);
                return existingCategories.has(cat);
            });
        }
        return whitelist;
    },

    getShiftCategory: function(shiftCode, shiftTimeMap) {
        const info = shiftTimeMap[shiftCode];
        if (!info || !info.endTime) return null;
        const [hour] = info.endTime.split(':').map(Number);
        return hour;
    },

    getWeekRange: function(day, year, month, weekStartDay) {
        const currentDate = new Date(year, month - 1, day);
        const dayOfWeek = currentDate.getDay();
        let daysFromWeekStart;
        if (weekStartDay === 1) {
            daysFromWeekStart = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);
        } else {
            daysFromWeekStart = dayOfWeek;
        }
        const weekStart = day - daysFromWeekStart;
        const daysInMonth = new Date(year, month, 0).getDate();
        return { start: Math.max(1, weekStart), end: Math.min(daysInMonth, weekStart + 6) };
    },

    filterByMinGap11Forward: function(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        let prevShift = (day === 1) ? lastMonthData?.[uid]?.lastShift : assignments[uid]?.[`current_${day - 1}`];
        if (!prevShift || prevShift === 'OFF' || prevShift === 'REQ_OFF') return whitelist;
        const prevEnd = this.parseTime(shiftTimeMap[prevShift]?.endTime);
        if (prevEnd === null) return whitelist;

        return whitelist.filter(s => {
            if (s === 'OFF' || s === 'REQ_OFF') return true;
            const start = this.parseTime(shiftTimeMap[s]?.startTime);
            if (start === null) return true;
            let gap = start - prevEnd;
            if (gap < 0) gap += 24;
            return gap >= 11;
        });
    },

    filterByMinGap11Backward: function(whitelist, staff, assignments, day, shiftTimeMap, rules) {
        const uid = staff.uid || staff.id;
        const nextShift = assignments[uid]?.[`current_${day + 1}`];
        if (!nextShift || nextShift === 'OFF' || nextShift === 'REQ_OFF') return whitelist;
        if ((rules?.policy?.prioritizePreReq || 'must') !== 'must') return whitelist;

        const nextStart = this.parseTime(shiftTimeMap[nextShift]?.startTime);
        if (nextStart === null) return whitelist;

        return whitelist.filter(s => {
            if (s === 'OFF' || s === 'REQ_OFF') return true;
            const end = this.parseTime(shiftTimeMap[s]?.endTime);
            if (end === null) return true;
            let gap = nextStart - end;
            if (gap < 0) gap += 24;
            return gap >= 11;
        });
    },

    filterProtectPregnant: function(whitelist, shiftTimeMap, rules) {
        return whitelist.filter(s => {
            if (s === 'OFF' || s === 'REQ_OFF') return true;
            const info = shiftTimeMap[s];
            if (!info || !info.startTime || !info.endTime) return true;

            const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
            const start = toMin(info.startTime);
            let end = toMin(info.endTime);
            if (end <= start) end += 1440;

            const forbidStart = 22 * 60;
            const forbidEnd = 1440 + 6 * 60;
            const isNight = !(end <= forbidStart || start >= forbidEnd);
            return !isNight;
        });
    },

    countConsecutiveWorkDays: function(staff, assignments, day, lastMonthData) {
        const uid = staff.uid || staff.id;
        let count = 0;
        for (let d = day - 1; d >= 1; d--) {
            const s = assignments[uid]?.[`current_${d}`];
            if (!s || s === 'OFF' || s === 'REQ_OFF') break;
            count++;
        }
        if (count === day - 1 && lastMonthData?.[uid]) {
            const lastDaysInMonth = lastMonthData._daysInMonth || 31;
            for (let d = lastDaysInMonth; d >= 1; d--) {
                const s = lastMonthData[uid][`last_${d}`] || lastMonthData[uid][d];
                if (!s || s === 'OFF' || s === 'REQ_OFF') break;
                count++;
            }
        }
        return count;
    },

    parseTime: function(timeStr) {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        return h + m / 60;
    }
};
console.log('✅ WhitelistCalculator 已更新 (統一讀取 schedulingParams + 孕哺夜班 22-06 精確區間判斷)');
