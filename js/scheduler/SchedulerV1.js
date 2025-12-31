/**
 * 策略 V1: 全域分層法 (Step 1 獨立驗證版)
 * * * 執行邏輯：
 * 1. [Step 0] 重置：將所有非預休 (REQ_OFF) 的格子清空為 OFF。
 * 2. [Step 1] 包班填滿：針對有設定包班 (N/E) 的人員，無視任何規則，將所有空位填滿。
 * 3. [STOP]  暫停執行後續步驟，以利驗證 Step 1 結果。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
    }

    run() {
        console.log("=== V1 (Step 1 Only): 重置並暴力填滿包班 ===");

        // [Step 0] 先把盤面清乾淨 (只保留 REQ_OFF)
        // 確保非包班的人員不會殘留之前的班表
        this.resetAllToOff();

        // [Step 1] 針對包班人員，填滿整月
        this.runStep1_FillPackageVIP();

        // [STOP] 這裡直接回傳結果，不執行後續的一般人員填班
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
    // Step 1: 包班 VIP 填好填滿 (暴力模式)
    // ==========================================
    runStep1_FillPackageVIP() {
        // 1. 嚴格篩選包班人員
        // 必須是 packageType 為 'N' 或 'E' 的人
        const packageStaff = this.staffList.filter(s => s.packageType && ['N', 'E'].includes(s.packageType));
        
        console.log(`[Step 1] 鎖定包班人員: ${packageStaff.map(s=>s.name).join(', ')}`);

        packageStaff.forEach(staff => {
            const targetShift = staff.packageType; // N 或 E

            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);

                // 邏輯：只要不是預休，就填入包班班別
                // 這裡我們不檢查連續性、不檢查人數上限，純粹填滿
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') {
                    this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                }
            }
        });
    }

    // ==========================================
    // 輔助函式 (保留但此階段未用到)
    // ==========================================
    getPotentialSupply(dateStr, shiftType, excludeStaffId) { return 0; }
    shuffleArray(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } }
    compareForWork(a, b, shift) { return 0; }
    isInWhiteList(staff, shift) { return true; }
    getDemand(dateStr, shift) { return 2; } // 假資料，Step 1 不檢查
    getPreference(staff, dateStr, level) { return null; }
}
