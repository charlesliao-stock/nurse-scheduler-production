// js/scheduler/SchedulerV2.js
class SchedulerV2 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.segments = parseInt(rules.aiParams?.balancingSegments) || 4; // 分段平衡
        this.initV2();
    }

    initV2() {
        const avgOff = parseFloat(this.rules.avgOffDays) || 8;
        this.staffList.forEach(s => {
            const bundleShift = s.packageType || s.prefs?.bundleShift;
            this.staffStats[s.id] = {
                workPressure: 0,
                isBundle: !!bundleShift,
                targetShift: bundleShift || null,
                targetQuota: bundleShift ? (this.daysInMonth - avgOff) : 0 // ✅ 包班目標班數
            };
        });
    }

    run() {
        this.applyPreSchedules();
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.fillDailyShifts(d);
            // ✅ 每段結束進行壓力平衡校正
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

            // ✅ 階層 1：包班人員
            gap = this.processQueue(day, code, gap, s => this.staffStats[s.id].targetShift === code);
            
            // ✅ 階層 2：志願者（非包班但有偏好）
            if (gap > 0) {
                gap = this.processQueue(day, code, gap, s => {
                    const p = s.preferences || s.prefs || {};
                    return !this.staffStats[s.id].isBundle && [p.favShift, p.favShift2].includes(code);
                });
            }

            // ✅ 階層 3：一般補位（根據壓力值排隊）
            if (gap > 0) {
                gap = this.processQueue(day, code, gap, s => true);
            }
        });
    }

    processQueue(day, code, gap, filterFn) {
        const ds = this.getDateStr(day);
        const candidates = this.staffList.filter(s => 
            this.getShiftByDate(ds, s.id) === 'OFF' && filterFn(s)
        );

        // ✅ 根據工作壓力排序：壓力小的人（排班少、休假多）優先排班
        candidates.sort((a, b) => this.calculateScore(a, code) - this.calculateScore(b, code));

        for (const s of candidates) {
            if (gap <= 0) break;
            if (this.isValidAssignment(s, ds, code)) {
                this.updateShift(ds, s.id, 'OFF', code);
                this.staffStats[s.id].workPressure += 1.5; // 增加權重
                gap--;
            }
        }
        return gap;
    }

    calculateScore(staff, code) {
        const stats = this.staffStats[staff.id];
        // 壓力值權重最高，確保 OFF 平衡
        let score = stats.workPressure * 100; 
        
        const p = staff.preferences || staff.prefs || {};
        if (p.favShift === code) score -= 50;
        if (p.favShift2 === code) score -= 20;
        
        return score;
    }

    rebalancePressure() {
        // 每段平衡時，給予目前 OFF 數低於平均的人減壓，讓他們下一段更容易獲得休假
        const avgWork = Object.values(this.staffStats).reduce((a,b)=>a+b.workPressure,0) / this.staffList.length;
        this.staffList.forEach(s => {
            if (this.staffStats[s.id].workPressure > avgWork) this.staffStats[s.id].workPressure += 5;
        });
    }

    getDailyNeeds(day) {
        const ds = this.getDateStr(day), date = new Date(this.year, this.month-1, day);
        const dayIdx = (date.getDay() + 6) % 7;
        if (this.rules.specificNeeds?.[ds]) return this.rules.specificNeeds[ds];
        const needs = {};
        this.shiftCodes.forEach(c => {
            if (c !== 'OFF' && c !== 'REQ_OFF') needs[c] = this.rules.dailyNeeds?.[`${c}_${dayIdx}`] || 0;
        });
        return needs;
    }
}
