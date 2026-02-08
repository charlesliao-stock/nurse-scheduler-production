// js/scheduler/SchedulerV2.js
/**
 * 階層式 AI 排班引擎 - 平衡優化版
 * 🔧 修正版 v5：解決包班人員超額問題 - 改用輪流制
 */
window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
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
                targetShift: bundleShift || null,
                // ✅ 新增：記錄該班別已排班次數
                bundleShiftCount: 0
            };
        });
    }

    run() {
        this.applyPreSchedules();
        this.applyEarlyMonthContinuity();
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.fillDailyShifts(d);
            if (d % Math.ceil(this.daysInMonth / this.segments) === 0) this.rebalancePressure();
        }
        return this.schedule;
    }

    fillDailyShifts(day) {
        const ds = this.getDateStr(day);
        const needs = this.getDailyNeeds(day);
        const shiftOrder = Object.keys(needs).sort((a,b) => needs[b] - needs[a]);

        shiftOrder.forEach(code => {
            const originalNeed = needs[code] || 0;
            
            // ✅ 如果原始需求為 0，清空所有該班別
            if (originalNeed <= 0) {
                const currentStaffs = [...(this.schedule[ds][code] || [])];
                currentStaffs.forEach(uid => {
                    this.updateShift(ds, uid, code, 'OFF');
                    this.staffStats[uid].workPressure -= 1.5;
                });
                return;
            }

            // ✅ 關鍵修正：如果當前已排人數超過需求，移除多餘人員
            let currentCount = (this.schedule[ds][code] || []).length;
            if (currentCount > originalNeed) {
                const excess = currentCount - originalNeed;
                console.warn(`⚠️ 第 ${day} 日 ${code} 班超額 ${excess} 人，開始調整...`);
                this.removeExcessStaff(ds, code, excess);
                currentCount = (this.schedule[ds][code] || []).length;
            }

            // ✅ 計算缺額
            let gap = originalNeed - currentCount;
            if (gap <= 0) return;

            // ✅ 階層 1：包班人員優先（使用輪流制）
            gap = this.processQueueWithRotation(day, code, gap);
            
            // ✅ 階層 2：志願人員遞補
            if (gap > 0) {
                gap = this.processQueue(day, code, gap, s => {
                    const p = s.preferences || s.prefs || {};
                    const isPref = (p.favShift === code || p.favShift2 === code);
                    return !this.staffStats[s.id].isBundle && isPref;
                });
            }

            // ✅ 階層 3：一般補位
            if (gap > 0) {
                gap = this.processQueue(day, code, gap, s => true);
            }
        });
    }

    /**
     * ✅ 新增方法：包班人員輪流分配
     * 策略：按照已排班次數排序，次數少的優先排班
     */
    processQueueWithRotation(day, code, gap) {
        const ds = this.getDateStr(day);
        
        // 找出所有包這個班別的人員
        const bundleStaff = this.staffList.filter(s => 
            this.staffStats[s.id].targetShift === code && 
            this.getShiftByDate(ds, s.id) === 'OFF'
        );

        if (bundleStaff.length === 0) return gap;

        // ✅ 關鍵：按照已排班次數排序（次數少的優先）
        bundleStaff.sort((a, b) => {
            const countA = this.staffStats[a.id].bundleShiftCount || 0;
            const countB = this.staffStats[b.id].bundleShiftCount || 0;
            
            // 次數相同時，按壓力值排序
            if (countA === countB) {
                return this.calculateScore(a, code) - this.calculateScore(b, code);
            }
            
            return countA - countB;  // 次數少的排前面
        });

        // 依序排班，直到滿足需求
        for (const s of bundleStaff) {
            if (gap <= 0) break;
            
            if (this.isValidAssignment(s, ds, code)) {
                this.updateShift(ds, s.id, 'OFF', code);
                this.staffStats[s.id].workPressure += 1.5;
                this.staffStats[s.id].bundleShiftCount++;  // ✅ 增加計數
                gap--;
                
                console.log(`  ✓ 包班輪流：${s.name} 排入 ${code} 班 (第 ${this.staffStats[s.id].bundleShiftCount} 次)`);
            }
        }
        
        return gap;
    }

    /**
     * ✅ 移除超額人員
     * 策略：優先移除該班別已排最多次的人
     */
    removeExcessStaff(dateStr, shiftCode, excessCount) {
        const staffInShift = [...(this.schedule[dateStr][shiftCode] || [])];
        
        // 找出包班人員
        const bundleStaffIds = this.staffList
            .filter(s => this.staffStats[s.id].targetShift === shiftCode)
            .map(s => s.id);
        
        // 分為包班人員和一般人員
        const bundleInShift = staffInShift.filter(uid => bundleStaffIds.includes(uid));
        const normalInShift = staffInShift.filter(uid => !bundleStaffIds.includes(uid));
        
        let removed = 0;
        
        // ✅ 策略 1：優先移除一般人員（不是包班的）
        if (normalInShift.length > 0 && removed < excessCount) {
            const toRemove = normalInShift.slice(0, excessCount - removed);
            toRemove.forEach(uid => {
                const staff = this.staffList.find(s => s.id === uid);
                this.updateShift(dateStr, uid, shiftCode, 'OFF');
                this.staffStats[uid].workPressure -= 1.5;
                console.log(`  ↳ 移除一般人員 ${staff?.name || uid} 從 ${shiftCode} 班`);
                removed++;
            });
        }
        
        // ✅ 策略 2：如果還有多餘，移除包班中已排最多次的人
        if (removed < excessCount && bundleInShift.length > 0) {
            const sortedBundle = bundleInShift
                .map(uid => {
                    const staff = this.staffList.find(s => s.id === uid);
                    const count = this.staffStats[uid].bundleShiftCount || 0;
                    return { uid, staff, count };
                })
                .sort((a, b) => b.count - a.count);  // 已排最多次的排前面
            
            const toRemove = sortedBundle.slice(0, excessCount - removed);
            toRemove.forEach(({ uid, staff }) => {
                this.updateShift(dateStr, uid, shiftCode, 'OFF');
                this.staffStats[uid].workPressure -= 1.5;
                this.staffStats[uid].bundleShiftCount--;  // ✅ 減少計數
                console.log(`  ↳ 移除包班人員 ${staff?.name || uid} 從 ${shiftCode} 班 (剩餘 ${this.staffStats[uid].bundleShiftCount} 次)`);
                removed++;
            });
        }
    }

    processQueue(day, code, gap, filterFn) {
        const ds = this.getDateStr(day);
        const candidates = this.staffList.filter(s => 
            this.getShiftByDate(ds, s.id) === 'OFF' && 
            filterFn(s)
        );

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
        if (p.favShift === code) score -= 150;
        else if (p.favShift2 === code) score -= 80;
        
        const consDays = this.getConsecutiveWorkDays(staff.id, this.getDateStr(1));
        if (consDays > 3) score += (consDays * 20);

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
        const dateObj = new Date(this.year, this.month - 1, day);
        const jsDay = dateObj.getDay(); 
        const dayIdx = (jsDay === 0) ? 6 : jsDay - 1; 
        
        if (this.rules.specificNeeds && this.rules.specificNeeds[ds]) {
            return this.rules.specificNeeds[ds];
        }
        
        const needs = {};
        let hasConfiguredNeeds = false;
        
        if (this.rules.dailyNeeds) {
            this.shiftCodes.forEach(c => {
                if (c !== 'OFF' && c !== 'REQ_OFF') {
                    const val = this.rules.dailyNeeds[`${c}_${dayIdx}`];
                    if (val !== undefined && val !== null) {
                        needs[c] = parseInt(val) || 0;
                        hasConfiguredNeeds = true;
                    } else {
                        needs[c] = 0;
                    }
                }
            });
        }

        if (!hasConfiguredNeeds) {
            const totalStaff = this.staffList.length;
            const activeShifts = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            
            if (activeShifts.length > 0) {
                const avgNeed = Math.max(2, Math.floor(totalStaff / (activeShifts.length + 1)));
                activeShifts.forEach(code => {
                    needs[code] = avgNeed;
                });
            }
        }
        
        return needs;
    }
}
