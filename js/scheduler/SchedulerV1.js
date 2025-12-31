/**
 * 策略 V1: 全域分層法 (Step 1: 嚴格包班填滿)
 * * 執行邏輯：
 * 1. [Step 0] 重置：將所有非預休 (REQ_OFF) 的格子清空為 OFF。
 * 2. [Step 1] 包班填滿：
 * - 鎖定對象：僅限偏好設定為「包N」或「包E」的人員 (packageType 不為空)。
 * - 執行動作：將整個月的空位全部填滿，不檢查任何規則 (爆量、連七都不管)。
 * 3. [STOP] 暫停，不處理一般人員 (如 1.D, 1.N)，他們應維持全空。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
    }

    run() {
        console.log("=== V1 (Step 1): 嚴格鎖定包班人員填滿 ===");

        // [Step 0] 重置盤面 (只保留 REQ_OFF)
        this.resetAllToOff();

        // [Step 1] 針對「包班」人員，填滿整月
        this.runStep1_FillPackageOnly();

        return this.schedule;
    }

    // ==========================================
    // Step 0: 重置全月班表
    // ==========================================
    resetAllToOff() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);
                
                // 只要不是「預休 (REQ_OFF)」或「請假 (LEAVE)」，全部清成 OFF
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') {
                    this.updateShift(dateStr, staff.id, 'OFF', 'OFF'); 
                }
            }
        });
        console.log("[Step 0] 已重置所有非預休班別為 OFF");
    }

// ==========================================
// Step 1: 嚴格篩選包班人員並填滿
// ==========================================
runStep1_FillPackageOnly() {
    // 1. 篩選條件：檢查 preference 欄位是否包含"包"字
    const packageStaff = this.staffList.filter(s => {
        // 確保 preference 存在且包含"包"字
        if (!s.preference) return false;
        
        const pref = s.preference.toString().trim();
        if (!pref.includes('包')) return false;
        
        // 解析包班類型 (包N 或 包E)
        if (pref.includes('包N')) {
            s.packageType = 'N';
            return true;
        } else if (pref.includes('包E')) {
            s.packageType = 'E';
            return true;
        }
        return false;
    });
    
    console.log(`[Step 1] 鎖定包班名單 (${packageStaff.length}人): ${packageStaff.map(s=>s.name).join(', ')}`);
    
    packageStaff.forEach(staff => {
        const targetShift = staff.packageType; // N 或 E
        console.log(`  → ${staff.name} 包班類型: ${targetShift}`);
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            const currentStatus = this.getShiftByDate(dateStr, staff.id);
            
            // 2. 暴力填入：只要這天沒預休或請假，就填入包班班別
            if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') {
                this.updateShift(dateStr, staff.id, 'OFF', targetShift);
            }
        }
    });
    
    console.log(`[Step 1] 完成 ${packageStaff.length} 位包班人員的班表填滿`);
}
    // ==========================================
    // 輔助函式 (保留結構，此階段未用)
    // ==========================================
    getPotentialSupply(dateStr, shiftType, excludeStaffId) { return 0; }
    shuffleArray(array) { /* ... */ }
    compareForWork(a, b, shift) { return 0; }
    isInWhiteList(staff, shift) { return true; }
    getDemand(dateStr, shift) { return 2; } 
    getPreference(staff, dateStr, level) { return null; }
}
