// js/scheduler/BaseScheduler.js
// 精簡版：只保留共用工具函式

class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.allStaff = allStaff || [];
        this.year = year;
        this.month = month;
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        this.daysInMonth = new Date(year, month, 0).getDate();
        
        this.shifts = rules.shifts || [];
        this.dailyNeeds = rules.dailyNeeds || {};
        this.specificNeeds = rules.specificNeeds || {};
        
        this.shiftTimeMap = this.buildShiftTimeMap();
    }
    
    buildShiftTimeMap() {
        const map = {};
        this.shifts.forEach(s => {
            map[s.code] = {
                start: this.parseTime(s.startTime),
                end: this.parseTime(s.endTime),
                duration: s.duration || 8
            };
        });
        return map;
    }
    
    parseTime(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h + m / 60;
    }
    
    isNightShift(shiftCode) {
        if (!shiftCode || shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return false;
        const shift = this.shifts.find(s => s.code === shiftCode);
        if (!shift) return false;
        if (shift.isNight !== undefined) return shift.isNight;
        const start = this.parseTime(shift.startTime);
        return start >= 22 || start <= 6;
    }
    
    isEveningShift(shiftCode) {
        if (!shiftCode || shiftCode === 'OFF' || shiftCode === 'REQ_OFF') return false;
        const shift = this.shifts.find(s => s.code === shiftCode);
        if (!shift) return false;
        if (shift.isEvening !== undefined) return shift.isEvening;
        const start = this.parseTime(shift.startTime);
        return start >= 14 && start < 22;
    }
    
    isEveningOrNightShift(shiftCode) {
        return this.isEveningShift(shiftCode) || this.isNightShift(shiftCode);
    }
    
    getDateKey(day) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    
    getDayOfWeek(day) {
        const date = new Date(this.year, this.month - 1, day);
        const jsDay = date.getDay();
        return (jsDay === 0) ? 6 : jsDay - 1;
    }
    
    isHoliday(day) {
        const date = new Date(this.year, this.month - 1, day);
        const jsDay = date.getDay();
        return jsDay === 0 || jsDay === 6;
    }
    
    getShiftByCode(code) {
        return this.shifts.find(s => s.code === code);
    }
    
    countConsecutiveWork(assignments, uid, upToDay) {
        let count = 0;
        for (let d = upToDay; d >= 1; d--) {
            const val = assignments[uid]?.[`current_${d}`];
            if (val && val !== 'OFF' && val !== 'REQ_OFF') {
                count++;
            } else {
                break;
            }
        }
        return count;
    }
    
    countConsecutiveOff(assignments, uid, upToDay) {
        let count = 0;
        for (let d = upToDay; d >= 1; d--) {
            const val = assignments[uid]?.[`current_${d}`];
            if (!val || val === 'OFF' || val === 'REQ_OFF') {
                count++;
            } else {
                break;
            }
        }
        return count;
    },

    countOffDays: function(assignments, uid, upToDay) {
        let count = 0;
        for (let d = 1; d <= upToDay; d++) {
            const val = assignments[uid]?.[`current_${d}`];
            if (!val || val === 'OFF' || val === 'REQ_OFF') {
                count++;
            }
        }
        return count;
    }
}

console.log('✅ BaseScheduler 已載入（精簡版）');
