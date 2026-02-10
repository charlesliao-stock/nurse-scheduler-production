// js/scheduler/SchedulerV2.js
/**
 * 階層式 AI 排班引擎 - 平衡優化版
 * 🔧 修正版 v8：
 * 1. 嚴格遵守排班偏好（包含 favShift3）
 * 2. 包班人員只能排包班或偏好內的班別
 * 3. 強化 OFF 天數平衡機制
 * 4. 新增實際的平衡調整階段
 */
window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.segments = parseInt(rules.aiParams?.balancingSegments) || 4; 
        
        // ✅ 記錄所有預班人員
        this.preScheduledMap = new Map(); // key: "dateStr-uid", value: shiftCode
        
        this.initV2();
    }

    initV2() {
        console.log('🔍 開始初始化 V2，人員數量:', this.staffList.length);
        
        this.staffList.forEach(s => {
            const bundleShift = s.packageType || s.prefs?.bundleShift || s.preferences?.bundleShift;
            this.staffStats[s.id] = {
                workPressure: 0,
                isBundle: !!bundleShift,
                targetShift: bundleShift || null,
                bundleShiftCount: 0
            };
            
            // ✅ 關鍵修正：從 schedulingParams 和 preferences 讀取預班
            const params = s.schedulingParams || {};
            const prefs = s.preferences || s.prefs || {};
            
            let staffPreCount = 0;
            
            for (let d = 1; d <= this.daysInMonth; d++) {
                const key = `current_${d}`;
                const ds = this.getDateStr(d);
                
                // ✅ 優先從 preferences 讀取，再從 schedulingParams 讀取
                let preShift = prefs[key] || params[key];
                
                // ✅ 包含所有非 OFF 的班別（包括 REQ_OFF）
                if (preShift && preShift !== 'OFF') {
                    this.preScheduledMap.set(`${ds}-${s.id}`, preShift);
                    staffPreCount++;
                    
                    console.log(`  📌 預班: ${s.name} 第${d}日 → ${preShift} (來源: ${prefs[key] ? 'preferences' : 'schedulingParams'})`);
                }
            }
            
            if (staffPreCount > 0) {
                console.log(`✅ ${s.name} 共 ${staffPreCount} 天預班`);
            }
        });
        
        console.log(`📋 已載入 ${this.preScheduledMap.size} 筆預班記錄`);
        
        // ✅ 詳細列出所有預班（除錯用）
        if (this.preScheduledMap.size > 0) {
            const preview = Array.from(this.preScheduledMap.entries()).slice(0, 10);
            console.log('📋 預班清單預覽 (前10筆):');
            preview.forEach(([key, shift]) => {
                console.log(`  ${key} → ${shift}`);
            });
        } else {
            console.warn('⚠️ 警告：沒有找到任何預班記錄！');
            
            // 除錯：列出第一位人員的完整資料結構
            if (this.staffList.length > 0) {
                const sample = this.staffList[0];
                console.log('🔍 人員資料範例:', {
                    name: sample.name,
                    id: sample.id,
                    schedulingParams: sample.schedulingParams,
                    preferences: sample.preferences,
                    prefs: sample.prefs
                });
            }
        }
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
        console.log('🚀 開始執行 AI 排班引擎 V2');
        
        // 階段 1: 套用預班
        this.applyPreSchedules();
        
        // 階段 2: 月初延續性
        this.applyEarlyMonthContinuity();
        
        // 階段 3: 逐日填補 + 分段平衡
        const segmentSize = Math.ceil(this.daysInMonth / this.segments);
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            this.fillDailyShifts(d);
            
            // ✅ 每個 segment 結束時進行平衡調整
            if (d % segmentSize === 0 || d === this.daysInMonth) {
                console.log(`📊 第 ${d} 日：執行平衡調整 (Segment ${Math.ceil(d / segmentSize)}/${this.segments})`);
                this.balanceOffDays(d);
            }
        }
        
        // 階段 4: 最終全局平衡
        console.log('🔄 最終全局平衡調整');
        this.finalBalancePass();
        
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
                    const isPref = (p.favShift === code || p.favShift2 === code || p.favShift3 === code);
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

    /**
     * ✅ 修正：評分函數 - 嚴格遵守偏好和包班限制
     */
    calculateScore(staff, code) {
        const stats = this.staffStats[staff.id];
        const counters = this.counters[staff.id] || {};
        
        let score = stats.workPressure * 100; 
        
        // ✅ OFF 天數平衡（更強的權重）
        const currentOff = counters.OFF || 0;
        const avgOff = Object.values(this.counters).reduce((sum, c) => sum + (c.OFF || 0), 0) / this.staffList.length;
        
        if (currentOff > avgOff) {
            score -= (currentOff - avgOff) * 300; // 提高權重從 200 -> 300
        } else if (currentOff < avgOff) {
            score += (avgOff - currentOff) * 300;
        }
        
        // ✅ 排班偏好處理（包含 favShift3）
        const p = staff.preferences || staff.prefs || {};
        const bundleShift = stats.targetShift;
        
        // ⛔ 包班人員：只能排包班班別或偏好內的班別
        if (bundleShift) {
            if (code === bundleShift) {
                score -= 200; // 包班最優先
            } else if (p.favShift === code || p.favShift2 === code || p.favShift3 === code) {
                score -= 50; // 允許偏好內的班別
            } else {
                score += 10000; // ⛔ 嚴重懲罰：不在包班或偏好內
            }
        } else {
            // 一般人員：偏好優先
            if (p.favShift === code) score -= 200;
            else if (p.favShift2 === code) score -= 120;
            else if (p.favShift3 === code) score -= 80;
        }
        
        const consDays = this.getConsecutiveWorkDays(staff.id, this.getDateStr(1));
        if (consDays > 3) score += (consDays * 50);

        return score;
    }

    /**
     * ✅ 新增：分段平衡調整
     */
    balanceOffDays(upToDay) {
        console.log(`  🔄 執行 OFF 天數平衡（至第 ${upToDay} 日）`);
        
        // 計算平均 OFF 天數
        const avgOff = Object.values(this.counters).reduce((sum, c) => sum + (c.OFF || 0), 0) / this.staffList.length;
        
        // 找出 OFF 過多和過少的人員
        const overOff = [];
        const underOff = [];
        
        this.staffList.forEach(s => {
            const uid = s.id;
            const currentOff = this.counters[uid].OFF || 0;
            const diff = currentOff - avgOff;
            
            if (diff > 1) {
                overOff.push({ uid, staff: s, diff, currentOff });
            } else if (diff < -1) {
                underOff.push({ uid, staff: s, diff, currentOff });
            }
        });
        
        if (overOff.length === 0 || underOff.length === 0) {
            console.log('  ✓ OFF 天數已平衡，無需調整');
            return;
        }
        
        console.log(`  📊 過多 OFF: ${overOff.length} 人，過少 OFF: ${underOff.length} 人`);
        
        // 嘗試交換班別
        let swapped = 0;
        
        overOff.sort((a, b) => b.diff - a.diff);
        underOff.sort((a, b) => a.diff - b.diff);
        
        for (const over of overOff) {
            for (const under of underOff) {
                // 嘗試在這個 segment 內找到可交換的日期
                for (let d = Math.max(1, upToDay - Math.ceil(this.daysInMonth / this.segments) + 1); d <= upToDay; d++) {
                    const ds = this.getDateStr(d);
                    
                    const overShift = this.getShiftByDate(ds, over.uid);
                    const underShift = this.getShiftByDate(ds, under.uid);
                    
                    // ⛔ 跳過預班
                    if (this.isPreScheduled(ds, over.uid) || this.isPreScheduled(ds, under.uid)) continue;
                    
                    // 案例 1: over 在上班，under 休息 -> 交換
                    if (overShift !== 'OFF' && overShift !== 'REQ_OFF' && underShift === 'OFF') {
                        if (this.isValidAssignment(under.staff, ds, overShift)) {
                            this.updateShift(ds, over.uid, overShift, 'OFF');
                            this.updateShift(ds, under.uid, 'OFF', overShift);
                            console.log(`    ↔️ 交換: ${over.staff.name} (${overShift}->OFF) ↔ ${under.staff.name} (OFF->${overShift})`);
                            swapped++;
                            break;
                        }
                    }
                }
            }
        }
        
        console.log(`  ✓ 共交換 ${swapped} 個班別以平衡 OFF 天數`);
    }

    /**
     * ✅ 新增：最終全局平衡
     */
    finalBalancePass() {
        const avgOff = Object.values(this.counters).reduce((sum, c) => sum + (c.OFF || 0), 0) / this.staffList.length;
        const tolerance = 2; // 允許誤差範圍
        
        console.log(`📊 平均 OFF 天數: ${avgOff.toFixed(2)}`);
        
        this.staffList.forEach(s => {
            const currentOff = this.counters[s.id].OFF || 0;
            const diff = currentOff - avgOff;
            
            if (Math.abs(diff) > tolerance) {
                console.warn(`⚠️ ${s.name}: OFF=${currentOff} (差異 ${diff.toFixed(1)} 天)`);
            }
        });
        
        // 執行全月範圍的平衡調整
        this.balanceOffDays(this.daysInMonth);
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
