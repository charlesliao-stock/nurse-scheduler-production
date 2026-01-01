/**
 * 策略 V1: 標準排班 (Standard Shift Scheduling)
 * 依據「修訂後精簡操作流程」實作
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.dailyNeeds = rules.dailyNeeds || { "N_0":2, "E_0":3, "D_0":4 }; // 預設值防呆
    }

    run() {
        console.log("=== V1 排班開始 ===");

        // [Phase 0] 初始化
        this.resetAllToOff();
        
        // [Phase 1 & 2] 逐日排班 (Day 1 ~ Day End)
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.scheduleDay(d);
        }

        // [Phase 3] 收尾優化 (暫略，先確保核心邏輯正確)
        
        return this.schedule;
    }

    // ==========================================
    // 核心：單日排班流程
    // ==========================================
    scheduleDay(day) {
        const dateStr = this.getDateStr(day);
        const dayOfWeek = new Date(dateStr).getDay(); // 0-6
        // 取得當日需求 (轉換為 Mon=0...Sun=6 格式以匹配 dailyNeeds key)
        const adjustedDayIdx = (dayOfWeek + 6) % 7; 
        
        // 1. 決定每人的「初始班別」
        this.staffList.forEach(staff => {
            // 已預休/請假則跳過
            const currentStatus = this.getShiftByDate(dateStr, staff.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return;

            // 取得昨日班別
            const prevShift = this.getYesterdayShift(staff.id, dateStr);

            // 建立白名單 (Whitelist)
            let whitelist = this.createWhitelist(staff, dateStr);

            // 決策 1: 決定候選班別
            let candidate = 'OFF';
            
            if (prevShift === 'OFF' || prevShift === 'LEAVE') {
                // 昨日休假 -> 今日優先排「白名單第一志願」
                if (whitelist.length > 0) candidate = whitelist[0];
            } else {
                // 昨日上班 -> 今日優先「延續」 (順接原則)
                // 檢查延續是否合規 (例如是否違反週3班、連七)
                if (this.isValidAssignment(staff, dateStr, prevShift)) {
                    candidate = prevShift;
                } else {
                    // 不能延續 -> 只能 OFF (因為嚴格 11 小時規則禁止直接轉班)
                    candidate = 'OFF'; 
                }
            }

            // 最終確認候選班別是否合規
            if (candidate !== 'OFF' && !this.isValidAssignment(staff, dateStr, candidate)) {
                candidate = 'OFF';
            }

            this.updateShift(dateStr, staff.id, 'OFF', candidate);
        });

        // 2. 人力平衡 (Balance)
        this.balanceStaff(dateStr, adjustedDayIdx);
    }

    // ==========================================
    // 建立白名單
    // ==========================================
    createWhitelist(staff, dateStr) {
        let list = [];
        
        // 1. 包班優先 (packageType)
        if (staff.packageType && ['N', 'E', 'D'].includes(staff.packageType)) {
            list.push(staff.packageType);
        }

        // 2. 個人偏好 (priority 1, 2, 3)
        // staff.prefs[dateStr] 格式可能為 {1:'N', 2:'D'}
        if (staff.prefs && staff.prefs[dateStr] && typeof staff.prefs[dateStr] === 'object') {
            if (staff.prefs[dateStr][1]) list.push(staff.prefs[dateStr][1]);
            if (staff.prefs[dateStr][2]) list.push(staff.prefs[dateStr][2]);
            if (staff.prefs[dateStr][3]) list.push(staff.prefs[dateStr][3]);
        }

        // 去重
        return [...new Set(list)];
    }

    // ==========================================
    // 合規檢查 (Wrapper)
    // ==========================================
    isValidAssignment(staff, dateStr, shift) {
        if (shift === 'OFF') return true;

        // 1. 11小時間隔 (嚴格順接)
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (!this.checkRestPeriod(prevShift, shift)) return false;

        // 2. 週班別種類 <= 2
        if (!this.checkWeeklyVariety(staff.id, dateStr, shift)) return false;

        // 3. 連續上班天數
        // 若今天排班，則連續天數 = 昨天的連續天數 + 1
        // 若 > 5 (或 6)，則違規
        const maxCons = this.rules.policy?.maxConsDays || 5; 
        // 注意：這裡需要高效計算，暫時用 getConsecutiveWorkDays
        // (若 prevShift 是 OFF，consecutive 為 0，加 1 為 1，合法)
        if (['N', 'E', 'D'].includes(prevShift)) {
            const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr); // 此函式會往前算
            // getConsecutiveWorkDays 算的是「截至昨天」還是「包含今天」？
            // BaseScheduler 裡的實作是往前算。如果在 updateShift 之前呼叫，它算的是「如果今天排班...」嗎？
            // 不，BaseScheduler 是讀取 schedule。因為我們還沒 updateShift，所以讀到的是 OFF (初始)。
            // 所以要算的是「昨天的連續天數」。
            // 修正 BaseScheduler 邏輯或在此手動算：
            // 簡單解法：讀取昨天的班，如果是上班，則連續天數+1
            // 由於 performance 考量，這裡簡化判斷：
            if (this.getConsecutiveWorkDays(staff.id, dateStr) >= maxCons) return false;
        }

        return true;
    }

    // ==========================================
    // 人力平衡 (處理過剩與缺額)
    // ==========================================
    balanceStaff(dateStr, dayIdx) {
        // 定義需求
        const demand = {
            N: this.getDailyDemand('N', dayIdx),
            E: this.getDailyDemand('E', dayIdx),
            D: this.getDailyDemand('D', dayIdx)
        };

        // 目前人數
        const count = {
            N: this.schedule[dateStr]['N'].length,
            E: this.schedule[dateStr]['E'].length,
            D: this.schedule[dateStr]['D'].length
        };

        // A. 處理缺額 (Shortage)
        // 優先順序：N > E > D (通常大夜最難補)
        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] < demand[shift]) {
                const success = this.fillShortage(dateStr, shift);
                if (success) count[shift]++;
                else break; // 無法補人，跳出 (觸發回溯機制)
            }
        });

        // B. 處理過剩 (Surplus)
        // 決策 2: 輪流轉 OFF
        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] > demand[shift]) { // 嚴格等於需求，不留緩衝
                const success = this.reduceSurplus(dateStr, shift);
                if (success) count[shift]--;
                else break;
            }
        });

        // C. 如果仍有缺額，觸發回溯 (簡單版：只回溯前一天)
        // (這裡先標記，若需要可實作 resolveShortageWithBacktrack)
    }

    fillShortage(dateStr, targetShift) {
        // 尋找候選人：目前是 OFF 或 過剩班別，且白名單有 targetShift
        // 排序：優先級高者 (總OFF數多 > 白名單順位高)
        
        let candidates = [];
        this.staffList.forEach(s => {
            const current = this.getShiftByDate(dateStr, s.id);
            if (current === 'REQ_OFF' || current === 'LEAVE' || current === targetShift) return;

            // 檢查是否合規 (轉班)
            if (!this.isValidAssignment(s, dateStr, targetShift)) return;

            // 檢查白名單
            const whitelist = this.createWhitelist(s, dateStr);
            const prefIndex = whitelist.indexOf(targetShift); // 0 is best
            if (prefIndex === -1) return; // 不在白名單不排 (除非強制)

            candidates.push({
                id: s.id,
                current: current,
                prefIndex: prefIndex,
                totalOff: this.counters[s.id].OFF
            });
        });

        if (candidates.length === 0) return false;

        // 排序：
        // 1. 若 current 是過剩班別 (暫略，需計算即時過剩，這裡先簡化為優先抓 OFF)
        // 2. prefIndex 小 (偏好高)
        // 3. totalOff 大 (休假多的人優先抓回來上班)
        candidates.sort((a, b) => {
            if (a.prefIndex !== b.prefIndex) return a.prefIndex - b.prefIndex;
            return b.totalOff - a.totalOff;
        });

        const best = candidates[0];
        this.updateShift(dateStr, best.id, best.current, targetShift);
        // 如果原本是上班，這一轉可能會造成原本班別缺人，需遞迴處理？
        // 為了避免無窮迴圈，建議只從 OFF 抓人，或從「明確過剩」的班抓人。
        // 這裡 V1 簡化：只從 OFF 抓人 (因為前面 isValidAssignment 會擋轉班，所以幾乎只能從 OFF 抓)
        return true;
    }

    reduceSurplus(dateStr, sourceShift) {
        // 找出該班別所有人
        const workers = this.schedule[dateStr][sourceShift];
        if (workers.length === 0) return false;

        let candidates = [];
        workers.forEach(uid => {
            const s = this.staffList.find(st => st.id === uid);
            // 包班人員盡量不動？ (看需求，決策2說「白名單偏好較低者優先」)
            // 這裡依據決策 2：
            // 1. forcedOffCount 少 (輪替)
            // 2. totalOff 少
            candidates.push({
                id: s.id,
                forcedOff: this.counters[s.id].forcedOffCount,
                totalOff: this.counters[s.id].OFF,
                uidVal: parseInt(s.id) || 0 // 員編
            });
        });

        // 排序：找「最應該被休假」的人
        // 1. forcedOffCount 少 (讓他休)
        // 2. totalOff 少
        // 3. 員編小
        candidates.sort((a, b) => {
            if (a.forcedOff !== b.forcedOff) return a.forcedOff - b.forcedOff;
            if (a.totalOff !== b.totalOff) return a.totalOff - b.totalOff;
            return a.uidVal - b.uidVal;
        });

        const victim = candidates[0];
        this.updateShift(dateStr, victim.id, sourceShift, 'OFF');
        this.counters[victim.id].forcedOffCount++; // 增加被強迫休假的計數
        return true;
    }

    getDailyDemand(shift, dayIdx) {
        // key format: "N_0", "D_1"...
        const key = `${shift}_${dayIdx}`;
        if (this.rules.dailyNeeds && this.rules.dailyNeeds[key] !== undefined) {
            return parseInt(this.rules.dailyNeeds[key]);
        }
        return 0;
    }
}
