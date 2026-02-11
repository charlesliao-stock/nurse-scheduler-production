/**
 * SchedulerV2_Strict_Fixed.js (修正版)
 */
window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.initV2();
    }

    initV2() {
        this.staffList.forEach(s => {
            // 修正：從多個可能的欄位讀取包班設定
            const bundleShift = s.packageType || s.prefs?.bundleShift || s.preferences?.bundleShift || s.bundleShift;
            
            const favs = [
                s.prefs?.favShift1, s.prefs?.favShift2, s.prefs?.favShift3,
                s.preferences?.favShift1, s.preferences?.favShift2, s.preferences?.favShift3
            ].filter(code => code && code !== 'OFF' && code !== 'NONE' && code !== '-');

            this.staffStats[s.id] = {
                workPressure: 0,
                isBundle: !!bundleShift,
                targetShift: bundleShift || null,
                favShifts: favs,
                offDaysCount: 0
            };
        });
        console.log('✅ SchedulerV2_Strict 初始化完成');
    }

    isPersonAvailableForShift(staff, date, shiftCode) {
        const stats = this.staffStats[staff.id];
        if (!stats) return false;

        // 硬規則：包班攔截
        if (stats.isBundle && stats.targetShift !== shiftCode) return false;

        // 硬規則：偏好攔截 (若有設偏好，則只能排偏好內的班)
        if (stats.favShifts.length > 0 && !stats.favShifts.includes(shiftCode)) return false;

        // 呼叫父類別 BaseScheduler 的檢查 (連上班、預排等)
        return super.isPersonAvailableForShift(staff, date, shiftCode);
    }

    tryFillShift(day, shiftCode, needCount) {
        const ds = this.getDateStr(day);
        if (!this.schedule[ds]) this.schedule[ds] = {};

        let candidates = this.staffList.filter(s => {
            if (this.schedule[ds][s.id] && this.schedule[ds][s.id] !== 'OFF') return false;
            return this.isPersonAvailableForShift(s, ds, shiftCode);
        });

        if (candidates.length < needCount) {
            console.warn(`[缺口] ${ds} ${shiftCode} 缺 ${needCount - candidates.length} 人`);
        }

        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];
            // 平衡 OFF 天數：OFF 越多的人優先排班
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

    // 關鍵修正：確保 getDailyNeeds 邏輯正確
    getDailyNeedsData(d) {
        // 如果子類沒有定義，嘗試呼叫父類或從 rules 直接取
        if (typeof super.getDailyNeeds === 'function') {
            return super.getDailyNeeds(d);
        }
        // 應急方案：若 Base 未定義，則回傳空需求避免崩潰
        return { D: 0, E: 0, N: 0 };
    }

    run() {
        console.log('🚀 開始執行嚴格版排班 (修正 getDailyNeeds 錯誤)...');
        
        // 階段 0: 套用預班 (由父類 BaseScheduler 提供)
        if (typeof this.applyPreSchedules === 'function') {
            this.applyPreSchedules();
        }

        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            // 修正處：使用剛定義的 safe getter
            const needs = this.getDailyNeedsData(d);
            
            const fillOrder = ['N', 'E', 'D']; 
            fillOrder.forEach(shiftCode => {
                const count = needs[shiftCode] || 0;
                if (count > 0) {
                    this.tryFillShift(d, shiftCode, count);
                }
            });

            // 統計當日 OFF
            this.staffList.forEach(s => {
                const current = this.schedule[ds][s.id];
                if (!current || current === 'OFF' || current === 'REQ_OFF' || current === 'FF') {
                    this.staffStats[s.id].offDaysCount++;
                    if (!this.schedule[ds][s.id]) this.schedule[ds][s.id] = 'OFF';
                }
            });
        }

        console.log('🏁 嚴格版排班完成');
        return this.schedule;
    }
};
