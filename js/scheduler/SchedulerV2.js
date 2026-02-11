/**
 * SchedulerV2.js - 嚴格硬規則版 (Strict Hard-Rule Edition)
 * 🔧 核心修正：
 * 1. [硬規則] 包班人員：嚴格限制只能排目標班別，禁止支援其他班。
 * 2. [硬規則] 排班偏好：若有設定偏好，AI 僅能在偏好內選班，不符者直接排除。
 * 3. [鎖定機制] 預班保護：FF、REQ_OFF 及指定班別絕對鎖定，禁止 AI 覆蓋。
 * 4. [平準化] OFF平衡：優先填補 OFF 天數過多的人。
 */

window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.lockedCells = new Set(); // 儲存格式: "dateStr-staffId"
        this.initV2();
    }

    initV2() {
        console.log('🔍 SchedulerV2 嚴格版初始化，人數:', this.staffList.length);
        
        this.staffList.forEach(s => {
            // 讀取包班設定
            const bundleShift = s.packageType || s.prefs?.bundleShift || s.preferences?.bundleShift;
            
            // 讀取偏好班別 (favShift 1~3)
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
     * ✅ 核心攔截：可用性檢查 (判定誰能進入白名單)
     */
    isPersonAvailableForShift(staff, date, shiftCode) {
        // 1. 保護鎖：如果該格子已經有預排班別，AI 禁止進入
        if (this.lockedCells.has(`${date}-${staff.id}`)) return false;

        const stats = this.staffStats[staff.id];
        if (!stats) return false;

        // 2. 【硬規則】包班攔截：如果不是目標班別，直接判定為不可用
        if (stats.isBundle && stats.targetShift && stats.targetShift !== shiftCode) {
            return false;
        }

        // 3. 【硬規則】偏好攔截：如果設定了偏好，但當前班別不在偏好內，直接判定為不可用
        if (stats.favShifts.length > 0 && !stats.favShifts.includes(shiftCode)) {
            return false;
        }

        // 4. 基礎規則檢查 (呼叫 BaseScheduler 處理連上班天數、跨班限制、預排休假等)
        if (window.BaseScheduler && window.BaseScheduler.prototype.isPersonAvailableForShift) {
            return window.BaseScheduler.prototype.isPersonAvailableForShift.call(this, staff, date, shiftCode);
        }
        return true; 
    }

    /**
     * 填補每日人力缺口
     */
    tryFillShift(day, shiftCode, needCount) {
        const ds = this.getDateStr(day);
        if (!this.schedule[ds]) this.schedule[ds] = {};

        // 找出目前「空白」且「完全符合硬規則」的白名單人選
        let candidates = this.staffList.filter(s => {
            const currentVal = this.schedule[ds][s.id];
            // 已有預班值 (FF, D, REQ_OFF 等) 則跳過
            if (currentVal && currentVal !== 'OFF') return false;
            return this.isPersonAvailableForShift(s, ds, shiftCode);
        });

        // 如果白名單人數不足，記錄缺口 (班表將維持空白)
        if (candidates.length < needCount) {
            console.warn(`⚠️ [人力缺口] ${ds} ${shiftCode} 需求 ${needCount} 人，白名單僅 ${candidates.length} 人`);
        }

        // 排序優選者：目前 OFF 天數過多的人優先排班，以平衡月休天數
        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];
            if (statsA.offDaysCount !== statsB.offDaysCount) {
                return statsB.offDaysCount - statsA.offDaysCount;
            }
            return statsA.workPressure - statsB.workPressure;
        });

        const selected = candidates.slice(0, needCount);
        selected.forEach(s => {
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
        console.log('🚀 開始執行 SchedulerV2 嚴格保護排班...');
        
        // 1. 套用預定班表 (FF, REQ_OFF, 指定 D/E/N)
        if (typeof this.applyPreSchedules === 'function') {
            this.applyPreSchedules();
        }

        // 2. 建立預班保護鎖：只要格子裡原本就有值的，AI 絕對不碰
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            this.staffList.forEach(s => {
                const preVal = this.schedule[ds]?.[s.id];
                if (preVal && preVal !== 'OFF') {
                    this.lockedCells.add(`${ds}-${s.id}`);
                }
            });
        }

        // 3. 逐日排班 (N -> E -> D 順序)
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            const needs = this.getDailyNeedsData(d);
            
            ['N', 'E', 'D'].forEach(shiftCode => {
                const count = needs[shiftCode] || 0;
                if (count > 0) this.tryFillShift(d, shiftCode, count);
            });

            // 4. 結算當日狀態：區隔預排假(FF)與系統分配假(OFF)
            this.staffList.forEach(s => {
                const current = this.schedule[ds][s.id];
                if (!current) {
                    // 沒班排且沒預排，填入系統 OFF
                    this.schedule[ds][s.id] = 'OFF';
                    this.staffStats[s.id].offDaysCount++;
                } else if (['OFF', 'REQ_OFF', 'FF'].includes(current)) {
                    // 預排假計入休假統計，但不蓋掉原本的字串 (如 FF)
                    this.staffStats[s.id].offDaysCount++;
                }
            });
        }

        console.log('🏁 嚴格版排班完成，預班與偏好已完整保護。');
        return this.schedule;
    }
};
