// js/scheduler/SchedulerV2.js
/**
 * 階層式 AI 排班引擎 - 平衡優化版
 * 🔧 修正版 v2：修復 getDailyNeeds 預設值無效導致全員 OFF 的問題
 * 
 * 修正內容：
 * 1. getDailyNeeds() 改為根據實際班別動態分配人力
 * 2. 避免硬編碼 D/E/N，改用 this.shiftCodes 自動偵測
 * 3. 新增詳細除錯 log 以利追蹤
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
            // ✅ 每段落結束進行壓力校正，避免特定員工休假過少
            if (d % Math.ceil(this.daysInMonth / this.segments) === 0) this.rebalancePressure();
        }
        return this.schedule;
    }

    fillDailyShifts(day) {
        const ds = this.getDateStr(day);
        const needs = this.getDailyNeeds(day);
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

    /**
     * 🔧 核心修正：getDailyNeeds()
     * 
     * 原問題：
     * - 當 unitRules 沒有 dailyNeeds 時，硬編碼給 D:3, E:2, N:2
     * - 但如果系統中沒有這些班別代碼，預設值無效，導致 needs 全為 0
     * - 結果所有員工都停留在初始的 OFF 狀態
     * 
     * 修正方案：
     * - 改為動態偵測 this.shiftCodes 中的實際班別
     * - 根據總人數自動平均分配人力需求
     * - 確保每個班別至少需要 2 人
     */
    getDailyNeeds(day) {
        const ds = this.getDateStr(day);
        const dayIdx = (new Date(this.year, this.month-1, day).getDay() + 6) % 7;
        
        // 優先使用特定日期的需求設定
        if (this.rules.specificNeeds?.[ds]) return this.rules.specificNeeds[ds];
        
        const needs = {};
        let hasConfiguredNeeds = false;
        
        // 嘗試從 dailyNeeds 讀取設定值
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

        // ✅ 關鍵修正：如果完全沒有設定人力需求，根據實際班別自動分配
        if (!hasConfiguredNeeds) {
            console.warn(`⚠️ ${ds} 單位未設定人力需求，使用系統預設值排班`);
            
            // 計算總人力和可用班別
            const totalStaff = this.staffList.length;
            const activeShifts = this.shiftCodes.filter(c => c !== 'OFF' && c !== 'REQ_OFF');
            
            if (activeShifts.length > 0) {
                // 平均分配人力：總人數 / (班別數 + 1)
                // +1 是為了保留一些人可以休假
                // 但每班至少需要 2 人
                const avgNeed = Math.max(2, Math.floor(totalStaff / (activeShifts.length + 1)));
                
                activeShifts.forEach(code => {
                    needs[code] = avgNeed;
                });
                
                // 第一天顯示詳細資訊，其他天簡化 log
                if (day === 1) {
                    console.log(`📊 自動分配人力需求 (總人數=${totalStaff}, 班別數=${activeShifts.length}, 每班=${avgNeed}人):`, needs);
                }
            } else {
                console.error(`❌ 錯誤：找不到任何可用班別！shiftCodes:`, this.shiftCodes);
            }
        }
        
        return needs;
    }
}
