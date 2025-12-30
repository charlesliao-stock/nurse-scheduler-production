/**
 * 策略 V1: 全域分層法 (Step 1: 暴力填滿版 + 自動重置)
 * 目前進度：
 * 1. Step 0: 先重置所有非預休的班別為 OFF。
 * 2. Step 1: 針對包班人員 (VIP)，無視需求與節奏，強制填滿整月。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // 初始化動態參數 (供未來參考，目前 Step 1 暫不影響排班結果)
        this.initDynamicPacing();
    }

    // [初始化] 動態計算供需與節奏
    initDynamicPacing() {
        let totalDemand = 0;
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            ['N', 'E', 'D'].forEach(shift => {
                totalDemand += this.getDemand(dateStr, shift);
            });
        }

        const staffCount = this.staffList.length;
        const totalSupply = staffCount * this.daysInMonth;
        const totalOffs = totalSupply - totalDemand;
        
        // 計算平均每人月休
        this.avgMonthlyOffs = staffCount > 0 ? (totalOffs / staffCount) : 0;

        // 推估放假節奏
        if (this.avgMonthlyOffs <= 0) {
            this.pacingLimit = 999; 
            console.warn(`[V1 Init] 人力嚴重不足！無法排休。`);
        } else {
            const workDays = this.daysInMonth - this.avgMonthlyOffs;
            const ratio = workDays / this.avgMonthlyOffs;
            this.pacingLimit = Math.ceil(ratio) + 1;
        }

        console.log(`=== V1 初始化參數 ===`);
        console.log(`- 總人力: ${staffCount} 人`);
        console.log(`- 預估平均月休: ${this.avgMonthlyOffs.toFixed(2)} 天`);
    }

    run() {
        console.log("=== V1 Step 1 執行: 重置並暴力填滿包班 (無視爆量) ===");

        // Step 0: 先把盤面清乾淨 (只保留預休 REQ_OFF)
        this.resetAllToOff();

        // Step 1: 針對包班人員，填滿整月
        this.runStep1_FillPackageVIP();

        return this.schedule;
    }

    // ==========================================
    // Step 0: 重置全月班表 (只留 REQ_OFF / LEAVE)
    // ==========================================
    resetAllToOff() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);
                
                // 如果不是「預休 (REQ_OFF)」或「請假 (LEAVE)」，全部清成 OFF
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'OFF'); 
                }
            }
        });
        console.log("[Step 0] 已重置所有非預休班別為 OFF");
    }

    // ==========================================
    // Step 1: 包班 VIP 填好填滿 (暴力模式)
    // ==========================================
    runStep1_FillPackageVIP() {
        // 篩選出有包班屬性 (N 或 E) 的人員
        const packageStaff = this.staffList.filter(s => s.packageType && ['N', 'E'].includes(s.packageType));
        
        console.log(`[Step 1] 處理包班人員共 ${packageStaff.length} 位`);

        packageStaff.forEach(staff => {
            const targetShift = staff.packageType; // 他包的班別 (N 或 E)

            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                
                // 檢查目前狀態
                // 若已是 'REQ_OFF' (預休) 則跳過，其餘(包括已被重置的OFF)都嘗試填入
                const currentStatus = this.getShiftByDate(dateStr, staff.id);

                if (currentStatus === 'OFF') {
                    // 暴力填入，僅檢查基本的生理連續性 (BaseScheduler 內建，如 N 不接 D)
                    // 不檢查需求上限 (Demand)，也不管節奏 (Pacing)
                    if (this.isValidContinuity(staff, dateStr, targetShift)) {
                        this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                    }
                }
            }
        });
    }

    // ==========================================
    // 輔助函式 (Helpers)
    // ==========================================

    getPotentialSupply(dateStr, shiftType, excludeStaffId) {
        let count = 0;
        this.staffList.forEach(s => {
            if (s.id === excludeStaffId) return;
            const currentStatus = this.getShiftByDate(dateStr, s.id);
            if (currentStatus === 'REQ_OFF' || currentStatus === 'LEAVE') return;
            if (['N', 'E', 'D'].includes(currentStatus) && currentStatus !== shiftType) return;
            if (!this.isInWhiteList(s, shiftType)) return;
            count++;
        });
        return count;
    }
    
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    compareForWork(a, b, shift) {
        const isPkgA = (a.packageType === shift);
        const isPkgB = (b.packageType === shift);
        if (isPkgA && !isPkgB) return -1;
        if (!isPkgA && isPkgB) return 1;
        return this.counters[b.id].OFF - this.counters[a.id].OFF;
    }
    
    isInWhiteList(staff, shift) {
        if (staff.packageType && staff.packageType.includes('N') && shift === 'E') return false; 
        if (staff.packageType && staff.packageType.includes('E') && shift === 'N') return false;
        return true; 
    }
    
    getDemand(dateStr, shift) {
        if (this.rules.dailyNeeds) {
            const dateObj = new Date(dateStr);
            let dayIdx = dateObj.getDay(); 
            const adjustedIdx = (dayIdx + 6) % 7; // Mon=0...Sun=6
            const key = `${shift}_${adjustedIdx}`; 
            
            if (this.rules.dailyNeeds[key] !== undefined && this.rules.dailyNeeds[key] !== "") {
                const val = parseInt(this.rules.dailyNeeds[key], 10);
                if (!isNaN(val)) return val;
            }
        }
        return 2; 
    }
    
    getPreference(staff, dateStr, level) {
        if (staff.prefs && staff.prefs[dateStr]) return staff.prefs[dateStr][level];
        return null;
    }
}
