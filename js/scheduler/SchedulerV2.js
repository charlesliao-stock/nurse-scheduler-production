// js/scheduler/SchedulerV2.js
/**
 * 階層式 AI 排班引擎 - 平衡優化版
 * 🔧 修正版 v6：絕對保護預班，AI 排班不得覆蓋或移除預班人員
 */
window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.segments = parseInt(rules.aiParams?.balancingSegments) || 4; 
        
        // ✅ 新增：記錄所有預班人員
        this.preScheduledMap = new Map(); // key: "dateStr-uid", value: shiftCode
        
        this.initV2();
    }

    initV2() {
        this.staffList.forEach(s => {
            const bundleShift = s.packageType || s.prefs?.bundleShift;
            this.staffStats[s.id] = {
                workPressure: 0,
                isBundle: !!bundleShift,
                targetShift: bundleShift || null,
                bundleShiftCount: 0
            };
            
            // ✅ 建立預班索引
            const params = s.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const key = `current_${d}`;
                const preShift = params[key];
                if (preShift && preShift !== 'OFF') {
                    const ds = this.getDateStr(d);
                    this.preScheduledMap.set(`${ds}-${s.id}`, preShift);
                }
            }
        });
        
        console.log(`📋 已載入 ${this.preScheduledMap.size} 筆預班記錄`);
    }

    /**
     * ✅ 檢查是否為預班
     */
    isPreScheduled(dateStr, uid, shiftCode = null) {
        const key = `${dateStr}-${uid}`;
        const preShift = this.preScheduledMap.get(key);
        
        if (!preShift) return false;
        if (shiftCode === null) return true;
        return preShift === shiftCode;
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
            
            // ✅ 計算預班人數（預班人員不可移除）
            const preScheduledCount = (this.schedule[ds][code] || [])
                .filter(uid => this.isPreScheduled(ds, uid, code))
                .length;
            
            // ✅ 如果原始需求為 0，只清空非預班人員
            if (originalNeed <= 0) {
                const currentStaffs = [...(this.schedule[ds][code] || [])];
                currentStaffs.forEach(uid => {
                    // ⛔ 預班人員絕對不移除
                    if (!this.isPreScheduled(ds, uid, code)) {
                        this.updateShift(ds, uid, code, 'OFF');
                        this.staffStats[uid].workPressure -= 1.5;
                        console.log(`  ↳ 移除非預班人員從 ${code} 班（需求為 0）`);
                    }
                });
                return;
            }

            // ✅ 計算當前人數（包含預班）
            let currentCount = (this.schedule[ds][code] || []).length;
            
            // ✅ 如果超過需求，移除多餘的非預班人員
            if (currentCount > originalNeed) {
                const excess = currentCount - originalNeed;
                console.warn(`⚠️ 第 ${day} 日 ${code} 班超額 ${excess} 人（預班 ${preScheduledCount} 人）`);
                this.removeExcessStaff(ds, code, excess);
                currentCount = (this.schedule[ds][code] || []).length;
            }

            // ✅ 計算缺額（已扣除預班人數）
            let gap = originalNeed - currentCount;
            if (gap <= 0) return;

            console.log(`  📊 ${code} 班：需求 ${originalNeed}，預班 ${preScheduledCount}，當前 ${currentCount}，缺額 ${gap}`);

            // ✅ 階層 1：包班人員優先（輪流制）
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
     * ✅ 包班人員輪流分配（跳過預班人員）
     */
    processQueueWithRotation(day, code, gap) {
        const ds = this.getDateStr(day);
        
        // ✅ 找出所有包這個班別的人員（排除已有預班的人）
        const bundleStaff = this.staffList.filter(s => {
            if (this.staffStats[s.id].targetShift !== code) return false;
            if (this.getShiftByDate(ds, s.id) !== 'OFF') return false;
            
            // ⛔ 如果這個人在這天已有預班，跳過
            if (this.isPreScheduled(ds, s.id)) return false;
            
            return true;
        });

        if (bundleStaff.length === 0) return gap;

        // ✅ 按照已排班次數排序
        bundleStaff.sort((a, b) => {
            const countA = this.staffStats[a.id].bundleShiftCount || 0;
            const countB = this.staffStats[b.id].bundleShiftCount || 0;
            
            if (countA === countB) {
                return this.calculateScore(a, code) - this.calculateScore(b, code);
            }
            
            return countA - countB;
        });

        for (const s of bundleStaff) {
            if (gap <= 0) break;
            
            if (this.isValidAssignment(s, ds, code)) {
                this.updateShift(ds, s.id, 'OFF', code);
                this.staffStats[s.id].workPressure += 1.5;
                this.staffStats[s.id].bundleShiftCount++;
                gap--;
                
                console.log(`  ✓ 包班輪流：${s.name} 排入 ${code} 班 (第 ${this.staffStats[s.id].bundleShiftCount} 次)`);
            }
        }
        
        return gap;
    }

    /**
     * ✅ 移除超額人員（絕對保護預班）
     */
    removeExcessStaff(dateStr, shiftCode, excessCount) {
        const staffInShift = [...(this.schedule[dateStr][shiftCode] || [])];
        
        // ✅ 區分預班和非預班人員
        const preScheduledIds = staffInShift.filter(uid => 
            this.isPreScheduled(dateStr, uid, shiftCode)
        );
        const nonPreScheduledIds = staffInShift.filter(uid => 
            !this.isPreScheduled(dateStr, uid, shiftCode)
        );
        
        console.log(`  📋 ${shiftCode} 班：預班 ${preScheduledIds.length} 位（不可移除），非預班 ${nonPreScheduledIds.length} 位`);
        
        // ⛔ 如果預班人數已超過需求，只能警告，不能移除
        if (preScheduledIds.length >= excessCount + nonPreScheduledIds.length) {
            console.error(`  ❌ ${shiftCode} 班預班人數過多，無法調整！`);
            return;
        }
        
        // 找出包班人員
        const bundleStaffIds = this.staffList
            .filter(s => this.staffStats[s.id].targetShift === shiftCode)
            .map(s => s.id);
        
        let removed = 0;
        
        // ✅ 策略 1：優先移除非預班的一般人員
        const normalNonPre = nonPreScheduledIds.filter(uid => !bundleStaffIds.includes(uid));
        if (normalNonPre.length > 0 && removed < excessCount) {
            const toRemove = normalNonPre.slice(0, excessCount - removed);
            toRemove.forEach(uid => {
                const staff = this.staffList.find(s => s.id === uid);
                this.updateShift(dateStr, uid, shiftCode, 'OFF');
                this.staffStats[uid].workPressure -= 1.5;
                console.log(`  ↳ 移除一般人員 ${staff?.name || uid}`);
                removed++;
            });
        }
        
        // ✅ 策略 2：移除非預班的包班人員（已排最多次的優先）
        const bundleNonPre = nonPreScheduledIds.filter(uid => bundleStaffIds.includes(uid));
        if (removed < excessCount && bundleNonPre.length > 0) {
            const sortedBundle = bundleNonPre
                .map(uid => {
                    const staff = this.staffList.find(s => s.id === uid);
                    const count = this.staffStats[uid].bundleShiftCount || 0;
                    return { uid, staff, count };
                })
                .sort((a, b) => b.count - a.count);
            
            const toRemove = sortedBundle.slice(0, excessCount - removed);
            toRemove.forEach(({ uid, staff }) => {
                this.updateShift(dateStr, uid, shiftCode, 'OFF');
                this.staffStats[uid].workPressure -= 1.5;
                this.staffStats[uid].bundleShiftCount--;
                console.log(`  ↳ 移除包班人員 ${staff?.name || uid} (剩餘 ${this.staffStats[uid].bundleShiftCount} 次)`);
                removed++;
            });
        }
        
        // ⚠️ 記錄移除結果
        if (removed < excessCount) {
            console.warn(`  ⚠️ ${shiftCode} 班仍超額 ${excessCount - removed} 人（皆為預班，不可移除）`);
        }
    }

    /**
     * ✅ 一般人員補位（跳過預班人員）
     */
    processQueue(day, code, gap, filterFn) {
        const ds = this.getDateStr(day);
        
        const candidates = this.staffList.filter(s => {
            if (this.getShiftByDate(ds, s.id) !== 'OFF') return false;
            
            // ⛔ 如果這個人在這天已有預班，跳過
            if (this.isPreScheduled(ds, s.id)) return false;
            
            return filterFn(s);
        });

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
        const counters = this.counters[staff.id] || {};
        
        let score = stats.workPressure * 100; 
        
        const currentOff = counters.OFF || 0;
        const avgOff = Object.values(this.counters).reduce((sum, c) => sum + (c.OFF || 0), 0) / this.staffList.length;
        
        if (currentOff > avgOff) {
            score -= (currentOff - avgOff) * 200;
        } else if (currentOff < avgOff) {
            score += (avgOff - currentOff) * 200;
        }
        
        const p = staff.preferences || staff.prefs || {};
        if (p.favShift === code) score -= 150;
        else if (p.favShift2 === code) score -= 80;
        
        const consDays = this.getConsecutiveWorkDays(staff.id, this.getDateStr(1));
        if (consDays > 3) score += (consDays * 50);

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
