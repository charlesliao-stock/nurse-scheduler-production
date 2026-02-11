// js/scheduler/SchedulerV2.js
/**
 * 階層式 AI 排班引擎 - 嚴格保護與補位修正版
 * 🔧 核心修正：
 * 1. [絕對鎖定] 預先排好的 FF、D、E、N 絕對不被覆蓋。
 * 2. [優先補位] 符合偏好者最優先；若不足，非包班者自動補位，不讓格子變 FF。
 * 3. [硬規則] 包班人員嚴格鎖定目標班別。
 */

window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.lockedCells = new Set(); // 用於鎖定預班位置
        this.initV2();
    }

    initV2() {
        console.log('🔍 初始化 V2 邏輯，總人數:', this.staffList.length);
        
        this.staffList.forEach(s => {
            // 從多個可能的欄位獲取包班與偏好資訊
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
     * ✅ 改進的可用性檢查：確保預班不被改動，且包班人員不亂跑
     */
    isPersonAvailableForShift(staff, date, shiftCode) {
        // 1. 如果這格已經被預班鎖定，絕對禁止 AI 填補
        if (this.lockedCells.has(`${date}-${staff.id}`)) return false;

        const stats = this.staffStats[staff.id];
        if (!stats) return false;

        // 2. 【硬規則】包班攔截：如果他是包班人員，且嘗試排的班不符合他的包班目標
        if (stats.isBundle && stats.targetShift && stats.targetShift !== shiftCode) {
            return false;
        }

        // 3. 呼叫 BaseScheduler 的基礎檢查（連上班、班別間隔、REQ_OFF等）
        if (window.BaseScheduler && window.BaseScheduler.prototype.isPersonAvailableForShift) {
            return window.BaseScheduler.prototype.isPersonAvailableForShift.call(this, staff, date, shiftCode);
        }
        return true; 
    }

    /**
     * 嘗試填滿每日人力需求
     */
    tryFillShift(day, shiftCode, needCount) {
        const ds = this.getDateStr(day);
        if (!this.schedule[ds]) this.schedule[ds] = {};

        // 1. 找出所有「目前為空」且「符合硬規則」的人
        let candidates = this.staffList.filter(s => {
            const currentVal = this.schedule[ds][s.id];
            // 只要格子已有預排值 (FF, D, REQ_OFF 等)，就不可填補
            if (currentVal && currentVal !== 'OFF') return false;
            return this.isPersonAvailableForShift(s, ds, shiftCode);
        });

        // 2. 排序邏輯：偏好符合者最優先 > 休假平衡 > 壓力值
        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];

            const isFavA = statsA.favShifts.includes(shiftCode) ? 1 : 0;
            const isFavB = statsB.favShifts.includes(shiftCode) ? 1 : 0;

            // 優先度 A: 符合偏好的人排最前面
            if (isFavA !== isFavB) return isFavB - isFavA;
            
            // 優先度 B: 月休天數落後的人排前面 (為了讓大家休假平均)
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

        if (selected.length < needCount) {
            console.warn(`⚠️ [人力缺口] ${ds} ${shiftCode} 需求 ${needCount} 人，白名單人選僅 ${selected.length} 人。`);
        }
    }

    run() {
        console.log('🚀 開始執行 SchedulerV2 穩定版...');
        
        // 階段 0: 套用預定班表 (FF, REQ_OFF, 指定 D/E/N)
        if (typeof this.applyPreSchedules === 'function') {
            this.applyPreSchedules();
        }

        // 階段 1: 建立保護鎖
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            this.staffList.forEach(s => {
                const val = this.schedule[ds]?.[s.id];
                // 只要預班表上有值 (含 FF)，就鎖定不可覆蓋
                if (val && val !== 'OFF') {
                    this.lockedCells.add(`${ds}-${s.id}`);
                }
            });
        }

        // 階段 2: 逐日掃描排班 (N -> E -> D 順序)
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            const needs = (window.BaseScheduler && window.BaseScheduler.prototype.getDailyNeeds) 
                ? window.BaseScheduler.prototype.getDailyNeeds.call(this, d) 
                : { D: 0, E: 0, N: 0 };
            
            ['N', 'E', 'D'].forEach(shiftCode => {
                const count = needs[shiftCode] || 0;
                if (count > 0) this.tryFillShift(d, shiftCode, count);
            });

            // 階段 3: 結算統計，保留原本的 FF 與 REQ_OFF 顯示
            this.staffList.forEach(s => {
                const current = this.schedule[ds][s.id];
                if (!current) {
                    this.schedule[ds][s.id] = 'OFF'; // 沒班排的空格填為 OFF
                    this.staffStats[s.id].offDaysCount++;
                } else if (['OFF', 'REQ_OFF', 'FF'].includes(current)) {
                    this.staffStats[s.id].offDaysCount++;
                }
            });
        }

        console.log('🏁 排班任務結束，FF 已保留且 D/E/N 應已正常填入。');
        return this.schedule;
    }
};
