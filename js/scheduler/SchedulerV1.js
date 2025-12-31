/**
 * 策略 V1: 全域分層法 (Step 1: 嚴格包班填滿)
 * * 修正：改用 packageType 判斷，確保正確抓取包班人員。
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
        // [修正] 使用 packageType (由 Editor Manager 解析後傳入)
        // packageType 會是 'N' 或 'E'，如果是一般人則為 null
        const packageStaff = this.staffList.filter(s => s.packageType && ['N', 'E'].includes(s.packageType));
        
        console.log(`[Step 1] 鎖定包班名單 (${packageStaff.length}人): ${packageStaff.map(s=>s.name).join(', ')}`);
        
        packageStaff.forEach(staff => {
            const targetShift = staff.packageType; // N 或 E
            // console.log(`  → ${staff.name} 包班類型: ${targetShift}`);
            
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);
                
                // 暴力填入：只要這天沒預休，就填入包班班別
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') {
                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                }
            }
        });
    }

    // 輔助函式
    getPotentialSupply(dateStr, shiftType, excludeStaffId) { return 0; }
    shuffleArray(array) { /* ... */ }
    compareForWork(a, b, shift) { return 0; }
    isInWhiteList(staff, shift) { return true; }
    getDemand(dateStr, shift) { return 2; } 
    getPreference(staff, dateStr, level) { return null; }
}
