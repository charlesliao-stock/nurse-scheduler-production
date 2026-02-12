// js/scheduler/validators/WhitelistCalculator.js

const WhitelistCalculator = {
    
    calculate: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap) {
        const uid = staff.uid || staff.id;
        const shifts = rules.shifts || [];
        const allShiftCodes = shifts.map(s => s.code);
        
        // --- 第一階段：絕對硬性規則 (不可違反) ---
        let hardWhitelist = [...allShiftCodes];
        
        // 1. 預班鎖定
        hardWhitelist = this.stage1_PreScheduleLock(hardWhitelist, staff, assignments, day);
        
        // 2. 勞基法/硬性規則 (連六、11小時休息等)
        hardWhitelist = this.stage2_HardRules(hardWhitelist, staff, assignments, day, rules, shiftTimeMap, daysInMonth);
        
        // 3. 包班約束 (必須嚴格遵守)
        hardWhitelist = this.stage3_BundleConstraints(hardWhitelist, staff, assignments, day);
        
        // 4. 特殊身份 (PGY 保護等)
        hardWhitelist = this.stage4_SpecialIdentity(hardWhitelist, staff, rules);
        
        // 5. 志願班別 (若設定為 'must' 則不可違反)
        hardWhitelist = this.stage5_Preferences(hardWhitelist, staff, assignments, day, rules);
        
        // --- 第二階段：供需過濾 (僅作為排班參考，可放寬) ---
        // 如果是為了檢查「誰可以排這個班」，我們應該回傳 hardWhitelist
        // 如果是為了「自動選擇班別」，才需要考慮供需
        if (!dailyCount) {
            return hardWhitelist;
        }

        let softWhitelist = this.stage6_SupplyDemand(hardWhitelist, staff, assignments, day, year, month, rules, dailyCount);
        
        // 如果供需過濾後沒人了，且允許放寬，則回退到硬性白名單
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
    
    stage3_BundleConstraints: function(whitelist, staff, assignments, day) {
        const prefs = staff.preferences || {};
        const bundleShift = prefs.bundleShift;
        
        if (!bundleShift) return whitelist;
        
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            return shift === bundleShift;
        });
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
    
    getWhitelistSize: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap) {
        const whitelist = this.calculate(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap);
        return whitelist.length;
    },
    
    hasValidShift: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap) {
        const whitelist = this.calculate(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap);
        return whitelist.length > 0;
    }
};

console.log('✅ WhitelistCalculator 已載入');
