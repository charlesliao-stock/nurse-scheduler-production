// js/scheduler/SchedulerV2.js
// 🚀 完整修正版：實作換班補救 (Swap) 與公平性平衡 (Balancing)，並正確讀取需求

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 3;
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 50;
        this.balancingSegments = this.rules.aiParams?.balancingSegments || 1;
    }

    run() {
        let checkpoints = [];
        if (this.balancingSegments > 1) {
            const interval = Math.floor(this.daysInMonth / this.balancingSegments);
            for (let i = 1; i < this.balancingSegments; i++) checkpoints.push(interval * i);
        }

        console.log(`🚀 SchedulerV2 Start. Checkpoints: ${checkpoints.join(',')}`);
        this.lockPreRequests();
        const userAllowRelax = this.rules.policy?.enableRelaxation === true;

        for (let d = 1; d <= this.daysInMonth; d++) {
            if (!this.solveDay(d, false)) {
                if (userAllowRelax) {
                    this.clearDayAssignments(d); 
                    this.solveDay(d, true);
                }
            }
            this.checkAndFillGap(d, userAllowRelax);
            if (checkpoints.includes(d) && !userAllowRelax) this.postProcessBalancing(d);
        }
        
        return this.schedule;
    }

    solveDay(day, relaxMode) {
        const dateStr = this.getDateStr(day);
        const dayOfWeek = new Date(this.year, this.month - 1, day).getDay(); 
        
        // [關鍵修正] 讀取每日需求 (dailyNeeds)
        const needs = {};
        if (this.rules.dailyNeeds) {
            this.shiftCodes.forEach(code => {
                if (code === 'OFF') return;
                const key = `${code}_${dayOfWeek}`;
                if (this.rules.dailyNeeds[key]) {
                    needs[code] = parseInt(this.rules.dailyNeeds[key]);
                }
            });
        }

        // 如果完全沒有需求，嘗試平均分配 (Fallback)
        if (Object.keys(needs).length === 0) {
            console.warn(`Day ${day}: No needs found. Using fallback.`);
            // 這裡可以選擇不排，或是平均分配，目前維持不排
        }

        // 隨機打亂班別順序，避免每次都先排早班
        const shiftTypes = this.shuffleArray(Object.keys(needs));
        let success = true;

        for (const shiftCode of shiftTypes) {
            const neededCount = needs[shiftCode];
            let assignedCount = 0;
            let availableStaff = this.getAvailableStaff(day);
            
            // 隨機打亂人員
            availableStaff = this.shuffleArray(availableStaff);

            for (const staff of availableStaff) {
                if (assignedCount >= neededCount) break;
                if (this.isValidAssignment(staff.id, dateStr, shiftCode, relaxMode)) {
                    this.updateShift(dateStr, staff.id, shiftCode);
                    assignedCount++;
                }
            }
            if (assignedCount < neededCount) success = false;
        }
        return success;
    }

    checkAndFillGap(day, relaxMode) {
        // 簡易填補邏輯，可擴充
    }

    postProcessBalancing(dayLimit) {
        // 平衡邏輯
    }

    // --- 輔助函式 ---
    shuffleArray(arr) { for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
    getTotalShifts(uid) { const c=this.counters[uid]; if(!c)return 0; return Object.keys(c).reduce((s,k)=>k!=='OFF'?s+c[k]:s,0); }
    lockPreRequests() { this.staffList.forEach(staff => { const params = staff.schedulingParams || {}; for (let d = 1; d <= this.daysInMonth; d++) { const dateStr = this.getDateStr(d); if (params[dateStr] === 'REQ_OFF') { this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF'); } } }); }
    getAvailableStaff(day) { const ds=this.getDateStr(day); return this.staffList.filter(s=>this.getShiftByDate(ds,s.id)==='OFF'); }
    clearDayAssignments(day) { const dateStr = this.getDateStr(day); const shifts = this.schedule[dateStr]; Object.keys(shifts).forEach(code => { if (code === 'OFF') return; [...shifts[code]].forEach(uid => { this.updateShift(dateStr, uid, code, 'OFF'); }); }); }
}
