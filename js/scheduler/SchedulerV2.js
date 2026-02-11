/**
 * SchedulerV2_Strict_Fixed.js (正式修復版)
 * 🔧 更新重点：
 * 1. [絕對鎖定] 預班 (FF, 指定班) 進入排班表後，後續邏輯禁止覆蓋。
 * 2. [修正] 解決「全部變 FF」的問題：區隔「預排假」與「系統分配假」。
 * 3. [硬規則] 嚴格執行包班與偏好，寧可人力缺口也絕不跳班。
 */

window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.lockedCells = new Set(); // 紀錄哪些格子是預班鎖定的
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
    }

    /**
     * 強化可用性檢查：排除已鎖定的格子
     */
    isPersonAvailableForShift(staff, date, shiftCode) {
        // 如果該單元格已被預班鎖定，直接不可用
        if (this.lockedCells.has(`${date}-${staff.id}`)) return false;

        const stats = this.staffStats[staff.id];
        if (!stats) return false;

        if (stats.isBundle && stats.targetShift !== shiftCode) return false;
        if (stats.favShifts.length > 0 && !stats.favShifts.includes(shiftCode)) return false;

        return super.isPersonAvailableForShift(staff, date, shiftCode);
    }

    /**
     * 修正填補邏輯：禁止覆蓋任何已有值
     */
    tryFillShift(day, shiftCode, needCount) {
        const ds = this.getDateStr(day);
        if (!this.schedule[ds]) this.schedule[ds] = {};

        let candidates = this.staffList.filter(s => {
            // 關鍵：如果這格已經有值（FF, D, E, N, REQ_OFF...），絕對不能動
            if (this.schedule[ds][s.id]) return false;
            return this.isPersonAvailableForShift(s, ds, shiftCode);
        });

        if (candidates.length < needCount) {
            console.warn(`⚠️ [缺口] ${ds} ${shiftCode} 缺 ${needCount - candidates.length} 人`);
        }

        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];
            if (statsA.offDaysCount !== statsB.offDaysCount) {
                return statsB.offDaysCount - statsA.offDaysCount;
            }
            return statsA.workPressure - statsB.workPressure;
        });

        candidates.slice(0, needCount).forEach(s => {
            this.updateShift(ds, s.id, shiftCode);
            this.staffStats[s.id].workPressure += 10;
        });
    }

    getDailyNeedsData(day) {
        if (typeof super.getDailyNeeds === 'function') return super.getDailyNeeds(day);
        return { D: 2, E: 2, N: 2 }; 
    }

    run() {
        console.log('🚀 開始執行嚴格版 AI 排班 (預班保護模式)...');
        
        // 1. 套用預班並「鎖定」
        if (typeof this.applyPreSchedules === 'function') {
            this.applyPreSchedules();
            // 掃描當前 schedule，將所有非空白格子鎖定
            for (let d = 1; d <= this.daysInMonth; d++) {
                const ds = this.getDateStr(d);
                this.staffList.forEach(s => {
                    if (this.schedule[ds] && this.schedule[ds][s.id]) {
                        this.lockedCells.add(`${ds}-${s.id}`);
                        // console.log(`🔒 鎖定預班: ${s.name} ${ds} -> ${this.schedule[ds][s.id]}`);
                    }
                });
            }
        }

        // 2. 逐日填補
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

            // 3. 統計當日 OFF (修正：不要把預排的班別蓋成 FF 或 OFF)
            this.staffList.forEach(s => {
                const current = this.schedule[ds][s.id];
                // 如果是空白，才填入系統 OFF；如果是 FF/REQ_OFF/OFF，增加統計
                if (!current) {
                    this.schedule[ds][s.id] = 'OFF';
                    this.staffStats[s.id].offDaysCount++;
                } else if (['OFF', 'REQ_OFF', 'FF'].includes(current)) {
                    this.staffStats[s.id].offDaysCount++;
                }
            });
        }

        console.log('🏁 排班完成，預班已完整保留。');
        return this.schedule;
    }
};
