/**
 * SchedulerV2_Strict_Fixed.js
 * 🔧 嚴格規則版 (Strict Mode)
 * 1. [硬規則] 包班人員：只能排目標班別。
 * 2. [硬規則] 排班偏好：只能排 favShift1~3 內的班別，其餘不排。
 * 3. [硬規則] FF/預排：優先級最高，鎖定不可變動。
 * 4. [平衡] 天數平準：優先填補 OFF 天數過多的人，抑制 OFF 過少的人。
 */

window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.initV2();
    }

    initV2() {
        this.staffList.forEach(s => {
            const bundleShift = s.packageType || s.prefs?.bundleShift || s.preferences?.bundleShift;
            
            // 整理偏好名單為陣列，方便後續 includes 檢查
            const favs = [
                s.prefs?.favShift1, 
                s.prefs?.favShift2, 
                s.prefs?.favShift3,
                s.preferences?.favShift1,
                s.preferences?.favShift2,
                s.preferences?.favShift3
            ].filter(code => code && code !== 'OFF' && code !== 'NONE');

            this.staffStats[s.id] = {
                workPressure: 0,
                isBundle: !!bundleShift,
                targetShift: bundleShift || null,
                favShifts: favs,
                offDaysCount: 0
            };
        });
        
        console.log('✅ SchedulerV2_Strict 初始化完成 (偏好已鎖定為硬規則)');
    }

    /**
     * ✅ 核心修正：可用性檢查 (硬規則攔截器)
     */
    isPersonAvailableForShift(staff, date, shiftCode) {
        const stats = this.staffStats[staff.id];

        // 1. 檢查是否為包班人員：如果不是他的目標班別，直接剔除
        if (stats.isBundle) {
            if (shiftCode !== stats.targetShift) return false;
        }

        // 2. 檢查排班偏好：如果該員有設定偏好，且嘗試排的班不在此名單內，直接剔除
        // 注意：若完全沒設偏好的人，視為可排任何班（補位者）
        if (stats.favShifts.length > 0) {
            if (!stats.favShifts.includes(shiftCode)) return false;
        }

        // 3. 呼叫 BaseScheduler 進行基礎檢查（連上班、班別間隔、已預排 OFF 等）
        return super.isPersonAvailableForShift(staff, date, shiftCode);
    }

    /**
     * ✅ 核心修正：填補邏輯 (資格制)
     */
    tryFillShift(day, shiftCode, needCount) {
        const ds = this.getDateStr(day);
        if (!this.schedule[ds]) this.schedule[ds] = {};

        // 1. 過濾出「絕對符合硬規則」的候選人
        let candidates = this.staffList.filter(s => {
            // 如果當天已經有排班（含預排），就不再考慮
            if (this.schedule[ds][s.id]) return false;
            // 執行上述硬規則檢查
            return this.isPersonAvailableForShift(s, ds, shiftCode);
        });

        // 2. 如果人數不足，記錄缺口但不強排不對的人
        if (candidates.length < needCount) {
            console.warn(`[缺口] ${ds} ${shiftCode} 班缺 ${needCount - candidates.length} 人 (符合偏好者不足)`);
        }

        // 3. 根據「休假平衡」與「壓力」排序
        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];

            // 優先排：目前 OFF 天數過多的人 (讓他減少 OFF)
            // 延後排：目前 OFF 天數過少的人 (讓他保留 OFF)
            if (statsA.offDaysCount !== statsB.offDaysCount) {
                return statsB.offDaysCount - statsA.offDaysCount;
            }
            
            return statsA.workPressure - statsB.workPressure;
        });

        // 4. 正式填入
        const toFill = candidates.slice(0, needCount);
        toFill.forEach(s => {
            this.updateShift(ds, s.id, shiftCode);
            this.staffStats[s.id].workPressure += 10;
        });
    }

    /**
     * 重寫執行邏輯
     */
    run() {
        console.log('🚀 開始執行嚴格版排班...');
        
        // 階段 0: 套用預班 (FF / REQ_OFF) - 最高優先級
        if (typeof this.applyPreSchedules === 'function') {
            this.applyPreSchedules();
        }

        // 階段 1: 逐日填補
        for (let d = 1; d <= this.daysInMonth; d++) {
            const needs = this.getDailyNeeds(d);
            
            // 依序填補 N -> E -> D (通常夜班較難排，先填)
            const fillOrder = ['N', 'E', 'D']; 
            fillOrder.forEach(shiftCode => {
                if (needs[shiftCode] > 0) {
                    this.tryFillShift(d, shiftCode, needs[shiftCode]);
                }
            });

            // 每天結束後更新當天沒被排到班的人的 OFF 計數
            const ds = this.getDateStr(d);
            this.staffList.forEach(s => {
                const shift = this.schedule[ds][s.id];
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') {
                    this.staffStats[s.id].offDaysCount++;
                    this.schedule[ds][s.id] = this.schedule[ds][s.id] || 'OFF';
                }
            });
        }

        console.log('🏁 嚴格版排班完成');
        return this.schedule;
    }
};
