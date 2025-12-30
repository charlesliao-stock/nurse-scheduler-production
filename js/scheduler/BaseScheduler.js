/**
 * AI 排班核心基礎類別 (BaseScheduler)
 * 負責：原子化更新、連續性檢查、計數器維護、權重計算
 */
class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff; 
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        
        // 外部資料與設定
        this.lastMonthData = lastMonthData || {}; // { staffId: { lastShift: 'N', consecutiveDays: 3 } }
        this.rules = rules || {}; // 排班規則
        
        // 內部狀態
        this.schedule = {}; // { '2025-12-01': { N:[], E:[], D:[], OFF:[], LEAVE:[] } }
        this.counters = {}; // 快取計數器 { staffId: { N:0, E:0, D:0, OFF:0, LEAVE:0 } }
        this.debugMode = true;

        this.init();
    }

    init() {
        // 1. 初始化計數器
        this.staffList.forEach(s => {
            this.counters[s.id] = { N: 0, E: 0, D: 0, OFF: 0, LEAVE: 0 };
        });

        // 2. 初始化每日班表結構
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = { N: [], E: [], D: [], OFF: [], LEAVE: [] };
        }

        // 3. 載入預假與初始狀態
        this.staffList.forEach(s => {
            // 預設所有人每天都是 OFF (未排班狀態)
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                
                // 檢查是否有預假 (Leaves)
                const preShift = this.getPreScheduledShift(s, dateStr);
                if (preShift === 'LEAVE' || preShift === 'REQ_OFF') {
                    this._addToSchedule(dateStr, s.id, 'LEAVE');
                    this.counters[s.id].LEAVE++;
                    this.counters[s.id].OFF++; // 預假也算在總休假中
                } else {
                    this._addToSchedule(dateStr, s.id, 'OFF');
                    this.counters[s.id].OFF++;
                }
            }
        });
    }

    // ==========================================
    // Core 1: 原子化更新 (Atomic Updates)
    // ==========================================
    updateShift(dateStr, staffId, oldShift, newShift) {
        if (oldShift === newShift) return;

        // 1. 執行班表陣列異動
        this._removeFromSchedule(dateStr, staffId, oldShift);
        this._addToSchedule(dateStr, staffId, newShift);

        // 2. 更新計數器 (快取)
        this._updateCounterCache(staffId, oldShift, -1);
        this._updateCounterCache(staffId, newShift, 1);
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

    _updateCounterCache(staffId, shift, delta) {
        if (!this.counters[staffId]) return;
        
        // 更新特定班別計數
        if (this.counters[staffId][shift] !== undefined) {
            this.counters[staffId][shift] += delta;
        }

        // 特別處理 OFF 計數 (LEAVE 也算 OFF, 排班 OFF 也算 OFF)
        // 邏輯：從 OFF/LEAVE 變成 上班 -> OFF_count 減少
        // 從 上班 變成 OFF/LEAVE -> OFF_count 增加
        const isOldOff = ['OFF', 'LEAVE', 'REQ_OFF'].includes(shift);
        
        // 這裡需要精確判斷：此函數是 updateShift，所以要看是從什麼變什麼
        // 簡化邏輯：我們直接維護一個 totalOFF 屬性
        // 如果是 (N/E/D) -> (OFF/LEAVE) : delta=+1
        // 如果是 (OFF/LEAVE) -> (N/E/D) : delta=-1
        // 這裡為求穩健，建議由 updateShift 呼叫時處理，或者單純依賴 counters.OFF 和 counters.LEAVE 加總
    }

    // 重寫 updateShift 的計數器邏輯以確保準確
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

    // ==========================================
    // Core 2: 連續性檢查 (Continuity Rules)
    // ==========================================
    isValidContinuity(staff, dateStr, targetShift) {
        // 若是排休或請假，通常不違反連續性 (視規則而定)
        if (targetShift === 'OFF' || targetShift === 'LEAVE') return true;

        // 1. 取得昨天的班別 (處理跨月)
        const prevShift = this.getYesterdayShift(staff.id, dateStr);

        // 2. 規則：禁止班別轉換 (N不接D, N不接E等)
        const forbidden = this.rules.forbiddenTransitions || { "N": ["D", "E"] };
        if (forbidden[prevShift] && forbidden[prevShift].includes(targetShift)) {
            return false;
        }

        // 3. 規則：最大連續上班天數 (勞基法連6或連7)
        const maxCons = this.rules.maxConsecutiveWorkDays || 6;
        // 回溯計算：如果今天排下去，會是第幾天？
        const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
        if (currentCons + 1 > maxCons) {
            return false; 
        }

        // 4. 規則：新增 D 不接 N (白班接大夜太累)
        // 若 rules 有設定 D -> N 禁止，會在上方 forbidden 處理。
        // 若無設定，可在此硬性加入：
        if (prevShift === 'D' && targetShift === 'N') return false; 

        return true;
    }

    // 取得昨天的班別 (含跨月處理)
    getYesterdayShift(staffId, dateStr) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() - 1); // 昨天

        // 跨月邊界檢查
        if (d.getMonth() + 1 !== this.month) {
            // 從 lastMonthData 讀取
            const lastData = this.lastMonthData[staffId]; 
            // 假設 lastMonthData 結構: { code: 'N' } 或直接是字串
            if (lastData) return lastData.lastShiftCode || lastData.code || 'OFF';
            return 'OFF';
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

    // 回溯計算連續上班天數
    getConsecutiveWorkDays(staffId, dateStr) {
        let count = 0;
        const d = new Date(dateStr);
        
        // 往回查 10 天就夠了
        for (let i = 1; i <= 10; i++) {
            d.setDate(d.getDate() - 1);
            
            // 處理跨月
            let shift;
            if (d.getMonth() + 1 !== this.month) {
                // 讀取上月資料的 consecutiveDays (如果有)
                // 這裡簡化：若上月最後一天是班，假設已連上 X 天
                const lastData = this.lastMonthData[staffId];
                if (i === 1 && lastData && ['N','E','D'].includes(lastData.lastShiftCode)) {
                    count += (lastData.consecutiveDays || 1);
                }
                break; // 跨月資料只讀一次，停止回溯
            } else {
                const prevDateStr = this.getDateStrFromDate(d);
                shift = this.getShiftByDate(prevDateStr, staffId);
            }

            if (['N', 'E', 'D'].includes(shift)) {
                count++;
            } else {
                break; // 遇到 OFF/LEAVE 中斷
            }
        }
        return count;
    }

    // ==========================================
    // Core 3: 輔助與工具
    // ==========================================
    getDateStr(d) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    getDateStrFromDate(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    getPreScheduledShift(staff, dateStr) {
        // 從 staff.prefs 或 staff.preSchedule 讀取
        // 假設傳入的 staff 物件已經包含 prefs: { '2025-12-01': 'LEAVE' }
        if (staff.prefs && staff.prefs[dateStr]) {
            return staff.prefs[dateStr];
        }
        return null;
    }
    
    // 計算近 7 日疲勞度 (工作密度)
    calculateWeightedDensity(staffId, dateStr) {
        let score = 0;
        const d = new Date(dateStr);
        
        for(let i=1; i<=7; i++) {
            d.setDate(d.getDate() - 1);
            // 跨月簡化：暫不計算上個月的密度，避免複雜
            if (d.getMonth() + 1 !== this.month) break;
            
            const sStr = this.getDateStrFromDate(d);
            const shift = this.getShiftByDate(sStr, staffId);
            
            if (shift === 'N') score += 1.5;
            else if (shift === 'E') score += 1.2;
            else if (shift === 'D') score += 1.0;
        }
        return score;
    }
}
