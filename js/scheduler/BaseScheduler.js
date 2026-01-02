// js/scheduler/BaseScheduler.js
class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules, shifts) {
        this.staffList = allStaff; 
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        this.shiftsMap = {}; 
        
        if (shifts && Array.isArray(shifts)) {
            shifts.forEach(s => this.shiftsMap[s.code] = s);
        }
        
        this.schedule = {}; 
        this.counters = {}; 
        this.init();
    }

    init() {
        this.staffList.forEach(s => {
            this.counters[s.id] = { N: 0, E: 0, D: 0, OFF: 0, LEAVE: 0, forcedOffCount: 0 };
        });

        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = { N: [], E: [], D: [], OFF: [], LEAVE: [] };
        }

        this.staffList.forEach(s => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const preShift = this.getPreScheduledShift(s, dateStr);
                
                if (preShift === 'REQ_OFF') {
                    this._addToSchedule(dateStr, s.id, 'LEAVE');
                    this.counters[s.id].LEAVE++;
                    this.counters[s.id].OFF++; 
                } else {
                    this._addToSchedule(dateStr, s.id, 'OFF');
                    this.counters[s.id].OFF++;
                }
            }
        });
    }

    updateShift(dateStr, staffId, oldShift, newShift) {
        if (oldShift === newShift) return;
        this._removeFromSchedule(dateStr, staffId, oldShift);
        this._addToSchedule(dateStr, staffId, newShift);

        const c = this.counters[staffId];
        if (['N', 'E', 'D'].includes(oldShift)) c[oldShift]--;
        if (['OFF', 'LEAVE'].includes(oldShift)) c.OFF--;
        if (['LEAVE'].includes(oldShift)) c.LEAVE--;

        if (['N', 'E', 'D'].includes(newShift)) c[newShift]++;
        if (['OFF', 'LEAVE'].includes(newShift)) c.OFF++;
        if (['LEAVE'].includes(newShift)) c.LEAVE++;
    }

    _addToSchedule(dateStr, staffId, shift) {
        if (!this.schedule[dateStr][shift]) this.schedule[dateStr][shift] = [];
        this.schedule[dateStr][shift].push(staffId);
    }

    _removeFromSchedule(dateStr, staffId, shift) {
        if (!this.schedule[dateStr][shift]) return;
        const idx = this.schedule[dateStr][shift].indexOf(staffId);
        if (idx > -1) this.schedule[dateStr][shift].splice(idx, 1);
    }

    getShiftByDate(dateStr, staffId) {
        const daySchedule = this.schedule[dateStr];
        if (!daySchedule) return 'OFF';
        if (daySchedule.N && daySchedule.N.includes(staffId)) return 'N';
        if (daySchedule.E && daySchedule.E.includes(staffId)) return 'E';
        if (daySchedule.D && daySchedule.D.includes(staffId)) return 'D';
        if (daySchedule.LEAVE && daySchedule.LEAVE.includes(staffId)) return 'LEAVE';
        return 'OFF';
    }

    getYesterdayShift(staffId, dateStr) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() - 1);
        if (d.getMonth() + 1 !== this.month) {
            const lastData = this.lastMonthData[staffId];
            return lastData ? (lastData.lastShiftCode || 'OFF') : 'OFF';
        }
        return this.getShiftByDate(this.getDateStrFromDate(d), staffId);
    }

    // [修正] 動態計算 11 小時間隔
    checkRestPeriod(prevShiftCode, nextShiftCode) {
        if (!prevShiftCode || prevShiftCode === 'OFF' || prevShiftCode === 'LEAVE') return true;
        if (!nextShiftCode || nextShiftCode === 'OFF' || nextShiftCode === 'LEAVE') return true;
        if (prevShiftCode === nextShiftCode) return true;

        const prevDef = this.shiftsMap[prevShiftCode];
        const nextDef = this.shiftsMap[nextShiftCode];

        // 若無定義，回退到預設防呆邏輯
        if (!prevDef || !nextDef) {
            if (prevShiftCode === 'E' && nextShiftCode === 'D') return false; 
            if (prevShiftCode === 'N' && nextShiftCode === 'E') return false;
            return true;
        }

        const toMins = (t) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };

        let prevEnd = toMins(prevDef.endTime);
        const prevStart = toMins(prevDef.startTime);
        
        // 處理跨日：若結束時間 < 開始時間 (如 16:00 -> 00:00)，視為跨日
        if (prevDef.endTime === "00:00") prevEnd = 1440; 
        else if (prevEnd < prevStart) prevEnd += 1440;

        // 下一班開始時間 (發生在隔天)
        const nextStart = toMins(nextDef.startTime) + 1440;

        const gap = nextStart - prevEnd;
        const limit = (this.rules.policy?.minRestHours || 11) * 60;

        return gap >= limit;
    }

    checkWeeklyVariety(staffId, dateStr, newShift) {
        if (newShift === 'OFF' || newShift === 'LEAVE') return true;
        const currentDay = new Date(dateStr);
        let dayOfWeek = currentDay.getDay(); 
        if (dayOfWeek === 0) dayOfWeek = 7; 
        const daysSinceMonday = dayOfWeek - 1;
        const shiftsInWeek = new Set();
        shiftsInWeek.add(newShift);

        for (let i = 1; i <= daysSinceMonday; i++) {
            const d = new Date(currentDay);
            d.setDate(d.getDate() - i);
            let shift = 'OFF';
            if (d.getMonth() + 1 !== this.month) {
                // 暫不處理跨月週種類
            } else {
                shift = this.getShiftByDate(this.getDateStrFromDate(d), staffId);
            }
            if (['N', 'E', 'D'].includes(shift)) shiftsInWeek.add(shift);
        }
        return shiftsInWeek.size <= 2;
    }
    
    // [修正] 連續上班計算
    getConsecutiveWorkDays(staffId, dateStr) {
        const d = new Date(dateStr);
        const dayOfCurrentMonth = d.getDate(); 
        let currentMonthStreak = 0;
        
        for (let i = 1; i < dayOfCurrentMonth; i++) {
            const checkDate = this.getDateStr(dayOfCurrentMonth - i);
            const shift = this.getShiftByDate(checkDate, staffId);
            if (['N', 'E', 'D'].includes(shift)) currentMonthStreak++;
            else return currentMonthStreak;
        }
        
        const lastData = this.lastMonthData[staffId];
        const lastMonthStreak = (lastData && lastData.consecutiveDays) ? lastData.consecutiveDays : 0;
        return currentMonthStreak + lastMonthStreak;
    }

    getDateStr(d) { return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    getDateStrFromDate(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    getPreScheduledShift(staff, dateStr) {
        if (staff.prefs && staff.prefs[dateStr] === 'REQ_OFF') return 'REQ_OFF';
        return null;
    }
}
