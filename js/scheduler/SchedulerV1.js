/**
 * 策略 V1: 全域分層法 (Step 1: 暴力填滿版 + 自動重置)
 * 修正：
 * 1. 在 run() 的第一步加入 resetAllToOff()。
 * 2. 確保每次執行 Step 1 時，畫布都是乾淨的，只保留預休 (REQ_OFF)。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // --- Step 1: 初始化 (保留動態計算供參考，雖然此階段還沒用到) ---
        this.initDynamicPacing();
    }

    initDynamicPacing() {
        // (保留原本的計算邏輯，為了完整性)
        let totalDemand = 0;
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            ['N', 'E', 'D'].forEach(shift => { totalDemand += this.getDemand(dateStr, shift); });
        }
        const staffCount = this.staffList.length;
        const totalSupply = staffCount * this.daysInMonth;
        const totalOffs = totalSupply - totalDemand;
        this.avgMonthlyOffs = staffCount > 0 ? (totalOffs / staffCount) : 0;

        if (this.avgMonthlyOffs <= 0) {
            this.pacingLimit = 999; 
        } else {
            const workDays = this.daysInMonth - this.avgMonthlyOffs;
            this.pacingLimit = Math.ceil((workDays / this.avgMonthlyOffs)) + 1;
        }
        console.log(`[V1 Init] 平均月休: ${this.avgMonthlyOffs.toFixed(2)}, 節奏: ${this.pacingLimit}`);
    }

    run() {
        console.log("=== V1 Step 1: 重置並暴力填滿包班 VIP ===");

        // [新增] Step 0: 先把盤面清乾淨！
        // 這樣才能確保結果只有 Step 1 的內容
        this.resetAllToOff();

        // Step 1: 針對包班人員，填滿整月
        this.runStep1_FillPackageVIP();

        return this.schedule;
    }

    // ==========================================
    // Step 0: 重置全月班表 (只留 REQ_OFF)
    // ==========================================
    resetAllToOff() {
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);
                
                // 如果不是「預休 (REQ_OFF)」或「請假 (LEAVE)」，全部清成 OFF
                if (currentStatus !== 'REQ_OFF' && currentStatus !== 'LEAVE') {
                    // 使用 BaseScheduler 的 updateShift 方法設為 OFF
                    this.updateShift(dateStr, staff.id, 'OFF', 'OFF'); 
                }
            }
        });
        console.log("[Step 0] 已重置所有非預休班別為 OFF");
    }

    // ==========================================
    // Step 1: 包班 VIP 填好填滿
    // ==========================================
    runStep1_FillPackageVIP() {
        const packageStaff = this.staffList.filter(s => s.packageType && ['N', 'E'].includes(s.packageType));
        
        console.log(`[Step 1] 處理包班人員共 ${packageStaff.length} 位`);

        packageStaff.forEach(staff => {
            const targetShift = staff.packageType; 

            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const currentStatus = this.getShiftByDate(dateStr, staff.id);

                // 只有在空檔 (OFF) 時才填入
                if (currentStatus === 'OFF') {
                    // 暴力填入，僅檢查基本的生理連續性 (BaseScheduler 內建)
                    // 不檢查需求、不檢查節奏
                    if (this.isValidContinuity(staff, dateStr, targetShift)) {
                        this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                    }
                }
            }
        });
    }

    // (以下保留輔助函式 getPotentialSupply, shuffleArray, compareForWork, isInWhiteList, getDemand, getPreference 等，不需更動)
    // 為了節省篇幅，這裡省略重複的輔助函式代碼，請保留您原檔下方的 Helper Functions
    // 如果您需要我完整貼出，請告訴我。
    getPotentialSupply(dateStr, shiftType, excludeStaffId) { /* ... */ return 0; }
    shuffleArray(array) { /* ... */ }
    compareForWork(a, b, shift) { /* ... */ return 0; }
    isInWhiteList(staff, shift) { /* ... */ return true; }
    getDemand(dateStr, shift) { /* ... */ return 2; }
    getPreference(staff, dateStr, level) { /* ... */ return null; }
}
