// js/scheduler/validators/WhitelistCalculator.js

const WhitelistCalculator = {
    
    /**
     * 🔥 修改：新增 lastMonthData 參數
     */
    calculate: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        const shifts = rules.shifts || [];
        const allShiftCodes = shifts.map(s => s.code);
        
        let hardWhitelist = [...allShiftCodes];
        
        hardWhitelist = this.stage1_PreScheduleLock(hardWhitelist, staff, assignments, day);
        
        hardWhitelist = this.stage2_HardRules(hardWhitelist, staff, assignments, day, rules, shiftTimeMap, daysInMonth);
        
        hardWhitelist = this.stage3_BundleConstraints(hardWhitelist, staff, assignments, day, lastMonthData, rules);
        
        hardWhitelist = this.stage4_SpecialIdentity(hardWhitelist, staff, rules);
        
        hardWhitelist = this.stage5_Preferences(hardWhitelist, staff, assignments, day, rules);
        
        if (!dailyCount) {
            return hardWhitelist;
        }

        let softWhitelist = this.stage6_SupplyDemand(hardWhitelist, staff, assignments, day, year, month, rules, dailyCount);
        
        if (softWhitelist.length === 0 || (softWhitelist.length === 1 && (softWhitelist[0] === 'OFF' || softWhitelist[0] === 'REQ_OFF'))) {
            if (rules?.policy?.enableRelaxation) {
                return hardWhitelist;
            }
        }
        
        return softWhitelist.length > 0 ? softWhitelist : hardWhitelist;
    },
    
    stage1_PreScheduleLock: function(whitelist, staff, assignments, day) {
        const uid = staff.uid || staff.id;
        const params = staff.schedulingParams || {};
        const preScheduled = params[`current_${day}`];
        
        if (preScheduled && preScheduled !== 'OFF') {
            return [preScheduled];
        }
        
        return whitelist;
    },
    
    stage2_HardRules: function(whitelist, staff, assignments, day, rules, shiftTimeMap, daysInMonth) {
        const uid = staff.uid || staff.id;
        const lastDay = day - 1;
        const lastShift = lastDay >= 1 ? assignments[uid]?.[`current_${lastDay}`] : null;
        
        return whitelist.filter(shift => {
            const result = HardRuleValidator.validateAll(
                staff, 
                assignments, 
                day, 
                shift, 
                lastShift, 
                rules, 
                shiftTimeMap, 
                daysInMonth
            );
            return result.valid;
        });
    },
    
    /**
     * 🔥 修改：包班切換邏輯
     */
    stage3_BundleConstraints: function(whitelist, staff, assignments, day, lastMonthData, rules) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};
        
        if (!prefs.bundleShift) return whitelist;
        
        const currentBundleShift = this.getCurrentBundleShift(staff, assignments, day, lastMonthData);
        
        if (!currentBundleShift) return whitelist;
        
        const consecutiveDays = this.countConsecutiveWorkDays(staff, assignments, day, lastMonthData);
        const maxConsDays = rules?.policy?.maxConsDays || 6;
        
        if (consecutiveDays >= maxConsDays) {
            return whitelist.filter(shift => shift === 'OFF' || shift === 'REQ_OFF');
        }
        
        const favoriteShifts = [];
        if (prefs.favShift) favoriteShifts.push(prefs.favShift);
        if (prefs.favShift2) favoriteShifts.push(prefs.favShift2);
        if (prefs.favShift3) favoriteShifts.push(prefs.favShift3);
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            if (shift === currentBundleShift) return true;
            if (favoriteShifts.includes(shift)) return true;
            return false;
        });
    },
    
    /**
     * 🔥 新增：判斷當前有效包班
     */
    getCurrentBundleShift: function(staff, assignments, day, lastMonthData) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};
        const newBundleShift = prefs.bundleShift;
        
        if (!newBundleShift) return null;
        
        const lastShift = lastMonthData?.[uid]?.lastShift || 'OFF';
        
        if (lastShift === 'OFF' || lastShift === 'REQ_OFF') {
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
    
    /**
     * 🔥 新增：檢查是否遇到 OFF
     */
    checkIfEncounteredOff: function(assignments, uid, currentDay) {
        for (let d = 1; d < currentDay; d++) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                return true;
            }
        }
        return false;
    },
    
    /**
     * 🔥 新增：計算連續上班天數（含上月）
     */
    countConsecutiveWorkDays: function(staff, assignments, day, lastMonthData) {
        const uid = staff.uid || staff.id;
        let count = 0;
        
        for (let d = day - 1; d >= 1; d--) {
            const shift = assignments[uid]?.[`current_${d}`];
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                count++;
            } else {
                return count;
            }
        }
        
        const lastMonthSchedule = lastMonthData?.[uid];
        if (!lastMonthSchedule) return count;
        
        for (let d = 31; d >= 26; d--) {
            const key = `last_${d}`;
            const shift = lastMonthSchedule[key];
            
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                count++;
            } else {
                break;
            }
        }
        
        return count;
    },
    
    stage4_SpecialIdentity: function(whitelist, staff, rules) {
        const params = staff.schedulingParams || {};
        const today = new Date();
        
        const isPGY = params.isPGY && 
                     params.pgyExpiry && 
                     new Date(params.pgyExpiry) >= today;
        
        if (!isPGY) return whitelist;
        
        if (!rules?.policy?.protectPGY) return whitelist;
        
        const pgyList = rules.policy.protectPGY_List || [];
        if (pgyList.length === 0) return whitelist;
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            return !pgyList.includes(shift);
        });
    },
    
    stage5_Preferences: function(whitelist, staff, assignments, day, rules) {
        const prefs = staff.preferences || {};
        
        const favShift = prefs.favShift;
        const favShift2 = prefs.favShift2;
        const favShift3 = prefs.favShift3;
        
        const avoidList = [];
        for (let d = 1; d <= 31; d++) {
            const key = `current_${d}`;
            const val = prefs[key];
            if (val && val.startsWith && val.startsWith('!')) {
                avoidList.push(val.substring(1));
            }
        }
        
        let preferred = [];
        if (favShift && whitelist.includes(favShift)) preferred.push(favShift);
        if (favShift2 && whitelist.includes(favShift2)) preferred.push(favShift2);
        if (favShift3 && whitelist.includes(favShift3)) preferred.push(favShift3);
        
        if (preferred.length > 0 && rules?.policy?.prioritizePref === 'must') {
            return preferred;
        }
        
        const filtered = whitelist.filter(shift => !avoidList.includes(shift));
        
        if (filtered.length > 0 && rules?.policy?.prioritizeAvoid === 'must') {
            return filtered;
        }
        
        return whitelist;
    },
    
    stage6_SupplyDemand: function(whitelist, staff, assignments, day, year, month, rules, dailyCount) {
        const dailyNeeds = rules.dailyNeeds || {};
        const specificNeeds = rules.specificNeeds || {};
        
        const dateStr = this.getDateKey(day, year, month);
        const dayOfWeek = this.getDayOfWeek(day, year, month);
        
        const result = [];
        
        for (let shift of whitelist) {
            if (shift === 'OFF' || shift === 'REQ_OFF') {
                result.push(shift);
                continue;
            }
            
            let need = 0;
            if (specificNeeds[dateStr] && specificNeeds[dateStr][shift] !== undefined) {
                need = specificNeeds[dateStr][shift];
            } else {
                const key = `${shift}_${dayOfWeek}`;
                need = dailyNeeds[key] || 0;
            }
            
            const current = dailyCount[shift] || 0;
            
            if (current < need) {
                result.push(shift);
            }
        }
        
        if (result.length === 0 && rules?.policy?.enableRelaxation) {
            return whitelist;
        }
        
        return result.length > 0 ? result : whitelist;
    },
    
    getDateKey: function(day, year, month) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    },
    
    getDayOfWeek: function(day, year, month) {
        const date = new Date(year, month - 1, day);
        const jsDay = date.getDay();
        return (jsDay === 0) ? 6 : jsDay - 1;
    },
    
    getWhitelistSize: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData) {
        const whitelist = this.calculate(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData);
        return whitelist.length;
    },
    
    hasValidShift: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData) {
        const whitelist = this.calculate(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData);
        return whitelist.length > 0;
    }
};

console.log('✅ WhitelistCalculator 已載入');
