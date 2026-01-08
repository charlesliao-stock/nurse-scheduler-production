// js/scheduler/BaseScheduler.js
// 🔧 完整修正版：整合所有規則檢查

class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff; // [{id, name, ...}]
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        
        // 動態獲取班別清單，預設包含 OFF
        this.shiftCodes = this.rules.shiftCodes || ['N', 'E', 'D'];
        if (!this.shiftCodes.includes('OFF')) this.shiftCodes.push('OFF');

        // 排班結果 { "YYYY-MM-DD": { [shiftCode]: [] } }
        this.schedule = {}; 
        // 統計計數器 { uid: { [shiftCode]: 0 } }
        this.counters = {}; 
        
        // 🆕 建立班別時間對照表 (用於計算間隔)
        this.shiftTimes = this.buildShiftTimeMap();
        
        // 🆕 解析規則參數
        this.parseRules();
        
        this.init();
    }

    // 🆕 解析規則參數
    parseRules() {
        const r = this.rules;
        
        // 硬性規則
        this.rule_minGap11 = r.hard?.minGap11 !== false; // 預設開啟
        this.rule_maxDiversity3 = r.hard?.maxDiversity3 !== false;
        this.rule_protectPregnant = r.hard?.protectPregnant !== false;
        this.rule_twoOffPerFortnight = r.hard?.twoOffPerFortnight !== false;
        this.rule_offGapMax = r.hard?.offGapMax || 12;
        this.rule_weekStartDay = parseInt(r.hard?.weekStartDay) || 1;
        
        // 政策規則
        this.rule_limitConsecutive = r.policy?.limitConsecutive !== false;
        this.rule_maxConsDays = r.policy?.maxConsDays || 6;
        this.rule_bundleNightOnly = r.policy?.bundleNightOnly !== false;
        this.rule_noNightAfterOff = r.policy?.noNightAfterOff !== false;
        this.rule_enableRelaxation = r.policy?.enableRelaxation === true; // 預設關閉
        
        // 輪替邏輯
        this.rule_dayStartShift = r.pattern?.dayStartShift || 'D';
        this.rule_rotationOrder = (r.pattern?.rotationOrder || 'OFF,N,E,D').split(',').map(s => s.trim());
        this.rule_consecutivePref = r.pattern?.consecutivePref !== false;
        this.rule_minConsecutive = r.pattern?.minConsecutive || 2;
        this.rule_avoidLonelyOff = r.pattern?.avoidLonelyOff !== false;
        
        // 公平性
        this.rule_fairOff = r.fairness?.fairOff !== false;
        this.rule_fairOffVar = r.fairness?.fairOffVar || 2;
        this.rule_fairNight = r.fairness?.fairNight !== false;
        this.rule_fairNightVar = r.fairness?.fairNightVar || 2;
        
        console.log("📋 規則解析完成:", {
            間隔保護: this.rule_minGap11,
            連上限制: this.rule_limitConsecutive ? `${this.rule_maxConsDays}天` : '關閉',
            輪替順序: this.rule_rotationOrder
        });
    }

    // 🆕 建立班別時間對照表
    buildShiftTimeMap() {
        const map = {};
        // 從規則中讀取班別定義 (如果有的話)
        if (this.rules.shifts && Array.isArray(this.rules.shifts)) {
            this.rules.shifts.forEach(s => {
                map[s.code] = {
                    start: this.parseTime(s.startTime),
                    end: this.parseTime(s.endTime),
                    hours: s.hours || 8
                };
            });
        } else {
            // 預設時間表
            map['D'] = { start: 8, end: 16, hours: 8 };   // 白班 08:00-16:00
            map['E'] = { start: 16, end: 24, hours: 8 };  // 小夜 16:00-00:00
            map['N'] = { start: 0, end: 8, hours: 8 };    // 大夜 00:00-08:00
            map['OFF'] = { start: 0, end: 0, hours: 0 };
        }
        return map;
    }

    parseTime(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h + (m || 0) / 60;
    }

    init() {
        // 1. 初始化計數器 (動態班別)
        this.staffList.forEach(s => {
            this.counters[s.id] = {};
            this.shiftCodes.forEach(code => {
                this.counters[s.id][code] = 0;
            });
        });

        // 2. 初始化每天的班表結構 (動態班別)
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = {};
            this.shiftCodes.forEach(code => {
                this.schedule[dateStr][code] = [];
            });
        }
        
        // 3. 預設將所有人先放入 OFF
        this.staffList.forEach(staff => {
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                if (this.schedule[dateStr].OFF) {
                    this.schedule[dateStr].OFF.push(staff.id);
                    this.counters[staff.id].OFF++;
                }
            }
        });
    }

    // --- 核心操作 ---

    // 取得某人某天的班別代號
    getShiftByDate(dateStr, uid) {
        if (!this.schedule[dateStr]) return null;
        const shiftCodes = Object.keys(this.schedule[dateStr]);
        for (const shiftCode of shiftCodes) {
            if (this.schedule[dateStr][shiftCode] && this.schedule[dateStr][shiftCode].includes(uid)) {
                return shiftCode;
            }
        }
        return null;
    }
    
    // 取得昨天的班別 (處理跨月)
    getYesterdayShift(uid, dateStr) {
        const today = new Date(dateStr);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        // 如果跨到上個月
        if (yesterday.getMonth() + 1 !== this.month) {
            if (this.lastMonthData && this.lastMonthData[uid]) {
                return this.lastMonthData[uid].lastShift || 'OFF';
            }
            return 'OFF';
        }

        // 本月
        const yStr = this.getDateStrFromDate(yesterday);
        return this.getShiftByDate(yStr, uid) || 'OFF';
    }

    // 更新班別 (核心：會同步更新計數器)
    updateShift(dateStr, uid, oldShift, newShift) {
        if (oldShift === newShift) return;

        // 1. 從舊班別移除
        if (oldShift && this.schedule[dateStr][oldShift]) {
            const arr = this.schedule[dateStr][oldShift];
            const idx = arr.indexOf(uid);
            if (idx > -1) {
                arr.splice(idx, 1);
                if (this.counters[uid] && this.counters[uid][oldShift] !== undefined) {
                    this.counters[uid][oldShift]--;
                }
            }
        }

        // 2. 加入新班別
        if (newShift && this.schedule[dateStr][newShift]) {
            this.schedule[dateStr][newShift].push(uid);
            if (this.counters[uid] && this.counters[uid][newShift] !== undefined) {
                this.counters[uid][newShift]++;
            }
        }
    }

    // --- 查詢輔助 ---

    // 計算某天某班別目前排了幾人
    countStaff(day, shiftCode) {
        const dateStr = this.getDateStr(day);
        if (!this.schedule[dateStr] || !this.schedule[dateStr][shiftCode]) return 0;
        return this.schedule[dateStr][shiftCode].length;
    }

    // 取得某天某班別的需求人數
    getDemand(day, shiftCode) {
        const date = new Date(this.year, this.month - 1, day);
        const dayOfWeek = (date.getDay() + 6) % 7; // Mon=0 ... Sun=6
        const key = `${shiftCode}_${dayOfWeek}`;
        return (this.rules.dailyNeeds && this.rules.dailyNeeds[key]) || 0;
    }

    // --- 🆕 驗證邏輯 (整合規則檢查) ---

    // 檢查基本合法性
    isValidAssignment(staff, dateStr, shiftCode, relaxRules = false) {
        if (shiftCode === 'OFF') return true;

        // 1️⃣ 檢查特殊身份保護 (強制規則，不可放寬)
        if (this.rule_protectPregnant && !this.checkSpecialStatus(staff, shiftCode)) {
            return false;
        }

        // 2️⃣ 檢查間隔 (上一班 vs 這一班) (強制規則，不可放寬)
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (this.rule_minGap11 && !this.checkRestPeriod(prevShift, shiftCode)) {
            return false;
        }

        // 3️⃣ 檢查連上天數 (提升為絕對規則，即使 relaxRules 為 true 也不可違反)
        if (this.rule_limitConsecutive) {
            const consecDays = this.getConsecutiveWorkDays(staff.id, dateStr);
            if (consecDays >= this.rule_maxConsDays) {
                // console.log(`🚫 連班限制: ${staff.name} 已連上 ${consecDays} 天`);
                return false;
            }
        }

        // 如果是放寬模式，以下「非強制」規則將被跳過
        if (relaxRules) return true;

        // 4️⃣ 檢查 OFF 後不排夜班
        if (this.rule_noNightAfterOff && prevShift === 'OFF') {
            if (shiftCode.includes('N') || shiftCode.includes('E')) {
                return false;
            }
        }

        // 5️⃣ 檢查班別多樣性 (一週內不得有3種班別)
        if (this.rule_maxDiversity3 && !this.checkWeeklyDiversity(staff.id, dateStr, shiftCode)) {
            return false;
        }

        return true;
    }

    // 🆕 檢查特殊身份 (孕婦/哺乳)
    checkSpecialStatus(staff, shiftCode) {
        const params = staff.schedulingParams || {};
        const today = new Date(this.year, this.month - 1, 1);
        
        // 懷孕保護：不排夜班
        if (params.isPregnant) {
            if (params.pregnantExpiry) {
                const expiry = new Date(params.pregnantExpiry);
                if (today <= expiry) {
                    // 禁止 22:00-06:00 班別
                    const shiftTime = this.shiftTimes[shiftCode];
                    if (shiftTime && (shiftTime.start >= 22 || shiftTime.end <= 6)) {
                        console.log(`⚠️ 孕婦保護: ${staff.name} 不可排 ${shiftCode}`);
                        return false;
                    }
                }
            }
        }

        // 哺乳保護：同上
        if (params.isBreastfeeding) {
            if (params.breastfeedingExpiry) {
                const expiry = new Date(params.breastfeedingExpiry);
                if (today <= expiry) {
                    const shiftTime = this.shiftTimes[shiftCode];
                    if (shiftTime && (shiftTime.start >= 22 || shiftTime.end <= 6)) {
                        console.log(`⚠️ 哺乳保護: ${staff.name} 不可排 ${shiftCode}`);
                        return false;
                    }
                }
            }
        }

        return true;
    }

    // 🆕 檢查間隔規則 (11小時休息)
    checkRestPeriod(prevShift, currShift) {
        if (!prevShift || prevShift === 'OFF') return true;
        
        const prev = this.shiftTimes[prevShift];
        const curr = this.shiftTimes[currShift];
        
        if (!prev || !curr) return true; // 找不到定義時放行

        // 計算間隔時數
        let gap;
        if (prev.end <= curr.start) {
            gap = curr.start - prev.end;
        } else {
            // 跨日情況 (例如 N 接 D)
            gap = (24 - prev.end) + curr.start;
        }

        if (gap < 11) {
            console.log(`⚠️ 間隔不足: ${prevShift}(${prev.end}h) → ${currShift}(${curr.start}h) = ${gap}h < 11h`);
            return false;
        }

        return true;
    }

    // 🆕 計算連續上班天數 (支援跨月)
    getConsecutiveWorkDays(uid, dateStr) {
        const targetDate = new Date(dateStr);
        let count = 0;
        
        // 往前檢查最多 14 天 (通常連上班上限不會超過此數)
        for (let i = 1; i <= 14; i++) {
            const checkDate = new Date(targetDate);
            checkDate.setDate(checkDate.getDate() - i);
            
            let shift = null;
            
            // 判斷是否跨到上個月
            if (checkDate.getMonth() + 1 !== this.month) {
                const d = checkDate.getDate();
                // 從 lastMonthData 讀取，格式預期為 { uid: { last_25: 'D', last_26: 'OFF', ... } }
                if (this.lastMonthData && this.lastMonthData[uid]) {
                    shift = this.lastMonthData[uid][`last_${d}`];
                }
                
                // 關鍵修正：如果讀取不到上月資料，應視為 OFF 中斷計數，避免無限連班
                if (!shift || shift === 'OFF' || shift === 'REQ_OFF') break;
            } else {
                // 本月資料
                const checkStr = this.getDateStrFromDate(checkDate);
                shift = this.getShiftByDate(checkStr, uid);
            }
            
            // 如果是休假或沒排班，則中斷連續計數
            if (shift === 'OFF' || shift === 'REQ_OFF' || !shift) break;
            count++;
        }
        
        return count;
    }

    // 🆕 檢查一週內班別多樣性
    checkWeeklyDiversity(uid, dateStr, newShift) {
        const targetDate = new Date(dateStr);
        const shifts = new Set();
        shifts.add(newShift);
        
        // 往前看7天
        for (let i = 1; i <= 7; i++) {
            const checkDate = new Date(targetDate);
            checkDate.setDate(checkDate.getDate() - i);
            
            if (checkDate.getMonth() + 1 !== this.month) break;
            
            const checkStr = this.getDateStrFromDate(checkDate);
            const shift = this.getShiftByDate(checkStr, uid);
            
            if (shift && shift !== 'OFF' && shift !== 'REQ_OFF') {
                shifts.add(shift);
            }
        }
        
        if (shifts.size > 3) {
            console.log(`⚠️ 班別過於分散: ${uid} 一週內有 ${shifts.size} 種班別`);
            return false;
        }
        
        return true;
    }

    // --- 工具 ---
    getDateStr(d) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    
    getDateStrFromDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    
    // 用於建立 V1/V2 相容的白名單格式
    createWhitelist(staff, dateStr) {
        let list = [];
        // 1. 包班意願
        if (staff.packageType) list.push(staff.packageType);
        
        // 2. 每日偏好
        if (staff.prefs && staff.prefs[dateStr]) {
            const p = staff.prefs[dateStr];
            if (p[1]) list.push(p[1]);
            if (p[2]) list.push(p[2]);
            if (p[3]) list.push(p[3]);
        }
        return list;
    }
}
