// js/scheduler/BaseScheduler.js
class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff; 
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        
        this.schedule = {}; 
        this.counters = {}; 
        this.init();
    }

    init() {
        // 初始化計數器 (包含 forcedOffCount 用於輪替)
        this.staffList.forEach(s => {
            this.counters[s.id] = { N: 0, E: 0, D: 0, OFF: 0, LEAVE: 0, forcedOffCount: 0 };
        });

        // 初始化班表結構
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = { N: [], E: [], D: [], OFF: [], LEAVE: [] };
        }

        // 載入預設狀態 (處理預假 REQ_OFF)
        this.staffList.forEach(s => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const preShift = this.getPreScheduledShift(s, dateStr);
                
                if (preShift === 'REQ_OFF') {
                    this._addToSchedule(dateStr, s.id, 'LEAVE'); // 視為 LEAVE 但其實是預休
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
        if (daySchedule.N.includes(staffId)) return 'N';
        if (daySchedule.E.includes(staffId)) return 'E';
        if (daySchedule.D.includes(staffId)) return 'D';
        if (daySchedule.LEAVE.includes(staffId)) return 'LEAVE'; 
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

    checkRestPeriod(prevShift, nextShift) {
        if (!prevShift || prevShift === 'OFF' || prevShift === 'LEAVE') return true;
        if (!nextShift || nextShift === 'OFF' || nextShift === 'LEAVE') return true;
        return prevShift === nextShift;
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
                // 跨月部分暫略，或可讀取 lastMonthData
            } else {
                shift = this.getShiftByDate(this.getDateStrFromDate(d), staffId);
            }
            if (['N', 'E', 'D'].includes(shift)) {
                shiftsInWeek.add(shift);
            }
        }
        return shiftsInWeek.size <= 2;
    }
    
    // [核心修正] 計算連續上班天數 (含跨月繼承)
    getConsecutiveWorkDays(staffId, dateStr) {
        let count = 0;
        const d = new Date(dateStr);
        
        // 往前檢查 10 天
        for (let i = 1; i <= 10; i++) {
            d.setDate(d.getDate() - 1); // 變成前一天

            // 1. 如果跨越到上個月
            if (d.getMonth() + 1 !== this.month) {
                const lastData = this.lastMonthData[staffId];
                if (lastData) {
                    // [Fix] 直接累加上個月底的連續天數，並停止回溯
                    // 因為 lastData.consecutiveDays 已經代表了上個月底那一刻的累積值
                    count += (lastData.consecutiveDays || 0);
                }
                break; // 跨月後資料已由 lastMonthData 提供，不需再往前查
            } 
            // 2. 如果還在本月
            else {
                const shift = this.getShiftByDate(this.getDateStrFromDate(d), staffId);
                // 只要是上班班別，計數器+1
                if (['N', 'E', 'D'].includes(shift)) {
                    count++;
                } else {
                    // 遇到 OFF/LEAVE，連續中斷
                    break; 
                }
            }
        }
        return count;
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
