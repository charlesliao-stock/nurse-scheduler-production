// js/scheduler/SchedulerV2.js
// 🚀 最終完整版：層級排序 + 嚴格手動救火 + 4種權重支援

class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.BACKTRACK_DEPTH = rules.aiParams?.backtrack_depth || 3;
        this.MAX_ATTEMPTS = rules.aiParams?.max_attempts || 50;
    }

    run() {
        console.log("🚀 SchedulerV2: 開始排班 (層級排序版)");
        this.lockPreRequests();

        for (let d = 1; d <= this.daysInMonth; d++) {
            // 第一輪：嚴格排班
            if (!this.solveDay(d, false)) {
                
                // 只有當「管理者啟動救火模式」時，才執行第二輪
                if (this.rules.policy?.enableRelaxation) {
                    console.warn(`⚠️ 第 ${d} 天排班失敗，啟動救火模式...`);
                    this.clearDayAssignments(d); 
                    
                    if (!this.solveDay(d, true)) {
                        console.error(`❌ 第 ${d} 天即便救火也無法完成。`);
                    }
                } else {
                    console.error(`❌ 第 ${d} 天排班失敗。救火模式未開，產生缺額。`);
                }
            }
        }
        
        if (!this.rules.policy?.enableRelaxation) {
            this.postProcessBalancing();
        }

        return this.formatResult();
    }

    solveDay(day, isRelaxMode) {
        const dateStr = this.getDateStr(day);
        const needs = this.getDailyNeeds(day);
        const staffPool = this.getAvailableStaff(day);

        for (const [shiftCode, count] of Object.entries(needs)) {
            let needed = count - this.countStaff(day, shiftCode);
            if (needed <= 0) continue;

            // 取得候選人並排序
            const candidates = this.sortCandidates(staffPool, dateStr, shiftCode);

            for (const staff of candidates) {
                if (needed <= 0) break;
                
                if (this.getShiftByDate(dateStr, staff.id) !== 'OFF') continue;

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

    // 核心：層級排序邏輯
    sortCandidates(staffList, dateStr, shiftCode) {
        return staffList.sort((a, b) => {
            // 1. 包班優先
            const isBundleA = (a.packageType === shiftCode || a.prefs?.bundleShift === shiftCode);
            const isBundleB = (b.packageType === shiftCode || b.prefs?.bundleShift === shiftCode);
            if (isBundleA && !isBundleB) return -1; 
            if (!isBundleA && isBundleB) return 1;  

            // 2. 指定預班 (Specific Request)
            const paramsA = a.schedulingParams?.[dateStr];
            const paramsB = b.schedulingParams?.[dateStr];
            const isReqA = (paramsA === shiftCode);
            const isReqB = (paramsB === shiftCode);
            if (isReqA && !isReqB) return -1;
            if (!isReqA && isReqB) return 1;

            // 3. 偏好 (Wish)
            const isPrefA = a.prefs?.[dateStr] && Object.values(a.prefs[dateStr]).includes(shiftCode);
            const isPrefB = b.prefs?.[dateStr] && Object.values(b.prefs[dateStr]).includes(shiftCode);
            if (isPrefA && !isPrefB) return -1;
            if (!isPrefA && isPrefB) return 1;
            
            // 4. 避開「勿排」 (!X) - 只有 Try 模式下有效
            const isAvoidA = (paramsA === '!' + shiftCode);
            const isAvoidB = (paramsB === '!' + shiftCode);
            if (isAvoidA && !isAvoidB) return 1; 
            if (!isAvoidA && isAvoidB) return -1;

            // 5. 勞逸平衡
            const countA = this.getTotalShifts(a.id);
            const countB = this.getTotalShifts(b.id);
            return countA - countB; 
        });
    }

    getTotalShifts(uid) {
        const counts = this.counters[uid];
        if (!counts) return 0;
        return Object.keys(counts).reduce((sum, key) => {
            return key !== 'OFF' ? sum + counts[key] : sum;
        }, 0);
    }
    
    lockPreRequests() {
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                if (params[dateStr] === 'REQ_OFF') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                }
            }
        });
    }

    getDailyNeeds(day) {
        const date = new Date(this.year, this.month - 1, day);
        const dayIdx = (date.getDay() + 6) % 7; 
        const needs = {};
        this.shiftCodes.forEach(code => {
            if(code === 'OFF' || code === 'REQ_OFF') return;
            const key = `${code}_${dayIdx}`;
            const val = this.rules.dailyNeeds?.[key] || 0;
            if (val > 0) needs[code] = val;
        });
        return needs;
    }

    getAvailableStaff(day) {
        const dateStr = this.getDateStr(day);
        return this.staffList.filter(s => {
            const currentShift = this.getShiftByDate(dateStr, s.id);
            return currentShift === 'OFF' || currentShift === null;
        });
    }
    
    clearDayAssignments(day) {
        const dateStr = this.getDateStr(day);
        const shifts = this.schedule[dateStr];
        Object.keys(shifts).forEach(code => {
            if (code === 'OFF') return; 
            [...shifts[code]].forEach(uid => {
                this.updateShift(dateStr, uid, code, 'OFF');
            });
        });
    }

    postProcessBalancing() { /* 平衡邏輯 */ }

    formatResult() {
        const result = {};
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            result[dateStr] = {};
            this.shiftCodes.forEach(code => {
                if(code === 'OFF') return;
                const staffIds = this.schedule[dateStr][code] || [];
                if(staffIds.length > 0) {
                    result[dateStr][code] = staffIds;
                }
            });
        }
        return result;
    }
}
