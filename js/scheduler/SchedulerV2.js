// js/scheduler/SchedulerV2.js
// 🚀 最終修正版：修正偏好讀取邏輯

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.MAX_SWAP_ATTEMPTS = 5; 
    }

    run() {
        console.log(`🚀 SchedulerV2 Strict Mode Start.`);
        this.applyPreSchedules();

        for (let d = 1; d <= this.daysInMonth; d++) {
            const dailyNeeds = this.getDailyNeeds(d);
            const shiftOrder = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            
            for (const shiftCode of shiftOrder) {
                const count = dailyNeeds[shiftCode] || 0;
                if (count > 0) {
                    this.fillShiftNeeds(d, shiftCode, count);
                }
            }
            this.balanceDay(d);
        }

        return this.formatResult();
    }

    applyPreSchedules() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const req = params[dateStr];
                
                if (req === 'REQ_OFF') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                }
                else if (req && req !== 'OFF' && !req.startsWith('!')) {
                    this.updateShift(dateStr, staff.id, 'OFF', req);
                }
            }
        });
    }

    fillShiftNeeds(day, shiftCode, neededCount) {
        const dateStr = this.getDateStr(day);
        let currentCount = this.countStaff(day, shiftCode);
        let gap = neededCount - currentCount;

        if (gap <= 0) return;

        let candidates = this.staffList.filter(s => {
            const currentShift = this.getShiftByDate(dateStr, s.id);
            return currentShift === 'OFF'; 
        });

        candidates = this.sortCandidates(candidates, dateStr, shiftCode);

        for (const staff of candidates) {
            if (gap <= 0) break;

            const isValid = this.isValidAssignment(staff, dateStr, shiftCode);
            const isGroupValid = this.checkGroupMaxLimit(day, staff, shiftCode);

            if (isValid && isGroupValid) {
                this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                gap--;
            } 
            else {
                if (gap > 0 && this.tryResolveConflict(day, staff, shiftCode)) {
                    if (this.isValidAssignment(staff, dateStr, shiftCode) && 
                        this.checkGroupMaxLimit(day, staff, shiftCode)) {
                        
                        this.updateShift(dateStr, staff.id, 'OFF', shiftCode);
                        gap--;
                    }
                }
            }
        }
        
        if (gap > 0) {
            console.warn(`[缺口警示] ${dateStr} ${shiftCode} 尚缺 ${gap} 人`);
        }
    }

    sortCandidates(staffList, dateStr, shiftCode) {
        return staffList.sort((a, b) => {
            const scoreA = this.calculateScore(a, dateStr, shiftCode);
            const scoreB = this.calculateScore(b, dateStr, shiftCode);
            return scoreB - scoreA; 
        });
    }

    calculateScore(staff, dateStr, shiftCode) {
        let score = 0;
        
        // [修正] 讀取偏好 (支援每日 vs 全月)
        let prefs = {};
        if (staff.prefs) {
            if (staff.prefs[dateStr]) { // 每日設定
                prefs = staff.prefs[dateStr];
            } else if (staff.prefs.favShift || staff.prefs.bundleShift) { // 全月共用
                prefs = staff.prefs;
            }
        }
        
        const params = staff.schedulingParams || {};

        // 1. 志願權重
        if (prefs.favShift === shiftCode) score += 1000;
        else if (prefs.favShift2 === shiftCode) score += 500;
        else if (prefs.favShift3 === shiftCode) score += 200;

        // 2. 包班偏好
        const bundleShift = staff.packageType || prefs.bundleShift;
        if (bundleShift === shiftCode) score += 800;

        // 3. Try 排斥 (!D)
        if (params[dateStr] === '!' + shiftCode) {
            score -= 2000; 
        }

        // 4. 避免連續上班
        const consDays = this.getConsecutiveWorkDays(staff.id, dateStr);
        score -= (consDays * 50);

        // 5. 平衡
        score -= (this.getTotalShifts(staff.id) * 10);

        return score;
    }

    tryResolveConflict(day, staff, targetShift) {
        if (day === 1) return false;

        const dateStr = this.getDateStr(day);
        const prevDateStr = this.getDateStr(day - 1);
        const prevShift = this.getShiftByDate(prevDateStr, staff.id);

        if (this.checkRestPeriod(prevShift, targetShift)) return false; 

        const swapCandidates = this.staffList.filter(s => 
            s.id !== staff.id && 
            this.getShiftByDate(prevDateStr, s.id) === 'OFF' &&
            !this.isPreRequestOff(s.id, prevDateStr) 
        );

        for (const candidate of swapCandidates) {
            if (this.isValidAssignment(candidate, prevDateStr, prevShift)) {
                this.updateShift(prevDateStr, candidate.id, 'OFF', prevShift);
                this.updateShift(prevDateStr, staff.id, prevShift, 'OFF');
                return true; 
            }
        }
        return false;
    }
    
    getDailyNeeds(day) {
        const dateStr = this.getDateStr(day);
        const date = new Date(this.year, this.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; 
        const needs = {};
        
        this.shiftCodes.forEach(code => {
            if(code === 'OFF' || code === 'REQ_OFF') return;
            if (this.rules.specificNeeds?.[dateStr]?.[code] !== undefined) {
                needs[code] = this.rules.specificNeeds[dateStr][code];
            } else {
                const key = `${code}_${dayIdx}`;
                const val = this.rules.dailyNeeds?.[key];
                if (val > 0) needs[code] = val;
            }
        });
        return needs;
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
    
    balanceDay(day) { }

    getTotalShifts(uid) { 
        const c = this.counters[uid]; 
        if(!c) return 0; 
        return Object.keys(c).reduce((s,k) => (k !== 'OFF' && k !== 'REQ_OFF') ? s + c[k] : s, 0); 
    }

    formatResult() { 
        const res = {}; 
        for(let d = 1; d <= this.daysInMonth; d++){ 
            const ds = this.getDateStr(d); 
            res[ds] = {}; 
            this.shiftCodes.forEach(code => { 
                if (code === 'OFF') return; 
                const ids = this.schedule[ds][code] || []; 
                if(ids.length > 0) res[ds][code] = ids; 
            }); 
        } 
        return res; 
    }
}
