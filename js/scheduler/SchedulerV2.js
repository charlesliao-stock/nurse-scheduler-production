/**
 * js/scheduler/SchedulerV2.js
 * 策略 V2: 啟發式回溯排班 (Fuzzy Fairness + Backtracking)
 * * 核心邏輯：
 * 1. 容許誤差 (Tolerance)：兩人休假/夜班數差異在 2 天內，視為平等，優先維持「連班慣性」。
 * 2. 天數公平：差異超過容許值時，強制抓「欠班最多」的人來上班。
 * 3. 局部回溯：遇到死局 (Deadlock) 時，自動往回修正前 1~3 天的班表。
 */

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // 設定回溯深度 (預設往回挖 3 天)
        this.BACKTRACK_DEPTH = rules.backtrackDepth || 3;
        
        // 設定容許誤差 (差異幾天內不用斤斤計較，預設 2 天)
        this.TOLERANCE = (rules.tolerance !== undefined) ? rules.tolerance : 2;
        
        console.log(`🚀 Scheduler V2 啟動: 容許誤差 ${this.TOLERANCE} 天, 回溯深度 ${this.BACKTRACK_DEPTH} 天`);
    }

    run() {
        // 1. 初始化：保留預休 (REQ_OFF) 與 請假 (LEAVE)，其餘重置為 OFF
        this.resetSchedule();

        // 2. 逐日排班 (Day 1 -> Day 30)
        for (let day = 1; day <= this.daysInMonth; day++) {
            
            // 每一天，依序排 N -> E -> D (越難排的班越先卡位)
            // 這樣白班 (D) 會留在最後，因為白班人選最多，最好調整
            if (!this.solveDay(day, ['N', 'E', 'D'])) {
                console.warn(`⚠️ Day ${day} 無法完全滿足需求 (已盡力填補)`);
            }
        }
        
        return this.schedule;
    }

    /**
     * 重置排班，但保留預休
     */
    resetSchedule() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const current = this.getShiftByDate(dateStr, staff.id);
                // 只有不是預休或請假，才重置為 OFF
                if (current !== 'REQ_OFF' && current !== 'LEAVE' && !this.isLocked(d, staff.id)) {
                    this.updateShift(dateStr, staff.id, 'OFF', 'OFF');
                }
            }
        });
    }

    /**
     * 單日排班解題器 (含回溯邏輯)
     */
    solveDay(day, shiftOrder) {
        for (const shiftCode of shiftOrder) {
            const needed = this.getDemand(day, shiftCode);
            let currentCount = this.countStaff(day, shiftCode);

            // 迴圈直到補足缺額
            while (currentCount < needed) {
                // 步驟 1: 嘗試直接找「條件最好」的人 (Greedy)
                if (this.assignBestCandidate(day, shiftCode)) {
                    currentCount++;
                    continue;
                }

                // 步驟 2: 找不到人 -> 啟動回溯 (Backtracking)
                // 往回修整前幾天的班表，看能否釋放人力
                if (this.backtrack(day, shiftCode, 1)) {
                    currentCount++;
                    continue; // 回溯成功，補到人了
                }

                // 步驟 3: 回溯也失敗 -> 真的開天窗了
                console.error(`❌ Day ${day} [${shiftCode}] 開天窗 (缺 ${needed - currentCount} 人)`);
                break; // 跳出，換排下一個班別
            }
        }
        return true;
    }

    /**
     * 尋找並指派最佳人選
     */
    assignBestCandidate(day, shiftCode) {
        // 1. 找出所有「合法」的候選人
        const candidates = this.staffList.filter(staff => {
            const uid = staff.id;
            // A. 基本狀態檢查 (必須是 OFF 才能被排班)
            if (this.getShiftByDate(this.getDateStr(day), uid) !== 'OFF') return false; 
            if (this.isLocked(day, uid)) return false; 
            
            // B. 法規與規則檢查 (接班、連上...)
            // 這裡呼叫 BaseScheduler 的驗證邏輯
            if (!this.isValidAssignment(staff, this.getDateStr(day), shiftCode)) return false;

            return true;
        });

        if (candidates.length === 0) return false;

        // 2. [關鍵] 使用模糊比較邏輯排序
        candidates.sort((a, b) => this.compareCandidates(a, b, day, shiftCode));

        // 3. 選出第一名 (Winner)
        const best = candidates[0];

        // 4. 執行指派
        this.updateShift(this.getDateStr(day), best.id, 'OFF', shiftCode);
        return true;
    }

    /**
     * [邏輯大腦] 人員比較函數
     * 比較 A 與 B 誰更適合上這個班
     * 返回負值代表 A 優先，正值代表 B 優先
     */
    compareCandidates(a, b, day, shiftCode) {
        const dateStr = this.getDateStr(day);
        
        // 1. 第一關：慣性連班 (Continuity)
        // 目的：優先讓昨天上 N 的人今天續上 N，避免斷班 (N-OFF-N)
        const aPrev = this.getYesterdayShift(a.id, dateStr);
        const bPrev = this.getYesterdayShift(b.id, dateStr);
        
        const aIsSame = (aPrev === shiftCode);
        const bIsSame = (bPrev === shiftCode);
        
        if (aIsSame && !bIsSame) return -1; // A 贏 (A排前面)
        if (!aIsSame && bIsSame) return 1;  // B 贏
        
        // 2. 第二關：個人志願 (Preference)
        // 目的：優先滿足有填志願的人
        const aWants = this.checkWillingness(a, dateStr, shiftCode);
        const bWants = this.checkWillingness(b, dateStr, shiftCode);
        
        if (aWants && !bWants) return -1;
        if (!aWants && bWants) return 1;

        // 3. 第三關：天數公平性 (模糊比較)
        const aStats = this.counters[a.id];
        const bStats = this.counters[b.id];

        // 根據班別類型決定比較標的
        let aVal, bVal;
        let isNight = ['N', 'E'].includes(shiftCode);

        if (isNight) {
            // 排夜班：比較夜班數 (少的優先)
            aVal = aStats[shiftCode]; 
            bVal = bStats[shiftCode];
        } else {
            // 排白班：比較休假數 (OFF 越多 = 工時越少 = 越應該被抓來上班)
            // 注意這裡反向比較
            aVal = bStats.OFF; 
            bVal = aStats.OFF; 
        }

        const diff = Math.abs(aVal - bVal);

        // --- [核心修正] ---
        
        // 情況 A: 差距過大 (超過容許值) -> 嚴格執行公平性
        // 誰缺的多，誰就一定要上班
        if (diff > this.TOLERANCE) {
            return aVal - bVal; // 升序：數值小的優先
        }

        // 情況 B: 差距在容許範圍內 (例如只差 1-2 天) -> 忽略天數，改看「連班慣性」
        // 這是為了避免「上1-休1」
        
        // 檢查昨天的狀態：有上班 vs 沒上班 (OFF)
        // 排除 REQ_OFF 造成的休假，只看是否排班造成的休假
        const aWorkedYesterday = (aPrev !== 'OFF' && aPrev !== 'REQ_OFF');
        const bWorkedYesterday = (bPrev !== 'OFF' && bPrev !== 'REQ_OFF');

        // 如果 A 昨天有上班，B 昨天休假 -> 優先排 A 繼續上班 (連班)，讓 B 繼續休假 (連休)
        if (aWorkedYesterday && !bWorkedYesterday) return -1;
        if (!aWorkedYesterday && bWorkedYesterday) return 1;

        // 4. 第四關：如果連狀態都一樣，隨機 (避免永遠是編號 001 的人被選中)
        return Math.random() - 0.5;
    }

    /**
     * 回溯機制 (Recursive Repair)
     */
    backtrack(day, shiftCode, depth) {
        if (depth > this.BACKTRACK_DEPTH) return false;
        if (day - depth < 1) return false;

        const targetDate = day;
        const pastDate = day - depth;

        // 尋找救星：目前在 targetDate 是 OFF，但因為 pastDate 的排班導致現在不能上的人
        // 我們嘗試去修改他在 pastDate 的班
        const potentialSaviors = this.staffList.filter(staff => {
            // 他現在必須是 OFF (如果已有班就不用救了，那是人力總數不足的問題)
            if (this.getShiftByDate(this.getDateStr(targetDate), staff.id) !== 'OFF') return false;
            // 過去那天不能是鎖定的
            if (this.isLocked(pastDate, staff.id)) return false;

            const originalPastShift = this.getShiftByDate(this.getDateStr(pastDate), staff.id);
            if (originalPastShift === 'OFF') return false; 

            // 模擬測試：如果他那天改休假，今天能否上班？
            this.updateShift(this.getDateStr(pastDate), staff.id, originalPastShift, 'OFF');
            const canWorkNow = this.isValidAssignment(staff, this.getDateStr(targetDate), shiftCode);
            // 還原
            this.updateShift(this.getDateStr(pastDate), staff.id, 'OFF', originalPastShift);

            return canWorkNow;
        });

        for (const savior of potentialSaviors) {
            const originalShift = this.getShiftByDate(this.getDateStr(pastDate), savior.id);

            // 策略 1: 簡單回溯 (如果那天其實不缺人，直接讓他休)
            if (this.countStaff(pastDate, originalShift) > this.getDemand(pastDate, originalShift)) {
                 this.updateShift(this.getDateStr(pastDate), savior.id, originalShift, 'OFF');
                 this.updateShift(this.getDateStr(targetDate), savior.id, 'OFF', shiftCode);
                 console.log(`🔨 簡單回溯：${savior.name} Day ${pastDate} 改休，支援 Day ${targetDate}`);
                 return true;
            }

            // 策略 2: 交換回溯 (找替死鬼 victim 來頂替 savior 在 pastDate 的班)
            const victim = this.findReplacement(pastDate, originalShift, [savior.id]);
            if (victim) {
                this.updateShift(this.getDateStr(pastDate), victim.id, 'OFF', originalShift); // Victim 頂班
                this.updateShift(this.getDateStr(pastDate), savior.id, originalShift, 'OFF'); // Savior 解放
                this.updateShift(this.getDateStr(targetDate), savior.id, 'OFF', shiftCode);   // Savior 救火
                console.log(`🔨 交換回溯：${victim.name} 替 ${savior.name} (Day ${pastDate})`);
                return true;
            }
        }
        
        // 往更深層找
        return this.backtrack(day, shiftCode, depth + 1);
    }

    findReplacement(day, shiftCode, excludeIds) {
        const candidates = this.staffList.filter(staff => {
            if (excludeIds.includes(staff.id)) return false;
            if (this.getShiftByDate(this.getDateStr(day), staff.id) !== 'OFF') return false;
            if (this.isLocked(day, staff.id)) return false;
            return this.isValidAssignment(staff, this.getDateStr(day), shiftCode);
        });

        if (candidates.length === 0) return null;
        // 使用相同的比較邏輯找最佳替補
        candidates.sort((a, b) => this.compareCandidates(a, b, day, shiftCode));
        return candidates[0];
    }

    // 輔助：判斷是否鎖定 (預休或請假)
    isLocked(day, uid) {
        const s = this.getShiftByDate(this.getDateStr(day), uid);
        return s === 'REQ_OFF' || s === 'LEAVE';
    }

    // 輔助：檢查意願 (相容 V1 的 createWhitelist)
    checkWillingness(staff, dateStr, shiftCode) {
        if (this.createWhitelist) {
            const list = this.createWhitelist(staff, dateStr);
            return list.includes(shiftCode);
        }
        return false;
    }
}
