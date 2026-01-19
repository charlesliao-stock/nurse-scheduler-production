// js/scheduler/SchedulerV2.js
// 🚀 完整版：AI 支援特定需求 & 動態組別限制

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

        if (!userAllowRelax) {
            this.postProcessBalancing(this.daysInMonth);
        }

        return this.formatResult();
    }

    getDailyNeeds(day) {
        const dateStr = this.getDateStr(day);
        const date = new Date(this.year, this.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; 
        
        const needs = {};
        this.shiftCodes.forEach(code => {
            if(code === 'OFF' || code === 'REQ_OFF') return;
            
            let val = 0;
            if (this.rules.specificNeeds?.[dateStr]?.[code] !== undefined) {
                val = this.rules.specificNeeds[dateStr][code];
            } else {
                const key = `${code}_${dayIdx}`;
                val = this.rules.dailyNeeds?.[key] || 0;
            }
            
            if (val > 0) needs[code] = val;
        });
        return needs;
    }

    solveDay(day, isRelaxMode) {
        const dateStr = this.getDateStr(day);
        const needs = this.getDailyNeeds(day);
        const staffPool = this.getAvailableStaff(day);

        // 1. 檢查組別限制 (Max)
        // 在指派前，先統計目前已指派的人數 (針對每個組別)
        // 由於 solveDay 是逐一班別處理，我們在候選人排序時進行加權

        for (const [shiftCode, count] of Object.entries(needs)) {
            let needed = count - this.countStaff(day, shiftCode);
            if (needed <= 0) continue;

            const candidates = this.sortCandidates(staffPool, dateStr, shiftCode);
            for (const staff of candidates) {
                if (needed <= 0) break;
                if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') continue;
                
                // 增加組別上限檢查
                if (!this.checkGroupMaxLimit(day, staff, shiftCode)) continue;

                if (this.isValidAssignment(staff, dateStr, shiftCode, isRelaxMode)) {
                    this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                    needed--;
                }
            }
        }
        
        for (const [code, count] of Object.entries(needs)) {
            if (this.countStaff(day, code) < count) return false;
        }
        return true;
    }

    // 檢查組別 Max 限制
    checkGroupMaxLimit(day, staff, shiftCode) {
        // 如果沒有設定 rules.groupLimits 則跳過
        if (!this.rules.groupLimits) return true;
        
        const group = staff.group; // 假設 staff 物件有 group 屬性 (由編輯器傳入)
        if (!group) return true;

        const limit = this.rules.groupLimits[group]?.[shiftCode]?.max;
        if (limit === undefined || limit === null || limit === '') return true;

        // 計算該組別當天該班別已排人數
        let currentCount = 0;
        const dateStr = this.getDateStr(day);
        const assignedUids = this.schedule[dateStr][shiftCode] || [];
        
        assignedUids.forEach(uid => {
            const s = this.staffList.find(st => st.id === uid);
            if (s && s.group === group) currentCount++;
        });

        return currentCount < limit;
    }

    sortCandidates(staffList, dateStr, shiftCode) {
        const randomizedList = this.shuffleArray(staffList);
        
        // 需要取得組別 Min 限制，優先滿足未達標的組別
        return randomizedList.sort((a, b) => {
            const scoreA = this.calculateCandidateScore(a, dateStr, shiftCode);
            const scoreB = this.calculateCandidateScore(b, dateStr, shiftCode);
            return scoreB - scoreA; // 分數高者優先
        });
    }

    calculateCandidateScore(staff, dateStr, shiftCode) {
        let score = 0;
        
        // 1. 組別 Min 優先權
        if (this.rules.groupLimits && staff.group) {
            const minLimit = this.rules.groupLimits[staff.group]?.[shiftCode]?.min;
            if (minLimit) {
                // 計算目前該組該班人數
                let currentCount = 0;
                const assignedUids = this.schedule[dateStr][shiftCode] || [];
                assignedUids.forEach(uid => {
                    const s = this.staffList.find(st => st.id === uid);
                    if (s && s.group === staff.group) currentCount++;
                });
                
                if (currentCount < minLimit) score += 1000; // 極高優先權
            }
        }

        // 2. 班數平衡 (班數越少越優先)
        score -= this.getTotalShifts(staff.id);

        return score;
    }

    checkAndFillGap(day, allowRelax) {
        const needs = this.getDailyNeeds(day);
        const dateStr = this.getDateStr(day);
        for (const [targetShift, count] of Object.entries(needs)) {
            let currentCount = this.countStaff(day, targetShift);
            let gap = count - currentCount;
            if (gap > 0) {
                const offStaffs = this.staffList.filter(s => this.getShiftByDate(dateStr, s.id) === 'OFF');
                const candidates = this.shuffleArray(offStaffs);
                for (const staff of candidates) {
                    if (gap <= 0) break;
                    // 補洞時也要檢查組別上限
                    if (!this.checkGroupMaxLimit(day, staff, targetShift)) continue;

                    if (this.isValidAssignment(staff, dateStr, targetShift, allowRelax)) { 
                        this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                        gap--; continue;
                    }
                    if (this.rules.hard?.minGap11) {
                        const prevShift = this.getYesterdayShift(staff.id, dateStr);
                        if (!this.checkRestPeriod(prevShift, targetShift)) {
                            if (this.trySwapYesterday(staff, day, prevShift, allowRelax)) {
                                if (this.isValidAssignment(staff, dateStr, targetShift, allowRelax)) {
                                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                                    gap--; continue;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    shuffleArray(arr) { for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
    
    trySwapYesterday(target, day, bad, relax) { return false; }
    
    getTotalShifts(uid) { 
        const c=this.counters[uid]; 
        if(!c)return 0; 
        return Object.keys(c).reduce((s,k)=>k!=='OFF'?s+c[k]:s,0); 
    }
    
    lockPreRequests() { 
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                if (params[dateStr] === 'REQ_OFF') { this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF'); }
            }
        });
    }
    
    getAvailableStaff(day) { 
        const ds=this.getDateStr(day); 
        return this.staffList.filter(s=>this.getShiftByDate(ds,s.id)==='OFF'); 
    }
    
    clearDayAssignments(day) { 
        const dateStr = this.getDateStr(day);
        const shifts = this.schedule[dateStr];
        Object.keys(shifts).forEach(code => {
            if (code === 'OFF') return; 
            [...shifts[code]].forEach(uid => { this.updateShift(dateStr, uid, code, 'OFF'); });
        });
    }
    
    postProcessBalancing(limitDay) { 
        // 簡易平衡 (可擴充)
    }
    
    isLocked(ds, uid) { 
        const staff = this.staffList.find(s => s.id === uid);
        return staff?.schedulingParams?.[ds] === 'REQ_OFF';
    }
    
    formatResult() {
        const res = {};
        for(let d=1; d<=this.daysInMonth; d++){
            const ds = this.getDateStr(d);
            res[ds] = {};
            this.shiftCodes.forEach(code=>{
                if(code==='OFF')return;
                const ids = this.schedule[ds][code]||[];
                if(ids.length>0) res[ds][code] = ids;
            });
        }
        return res;
    }
}
