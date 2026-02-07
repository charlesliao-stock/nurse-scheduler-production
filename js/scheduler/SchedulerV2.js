// js/scheduler/SchedulerV2.js
/**
 * 階層式 AI 排班引擎 - 平衡優化版
 */
class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.segments = parseInt(rules.aiParams?.balancingSegments) || 4; 
        this.initV2();
    }

    initV2() {
        this.staffList.forEach(s => {
            const bundleShift = s.packageType || s.prefs?.bundleShift;
            this.staffStats[s.id] = {
                workPressure: 0,
                isBundle: !!bundleShift,
                targetShift: bundleShift || null
            };
        });
    }

    run() {
        this.applyPreSchedules();
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.fillDailyShifts(d);
            // ✅ 每段落結束進行壓力校正，避免廖苡凱休假過少
            if (d % Math.ceil(this.daysInMonth / this.segments) === 0) this.rebalancePressure();
        }
        return this.schedule;
    }

    fillDailyShifts(day) {
        const ds = this.getDateStr(day), needs = this.getDailyNeeds(day);
        const shiftOrder = Object.keys(needs).sort((a,b) => needs[b] - needs[a]);

        shiftOrder.forEach(code => {
            let gap = needs[code] - (this.schedule[ds][code]?.length || 0);
            if (gap <= 0) return;

            // ✅ 階層 1：包班人員優先
            gap = this.processQueue(day, code, gap, s => this.staffStats[s.id].targetShift === code);
            
            // ✅ 階層 2：志願人員遞補
            if (gap > 0) {
                gap = this.processQueue(day, code, gap, s => {
                    const p = s.preferences || s.prefs || {};
                    return !this.staffStats[s.id].isBundle && [p.favShift, p.favShift2].includes(code);
                });
            }

            // ✅ 階層 3：一般補位（按壓力值自動排隊）
            if (gap > 0) {
                gap = this.processQueue(day, code, gap, s => true);
            }
        });
    }

    processQueue(day, code, gap, filterFn) {
        const ds = this.getDateStr(day);
        const candidates = this.staffList.filter(s => this.getShiftByDate(ds, s.id) === 'OFF' && filterFn(s));

        // ✅ 壓力越小（休假越多）的人分數越低，越優先排班
        candidates.sort((a, b) => this.calculateScore(a, code) - this.calculateScore(b, code));

        for (const s of candidates) {
            if (gap <= 0) break;
            if (this.isValidAssignment(s, ds, code)) {
                this.updateShift(ds, s.id, 'OFF', code);
                this.staffStats[s.id].workPressure += 1.5; 
                gap--;
            }
        }
        return gap;
    }

    calculateScore(staff, code) {
        const stats = this.staffStats[staff.id];
        let score = stats.workPressure * 100; 
        const p = staff.preferences || staff.prefs || {};
        if (p.favShift === code) score -= 50;
        return score;
    }

    rebalancePressure() {
        const avgWork = Object.values(this.staffStats).reduce((a,b)=>a+b.workPressure,0) / this.staffList.length;
        this.staffList.forEach(s => {
            if (this.staffStats[s.id].workPressure > avgWork) this.staffStats[s.id].workPressure += 5;
        });
    }

    getDailyNeeds(day) {
        const ds = this.getDateStr(day);
        const dayIdx = (new Date(this.year, this.month-1, day).getDay() + 6) % 7;
        if (this.rules.specificNeeds?.[ds]) return this.rules.specificNeeds[ds];
        
        const needs = {};
        let hasConfiguredNeeds = false;
        
        this.shiftCodes.forEach(c => {
            if (c !== 'OFF' && c !== 'REQ_OFF') {
                const val = this.rules.dailyNeeds?.[`${c}_${dayIdx}`];
                if (val !== undefined && val !== null) {
                    needs[c] = parseInt(val) || 0;
                    hasConfiguredNeeds = true;
                } else {
                    needs[c] = 0;
                }
            }
        });

        // ✅ 如果完全沒有設定人力需求，則給予預設值 (D:3, E:2, N:2) 避免全體休假
        if (!hasConfiguredNeeds) {
            console.warn(`⚠️ 單位未設定人力需求，使用系統預設值排班`);
            if (this.shiftCodes.includes('D')) needs['D'] = 3;
            if (this.shiftCodes.includes('E')) needs['E'] = 2;
            if (this.shiftCodes.includes('N')) needs['N'] = 2;
        }
        
        return needs;
    }
}
