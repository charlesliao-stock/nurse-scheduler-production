// js/scheduler/BaseScheduler.js
class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules, shifts) {
        this.staffList = allStaff || [];
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        
        // --- [修正] 動態班別初始化 ---
        this.shiftsMap = {};
        this.workShiftCodes = []; // 自動偵測的工作班別 (如: N, E, D, A, B...)

        if (shifts && Array.isArray(shifts) && shifts.length > 0) {
            shifts.forEach(s => {
                this.shiftsMap[s.code] = s;
                // 自動判定：不是休息類型的都算工作班
                if (s.code !== 'OFF' && s.code !== 'PH' && s.code !== 'REQ_OFF') {
                    this.workShiftCodes.push(s.code);
                }
            });
        } else {
            console.warn("⚠️ BaseScheduler: 未傳入班別定義，使用預設 N/E/D (相容模式)");
            this.workShiftCodes = ['N', 'E', 'D'];
        }

        this.schedule = {};
        this.counters = {};
        this.init();
    }

    init() {
        // 初始化計數器 (動態生成 key)
        this.staffList.forEach(s => {
            this.counters[s.id] = { OFF: 0, LEAVE: 0, forcedOffCount: 0 };
            // 為每個工作班別建立計數器
            this.workShiftCodes.forEach(code => {
                this.counters[s.id][code] = 0;
            });
        });

        // 初始化排班表
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = { OFF: [], LEAVE: [] };
            this.workShiftCodes.forEach(code => {
                this.schedule[dateStr][code] = [];
            });
        }

        // 載入預班資料
        this.staffList.forEach(s => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const preShift = this.getPreScheduledShift(s, dateStr);
                
                if (preShift === 'REQ_OFF' || preShift === 'OFF') {
                    this.updateShift(dateStr, s.id, 'OFF', 'OFF');
                    // 如果是預休，標記為 REQ_OFF 方便後續識別，但計數算 OFF
                    if (preShift === 'REQ_OFF') this.setShiftByDate(dateStr, s.id, 'REQ_OFF');
                } else if (this.isWorkShift(preShift)) {
                    // 如果預班指定了特定班別 (包班或指定班)
                    this.updateShift(dateStr, s.id, 'OFF', preShift);
                } else {
                    // 預設為 OFF (初始狀態)
                    this.setShiftByDate(dateStr, s.id, 'OFF');
                }
            }
        });
    }

    // --- [新增] 通用判斷與時間計算 ---

    /**
     * 判斷是否為工作班別 (動態)
     */
    isWorkShift(code) {
        return this.workShiftCodes.includes(code);
    }

    /**
     * 計算連續上班天數 (修正版：支援動態班別與跨月回溯)
     */
    getConsecutiveWorkDays(staffId, dateStr) {
        const d = new Date(dateStr);
        const dayOfCurrentMonth = d.getDate();
        let currentMonthStreak = 0;

        // 1. 往回檢查當月
        for (let i = 1; i < dayOfCurrentMonth; i++) {
            const checkDate = this.getDateStr(dayOfCurrentMonth - i);
            const shift = this.getShiftByDate(checkDate, staffId);
            if (this.isWorkShift(shift)) {
                currentMonthStreak++;
            } else {
                return currentMonthStreak; // 遇到斷點直接回傳
            }
        }

        // 2. 如果當月全勤，疊加上個月底的連續天數
        const lastData = this.lastMonthData[staffId];
        const lastMonthStreak = (lastData && lastData.consecutiveDays) ? lastData.consecutiveDays : 0;
        return currentMonthStreak + lastMonthStreak;
    }

    /**
     * 檢查休息間隔 (支援動態時間計算)
     */
    checkRestPeriod(prevShiftCode, nextShiftCode) {
        // 如果其中一個是休假，必定合規
        if (!this.isWorkShift(prevShiftCode) || !this.isWorkShift(nextShiftCode)) return true;

        const prevDef = this.shiftsMap[prevShiftCode];
        const nextDef = this.shiftsMap[nextShiftCode];

        // 防呆：如果找不到班別定義，使用代號猜測 (相容舊邏輯)
        if (!prevDef || !nextDef) {
            if (prevShiftCode === 'E' && nextShiftCode === 'D') return false;
            if (prevShiftCode === 'N' && nextShiftCode === 'D') return false; // N接D通常也不行(視醫院規定)
            if (prevShiftCode === 'N' && nextShiftCode === 'E') return false;
            return true;
        }

        // 使用分鐘數精確計算
        let prevEnd = this.toMins(prevDef.endTime);
        let nextStart = this.toMins(nextDef.startTime);

        // 處理跨日：如果結束時間 <= 開始時間 (例如 00:00 結束)，視為隔天
        // 邏輯：前一班結束時間 + 休息時間 <= 後一班開始時間
        // 由於我們只看「班與班之間」，這裡假設 nextShift 是在 prevShift 的「隔天」或「接續」
        
        // 修正跨日計算：
        // 情境 A: 16:00-24:00 (E) 接 08:00-16:00 (D)
        // prevEnd = 24*60 = 1440 (若 00:00 則視為 24:00)
        // nextStart (隔天) = 08*60 + 24*60 = 1920
        // 間隔 = 1920 - 1440 = 480 mins (8小時) -> 不足 11 小時 (660 mins) -> FALSE

        if (prevDef.endTime === "00:00") prevEnd = 1440; 
        
        // 假設是「隔日」上班，nextStart 要加 24 小時 (1440 分鐘)
        const gap = (nextStart + 1440) - prevEnd;
        
        // 11 小時 = 660 分鐘
        return gap >= 660; 
    }

    toMins(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    // --- 基礎操作 ---
    
    updateShift(dateStr, staffId, oldShift, newShift) {
        // 更新 Schedule
        const daySchedule = this.schedule[dateStr];
        
        // 從舊陣列移除
        if (daySchedule[oldShift]) {
            daySchedule[oldShift] = daySchedule[oldShift].filter(id => id !== staffId);
        }
        // 加入新陣列
        if (!daySchedule[newShift]) daySchedule[newShift] = [];
        daySchedule[newShift].push(staffId);

        // 更新計數器 (Counters)
        if (this.counters[staffId][oldShift] !== undefined) this.counters[staffId][oldShift]--;
        if (this.counters[staffId][newShift] !== undefined) this.counters[staffId][newShift]++;
    }

    getShiftByDate(dateStr, staffId) {
        // 反查：這有點慢，但為了資料結構一致性先這樣寫
        // 實務上可以在 updateShift 時維護一個 reverse lookup map
        const daySch = this.schedule[dateStr];
        for (const shiftCode in daySch) {
            if (daySch[shiftCode].includes(staffId)) return shiftCode;
        }
        return 'OFF';
    }

    getPreScheduledShift(staff, dateStr) {
        if (!staff.preSchedule || !staff.preSchedule.assignments) return null;
        return staff.preSchedule.assignments[dateStr] || null;
    }

    getDateStr(d) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
}
