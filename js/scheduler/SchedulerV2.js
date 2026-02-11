/**
 * SchedulerV2_Strict_Fixed.js (正式穩定版)
 * 🔧 修正重點：
 * 1. [硬規則] 包班人員：絕對鎖定目標班別，不排其他班。
 * 2. [優先級] 排班偏好：符合偏好者最優先，不符者(且非包班)作為補位備選，不直接剔除。
 * 3. [保護鎖] 預先排好的 FF、D、E、N 絕對不被覆蓋。
 * 4. [區隔] 預排假維持 FF/REQ_OFF，AI 分配假顯示為 OFF。
 */

window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        this.staffStats = {};
        this.lockedCells = new Set(); 
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
        console.log('✅ SchedulerV2_Strict 邏輯初始化完成');
    }

    /**
     * 穩定版可用性檢查
     */
    isPersonAvailableForShift(staff, date, shiftCode) {
        // 1. 預班保護：格子已鎖定則不可用
        if (this.lockedCells.has(`${date}-${staff.id}`)) return false;

        const stats = this.staffStats[staff.id];
        if (!stats) return false;

        // 2. 【硬規則】包班人員：嚴格限制只能排目標班別
        if (stats.isBundle && stats.targetShift && stats.targetShift !== shiftCode) {
            return false;
        }

        // 3. 基礎規則檢查 (連上班、班別間隔等)
        if (window.BaseScheduler && window.BaseScheduler.prototype.isPersonAvailableForShift) {
            return window.BaseScheduler.prototype.isPersonAvailableForShift.call(this, staff, date, shiftCode);
        }
        return true; 
    }

    tryFillShift(day, shiftCode, needCount) {
        const ds = this.getDateStr(day);
        if (!this.schedule[ds]) this.schedule[ds] = {};

        // 1. 找出所有「目前沒班」且「符合基礎規則」的人
        let candidates = this.staffList.filter(s => {
            const currentVal = this.schedule[ds][s.id];
            // 禁止覆蓋任何預班 (FF, D, REQ_OFF 等)
            if (currentVal && currentVal !== 'OFF') return false;
            return this.isPersonAvailableForShift(s, ds, shiftCode);
        });

        // 2. 排序：偏好符合 > 休假平衡 > 壓力
        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];

            const isFavA = statsA.favShifts.includes(shiftCode) ? 1 : 0;
            const isFavB = statsB.favShifts.includes(shiftCode) ? 1 : 0;

            // 符合偏好者排在最前面
            if (isFavA !== isFavB) return isFavB - isFavA;
            
            // 接著考慮休假平衡 (OFF 天數多的人優先上班)
            if (statsA.offDaysCount !== statsB.offDaysCount) {
                return statsB.offDaysCount - statsA.offDaysCount;
            }
            
            return statsA.workPressure - statsB.workPressure;
        });

        if (candidates.length < needCount) {
            console.warn(`⚠️ [缺口] ${ds} ${shiftCode} 需求 ${needCount} 人，實排 ${candidates.length} 人`);
        }

        const selected = candidates.slice(0, needCount);
        selected.forEach(s => {
            this.updateShift(ds, s.id, shiftCode);
            this.staffStats[s.id].workPressure += 10;
        });
    }

    run() {
        console.log('🚀 開始執行穩定版 AI 排班 (強化 D/E/N 填補)...');
        
        // 1. 套用預班
        if (typeof this.applyPreSchedules === 'function') {
            this.applyPreSchedules();
        }

        // 2. 鎖定預班 (包含 FF, REQ_OFF, 指定班別)
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            this.staffList.forEach(s => {
                const preVal = this.schedule[ds]?.[s.id];
                if (preVal && preVal !== 'OFF') {
                    this.lockedCells.add(`${ds}-${s.id}`);
                }
            });
        }

        // 3. 逐日填補 D/E/N
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            const needs = (window.BaseScheduler && window.BaseScheduler.prototype.getDailyNeeds) 
                ? window.BaseScheduler.prototype.getDailyNeeds.call(this, d) 
                : { D: 0, E: 0, N: 0 };
            
            ['N', 'E', 'D'].forEach(shiftCode => {
                const count = needs[shiftCode] || 0;
                if (count > 0) this.tryFillShift(d, shiftCode, count);
            });

            // 4. 當日統計與 FF 保護
            this.staffList.forEach(s => {
                const current = this.schedule[ds][s.id];
                // 只有 AI 沒排到人且預班也沒填的地方，才補上系統 OFF
                if (!current) {
                    this.schedule[ds][s.id] = 'OFF';
                    this.staffStats[s.id].offDaysCount++;
                } 
                // 如果是預排假 (FF/REQ_OFF)，增加統計
                else if (['OFF', 'REQ_OFF', 'FF'].includes(current)) {
                    this.staffStats[s.id].offDaysCount++;
                }
            });
        }

        console.log('🏁 排班任務結束。');
        return this.schedule;
    }
};
