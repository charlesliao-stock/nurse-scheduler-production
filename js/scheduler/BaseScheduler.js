// js/scheduler/BaseScheduler.js
class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules, shifts) {
        this.staffList = allStaff; 
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        this.shiftsMap = {}; // 儲存班別詳細資料 (含時間)
        
        // 解析 shifts (陣列轉 Map)
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

    // [修正] 動態計算休息時間
    checkRestPeriod(prevShiftCode, nextShiftCode) {
        // 1. 如果任一方是休假，直接通過
        if (!prevShiftCode || prevShiftCode === 'OFF' || prevShiftCode === 'LEAVE') return true;
        if (!nextShiftCode || nextShiftCode === 'OFF' || nextShiftCode === 'LEAVE') return true;
        
        // 2. 相同班別順接，視為通過 (除非有特殊規定，但通常 D接D 是 OK 的)
        if (prevShiftCode === nextShiftCode) return true;

        // 3. 讀取班別時間定義
        const prevShiftDef = this.shiftsMap[prevShiftCode];
        const nextShiftDef = this.shiftsMap[nextShiftCode];

        // 如果找不到定義 (例如代號錯誤)，保守起見回傳 true 或 false? 
        // 建議 fallback 到舊邏輯或報錯。這裡假設 shiftsMap 齊全。
        if (!prevShiftDef || !nextShiftDef) {
            // Fallback: 舊有的硬編碼檢查 (防止資料缺失時出錯)
            if (prevShiftCode === 'E' && nextShiftCode === 'D') return false; 
            if (prevShiftCode === 'N' && nextShiftCode === 'E') return false;
            return true;
        }

        // 4. 計算間隔
        // 假設時間格式 "HH:mm"。需處理跨日問題。
        // 為了簡化，我們將所有時間轉為 "相對於前一天上班時間的分鐘數"
        
        // 上一班下班時間 (End Time)
        // 下一班上班時間 (Start Time) + 24小時 (因為是隔天)
        
        const getMinutes = (timeStr) => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        };

        let prevEnd = getMinutes(prevShiftDef.endTime);
        let nextStart = getMinutes(nextShiftDef.startTime) + 1440; // 隔天，加 24*60 分鐘

        // 處理跨日班別 (如大夜 00:00 - 08:00，或小夜 16:00 - 00:00)
        // 如果 prevStart > prevEnd，表示跨日。
        // 例如 N班 00:00 - 08:00 (沒跨日，但在當天極早)
        // E班 16:00 - 00:00 (endTime 00:00 通常視為 24:00)
        // 這裡需要依據您的系統定義。通常 EndTime < StartTime 代表跨日。
        
        // 修正邏輯：我們關心的是 "上一班結束" 到 "下一班開始" 的絕對時間差
        // Case 1: E班 (16:00 - 00:00) 接 D班 (08:00 - 16:00)
        // prevEnd = 24:00 (1440), nextStart = 08:00 (+24h = 32:00 = 1920)
        // Gap = 1920 - 1440 = 480 min = 8 hours -> Fail
        
        // 簡單化：如果 endTime 是 "00:00"，視為 24:00 (1440)
        if (prevShiftDef.endTime === "00:00") prevEnd = 1440;
        
        // 處理跨日班 (例如 23:00 - 07:00)
        // 如果 prevEnd < prevStart，說明跨日了，prevEnd 應該 +1440
        const prevStart = getMinutes(prevShiftDef.startTime);
        if (prevEnd < prevStart) prevEnd += 1440; 

        // 計算間隔
        const gapMinutes = nextStart - prevEnd;
        const minRestMinutes = (this.rules.policy?.minRestHours || 11) * 60;

        return gapMinutes >= minRestMinutes;
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
                // 暫不處理上月
            } else {
                shift = this.getShiftByDate(this.getDateStrFromDate(d), staffId);
            }

            if (['N', 'E', 'D'].includes(shift)) {
                shiftsInWeek.add(shift);
            }
        }
        return shiftsInWeek.size <= 2;
    }
    
    // [修正] 連續上班天數計算 (跨月接軌)
    getConsecutiveWorkDays(staffId, dateStr) {
        const d = new Date(dateStr);
        const dayOfCurrentMonth = d.getDate(); // 1..31
        
        let currentMonthStreak = 0;
        
        // 1. 本月往前數
        // 例如 dateStr 是 1號，這裡迴圈不執行，直接進入步驟 2
        for (let i = 1; i < dayOfCurrentMonth; i++) {
            const checkDate = this.getDateStr(dayOfCurrentMonth - i);
            const shift = this.getShiftByDate(checkDate, staffId);
            
            if (['N', 'E', 'D'].includes(shift)) {
                currentMonthStreak++;
            } else {
                return currentMonthStreak;
            }
        }
        
        // 2. 接軌上個月
        // 如果本月目前為止全是上班 (例如 3號，1,2號都上班)，才需要看上個月
        // 如果本月中間斷過，上面迴圈就 return 了
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
