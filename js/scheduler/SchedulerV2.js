/**
 * SchedulerV2_Strict_Fixed.js
 * * 🔧 修正說明：
 * 1. 徹底解決 getDailyNeeds 呼叫錯誤，改用 getDailyNeedsData 安全獲取資料。
 * 2. 移除所有「...」省略，提供完整可運行的類別定義。
 * 3. 強化包班與偏好攔截，人力不足時寧可缺口也絕不亂排。
 */

window.SchedulerV2 = class SchedulerV2 extends (window.BaseScheduler || class {}) {
    constructor(allStaff, year, month, lastMonthData, rules) {
        // 呼叫父類別 BaseScheduler
        super(allStaff, year, month, lastMonthData, rules);
        
        // 初始化統計物件
        this.staffStats = {};
        // 取得平衡段數（來自規則或預設 4 段）
        this.segments = parseInt(rules?.aiParams?.balancingSegments) || 4; 
        
        this.initV2();
    }

    /**
     * 初始化 V2 專用的員工統計資料
     */
    initV2() {
        console.log('🔍 SchedulerV2_Strict 初始化中，總人數:', this.staffList.length);
        
        this.staffList.forEach(s => {
            // 從各種可能的欄位獲取包班資訊
            const bundleShift = s.packageType || s.prefs?.bundleShift || s.preferences?.bundleShift || s.bundleShift;
            
            // 獲取所有偏好班別 (favShift 1~3)
            const favs = [
                s.prefs?.favShift1, 
                s.prefs?.favShift2, 
                s.prefs?.favShift3,
                s.preferences?.favShift1,
                s.preferences?.favShift2,
                s.preferences?.favShift3
            ].filter(code => code && code !== 'OFF' && code !== 'NONE' && code !== '-');

            this.staffStats[s.id] = {
                workPressure: 0,
                isBundle: !!bundleShift,
                targetShift: (bundleShift === 'NONE' || !bundleShift) ? null : bundleShift,
                favShifts: favs,
                offDaysCount: 0
            };
        });
        console.log('✅ SchedulerV2_Strict 初始化完成 (包班與偏好已設定為硬規則)');
    }

    /**
     * [核心] 判斷人員對特定班別的可用性 (攔截器)
     */
    isPersonAvailableForShift(staff, date, shiftCode) {
        const stats = this.staffStats[staff.id];
        if (!stats) return false;

        // --- 硬規則 1：包班攔截 ---
        // 如果是包班人員，且當前排的班不是他的目標班別，直接剔除
        if (stats.isBundle && stats.targetShift && stats.targetShift !== shiftCode) {
            return false;
        }

        // --- 硬規則 2：排班偏好攔截 ---
        // 如果該員工有設定任何偏好，且目前嘗試排的班別不在他的偏好名單內，直接剔除
        if (stats.favShifts.length > 0) {
            if (!stats.favShifts.includes(shiftCode)) {
                return false;
            }
        }

        // --- 呼叫父類別的基礎檢查 ---
        // 這包含：連上班上限、班別間隔限制 (如 N 不接 D)、已預排 OFF (REQ_OFF/FF) 等
        if (typeof super.isPersonAvailableForShift === 'function') {
            return super.isPersonAvailableForShift(staff, date, shiftCode);
        }

        return true; 
    }

    /**
     * 嘗試填滿特定日期的特定班別
     */
    tryFillShift(day, shiftCode, needCount) {
        const ds = this.getDateStr(day);
        if (!this.schedule[ds]) this.schedule[ds] = {};

        // 1. 篩選出符合硬規則的候選人
        let candidates = this.staffList.filter(s => {
            // 如果這天已經被排了班 (例如預先套用的 REQ_OFF, FF)，則不再排班
            const currentShift = this.schedule[ds][s.id];
            if (currentShift && currentShift !== 'OFF') return false;
            
            return this.isPersonAvailableForShift(s, ds, shiftCode);
        });

        // 2. 人力缺口紀錄
        if (candidates.length < needCount) {
            console.warn(`⚠️ [人力缺口] ${ds} ${shiftCode} 班：需求 ${needCount} 人，但符合偏好者僅 ${candidates.length} 人。`);
        }

        // 3. 排序優選者：優先考慮目前休假 (OFF) 太大的人
        candidates.sort((a, b) => {
            const statsA = this.staffStats[a.id];
            const statsB = this.staffStats[b.id];

            // 策略：OFF 天數多的人，代表目前排班太少，應優先排班
            if (statsA.offDaysCount !== statsB.offDaysCount) {
                return statsB.offDaysCount - statsA.offDaysCount;
            }
            
            // 次要參考：壓力值
            return statsA.workPressure - statsB.workPressure;
        });

        // 4. 正式填入班表
        const selectedStaff = candidates.slice(0, needCount);
        selectedStaff.forEach(s => {
            this.updateShift(ds, s.id, shiftCode);
            // 增加壓力值，避免同一個人連續被選中（除非 OFF 天數落後太多）
            this.staffStats[s.id].workPressure += 10;
        });
    }

    /**
     * 安全獲取每日人力需求
     */
    getDailyNeedsData(day) {
        // 優先嘗試從父類別獲取 getDailyNeeds
        if (typeof super.getDailyNeeds === 'function') {
            return super.getDailyNeeds(day);
        }
        
        // 若父類別無法直接呼叫，則手動實作基礎邏輯 (從 rules.dailyNeeds 讀取)
        const dateObj = new Date(this.year, this.month - 1, day);
        const jsDay = dateObj.getDay(); 
        const dayIdx = (jsDay === 0) ? 6 : jsDay - 1; // 轉為 0(一) ~ 6(日)
        
        const needs = { D: 0, E: 0, N: 0 };
        const codes = ['D', 'E', 'N'];
        
        codes.forEach(c => {
            const key = `${c}_${dayIdx}`;
            if (this.rules && this.rules.dailyNeeds && this.rules.dailyNeeds[key] !== undefined) {
                needs[c] = parseInt(this.rules.dailyNeeds[key]) || 0;
            } else {
                needs[c] = 2; // 預設保底 2 人
            }
        });
        
        return needs;
    }

    /**
     * 執行主迴圈
     */
    run() {
        console.log(`🚀 開始執行嚴格版 AI 排班 (${this.year}/${this.month})`);
        
        // 階段 0: 套用預定班表 (由 BaseScheduler 提供)
        if (typeof this.applyPreSchedules === 'function') {
            this.applyPreSchedules();
        }

        // 階段 1: 逐日掃描排班
        for (let d = 1; d <= this.daysInMonth; d++) {
            const ds = this.getDateStr(d);
            const needs = this.getDailyNeedsData(d);
            
            // 排序：通常大夜與小夜比較難排，先排夜班
            const shiftTypes = ['N', 'E', 'D'];
            
            shiftTypes.forEach(shiftCode => {
                const count = needs[shiftCode] || 0;
                if (count > 0) {
                    this.tryFillShift(d, shiftCode, count);
                }
            });

            // 當天排班結束，更新所有人的 OFF 計數
            this.staffList.forEach(s => {
                const current = this.schedule[ds][s.id];
                // 如果當天沒排班，或排的是 OFF 類別，則增加 OFF 計數
                if (!current || current === 'OFF' || current === 'REQ_OFF' || current === 'FF') {
                    this.staffStats[s.id].offDaysCount++;
                    // 若當天完全空白，則補上 'OFF' 字串以供顯示
                    if (!this.schedule[ds][s.id]) {
                        this.schedule[ds][s.id] = 'OFF';
                    }
                }
            });
        }

        console.log('🏁 嚴格版 AI 排班流程結束，請檢查控制台是否有缺口警告。');
        return this.schedule;
    }
};
