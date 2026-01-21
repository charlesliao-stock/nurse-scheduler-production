// js/scheduler/SchedulerV2.js
// 🚀 完整修正版：實作換班補救 (Swap) 與公平性平衡 (Balancing)

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

        for (const [shiftCode, count] of Object.entries(needs)) {
            let needed = count - this.countStaff(day, shiftCode);
            if (needed <= 0) continue;

            const candidates = this.sortCandidates(staffPool, dateStr, shiftCode);
            for (const staff of candidates) {
                if (needed <= 0) break;
                if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') continue;
                
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

    checkGroupMaxLimit(day, staff, shiftCode) {
        if (!this.rules.groupLimits) return true;
        const group = staff.group; 
        if (!group) return true;

        const limit = this.rules.groupLimits[group]?.[shiftCode]?.max;
        if (limit === undefined || limit === null || limit === '') return true;

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
        return randomizedList.sort((a, b) => {
            const scoreA = this.calculateCandidateScore(a, dateStr, shiftCode);
            const scoreB = this.calculateCandidateScore(b, dateStr, shiftCode);
            return scoreB - scoreA; 
        });
    }

    calculateCandidateScore(staff, dateStr, shiftCode) {
        let score = 0;
        if (this.rules.groupLimits && staff.group) {
            const minLimit = this.rules.groupLimits[staff.group]?.[shiftCode]?.min;
            if (minLimit) {
                let currentCount = 0;
                const assignedUids = this.schedule[dateStr][shiftCode] || [];
                assignedUids.forEach(uid => {
                    const s = this.staffList.find(st => st.id === uid);
                    if (s && s.group === staff.group) currentCount++;
                });
                
                if (currentCount < minLimit) score += 1000; 
            }
        }
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
                    if (!this.checkGroupMaxLimit(day, staff, targetShift)) continue;

                    if (this.isValidAssignment(staff, dateStr, targetShift, allowRelax)) { 
                        this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                        gap--; 
                        continue;
                    }
                    // 嘗試「交換昨天」來解決間隔問題
                    if (this.rules.hard?.minGap11) {
                        const prevShift = this.getYesterdayShift(staff.id, dateStr);
                        if (!this.checkRestPeriod(prevShift, targetShift)) {
                            if (this.trySwapYesterday(staff, day, prevShift, allowRelax)) {
                                if (this.isValidAssignment(staff, dateStr, targetShift, allowRelax)) {
                                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                                    gap--; 
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * [實作] 換班補救：嘗試找昨天休假的人來跟目前卡住的人交換昨天的班
     */
    trySwapYesterday(targetStaff, currentDay, badPrevShift, allowRelax) {
        if (currentDay === 1) return false;
        const prevDateStr = this.getDateStr(currentDay - 1);
        
        // 找昨天休假的人 (最安全)
        const candidates = this.staffList.filter(s => {
            if (s.id === targetStaff.id) return false;
            return this.getShiftByDate(prevDateStr, s.id) === 'OFF'; 
        });

        for (const candidate of candidates) {
            // 檢查候選人能否上昨天那個「壞班」(導致間隔不足的班)
            if (!this.isValidAssignment(candidate, prevDateStr, badPrevShift, allowRelax)) continue;

            // 交換
            this.updateShift(prevDateStr, candidate.id, 'OFF', badPrevShift);
            this.updateShift(prevDateStr, targetStaff.id, badPrevShift, 'OFF');
            return true; 
        }
        return false;
    }
    
    /**
     * [實作] 排班後平衡：平衡夜班數 (可擴充至總班數)
     */
    postProcessBalancing(limitDay) { 
        const rounds = this.rules.fairness?.balanceRounds || 100;
        const isLocked = (d, uid) => {
             const dateStr = this.getDateStr(d);
             const s = this.staffList.find(x => x.id === uid);
             return s?.schedulingParams?.[dateStr] !== undefined; 
        };

        for (let r = 0; r < rounds; r++) {
            // 找出夜班最多與最少的人
            const stats = this.staffList.map(s => ({
                id: s.id,
                count: this.counters[s.id]['N'] || 0,
                obj: s
            })).sort((a, b) => b.count - a.count);

            const maxPerson = stats[0];
            const minPerson = stats[stats.length - 1];

            if (maxPerson.count - minPerson.count <= 1) break;

            let swapped = false;
            for (let d = 1; d <= limitDay; d++) {
                if (isLocked(d, maxPerson.id) || isLocked(d, minPerson.id)) continue;

                const dateStr = this.getDateStr(d);
                const shiftMax = this.getShiftByDate(dateStr, maxPerson.id);
                const shiftMin = this.getShiftByDate(dateStr, minPerson.id);

                if (shiftMax !== 'N') continue; // 只處理夜班
                
                // 檢查是否可互換
                if (!this.isValidAssignment(minPerson.obj, dateStr, 'N', false)) continue;
                if (!this.isValidAssignment(maxPerson.obj, dateStr, shiftMin, false)) continue;

                // 交換
                this.updateShift(dateStr, maxPerson.id, 'N', shiftMin);
                this.updateShift(dateStr, minPerson.id, shiftMin, 'N');
                
                swapped = true;
                break; 
            }
            if (!swapped) break; 
        }
    }

    shuffleArray(arr) { for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
    getTotalShifts(uid) { const c=this.counters[uid]; if(!c)return 0; return Object.keys(c).reduce((s,k)=>k!=='OFF'?s+c[k]:s,0); }
    lockPreRequests() { this.staffList.forEach(staff => { const params = staff.schedulingParams || {}; for (let d = 1; d <= this.daysInMonth; d++) { const dateStr = this.getDateStr(d); if (params[dateStr] === 'REQ_OFF') { this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF'); } } }); }
    getAvailableStaff(day) { const ds=this.getDateStr(day); return this.staffList.filter(s=>this.getShiftByDate(ds,s.id)==='OFF'); }
    clearDayAssignments(day) { const dateStr = this.getDateStr(day); const shifts = this.schedule[dateStr]; Object.keys(shifts).forEach(code => { if (code === 'OFF') return; [...shifts[code]].forEach(uid => { this.updateShift(dateStr, uid, code, 'OFF'); }); }); }
    isLocked(ds, uid) { const staff = this.staffList.find(s => s.id === uid); return staff?.schedulingParams?.[ds] === 'REQ_OFF'; }
    formatResult() { const res = {}; for(let d=1; d<=this.daysInMonth; d++){ const ds = this.getDateStr(d); res[ds] = {}; this.shiftCodes.forEach(code=>{ if(code==='OFF')return; const ids = this.schedule[ds][code]||[]; if(ids.length>0) res[ds][code] = ids; }); } return res; }
}
