// js/scheduler/BaseScheduler.js
class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff; // [{id, name, ...}]
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        
        // 🔧 修正：動態獲取班別清單，預設包含 OFF
        this.shiftCodes = this.rules.shiftCodes || ['N', 'E', 'D'];
        if (!this.shiftCodes.includes('OFF')) this.shiftCodes.push('OFF');

        // 排班結果 { "YYYY-MM-DD": { [shiftCode]: [] } }
        this.schedule = {}; 
        // 統計計數器 { uid: { [shiftCode]: 0 } }
        this.counters = {}; 
        
        this.init();
    }

    init() {
        // 1. 初始化計數器 (動態班別)
        this.staffList.forEach(s => {
            this.counters[s.id] = {};
            this.shiftCodes.forEach(code => {
                this.counters[s.id][code] = 0;
            });
        });

        // 2. 初始化每天的班表結構 (動態班別)
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = {};
            this.shiftCodes.forEach(code => {
                this.schedule[dateStr][code] = [];
            });
        }
        
        // 3. 🔧 修正：預設將所有人先放入 OFF
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                if (this.schedule[dateStr].OFF) {
                    this.schedule[dateStr].OFF.push(staff.id);
                    this.counters[staff.id].OFF++;
                }
            }
        });
    }

    // --- 核心操作 ---

    // 取得某人某天的班別代號
    getShiftByDate(dateStr, uid) {
        if (!this.schedule[dateStr]) return null;
        // 🔧 修正：動態獲取所有已定義的班別代號，而不僅限於 N, E, D, OFF
        const shiftCodes = Object.keys(this.schedule[dateStr]);
        for (const shiftCode of shiftCodes) {
            if (this.schedule[dateStr][shiftCode] && this.schedule[dateStr][shiftCode].includes(uid)) {
                return shiftCode;
            }
        }
        return null;
    }
    
    // 取得昨天的班別 (處理跨月)
    getYesterdayShift(uid, dateStr) {
        const today = new Date(dateStr);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        // 如果跨到上個月
        if (yesterday.getMonth() + 1 !== this.month) {
            // 從 lastMonthData 讀取 (需確保 lastMonthData 結構正確)
            // 這裡假設 lastMonthData[uid] 存的是上個月最後一天的班別代號
            if (this.lastMonthData && this.lastMonthData[uid]) {
                return this.lastMonthData[uid].lastShift || 'OFF';
            }
            return 'OFF'; // 預設
        }

        // 本月
        const yStr = this.getDateStrFromDate(yesterday);
        return this.getShiftByDate(yStr, uid) || 'OFF';
    }

    // 更新班別 (核心：會同步更新計數器)
    updateShift(dateStr, uid, oldShift, newShift) {
        if (oldShift === newShift) return;

        // 1. 從舊班別移除
        if (oldShift && this.schedule[dateStr][oldShift]) {
            const arr = this.schedule[dateStr][oldShift];
            const idx = arr.indexOf(uid);
            if (idx > -1) {
                arr.splice(idx, 1);
                // 更新統計
                if (this.counters[uid] && this.counters[uid][oldShift] !== undefined) {
                    this.counters[uid][oldShift]--;
                }
            }
        }

        // 2. 加入新班別
        if (newShift && this.schedule[dateStr][newShift]) {
            this.schedule[dateStr][newShift].push(uid);
            // 更新統計
            if (this.counters[uid] && this.counters[uid][newShift] !== undefined) {
                this.counters[uid][newShift]++;
            }
        }
    }

    // --- 查詢輔助 ---

    // 計算某天某班別目前排了幾人
    countStaff(day, shiftCode) {
        const dateStr = this.getDateStr(day);
        if (!this.schedule[dateStr] || !this.schedule[dateStr][shiftCode]) return 0;
        return this.schedule[dateStr][shiftCode].length;
    }

    // 取得某天某班別的需求人數
    getDemand(day, shiftCode) {
        const date = new Date(this.year, this.month - 1, day);
        const dayOfWeek = (date.getDay() + 6) % 7; // Mon=0 ... Sun=6
        const key = `${shiftCode}_${dayOfWeek}`;
        return (this.rules.dailyNeeds && this.rules.dailyNeeds[key]) || 0;
    }

    // --- 驗證邏輯 ---

    // 檢查基本合法性 (間隔、連上)
    isValidAssignment(staff, dateStr, shiftCode) {
        if (shiftCode === 'OFF') return true;

        // 1. 檢查間隔 (上一班 vs 這一班)
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (!this.checkRestPeriod(prevShift, shiftCode)) return false;

        // 2. 檢查連上天數
        // 注意：這需要往回算連續天數，這裡簡化處理，若要精確需實作 getConsecutiveWorkDays
        // 為了效能，V2 通常依賴 Heuristic，此處僅作基礎防守
        // if (this.getConsecutiveWorkDays(staff.id, dateStr) >= 6) return false;

        return true;
    }

    // 檢查 N-D 等間隔規則
    checkRestPeriod(prev, curr) {
        if (!prev || prev === 'OFF') return true;
        // 範例：禁止 N 接 D, N 接 E
        // 實際應讀取 rules.minGapHours
        if (prev.includes('N') && (curr === 'D' || curr === 'E')) return false;
        if (prev.includes('E') && curr === 'D') return false; 
        return true;
    }

    // --- 工具 ---
    getDateStr(d) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    
    getDateStrFromDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    
    // 用於建立 V1/V2 相容的白名單格式
    createWhitelist(staff, dateStr) {
        let list = [];
        // 1. 包班意願
        if (staff.packageType) list.push(staff.packageType);
        
        // 2. 每日偏好 (prefs 格式可能為 { "YYYY-MM-DD": {1:'N', 2:'OFF'} })
        if (staff.prefs && staff.prefs[dateStr]) {
            const p = staff.prefs[dateStr];
            if (p[1]) list.push(p[1]);
            if (p[2]) list.push(p[2]);
            if (p[3]) list.push(p[3]);
        }
        return list;
    }
}
