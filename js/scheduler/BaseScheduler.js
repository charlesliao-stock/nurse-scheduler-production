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
                    // 預設先給 OFF，後續排班會覆蓋
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
        // 扣除舊班別
        if (['N', 'E', 'D'].includes(oldShift)) c[oldShift]--;
        if (['OFF', 'LEAVE'].includes(oldShift)) c.OFF--;
        if (['LEAVE'].includes(oldShift)) c.LEAVE--;

        // 加入新班別
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

    // 取得指定日期的班別
    getShiftByDate(dateStr, staffId) {
        const daySchedule = this.schedule[dateStr];
        if (!daySchedule) return 'OFF';
        if (daySchedule.N.includes(staffId)) return 'N';
        if (daySchedule.E.includes(staffId)) return 'E';
        if (daySchedule.D.includes(staffId)) return 'D';
        if (daySchedule.LEAVE.includes(staffId)) return 'LEAVE'; // 包含 REQ_OFF
        return 'OFF';
    }

    // 取得前一天的班別 (含跨月)
    getYesterdayShift(staffId, dateStr) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() - 1);
        if (d.getMonth() + 1 !== this.month) {
            const lastData = this.lastMonthData[staffId];
            return lastData ? (lastData.lastShiftCode || 'OFF') : 'OFF';
        }
        return this.getShiftByDate(this.getDateStrFromDate(d), staffId);
    }

    // [新增] 檢查 11 小時間隔 (嚴格定義：任何班別轉換都視為違反，除非中間有 OFF)
    // 您的規則：D->E (X), E->N (X), N->D (X)
    // 結論：除了 Same Shift 或 OFF，其他都擋
    checkRestPeriod(prevShift, nextShift) {
        if (!prevShift || prevShift === 'OFF' || prevShift === 'LEAVE') return true;
        if (!nextShift || nextShift === 'OFF' || nextShift === 'LEAVE') return true;
        
        // 嚴格順接原則：只有相同班別可以接
        return prevShift === nextShift;
    }

    // [新增] 檢查該週 (週一~週日) 班別種類是否超過 2 種
    checkWeeklyVariety(staffId, dateStr, newShift) {
        if (newShift === 'OFF' || newShift === 'LEAVE') return true;

        const currentDay = new Date(dateStr);
        // 找到本週一 (若 dateStr 是週一，則就是當天)
        // getDay(): Sun=0, Mon=1...Sat=6
        let dayOfWeek = currentDay.getDay(); 
        if (dayOfWeek === 0) dayOfWeek = 7; // 把週日當作 7
        
        // 回溯到週一
        const daysSinceMonday = dayOfWeek - 1;
        
        const shiftsInWeek = new Set();
        shiftsInWeek.add(newShift);

        // 往前檢查到週一
        for (let i = 1; i <= daysSinceMonday; i++) {
            const d = new Date(currentDay);
            d.setDate(d.getDate() - i);
            
            // 跨月邊界處理：如果週一在上個月，是否要查？
            // 簡化原則：只查本月已排的部分，或者查 lastMonthData (若在本週內)
            let shift = 'OFF';
            if (d.getMonth() + 1 !== this.month) {
                // 檢查上個月底是否屬於這一週 (例如 1號是週三，那上月30,29是週二週一)
                // 這裡暫時忽略上個月的班別種類影響，專注本月
                // 若需嚴格檢查，需讀取 lastMonthData 更多天數
            } else {
                shift = this.getShiftByDate(this.getDateStrFromDate(d), staffId);
            }

            if (['N', 'E', 'D'].includes(shift)) {
                shiftsInWeek.add(shift);
            }
        }

        return shiftsInWeek.size <= 2;
    }
    
    // 連續上班天數檢查
    getConsecutiveWorkDays(staffId, dateStr) {
        let count = 0;
        const d = new Date(dateStr);
        for (let i = 1; i <= 10; i++) {
            d.setDate(d.getDate() - 1);
            let shift;
            if (d.getMonth() + 1 !== this.month) {
                const lastData = this.lastMonthData[staffId];
                // 這裡簡化：只加最後一天的連續天數 (若有)
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
        // 支援 Editor Manager 傳進來的 prefs (priority_1, REQ_OFF 都在 prefs 物件裡)
        // 結構: staff.prefs[dateStr] = 'REQ_OFF' 或 {1:'N', 2:'D'}
        if (staff.prefs && staff.prefs[dateStr] === 'REQ_OFF') return 'REQ_OFF';
        return null;
    }
}
