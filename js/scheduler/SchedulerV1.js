/**
 * 策略 V1: 標準排班 - 嚴格規則版
 * 特性：
 * 1. 白名單即為「合法可行名單」 (Whitelist = Allowed & Valid)
 * 2. 嚴格遵守間隔與連續上班限制
 * 3. 支援無偏好人員的預設排班
 */
class SchedulerV1 extends BaseScheduler {
    // 建構子需接收 shifts
    constructor(allStaff, year, month, lastMonthData, rules, shifts) {
        super(allStaff, year, month, lastMonthData, rules, shifts);
        this.dailyNeeds = rules.dailyNeeds || { "N_0":2, "E_0":3, "D_0":4 }; 
        this.checkInterval = 5; 
    }

    run() {
        console.log("=== V1 排班開始 (嚴格規則版) ===");
        this.resetAllToOff();
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.scheduleDay(d);
            this.fixDailyGaps(d);
            
            if (d % this.checkInterval === 0 || d === this.daysInMonth) {
                this.performHealthCheck(d);
            }
        }
        return this.schedule;
    }

    scheduleDay(day) {
        const dateStr = this.getDateStr(day);
        const dayOfWeek = new Date(dateStr).getDay(); 
        const adjustedDayIdx = (dayOfWeek + 6) % 7; 
        
        this.staffList.forEach(staff => {
            const currentStatus = this.getShiftByDate(dateStr, staff.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return;

            // 1. 產生合法的白名單 (已過濾掉違規班別)
            const whitelist = this.createWhitelist(staff, dateStr);
            const prevShift = this.getYesterdayShift(staff.id, dateStr);
            
            let candidate = 'OFF';

            // 2. 決策邏輯
            if (whitelist.length > 0) {
                // 優先順序：
                // A. 如果昨天上班，且該班別仍在今日白名單內 -> 優先順接 (減少換班)
                if (['N', 'E', 'D'].includes(prevShift) && whitelist.includes(prevShift)) {
                    candidate = prevShift;
                } 
                // B. 否則選白名單的第一順位
                else {
                    candidate = whitelist[0];
                }
            } else {
                // 白名單為空 (代表今天排任何班都會違規，或者真的不想上班) -> OFF
                candidate = 'OFF';
            }

            this.updateShift(dateStr, staff.id, 'OFF', candidate);
        });

        this.balanceStaff(dateStr, adjustedDayIdx);
    }

    // ==========================================
    // [核心] 產生「合法」白名單
    // ==========================================
    createWhitelist(staff, dateStr) {
        let rawList = [];

        // 1. 收集意願
        // A. 包班
        if (staff.packageType && ['N', 'E', 'D'].includes(staff.packageType)) {
            rawList.push(staff.packageType);
        }
        
        // B. 每日偏好 (1, 2, 3)
        if (staff.prefs && staff.prefs[dateStr]) {
            if (staff.prefs[dateStr][1]) rawList.push(staff.prefs[dateStr][1]);
            if (staff.prefs[dateStr][2]) rawList.push(staff.prefs[dateStr][2]);
            if (staff.prefs[dateStr][3]) rawList.push(staff.prefs[dateStr][3]);
        }

        // C. 無偏好處理 (Open Availability)
        // 如果當天沒有劃休，也沒有填志願，視為可排任意班 (D/E/N)
        // 這是解決「巫宇涵未補 D」的關鍵
        if (rawList.length === 0) {
            rawList = ['D', 'E', 'N']; 
        }

        // 去重
        rawList = [...new Set(rawList)];

        // 2. 過濾規則 (Filter by Rules)
        // 只有通過 isValidAssignment 的班別才能進入最終白名單
        // 這解決了「連續上班太長」的問題 (一旦滿6天，D/E/N 都會被濾掉，回傳空陣列 -> 只能 OFF)
        const validList = rawList.filter(shift => {
            return this.isValidAssignment(staff, dateStr, shift);
        });

        return validList;
    }

    // 合規檢查
    isValidAssignment(staff, dateStr, shift) {
        if (shift === 'OFF') return true;

        // 1. 間隔 (Check Rest Period via DB Shifts)
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (!this.checkRestPeriod(prevShift, shift)) return false;

        // 2. 週種類
        if (!this.checkWeeklyVariety(staff.id, dateStr, shift)) return false;

        // 3. 連續上班天數 (嚴格限制)
        const maxCons = this.rules.policy?.maxConsDays || 6; 
        const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
        
        // 若昨天已達上限，今天不能再排
        if (currentCons >= maxCons) return false;

        return true;
    }

    balanceStaff(dateStr, dayIdx) {
        const shifts = ['N', 'E', 'D'];
        
        // 補缺
        shifts.forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let count = this.schedule[dateStr][shift].length;
            while (count < demand) {
                if (this.fillShortage(dateStr, shift)) count++;
                else break; 
            }
        });

        // 減剩
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
            
            // 使用 createWhitelist 取得該員當天「所有合法班別」
            // 因為 createWhitelist 已經內建 isValidAssignment 檢查，所以這裡只要看 targetShift 是否在名單內即可
            const whitelist = this.createWhitelist(s, dateStr);
            const prefIndex = whitelist.indexOf(targetShift); 
            
            // 必須在合法白名單內 (遵守不放寬原則)
            if (prefIndex === -1) return; 

            candidates.push({
                id: s.id,
                current: current,
                prefIndex: prefIndex, 
                totalOff: this.counters[s.id].OFF
            });
        });

        if (candidates.length === 0) return false;

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

        candidates.sort((a, b) => {
            if (a.totalOff !== b.totalOff) return a.totalOff - b.totalOff; 
            if (a.forcedOff !== b.forcedOff) return a.forcedOff - b.forcedOff;
            return a.uidVal - b.uidVal;
        });

        const victim = candidates[0];
        this.updateShift(dateStr, victim.id, sourceShift, 'OFF');
        this.counters[victim.id].forcedOffCount++; 
        return true;
    }

    // 每日回溯 (呼叫 fillShortage 再次嘗試)
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

    // OFF 平衡 (同前)
    performHealthCheck(currentDay) {
        for (let k = 0; k < 50; k++) {
            let minOff = 999, maxOff = -1;
            let poorStaff = null, richStaff = null;
            this.staffList.forEach(s => {
                const offs = this.counters[s.id].OFF;
                if (offs < minOff) { minOff = offs; poorStaff = s; }
                if (offs > maxOff) { maxOff = offs; richStaff = s; }
            });
            if (maxOff - minOff <= 2) break;

            const startCheckDay = Math.max(1, currentDay - this.checkInterval + 1);
            let swapped = false;
            for (let d = currentDay; d >= startCheckDay; d--) {
                const dateStr = this.getDateStr(d);
                const poorShift = this.getShiftByDate(dateStr, poorStaff.id);
                const richShift = this.getShiftByDate(dateStr, richStaff.id);
                
                if (['N', 'E', 'D'].includes(poorShift) && richShift === 'OFF') {
                    // 交換檢查：雙方交換後都必須在自己的 whitelist 內 (且合規)
                    const poorWL = this.createWhitelist(poorStaff, dateStr); // 含 'OFF'? createWhitelist return valid shifts usually excluding OFF
                    // OFF 總是合規，所以只需檢查 rich 是否能接 poorShift
                    const richWL = this.createWhitelist(richStaff, dateStr);
                    
                    if (richWL.includes(poorShift)) {
                        // 雖然在白名單內 (表示合規且有意願)，但還需檢查「明天」的影響 (BaseScheduler 未實作未來檢查，這裡做簡單 check)
                        if (this.isSafeSwap(dateStr, richStaff, poorShift) && this.isSafeSwap(dateStr, poorStaff, 'OFF')) {
                            this.updateShift(dateStr, poorStaff.id, poorShift, 'OFF');
                            this.updateShift(dateStr, richStaff.id, 'OFF', poorShift);
                            swapped = true;
                            break;
                        }
                    }
                }
            }
            if (!swapped) break; 
        }
    }

    isSafeSwap(dateStr, staff, newShift) {
        // 白名單已包含 isValidAssignment (當日檢查)，這裡額外檢查「明天」
        // (因為 createWhitelist 只看昨天，沒看明天)
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1);
        if (d.getMonth() + 1 === this.month && d.getDate() <= this.daysInMonth) {
            const nextDateStr = this.getDateStrFromDate(d);
            const nextShift = this.getShiftByDate(nextDateStr, staff.id);
            if (!this.checkRestPeriod(newShift, nextShift)) return false;
        }
        return true;
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
}
