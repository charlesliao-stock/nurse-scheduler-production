/**
 * SchedulerV2_Strict_Fixed.js (最終修復版)
 * 🔧 更新重點：
 * 1. [修正錯誤] 解決 super 呼叫產生的 TypeError，改用更穩定的 prototype 呼叫。
 * 2. [預班保護] 嚴格保留 FF、REQ_OFF 及所有指定班別，AI 絕對禁止覆蓋。
 * 3. [硬規則] 包班與偏好絕對隔離，不符偏好者寧可缺口也不排班。
 */

window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.lockedCells = new Set(); // 儲存格式: "dateStr-staffId"
        this.initV2();
    }

    initV2() {
        this.staffList.forEach(s => {
            const bundleShift = s.packageType || s.prefs?.bundleShift || s.preferences?.bundleShift || s.bundleShift;
            
            const favs = [
                s.prefs?.favShift1, s.prefs?.favShift2, s.prefs?.favShift3,
                s.preferences?.favShift1, s.preferences?.favShift2, s.preferences?.favShift3
            ].filter(code => code && code !== 'OFF' && code !== 'NONE' && code !== '-');

            this.staffStats[s.id] = {
                workPressure: 0,
                isBundle: !!bundleShift && bundleShift !== 'NONE',
                targetShift: (bundleShift === 'NONE' || !bundleShift) ? null : bundleShift,
                favShifts: favs,
                offDaysCount: 0
            };
        });
        console.log('✅ SchedulerV2_Strict 初始化完成 (預班保護已就緒)');
    }

    /**
     * ✅ 修正：使用更穩定的方式呼叫父類別檢查
     */
    checkBaseRules(staff, date, shiftCode) {
        if (window.BaseScheduler && window.BaseScheduler.prototype.isPersonAvailableForShift) {
            return window.BaseScheduler.prototype.isPersonAvailableForShift.call(this, staff, date, shiftCode);
        }
        return true; 
    }

    isPersonAvailableForShift(staff, date, shiftCode) {
        // 如果該單元格已被鎖定（預班），直接判定為不可用（因為不能覆蓋）
        if (this.lockedCells.has(`${date}-${staff.id}`)) return false;

        const stats = this.staffStats[staff.id];
        if (!stats) return false;

        // 硬規則：包班攔截
        if (stats.isBundle && stats.targetShift && stats.targetShift !== shiftCode) return false;

        // 硬規則：偏好攔截
        if (stats.favShifts.length > 0 && !stats.favShifts.includes(shiftCode)) return false;

        // 基礎規則檢查 (連上班、跨班等)
        return this.checkBaseRules(staff, date, shiftCode);
    }

    tryFillShift(day, shiftCode, needCount) {
        const ds = this.getDateStr(day);
        if (!this.schedule[ds]) this.schedule[ds] = {};

        // 篩選出目前「空白」且「符合硬規則」的人
        let candidates = this.staffList.filter(s => {
            const currentVal = this.schedule[ds][s.id];
            // 只要格子已有值 (FF, D, REQ_OFF 等)，就不能被 AI 填補
            if (currentVal && currentVal !== 'OFF') return false;
            
            return this.isPersonAvailableForShift(s, ds, shiftCode);
        });

        if (candidates.length < needCount) {
            console.warn(`⚠️ [人力缺口] ${ds} ${shiftCode} 缺 ${needCount - candidates.length} 人`);
        }

        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];
            // 平衡 OFF 天數：休假少的人優先排班
            if (statsA.offDaysCount !== statsB.offDaysCount) {
                return statsB.offDaysCount - statsA.offDaysCount;
            }
            return statsA.workPressure - statsB.workPressure;
        });

        const toFill = candidates.slice(0, needCount);
        toFill.forEach(s => {
            this.updateShift(ds, s.id, shiftCode);
            this.staffStats[s.id].workPressure += 10;
        });
    }

    getDailyNeedsData(day) {
        if (window.BaseScheduler && window.BaseScheduler.prototype.getDailyNeeds) {
            return window.BaseScheduler.prototype.getDailyNeeds.call(this, day);
        }
        return { D: 0, E: 0, N: 0 };
    }

    run() {
        console.log('🚀 開始執行嚴格版 AI 排班 (強化預班鎖定模式)...');
        
        // 1. 套用預班
        if (typeof this.applyPreSchedules === 'function') {
            this.applyPreSchedules();
        }

        // 2. 掃描並「鎖定」預班格子
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            this.staffList.forEach(s => {
                const preVal = this.schedule[ds]?.[s.id];
                // 只要不是空的，也不是預設的 OFF，就鎖定
                if (preVal && preVal !== 'OFF') {
                    this.lockedCells.add(`${ds}-${s.id}`);
                }
            });
        }

        // 3. 逐日填補
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            const needs = this.getDailyNeedsData(d);
            
            const fillOrder = ['N', 'E', 'D']; 
            fillOrder.forEach(shiftCode => {
                const count = needs[shiftCode] || 0;
                if (count > 0) {
                    this.tryFillShift(d, shiftCode, count);
                }
            });

            // 4. 統計與結算 (保留 FF，不覆蓋已有的值)
            this.staffList.forEach(s => {
                const current = this.schedule[ds][s.id];
                // 如果是空白，才補上系統 OFF
                if (!current) {
                    this.schedule[ds][s.id] = 'OFF';
                    this.staffStats[s.id].offDaysCount++;
                } 
                // 如果是預排的假 (FF/REQ_OFF)，增加統計計數
                else if (['OFF', 'REQ_OFF', 'FF'].includes(current)) {
                    this.staffStats[s.id].offDaysCount++;
                }
            });
        }

        console.log('🏁 嚴格版排班完成，已保護預排 FF 與指定班別。');
        return this.schedule;
    }
};
