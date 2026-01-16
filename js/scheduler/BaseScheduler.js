// js/scheduler/BaseScheduler.js
// 🔧 11小時修正版：修正間隔計算、移除預設班別

class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff; // [{id, name, ...}]
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        
        // 動態獲取班別清單，預設包含 OFF
        this.shiftCodes = this.rules.shiftCodes || [];
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

    // 🆕 建立班別時間對照表 (修正重點3: 移除預設班別)
    buildShiftTimeMap() {
        const map = {};
        
        // 必須從規則中讀取班別定義
        if (this.rules.shifts && Array.isArray(this.rules.shifts) && this.rules.shifts.length > 0) {
            this.rules.shifts.forEach(s => {
                map[s.code] = {
                    start: this.parseTime(s.startTime),
                    end: this.parseTime(s.endTime),
                    hours: s.hours || 8,
                    // 簡單判定：如果開始時間在 20:00 後或 04:00 前，視為夜班
                    isNight: this.parseTime(s.startTime) >= 20 || this.parseTime(s.startTime) <= 4
                };
            });
        } else {
            console.warn("⚠️ 警告：未設定任何班別資料，排班可能會失敗。請至「班別管理」設定。");
        }

        // 始終加入 OFF 定義
        map['OFF'] = { start: 0, end: 0, hours: 0, isNight: false };
        map['REQ_OFF'] = { start: 0, end: 0, hours: 0, isNight: false }; // 兼容處理
        
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
    
    getYesterdayShift(uid, dateStr) {
        const today = new Date(dateStr);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        if (yesterday.getMonth() + 1 !== this.month) {
            if (this.lastMonthData && this.lastMonthData[uid]) {
                return this.lastMonthData[uid].lastShift || 'OFF';
            }
            return 'OFF';
        }

        const yStr = this.getDateStrFromDate(yesterday);
        return this.getShiftByDate(yStr, uid) || 'OFF';
    }

    updateShift(dateStr, uid, oldShift, newShift) {
        if (oldShift === newShift) return;

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

        if (newShift && this.schedule[dateStr][newShift]) {
            this.schedule[dateStr][newShift].push(uid);
            if (this.counters[uid] && this.counters[uid][newShift] !== undefined) {
                this.counters[uid][newShift]++;
            }
        }
    }

    countStaff(day, shiftCode) {
        const dateStr = this.getDateStr(day);
        if (!this.schedule[dateStr] || !this.schedule[dateStr][shiftCode]) return 0;
        return this.schedule[dateStr][shiftCode].length;
    }

    getDemand(day, shiftCode) {
        const date = new Date(this.year, this.month - 1, day);
        const dayOfWeek = (date.getDay() + 6) % 7; 
        const key = `${shiftCode}_${dayOfWeek}`;
        return (this.rules.dailyNeeds && this.rules.dailyNeeds[key]) || 0;
    }

    // --- 🆕 驗證邏輯 (整合規則檢查) ---

    isValidAssignment(staff, dateStr, shiftCode, relaxRules = false) {
        if (shiftCode === 'OFF') return true;

        // 1️⃣ 檢查特殊身份保護
        if (this.rule_protectPregnant && !this.checkSpecialStatus(staff, shiftCode)) {
            return false;
        }

        // 2️⃣ 檢查間隔 (上一班 vs 這一班)
        const prevShift = this.getYesterdayShift(staff.id, dateStr);
        if (this.rule_minGap11 && !this.checkRestPeriod(prevShift, shiftCode)) {
            return false;
        }

        // 3️⃣ 檢查連上天數
        if (this.rule_limitConsecutive) {
            const consecDays = this.getConsecutiveWorkDays(staff.id, dateStr);
            if (consecDays >= this.rule_maxConsDays) {
                return false;
            }
        }

        // 4️⃣ 檢查個人偏好/包班
        const params = staff.schedulingParams || {};
        const prefs = staff.prefs || {};
        const bundleShift = staff.packageType || prefs.bundleShift;
        
        if (bundleShift && bundleShift !== shiftCode) {
            return false;
        }

        const shouldSkipSoftRules = this.rule_enableRelaxation && relaxRules;
        if (shouldSkipSoftRules) return true;

        // 5️⃣ 檢查 OFF 後不排夜班
        if (this.rule_noNightAfterOff && !bundleShift) {
            const isPrevReqOff = this.isPreRequestOff(staff.id, dateStr, -1);
            if (isPrevReqOff) {
                const isNightShift = this.isNightShift(shiftCode);
                if (isNightShift) {
                    return false;
                }
            }
        }

        // 6️⃣ 檢查班別多樣性
        if (this.rule_maxDiversity3 && !this.checkWeeklyDiversity(staff.id, dateStr, shiftCode)) {
            return false;
        }

        return true;
    }

    isNightShift(shiftCode) {
        const limitList = this.rules.policy?.noNightAfterOff_List || [];
        if (limitList.length > 0) {
            return limitList.includes(shiftCode);
        }
        
        const nightStart = this.rules.policy?.nightStart || '22:00';
        const nightEnd = this.rules.policy?.nightEnd || '06:00';
        
        const shiftTime = this.shiftTimes[shiftCode];
        if (!shiftTime) return false;
        
        const startVal = this.parseTime(nightStart);
        const endVal = this.parseTime(nightEnd);
        const shiftStart = shiftTime.start;
        
        if (startVal <= endVal) {
            return shiftStart >= startVal && shiftStart <= endVal;
        } else {
            return shiftStart >= startVal || shiftStart <= endVal;
        }
    }

    isPreRequestOff(uid, dateStr, offset = 0) {
        const targetDate = new Date(dateStr);
        targetDate.setDate(targetDate.getDate() + offset);
        const targetStr = this.getDateStrFromDate(targetDate);
        
        const staff = this.staffList.find(s => s.id === uid);
        if (!staff) return false;
        
        const params = staff.schedulingParams || {};
        return params[targetStr] === 'REQ_OFF';
    }

    checkSpecialStatus(staff, shiftCode) {
        const params = staff.schedulingParams || {};
        const today = new Date(this.year, this.month - 1, 1);
        
        // 判斷邏輯：如果該班別有跨越 22:00-06:00 區間，則禁止
        const isNightForbidden = (code) => {
            const time = this.shiftTimes[code];
            if (!time) return false;
            // 簡單判斷：開始時間在 22點後，或結束時間在 6點前(跨夜)
            return (time.start >= 22 || time.end <= 6 || (time.start < 6));
        };

        if (params.isPregnant && params.pregnantExpiry) {
            if (today <= new Date(params.pregnantExpiry)) {
                if (isNightForbidden(shiftCode)) return false;
            }
        }

        if (params.isBreastfeeding && params.breastfeedingExpiry) {
            if (today <= new Date(params.breastfeedingExpiry)) {
                if (isNightForbidden(shiftCode)) return false;
            }
        }

        return true;
    }

    /**
     * 🔧 修正重點 1 & 2：嚴格的 11 小時間隔檢查
     * 定義：前一班「下班時間」到下一班「上班時間」需 > 11 小時
     */
    checkRestPeriod(prevShift, currShift) {
        if (!prevShift || prevShift === 'OFF' || prevShift === 'REQ_OFF') return true;
        if (!currShift || currShift === 'OFF' || currShift === 'REQ_OFF') return true;
        
        const prev = this.shiftTimes[prevShift];
        const curr = this.shiftTimes[currShift];
        
        if (!prev || !curr) return true; // 若無定義則放行

        // 計算基準：以前一天 00:00 為 0
        // 前一天班別：
        // 如果 start < end (如 08:00-16:00)，下班時間是 16
        // 如果 start > end (如 16:00-00:00 或 23:00-07:00)，視為跨夜，下班時間是 end + 24
        let prevEndTime = prev.end;
        if (prev.end <= prev.start) {
            prevEndTime += 24; 
        }

        // 今天班別：
        // 因為是隔天，所以上班時間要 +24
        let currStartTime = curr.start + 24;

        // 計算間隔
        const gap = currStartTime - prevEndTime;

        // 除錯用 (可在 Console 查看)
        // console.log(`${prevShift}(${prevEndTime}) -> ${currShift}(${currStartTime}) Gap: ${gap}`);

        if (gap < 11) {
            return false;
        }

        return true;
    }

    getConsecutiveWorkDays(uid, dateStr) {
        const targetDate = new Date(dateStr);
        let count = 0;
        const checkLimit = (this.rule_maxConsDays || 6) + 7;
        
        for (let i = 1; i <= checkLimit; i++) {
            const checkDate = new Date(targetDate);
            checkDate.setDate(checkDate.getDate() - i);
            
            let shift = null;
            if (checkDate.getMonth() + 1 !== this.month) {
                const d = checkDate.getDate();
                if (this.lastMonthData && this.lastMonthData[uid]) {
                    shift = this.lastMonthData[uid][`last_${d}`];
                }
                if (!shift) break;
            } else {
                const checkStr = this.getDateStrFromDate(checkDate);
                shift = this.getShiftByDate(checkStr, uid);
            }
            
            if (shift === 'OFF' || shift === 'REQ_OFF' || !shift) break;
            count++;
        }
        return count;
    }

    checkWeeklyDiversity(uid, dateStr, newShift) {
        const targetDate = new Date(dateStr);
        const shifts = new Set();
        shifts.add(newShift);
        
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
        if (shifts.size > 3) return false;
        return true;
    }

    getDateStr(d) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    
    getDateStrFromDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    
    createWhitelist(staff, dateStr) {
        let list = [];
        if (staff.packageType) list.push(staff.packageType);
        if (staff.prefs && staff.prefs[dateStr]) {
            const p = staff.prefs[dateStr];
            if (p[1]) list.push(p[1]);
            if (p[2]) list.push(p[2]);
            if (p[3]) list.push(p[3]);
        }
        return list;
    }
}
