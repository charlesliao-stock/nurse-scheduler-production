/**
 * 策略 V1: 全域分層法 (Step 1: 暴力填滿版)
 * 目前進度：
 * 1. 保留了動態參數初始化 (供後續計算參考)。
 * 2. 排班邏輯僅執行「包班填滿」，無視任何限制 (爆量、節奏)。
 */
class SchedulerV1 extends BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        super(allStaff, year, month, lastMonthData, rules);
        
        // --- Step 1: 初始化與參數準備 (保留您提供的動態計算) ---
        this.initDynamicPacing();
    }

    // [核心修正] 動態計算供需與節奏 (保留)
    initDynamicPacing() {
        // 1. 計算全月總需求 (Total Demand)
        let totalDemand = 0;
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            ['N', 'E', 'D'].forEach(shift => {
                totalDemand += this.getDemand(dateStr, shift);
            });
        }

        // 2. 計算總供給 (Total Supply)
        const staffCount = this.staffList.length;
        const totalSupply = staffCount * this.daysInMonth;

        // 3. 計算剩餘給 OFF 的額度
        const totalOffs = totalSupply - totalDemand;
        
        // 4. 計算平均每人月休 (Avg Offs)
        this.avgMonthlyOffs = staffCount > 0 ? (totalOffs / staffCount) : 0;

        // 5. 推估放假節奏 (Pacing Limit)
        if (this.avgMonthlyOffs <= 0) {
            this.pacingLimit = 999; 
            console.warn(`[V1 Init] 人力嚴重不足！需求 ${totalDemand} > 供給 ${totalSupply}，無法排休。`);
        } else {
            const workDays = this.daysInMonth - this.avgMonthlyOffs;
            const ratio = workDays / this.avgMonthlyOffs;
            this.pacingLimit = Math.ceil(ratio) + 1;
        }

        console.log(`=== V1 初始化參數 ===`);
        console.log(`- 總人力: ${staffCount} 人`);
        console.log(`- 總需求人次: ${totalDemand}`);
        console.log(`- 預估平均月休: ${this.avgMonthlyOffs.toFixed(2)} 天`);
        console.log(`- 動態節奏: 每連上 ${this.pacingLimit} 天建議休假 (此階段暫不啟用)`);
    }

    run() {
        console.log("=== V1 Step 1 執行: 包班暴力填滿 (無視爆量) ===");

        // 執行: 針對包班人員，填滿整月
        this.runStep1_FillPackageVIP();

        // 暫時不跑其他 Cycle，一步一步來
        return this.schedule;
    }

    // ==========================================
    // Step 1 核心: 包班 VIP 填好填滿
    // ==========================================
    runStep1_FillPackageVIP() {
        // 1. 篩選出有包班屬性 (N 或 E) 的人員
        const packageStaff = this.staffList.filter(s => s.packageType && ['N', 'E'].includes(s.packageType));
        
        console.log(`[Step 1] 處理包班人員共 ${packageStaff.length} 位`);

        packageStaff.forEach(staff => {
            const targetShift = staff.packageType; // 他包的班別 (N 或 E)

            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                
                // 檢查目前狀態
                // 只有當天是 'OFF' (空白) 時才動作
                // 若已是 'REQ_OFF' (預休) 則跳過
                const currentStatus = this.getShiftByDate(dateStr, staff.id);

                if (currentStatus === 'OFF') {
                    // 這裡只做最基本的生理連續性檢查 (確保符合 BaseScheduler 規則)
                    // 完全不檢查 getDemand (每日需求)，也不管 pacingLimit (節奏)
                    if (this.isValidContinuity(staff, dateStr, targetShift)) {
                        this.updateShift(dateStr, staff.id, 'OFF', targetShift);
                    }
                }
            }
        });
    }

    // ==========================================
    // 輔助函式 (保留原樣)
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
