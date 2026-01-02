// js/scheduler/SchedulerV1.js
/**
 * 策略 V1: 標準排班 - 軟著陸 + 強制均富版 (動態班別修正版)
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules, shifts) {
        super(allStaff, year, month, lastMonthData, rules, shifts);
        
        // [修正] 讀取 Rules 中的設定，若無則為空物件 (避免預設值與單位班別衝突)
        this.dailyNeeds = rules.dailyNeeds || {}; 
        
        // [修正] 從 AI 參數讀取設定
        const aiParams = rules.aiParams || {};
        this.checkInterval = aiParams.tolerance || 3; 
        this.switchedState = {}; 
    }

    run() {
        console.log(`=== V1 排班開始 (動態班別: ${this.workShiftCodes.join(',')}) ===`);
        
        // 初始化轉場狀態
        this.staffList.forEach(s => this.switchedState[s.id] = false);

        for (let d = 1; d <= this.daysInMonth; d++) {
            this.scheduleDay(d);
            this.fixDailyGaps(d);
            
            // 週期性檢查 (均富)
            if (d % this.checkInterval === 0 || d === this.daysInMonth) {
                this.performHealthCheck(d);
            }
        }
        return this.schedule;
    }

    scheduleDay(d) {
        const dateStr = this.getDateStr(d);
        const yesterday = this.getDateStr(d - 1);

        // 隨機打亂順序，避免固定人員優先
        const shuffledStaff = this.shuffleArray([...this.staffList]);

        shuffledStaff.forEach(staff => {
            // 1. 如果已有預班 (REQ_OFF / 包班)，跳過
            if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') return;

            // 2. 軟著陸邏輯 (Soft Landing)
            // 如果還沒轉場 (月初)，且昨天有上班，優先延續昨天的班
            if (d <= 7 && !this.switchedState[staff.id]) {
                const prevShift = (d === 1) 
                    ? (this.lastMonthData[staff.id]?.lastShift || 'OFF') 
                    : this.getShiftByDate(yesterday, staff.id);

                if (this.isWorkShift(prevShift)) {
                    if (this.tryAssign(dateStr, staff, prevShift)) return;
                } else {
                    // 昨天是 OFF，標記轉場完成，開始接受新排班
                    this.switchedState[staff.id] = true;
                }
            }

            // 3. 正常排班 (依據志願序 或 隨機)
            // 這裡簡化：隨機嘗試所有工作班別
            // 實務上應讀取 staff.preferences
            const shiftCandidates = this.shuffleArray([...this.workShiftCodes]);
            
            for (const shift of shiftCandidates) {
                if (this.tryAssign(dateStr, staff, shift)) return;
            }
        });
    }

    tryAssign(dateStr, staff, shift) {
        // 檢查 1: 間隔 (Rest Period)
        const d = new Date(dateStr).getDate();
        const prevDate = this.getDateStr(d - 1);
        const prevShift = (d === 1) 
            ? (this.lastMonthData[staff.id]?.lastShift || 'OFF') 
            : this.getShiftByDate(prevDate, staff.id);

        if (!this.checkRestPeriod(prevShift, shift)) return false;

        // 檢查 2: 連續上班 (Consecutive Days)
        // 暫時加上班，計算連續天數
        this.updateShift(dateStr, staff.id, 'OFF', shift);
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        
        // 復原 (Backtrack)
        this.updateShift(dateStr, staff.id, shift, 'OFF');

        const maxCons = this.rules.policy?.maxConsDays || 6;
        if (consDays > maxCons) return false;

        // 檢查通過，正式排班
        this.updateShift(dateStr, staff.id, 'OFF', shift);
        return true;
    }

    fixDailyGaps(day) {
        const dateStr = this.getDateStr(day);
        const dayIdx = (new Date(dateStr).getDay() + 6) % 7; // Mon=0

        // [修正] 使用動態班別清單
        this.workShiftCodes.forEach(shift => {
            const demand = this.getDailyDemand(shift, dayIdx);
            let currentCount = this.schedule[dateStr][shift].length;

            // 若人力不足，嘗試補人
            let attempts = 0;
            while (currentCount < demand && attempts < 50) {
                if (this.fillShortage(dateStr, shift)) currentCount++;
                else break; // 補不到人就放棄
                attempts++;
            }
        });
    }

    fillShortage(dateStr, targetShift) {
        // 找出當天休假的人，且 OFF 數最多的人優先 (均富)
        let candidates = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
        
        candidates.sort((a, b) => this.counters[b.id].OFF - this.counters[a.id].OFF);

        for (const staff of candidates) {
            if (this.tryAssign(dateStr, staff, targetShift)) return true;
        }
        return false;
    }

    performHealthCheck(currentDay) {
        // 簡易均富檢查：找出 OFF 最多與最少的人，嘗試交換
        // 這裡僅示範邏輯，實際優化需配合 PriorityQueue
        let maxIter = 50;
        for(let k=0; k<maxIter; k++) {
            // ... (交換邏輯可沿用原版，但需確保只交換 workShiftCodes 內的班別)
        }
    }

    getDailyDemand(shift, dayIdx) {
        // key 格式: "N_0", "D_1" 等
        const key = `${shift}_${dayIdx}`;
        if (this.dailyNeeds[key] !== undefined) return parseInt(this.dailyNeeds[key]);
        return 0; // 預設需求 0
    }
    
    resetAllToOff() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const current = this.getShiftByDate(dateStr, staff.id);
                if (current !== 'REQ_OFF' && current !== 'LEAVE') {
                    this.updateShift(dateStr, staff.id, current, 'OFF');
                }
            }
        });
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}
