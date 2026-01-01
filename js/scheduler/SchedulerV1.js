/**
 * 策略 V1: 標準排班 (Standard Shift Scheduling) - 滾動修正版
 * 特性：
 * 1. 逐日排班 + 每日回溯 (Day-by-Day + Daily Backtracking)
 * 2. 週期性體檢 (Periodic Health Check): 每 5 天平衡一次 OFF
 * 3. 雙向合規檢查 (Bidirectional Validation)
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.dailyNeeds = rules.dailyNeeds || { "N_0":2, "E_0":3, "D_0":4 }; 
        this.checkInterval = 5; // 每 5 天做一次體檢
    }

    run() {
        console.log("=== V1 排班開始: 啟動滾動修正引擎 ===");
        
        // [Step 0] 初始化
        this.resetAllToOff();
        
        // [Step 1] 逐日推進
        for (let d = 1; d <= this.daysInMonth; d++) {
            // A. 排當天的班
            this.scheduleDay(d);

            // B. 解決當日缺口 (每日即時回溯)
            // 不等到月底才補，當天有洞當天補
            this.fixDailyGaps(d);

            // C. 週期性體檢 (OFF 平衡)
            if (d % this.checkInterval === 0 || d === this.daysInMonth) {
                console.log(`[體檢] Day ${d}: 執行 OFF 平衡檢查...`);
                this.performHealthCheck(d);
            }
        }

        return this.schedule;
    }

    // ==========================================
    // 每日核心排班
    // ==========================================
    scheduleDay(day) {
        const dateStr = this.getDateStr(day);
        const dayOfWeek = new Date(dateStr).getDay(); 
        const adjustedDayIdx = (dayOfWeek + 6) % 7; 
        
        // 1. 初始填班
        this.staffList.forEach(staff => {
            const currentStatus = this.getShiftByDate(dateStr, staff.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return;

            const prevShift = this.getYesterdayShift(staff.id, dateStr);
            let whitelist = this.createWhitelist(staff, dateStr);
            let candidate = 'OFF';
            
            if (prevShift === 'OFF' || prevShift === 'LEAVE') {
                if (whitelist.length > 0) candidate = whitelist[0];
            } else {
                // 順接優先
                if (this.isValidAssignment(staff, dateStr, prevShift)) candidate = prevShift;
                else candidate = 'OFF'; 
            }

            if (candidate !== 'OFF' && !this.isValidAssignment(staff, dateStr, candidate)) {
                candidate = 'OFF';
            }
            this.updateShift(dateStr, staff.id, 'OFF', candidate);
        });

        // 2. 當日人力平衡 (初步)
        this.balanceStaff(dateStr, adjustedDayIdx);
    }

    // ==========================================
    // 週期性體檢 (Periodic Health Check)
    // ==========================================
    performHealthCheck(currentDay) {
        // 嘗試多次交換以收斂差異
        for (let k = 0; k < 50; k++) {
            // 1. 找出目前(截至今日) OFF 最多與最少的人
            let minOff = 999, maxOff = -1;
            let poorStaff = null, richStaff = null;

            this.staffList.forEach(s => {
                const offs = this.counters[s.id].OFF;
                if (offs < minOff) { minOff = offs; poorStaff = s; }
                if (offs > maxOff) { maxOff = offs; richStaff = s; }
            });

            // 如果差距在容許範圍內 (例如 2 天)，則不需調整
            if (maxOff - minOff <= 2) break;

            // 2. 嘗試「劫富濟貧」：Rich (OFF多) 吐出一天假，Poor (OFF少) 獲得一天假
            // 搜尋範圍：過去這段檢查週期內 (例如過去 5 天)
            const startCheckDay = Math.max(1, currentDay - this.checkInterval + 1);
            let swapped = false;

            for (let d = currentDay; d >= startCheckDay; d--) {
                const dateStr = this.getDateStr(d);
                const poorShift = this.getShiftByDate(dateStr, poorStaff.id); // 應該要是上班
                const richShift = this.getShiftByDate(dateStr, richStaff.id); // 應該要是 OFF

                // 條件：Poor 上班，Rich 休假 -> 嘗試交換
                if (['N', 'E', 'D'].includes(poorShift) && richShift === 'OFF') {
                    // 模擬交換：Rich 接手 poorShift，Poor 變 OFF
                    if (this.isSafeSwap(dateStr, richStaff, poorShift) && 
                        this.isSafeSwap(dateStr, poorStaff, 'OFF')) {
                        
                        // 執行交換
                        this.updateShift(dateStr, poorStaff.id, poorShift, 'OFF');
                        this.updateShift(dateStr, richStaff.id, 'OFF', poorShift);
                        swapped = true;
                        // console.log(`[平衡] Day ${d}: ${poorStaff.name} 轉休, ${richStaff.name} 代班 (${poorShift})`);
                        break; // 換成功一次就重新評估極端值
                    }
                }
            }
            if (!swapped) break; // 如果這對組合換不動，就跳出避免死迴圈 (或可隨機換人)
        }
    }

    /**
     * 雙向安全檢查：確認某人在某天換班後，不會違反「前一天」與「後一天」的規則
     */
    isSafeSwap(dateStr, staff, newShift) {
        // 1. 檢查白名單 (如果是上班班別)
        if (newShift !== 'OFF') {
            const whitelist = this.createWhitelist(staff, dateStr);
            // 這裡可以寬容一點：如果在白名單內最好，不在也行(為了公平)，但 V1 偏好嚴格
            // 為了平衡，我們允許 "不在白名單但合規" 的班? 暫時維持嚴格
            if (!whitelist.includes(newShift)) return false; 
        }

        // 2. 檢查與「前一天」的相容性
        if (!this.isValidAssignment(staff, dateStr, newShift)) return false;

        // 3. 檢查與「後一天」的相容性 (關鍵！)
        // 因為我們是回溯修改過去，所以必須看「明天」已經排好的班
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1); // 明天
        // 如果明天還沒排 (currentDay 剛好是邊界)，則不用查
        if (d.getMonth() + 1 === this.month && d.getDate() <= this.daysInMonth) {
            const nextDateStr = this.getDateStrFromDate(d);
            const nextShift = this.getShiftByDate(nextDateStr, staff.id);
            
            // 如果明天已經排了班，我們要檢查 (今天 newShift) -> (明天 nextShift) 是否合法
            // 檢查間隔
            if (!this.checkRestPeriod(newShift, nextShift)) return false;
            // 檢查 D不接N (反向)
            if (newShift === 'D' && nextShift === 'N') return false;
        }

        return true;
    }

    // ==========================================
    // 每日即時缺口修復 (Recursive Backtracking)
    // ==========================================
    fixDailyGaps(day) {
        const dateStr = this.getDateStr(day);
        const dayIdx = (new Date(dateStr).getDay() + 6) % 7;
        
        ['N', 'E', 'D'].forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let currentCount = this.schedule[dateStr][shift].length;

            while (currentCount < demand) {
                // 嘗試回溯解決 (深度限制 3)
                if (this.solveGapWithBacktrack(day, shift, 0)) {
                    currentCount++;
                } else {
                    break; // 真的無解
                }
            }
        });
    }

    solveGapWithBacktrack(day, targetShift, depth) {
        if (depth > 2) return false; // 淺層回溯即可，太深會慢
        if (day <= 1) return false;

        const dateStr = this.getDateStr(day);
        
        // 候選人：目前沒上 targetShift，但在白名單內的人
        let candidates = this.staffList.filter(s => {
            const current = this.getShiftByDate(dateStr, s.id);
            if (current === targetShift || current === 'REQ_OFF' || current === 'LEAVE') return false;
            const whitelist = this.createWhitelist(s, dateStr);
            return whitelist.includes(targetShift);
        });

        // 優先找 OFF 數多的人
        candidates.sort((a, b) => this.counters[b.id].OFF - this.counters[a.id].OFF);

        for (let staff of candidates) {
            const yesterdayDateStr = this.getDateStr(day - 1);
            const conflictShift = this.getShiftByDate(yesterdayDateStr, staff.id); 

            if (conflictShift === 'OFF' || conflictShift === 'REQ_OFF') continue;

            // 模擬：如果昨天把他改成 OFF (騰出空間)
            // 先暫存
            this.updateShift(yesterdayDateStr, staff.id, conflictShift, 'OFF');
            
            // 檢查今天能否排入 targetShift
            if (this.isValidAssignment(staff, dateStr, targetShift)) {
                // 成功騰出空間！但昨天 conflictShift 出缺口了，需要找人補昨天
                // 遞迴呼叫：去補昨天的 conflictShift
                const yesterdayFixed = this.solveGapWithBacktrack(day - 1, conflictShift, depth + 1);
                
                if (yesterdayFixed) {
                    // 連鎖成功：昨天補好了，今天 staff 排入 targetShift
                    // staff 原本今天的班 (可能是 OFF 或其他) 也要更新
                    const current = this.getShiftByDate(dateStr, staff.id); // 應該是 OFF 因為 updateShift 沒動今天
                    // 這裡要注意：上面 isValidAssignment 只是檢查，還沒改今天的班
                    // 現在確認要改了
                    this.updateShift(dateStr, staff.id, current, targetShift);
                    return true;
                } else {
                    // 昨天補不起來，復原
                    this.updateShift(yesterdayDateStr, staff.id, 'OFF', conflictShift);
                }
            } else {
                // 就算休假也不能上，復原
                this.updateShift(yesterdayDateStr, staff.id, 'OFF', conflictShift);
            }
        }

        // 最後手段：直接補人 (不回溯，只看有無閒置人力)
        return this.fillShortage(dateStr, targetShift);
    }

    // ==========================================
    // 基礎邏輯
    // ==========================================
    createWhitelist(staff, dateStr) {
        let list = [];
        if (staff.packageType && ['N', 'E', 'D'].includes(staff.packageType)) list.push(staff.packageType);
        if (staff.prefs && staff.prefs[dateStr]) {
            if (staff.prefs[dateStr][1]) list.push(staff.prefs[dateStr][1]);
            if (staff.prefs[dateStr][2]) list.push(staff.prefs[dateStr][2]);
            if (staff.prefs[dateStr][3]) list.push(staff.prefs[dateStr][3]);
        }
        return [...new Set(list)];
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

    balanceStaff(dateStr, dayIdx) {
        const demand = { N: this.getDailyDemand('N', dayIdx), E: this.getDailyDemand('E', dayIdx), D: this.getDailyDemand('D', dayIdx) };
        const count = { N: this.schedule[dateStr]['N'].length, E: this.schedule[dateStr]['E'].length, D: this.schedule[dateStr]['D'].length };

        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] < demand[shift]) {
                if (this.fillShortage(dateStr, shift)) count[shift]++;
                else break; 
            }
        });
        ['N', 'E', 'D'].forEach(shift => {
            while (count[shift] > demand[shift]) { 
                if (this.reduceSurplus(dateStr, shift)) count[shift]--;
                else break;
            }
        });
    }

    fillShortage(dateStr, targetShift) {
        let candidates = [];
        this.staffList.forEach(s => {
            const current = this.getShiftByDate(dateStr, s.id);
            if (current !== 'OFF') return; 
            if (!this.isValidAssignment(s, dateStr, targetShift)) return;
            const whitelist = this.createWhitelist(s, dateStr);
            const prefIndex = whitelist.indexOf(targetShift); 
            if (prefIndex === -1) return; 
            candidates.push({ id: s.id, current: current, prefIndex: prefIndex, totalOff: this.counters[s.id].OFF });
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
            candidates.push({ id: s.id, forcedOff: this.counters[s.id].forcedOffCount, totalOff: this.counters[s.id].OFF, uidVal: parseInt(s.id) || 0 });
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
