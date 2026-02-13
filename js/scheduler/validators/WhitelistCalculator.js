// js/scheduler/validators/WhitelistCalculator.js

const WhitelistCalculator = {
    
    calculate: function(staff, assignments, day, year, month, rules, dailyCount, daysInMonth, shiftTimeMap, lastMonthData) {
        const uid = staff.uid || staff.id;
        const prefs = staff.preferences || {};
        
        // 1. 定義絕對允許的班次 (包班或志願班)
        // 這是最核心的限制：絕不允許排入非包班且非志願的班次
        let allowedShifts = new Set(['OFF', 'REQ_OFF']);
        if (prefs.bundleShift) {
            allowedShifts.add(prefs.bundleShift);
        } else {
            if (prefs.favShift) allowedShifts.add(prefs.favShift);
            if (prefs.favShift2) allowedShifts.add(prefs.favShift2);
            if (prefs.favShift3) allowedShifts.add(prefs.favShift3);
        }

        // 2. 基礎白名單 (所有可能的班次)
        let whitelist = Array.from(allowedShifts);
        
        // 3. 檢查預班 (如果有預班，則只能排預班)
        const key = `current_${day}`;
        const preScheduled = assignments[uid]?.[key];
        if (preScheduled) {
            return [preScheduled];
        }
        
        // 4. 檢查硬規則 (勞基法/感控規則)
        // 11小時休期間隔
        if (rules.hard?.minGap11 !== false) {
            whitelist = this.filterByMinGap11(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData);
        }
        
        // 連續上班天數限制
        const consecutiveDays = this.countConsecutiveWorkDays(staff, assignments, day, lastMonthData);
        const maxConsDays = rules?.policy?.maxConsDays || 6;
        if (consecutiveDays >= maxConsDays) {
            whitelist = whitelist.filter(s => s === 'OFF' || s === 'REQ_OFF');
        }
        
        // 懷孕/哺乳保護 (不排大夜)
        if (rules.hard?.protectPregnant !== false && (staff.isPregnant || staff.isBreastfeeding)) {
            whitelist = this.filterProtectPregnant(whitelist, shiftTimeMap, rules);
        }
        
        return whitelist;
    },
    
    filterByMinGap11: function(whitelist, staff, assignments, day, shiftTimeMap, lastMonthData) {
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

    filterProtectPregnant: function(whitelist, shiftTimeMap, rules) {
        const nightStart = this.parseTime(rules.policy?.nightStart || '22:00');
        const nightEnd = this.parseTime(rules.policy?.nightEnd || '06:00');
        return whitelist.filter(shift => {
            if (shift === 'OFF' || shift === 'REQ_OFF') return true;
            const start = this.parseTime(shiftTimeMap[shift]?.startTime);
            const isNight = (nightStart > nightEnd) ? (start >= nightStart || start <= nightEnd) : (start >= nightStart && start <= nightEnd);
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
            const lastDays = ['last_31', 'last_30', 'last_29', 'last_28', 'last_27', 'last_26'];
            for (let k of lastDays) {
                const s = lastMonthData[uid][k];
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

console.log('✅ WhitelistCalculator 已載入 (絕對限制版)');
