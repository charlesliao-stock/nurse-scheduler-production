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
        // 初始化計數器
        this.staffList.forEach(s => {
            this.counters[s.id] = { N: 0, E: 0, D: 0, OFF: 0, LEAVE: 0 };
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
                    this._addToSchedule(dateStr, s.id, 'LEAVE');
                    this.counters[s.id].LEAVE++;
                    this.counters[s.id].OFF++; // 預假計入總休假
                } else {
                    this._addToSchedule(dateStr, s.id, 'OFF');
                    this.counters[s.id].OFF++;
                }
            }
        });
    }

    // 原子化更新 (核心操作)
    updateShift(dateStr, staffId, oldShift, newShift) {
        if (oldShift === newShift) return;
        this._removeFromSchedule(dateStr, staffId, oldShift);
        this._addToSchedule(dateStr, staffId, newShift);

        const c = this.counters[staffId];
        
        // 扣除舊班別
        if (['N', 'E', 'D'].includes(oldShift)) c[oldShift]--;
        if (['OFF', 'LEAVE', 'REQ_OFF'].includes(oldShift)) c.OFF--;
        if (['LEAVE', 'REQ_OFF'].includes(oldShift)) c.LEAVE--;

        // 加入新班別
        if (['N', 'E', 'D'].includes(newShift)) c[newShift]++;
        if (['OFF', 'LEAVE', 'REQ_OFF'].includes(newShift)) c.OFF++;
        if (['LEAVE', 'REQ_OFF'].includes(newShift)) c.LEAVE++;
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

    // 連續性檢查
    isValidContinuity(staff, dateStr, targetShift) {
        if (targetShift === 'OFF' || targetShift === 'LEAVE') return true;

        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        
        // 1. 禁忌轉換 (預設規則)
        const forbidden = (this.rules.hard && this.rules.hard.forbiddenTransitions) 
                         ? this.rules.hard.forbiddenTransitions 
                         : { "N": ["D", "E"], "E": ["D"] };
        
        if (forbidden[prevShift] && forbidden[prevShift].includes(targetShift)) return false;

        // 2. 連續上班天數限制
        const maxCons = (this.rules.policy && this.rules.policy.maxConsDays) ? this.rules.policy.maxConsDays : 6;
        const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
        if (currentCons + 1 > maxCons) return false;

        // 3. D 不接 N (若無特別設定，預設為真)
        if (prevShift === 'D' && targetShift === 'N') return false;

        return true;
    }

    getYesterdayShift(staffId, dateStr) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() - 1);
        
        // 跨月處理
        if (d.getMonth() + 1 !== this.month) {
            const lastData = this.lastMonthData[staffId];
            return lastData ? (lastData.lastShiftCode || 'OFF') : 'OFF';
        }
        const prevDateStr = this.getDateStrFromDate(d);
        return this.getShiftByDate(prevDateStr, staffId);
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

    getConsecutiveWorkDays(staffId, dateStr) {
        let count = 0;
        const d = new Date(dateStr);
        // 回溯 10 天
        for (let i = 1; i <= 10; i++) {
            d.setDate(d.getDate() - 1);
            let shift;
            if (d.getMonth() + 1 !== this.month) {
                const lastData = this.lastMonthData[staffId];
                if (i === 1 && lastData) count += (lastData.consecutiveDays || 0);
                break;
            } else {
                shift = this.getShiftByDate(this.getDateStrFromDate(d), staffId);
            }
            if (['N', 'E', 'D'].includes(shift)) count++;
            else break;
        }
        return count;
    }

    // 工具函式
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
    calculateWeightedDensity(staffId, dateStr) {
        let score = 0;
        const d = new Date(dateStr);
        for(let i=1; i<=7; i++) {
            d.setDate(d.getDate() - 1);
            if (d.getMonth() + 1 !== this.month) break;
            const shift = this.getShiftByDate(this.getDateStrFromDate(d), staffId);
            if (shift === 'N') score += 1.5;
            else if (shift === 'E') score += 1.2;
            else if (shift === 'D') score += 1.0;
        }
        return score;
    }
}
