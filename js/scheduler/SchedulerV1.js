/**
 * 策略 V1: 標準排班 - 軟著陸 + 強制均富版
 * 特性：
 * 1. 月初軟著陸 (Soft Landing): 前 7 天優先延續上月班別，遇 OFF 才切換偏好。
 * 2. 羅賓漢均富 (Robin Hood): 嚴格控制 OFF 差距，減少貧富不均。
 * 3. 嚴格合規 (Strict Rules): 遵守連六與間隔限制。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules, shifts) {
        super(allStaff, year, month, lastMonthData, rules, shifts);
        this.dailyNeeds = rules.dailyNeeds || { "N_0":2, "E_0":3, "D_0":4 }; 
        this.checkInterval = 3; // 縮短檢查週期，更頻繁地平衡 OFF
        this.switchedState = {}; // 追蹤每位員工是否已經完成「轉場」
    }

    run() {
        console.log("=== V1 排班開始 (軟著陸 + 強制均富) ===");
        this.resetAllToOff();
        
        // 初始化轉場狀態：預設大家都還沒轉場
        this.staffList.forEach(s => this.switchedState[s.id] = false);

        for (let d = 1; d <= this.daysInMonth; d++) {
            this.scheduleDay(d);
            
            // 每日多次回溯修補，確保不留紅字
            this.fixDailyGaps(d); 
            
            // 週期性平衡 OFF
            if (d % this.checkInterval === 0 || d === this.daysInMonth) {
                this.performHealthCheck(d);
            }
        }
        
        // 最後再來一次全域大平衡
        this.performHealthCheck(this.daysInMonth, 200); 

        return this.schedule;
    }

    scheduleDay(day) {
        const dateStr = this.getDateStr(day);
        const dayOfWeek = new Date(dateStr).getDay(); 
        const adjustedDayIdx = (dayOfWeek + 6) % 7; 
        
        // 隨機打亂處理順序，避免固定人員總是吃虧
        const shuffledStaff = [...this.staffList];
        this.shuffleArray(shuffledStaff);

        shuffledStaff.forEach(staff => {
            const currentStatus = this.getShiftByDate(dateStr, staff.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') {
                // 遇到預休，視為轉場完成 (自然斷點)
                this.switchedState[staff.id] = true;
                return;
            }

            const prevShift = this.getYesterdayShift(staff.id, dateStr);
            const isWorkingYesterday = ['N', 'E', 'D'].includes(prevShift);
            
            // 如果昨天是 OFF，代表這是一個自然的斷點，視為轉場完成
            if (prevShift === 'OFF' || prevShift === 'LEAVE') {
                this.switchedState[staff.id] = true;
            }

            // 取得該員的合法白名單
            const whitelist = this.createWhitelist(staff, dateStr);
            let candidate = 'OFF';

            // --- 核心邏輯：軟著陸 vs 正常排班 ---
            
            // 條件：在前 7 天內，且尚未完成轉場，且昨天有上班
            if (day <= 7 && !this.switchedState[staff.id] && isWorkingYesterday) {
                // 策略：優先延續昨天的班 (即使它不在今天的白名單偏好裡，只要合規就繼續上)
                // 這能避免為了轉班而浪費一個 OFF
                if (this.isValidAssignment(staff, dateStr, prevShift)) {
                    candidate = prevShift; 
                } else {
                    // 如果不能延續 (例如連六了，或間隔不足)，那只能 OFF
                    // 這是一個強制斷點，轉場將在明天完成
                    candidate = 'OFF';
                }
            } 
            else {
                // 正常模式：依照白名單偏好
                if (whitelist.length > 0) {
                    // 優先順接 (減少換班痛苦)
                    if (isWorkingYesterday && whitelist.includes(prevShift)) {
                        candidate = prevShift;
                    } else {
                        // 否則選第一志願
                        candidate = whitelist[0];
                    }
                }
            }

            this.updateShift(dateStr, staff.id, 'OFF', candidate);
        });

        // 人力平衡
        this.balanceStaff(dateStr, adjustedDayIdx);
    }

    // ==========================================
    // 平衡邏輯 (修正 OFF 分配不均)
    // ==========================================
    balanceStaff(dateStr, dayIdx) {
        const shifts = ['N', 'E', 'D'];
        
        // 1. 補缺 (Fill Shortage)
        // 優先抓「OFF 太多」的人回來上班
        shifts.forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let count = this.schedule[dateStr][shift].length;
            while (count < demand) {
                if (this.fillShortage(dateStr, shift)) count++;
                else break; 
            }
        });

        // 2. 減剩 (Reduce Surplus)
        // 優先踢「OFF 太少」的人去休假
        shifts.forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let count = this.schedule[dateStr][shift].length;
            while (count > demand) { 
                if (this.reduceSurplus(dateStr, shift)) count--;
                else break;
            }
        });
    }

    fillShortage(dateStr, targetShift) {
        let candidates = [];
        this.staffList.forEach(s => {
            const current = this.getShiftByDate(dateStr, s.id);
            if (current !== 'OFF') return; 
            
            const whitelist = this.createWhitelist(s, dateStr);
            const prefIndex = whitelist.indexOf(targetShift); 
            if (prefIndex === -1) return; 

            candidates.push({
                id: s.id,
                current: current,
                prefIndex: prefIndex, 
                totalOff: this.counters[s.id].OFF
            });
        });

        if (candidates.length === 0) return false;

        // [關鍵排序]
        // 1. OFF 最多的人優先 (b.totalOff - a.totalOff) -> 叫回來上班
        // 2. 偏好順位
        this.shuffleArray(candidates); // 先洗牌，避免同分時總是同一人
        candidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) return b.totalOff - a.totalOff; 
            return a.prefIndex - b.prefIndex;
        });

        const best = candidates[0];
        this.updateShift(dateStr, best.id, best.current, targetShift);
        return true;
    }

    reduceSurplus(dateStr, sourceShift) {
        const workers = this.schedule[dateStr][sourceShift];
        if (workers.length === 0) return false;

        let candidates = [];
        workers.forEach(uid => {
            const s = this.staffList.find(st => st.id === uid);
            candidates.push({
                id: s.id,
                forcedOff: this.counters[s.id].forcedOffCount,
                totalOff: this.counters[s.id].OFF,
                uidVal: parseInt(s.id) || 0 
            });
        });

        // [關鍵排序]
        // 1. OFF 最少的人優先 (a.totalOff - b.totalOff) -> 強制休假
        // 2. 被強迫次數
        this.shuffleArray(candidates);
        candidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) return a.totalOff - b.totalOff; 
            return a.forcedOff - b.forcedOff;
        });

        const victim = candidates[0];
        this.updateShift(dateStr, victim.id, sourceShift, 'OFF');
        this.counters[victim.id].forcedOffCount++; 
        return true;
    }

    // ==========================================
    // 全域交換 (拉平 OFF 曲線)
    // ==========================================
    performHealthCheck(currentDay, maxIter = 100) {
        for (let k = 0; k < maxIter; k++) {
            let minOff = 999, maxOff = -1;
            let poorStaff = null, richStaff = null;
            
            // 隨機打亂尋找極端值
            const shuffled = [...this.staffList];
            this.shuffleArray(shuffled);

            shuffled.forEach(s => {
                const offs = this.counters[s.id].OFF;
                if (offs < minOff) { minOff = offs; poorStaff = s; }
                if (offs > maxOff) { maxOff = offs; richStaff = s; }
            });

            // 容許誤差 1 天
            if (maxOff - minOff <= 1) break;

            // 尋找交換機會：過去 N 天內
            // Rich (OFF多) 吐出一天假給 Poor (OFF少)
            // 即：Rich 把自己的 OFF 換成 Poor 的上班
            let swapped = false;
            // 從這週往回找，效果較好
            for (let d = currentDay; d >= 1; d--) {
                const dateStr = this.getDateStr(d);
                const poorShift = this.getShiftByDate(dateStr, poorStaff.id); // 應該要是上班
                const richShift = this.getShiftByDate(dateStr, richStaff.id); // 應該要是 OFF

                if (['N', 'E', 'D'].includes(poorShift) && richShift === 'OFF') {
                    // 檢查 Rich 能不能接這個班
                    // 這裡稍微放寬：只要合規(isSafeSwap)即可，不一定要在第一志願白名單
                    // 因為這是為了公平性做的必要犧牲
                    
                    if (this.isSafeSwap(dateStr, richStaff, poorShift) && 
                        this.isSafeSwap(dateStr, poorStaff, 'OFF')) {
                        
                        this.updateShift(dateStr, poorStaff.id, poorShift, 'OFF');
                        this.updateShift(dateStr, richStaff.id, 'OFF', poorShift);
                        swapped = true;
                        break; 
                    }
                }
            }
            if (!swapped) break; // 換不動了
        }
    }

    // ==========================================
    // 基礎邏輯與白名單
    // ==========================================
    createWhitelist(staff, dateStr) {
        let rawList = [];
        if (staff.packageType && ['N', 'E', 'D'].includes(staff.packageType)) rawList.push(staff.packageType);
        if (staff.prefs && staff.prefs[dateStr]) {
            if (staff.prefs[dateStr][1]) rawList.push(staff.prefs[dateStr][1]);
            if (staff.prefs[dateStr][2]) rawList.push(staff.prefs[dateStr][2]);
            if (staff.prefs[dateStr][3]) rawList.push(staff.prefs[dateStr][3]);
        }
        if (rawList.length === 0) rawList = ['D', 'E', 'N']; 
        rawList = [...new Set(rawList)];
        return rawList.filter(shift => this.isValidAssignment(staff, dateStr, shift));
    }

    isValidAssignment(staff, dateStr, shift) {
        if (shift === 'OFF') return true;
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (!this.checkRestPeriod(prevShift, shift)) return false;
        if (!this.checkWeeklyVariety(staff.id, dateStr, shift)) return false;
        const maxCons = this.rules.policy?.maxConsDays || 6; 
        const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
        if (currentCons >= maxCons) return false;
        return true;
    }

    isSafeSwap(dateStr, staff, newShift) {
        // 基本當日檢查
        if (!this.isValidAssignment(staff, dateStr, newShift)) return false;
        
        // 未來檢查 (明日)
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1);
        if (d.getMonth() + 1 === this.month && d.getDate() <= this.daysInMonth) {
            const nextDateStr = this.getDateStrFromDate(d);
            const nextShift = this.getShiftByDate(nextDateStr, staff.id);
            if (!this.checkRestPeriod(newShift, nextShift)) return false;
        }
        return true;
    }

    fixDailyGaps(day) {
        const dateStr = this.getDateStr(day);
        const dayIdx = (new Date(dateStr).getDay() + 6) % 7;
        ['N', 'E', 'D'].forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let currentCount = this.schedule[dateStr][shift].length;
            while (currentCount < demand) {
                if (this.fillShortage(dateStr, shift)) currentCount++;
                else break;
            }
        });
    }

    getDailyDemand(shift, dayIdx) {
        const key = `${shift}_${dayIdx}`;
        if (this.rules.dailyNeeds && this.rules.dailyNeeds[key] !== undefined) return parseInt(this.rules.dailyNeeds[key]);
        return 0;
    }
    
    resetAllToOff() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') this.updateShift(dateStr, staff.id, 'OFF', 'OFF'); 
            }
        });
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}
