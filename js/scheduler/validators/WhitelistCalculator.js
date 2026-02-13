// js/scheduler/validators/WhitelistCalculator.js

const WhitelistCalculator = {
    
    calculate: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        let whitelist = ['OFF', 'REQ_OFF'];
        
        for (let shift of Object.keys(shiftTimeMap)) {
            whitelist.push(shift);
        }
        
        whitelist = this.stage1_PreScheduledDays(whitelist, staff, assignments, day);
        whitelist = this.stage2_HardRules(whitelist, staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData);
        whitelist = this.stage3_BundleConstraints(whitelist, staff, assignments, day, lastMonthData, rules, daysInMonth);
        whitelist = this.stage4_PreferenceRatioLimits(whitelist, staff, assignments, day, rules, daysInMonth);
        
        return whitelist;
    },
    
    stage1_PreScheduledDays: function(whitelist, staff, assignments, day) {
        const uid = staff.uid || staff.id;
        const key = `current_${day}`;
        const preScheduled = assignments[uid]?.[key];
        
        if (preScheduled) {
            return [preScheduled];
        }
        
        return whitelist;
    },
    
    stage2_HardRules: function(whitelist, staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        
        if (rules.hard?.minGap11 !== false) {
            whitelist = this.filterByMinGap11(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData);
        }
        
        if (rules.hard?.maxDiversity3 !== false) {
            whitelist = this.filterByMaxDiversity3(whitelist, staff, assignments, day, year, month, rules);
        }
        
        if (rules.hard?.protectPregnant !== false) {
            whitelist = this.filterProtectPregnant(whitelist, staff, shiftTimeMap, rules);
        }
        
        if (rules.hard?.twoOffPerFortnight !== false) {
            whitelist = this.filterByTwoOffPerFortnight(whitelist, staff, assignments, day, daysInMonth);
        }
        
        return whitelist;
    },
    
    filterByMinGap11: function(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        
        let prevShift = null;
        if (day === 1) {
            prevShift = lastMonthData?.[uid]?.lastShift;
        } else {
            prevShift = assignments[uid]?.[`current_${day - 1}`];
        }
        
        if (!prevShift || prevShift === 'OFF' || prevShift === 'REQ_OFF') {
            return whitelist;
        }
        
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
    
    filterByMaxDiversity3: function(whitelist, staff, assignments, day, year, month, rules) {
        const uid = staff.uid || staff.id;
        const weekStartDay = rules.hard?.weekStartDay || 1;
        
        const weekRange = this.getWeekRange(day, year, month, weekStartDay);
        const shiftsThisWeek = new Set();
        
        for (let d = weekRange.start; d <= Math.min(weekRange.end, day - 1); d++) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                shiftsThisWeek.add(shift);
            }
        }
        
        if (shiftsThisWeek.size < 3) {
            return whitelist;
        }
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            return shiftsThisWeek.has(shift);
        });
    },
    
    filterProtectPregnant: function(whitelist, staff, shiftTimeMap, rules) {
        if (!staff.isPregnant && !staff.isBreastfeeding) {
            return whitelist;
        }
        
        const nightStart = this.parseTime(rules.policy?.nightStart || '22:00');
        const nightEnd = this.parseTime(rules.policy?.nightEnd || '06:00');
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            
            const shiftStart = this.parseTime(shiftTimeMap[shift]?.startTime);
            if (shiftStart === null) return true;
            
            const isNightShift = (nightStart > nightEnd) 
                ? (shiftStart >= nightStart || shiftStart <= nightEnd)
                : (shiftStart >= nightStart && shiftStart <= nightEnd);
            
            return !isNightShift;
        });
    },
    
    filterByTwoOffPerFortnight: function(whitelist, staff, assignments, day, daysInMonth) {
        const uid = staff.uid || staff.id;
        
        const fortnightStart = Math.max(1, day - 13);
        let offCount = 0;
        
        for (let d = fortnightStart; d < day; d++) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                offCount++;
            }
        }
        
        if (offCount >= 2) {
            return whitelist;
        }
        
        const remainingDays = Math.min(14, day + 13) - day + 1;
        const neededOffs = 2 - offCount;
        
        if (remainingDays <= neededOffs) {
            return whitelist.filter(shift => shift === 'OFF' || shift === 'REQ_OFF');
        }
        
        return whitelist;
    },
    
    stage3_BundleConstraints: function(whitelist, staff, assignments, day, lastMonthData, rules, daysInMonth) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};
        
        if (!prefs.bundleShift) return whitelist;
        
        const currentBundleShift = this.getCurrentBundleShift(staff, assignments, day, lastMonthData);
        
        if (!currentBundleShift) return whitelist;
        
        const consecutiveDays = this.countConsecutiveWorkDays(staff, assignments, day, lastMonthData);
        const maxConsDays = rules?.policy?.maxConsDays || 6;
        
        const hasLongVacation = this.checkLongVacation(staff, assignments, day, rules);
        const effectiveMaxConsDays = hasLongVacation 
            ? (rules?.policy?.longVacationWorkLimit || 7)
            : maxConsDays;
        
        if (consecutiveDays >= effectiveMaxConsDays) {
            return whitelist.filter(shift => shift === 'OFF' || shift === 'REQ_OFF');
        }
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            if (shift === currentBundleShift) return true;
            return false;
        });
    },
    
    getCurrentBundleShift: function(staff, assignments, day, lastMonthData) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};
        const newBundleShift = prefs.bundleShift;
        
        if (!newBundleShift) return null;
        
        const lastShift = lastMonthData?.[uid]?.lastShift;
        
        if (!lastShift || lastShift === 'OFF' || lastShift === 'REQ_OFF') {
            return newBundleShift;
        }
        
        if (lastShift === newBundleShift) {
            return newBundleShift;
        }
        
        const hasEncounteredOff = this.checkIfEncounteredOff(assignments, uid, day);
        
        if (hasEncounteredOff) {
            return newBundleShift;
        } else {
            return lastShift;
        }
    },
    
    checkIfEncounteredOff: function(assignments, uid, currentDay) {
        for (let d = 1; d < currentDay; d++) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                return true;
            }
        }
        return false;
    },
    
    countConsecutiveWorkDays: function(staff, assignments, day, lastMonthData) {
        const uid = staff.uid || staff.id;
        let count = 0;
        
        for (let d = day - 1; d >= 1; d--) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                return count;
            }
            count++;
        }
        
        if (count === day - 1 && lastMonthData?.[uid]) {
            const lastMonthDays = ['last_31', 'last_30', 'last_29', 'last_28', 'last_27', 'last_26'];
            
            for (let key of lastMonthDays) {
                const shift = lastMonthData[uid][key];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                    return count;
                }
                count++;
            }
        }
        
        return count;
    },
    
    checkLongVacation: function(staff, assignments, day, rules) {
        const uid = staff.uid || staff.id;
        const longVacationDays = rules?.policy?.longVacationDays || 7;
        
        let maxConsecutiveOff = 0;
        let currentConsecutiveOff = 0;
        
        for (let d = 1; d < day; d++) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                currentConsecutiveOff++;
                maxConsecutiveOff = Math.max(maxConsecutiveOff, currentConsecutiveOff);
            } else {
                currentConsecutiveOff = 0;
            }
        }
        
        return maxConsecutiveOff >= longVacationDays;
    },
    
    stage4_PreferenceRatioLimits: function(whitelist, staff, assignments, day, rules, daysInMonth) {
        if (!rules.policy?.enablePrefRatio) {
            return whitelist;
        }
        
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};
        
        const avgOff = rules.avgOff || 9;
        const workableDays = daysInMonth - avgOff;
        
        const pref1Limit = Math.floor(workableDays * (rules.policy.prefRatio1 || 50) / 100);
        const pref2Limit = Math.floor(workableDays * (rules.policy.prefRatio2 || 30) / 100);
        const pref3Limit = Math.floor(workableDays * (rules.policy.prefRatio3 || 20) / 100);
        
        const pref1Count = this.countShiftDays(assignments, uid, prefs.favShift, day);
        const pref2Count = this.countShiftDays(assignments, uid, prefs.favShift2, day);
        const pref3Count = this.countShiftDays(assignments, uid, prefs.favShift3, day);
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            if (shift === prefs.favShift && pref1Count >= pref1Limit) return false;
            if (shift === prefs.favShift2 && pref2Count >= pref2Limit) return false;
            if (shift === prefs.favShift3 && pref3Count >= pref3Limit) return false;
            return true;
        });
    },
    
    countShiftDays: function(assignments, uid, shiftCode, upToDay) {
        if (!shiftCode) return 0;
        
        let count = 0;
        for (let d = 1; d < upToDay; d++) {
            const key = `current_${d}`;
            if (assignments[uid]?.[key] === shiftCode) {
                count++;
            }
        }
        return count;
    },
    
    getWeekRange: function(day, year, month, weekStartDay) {
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        const adjustedDay = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;
        const adjustedStart = (weekStartDay === 0) ? 6 : weekStartDay - 1;
        
        let daysFromWeekStart = (adjustedDay - adjustedStart + 7) % 7;
        const weekStart = day - daysFromWeekStart;
        const weekEnd = weekStart + 6;
        
        return { start: Math.max(1, weekStart), end: weekEnd };
    },
    
    parseTime: function(timeStr) {
        if (!timeStr) return null;
        const parts = timeStr.split(':');
        if (parts.length < 2) return null;
        const h = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        if (isNaN(h) || isNaN(m)) return null;
        return h + m / 60;
    }
};

console.log('✅ WhitelistCalculator 已載入');
