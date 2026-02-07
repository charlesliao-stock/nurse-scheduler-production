// js/scheduler/BaseScheduler.js
// 🔧 完整修正版：使用完整日期時間計算休息間隔
// ✅ 修正重點：
// 1. 使用 JavaScript Date 物件精確計算休息時間
// 2. 特殊身分檢查使用正確日期
// 3. 未獨立人員不排班
// 4. 完整的 schedulingParams 傳遞

class BaseScheduler {
    constructor(allStaff, year, month, lastMonthData, rules) {
        this.staffList = allStaff;
        this.year = year;
        this.month = month;
        this.daysInMonth = new Date(year, month, 0).getDate();
        this.lastMonthData = lastMonthData || {};
        this.rules = rules || {};
        
        this.shiftCodes = this.rules.shiftCodes || [];
        if (!this.shiftCodes.includes('OFF')) this.shiftCodes.push('OFF');

        this.schedule = {}; 
        this.counters = {}; 
        this.shiftTimes = this.buildShiftTimeMap();
        this.parseRules();
        this.init();
    }

    parseRules() {
        const r = this.rules;
        
        // 硬性規則
        this.rule_minGapHours = parseFloat(r.hard?.minGapHours) || 11;
        this.rule_minGap11 = r.hard?.minGap11 !== false;
        this.rule_maxDiversity3 = r.hard?.maxDiversity3 !== false;
        this.rule_protectPregnant = r.hard?.protectPregnant !== false;
        this.rule_twoOffPerFortnight = r.hard?.twoOffPerFortnight !== false;
        this.rule_offGapMax = parseInt(r.hard?.offGapMax) || 12;
        this.rule_weekStartDay = parseInt(r.hard?.weekStartDay) || 1;

        // 政策與長假
        this.rule_enableRelaxation = r.policy?.enableRelaxation === true;
        this.rule_limitConsecutive = r.policy?.limitConsecutive !== false;
        this.rule_maxConsDays = r.policy?.maxConsDays || 6;
        this.rule_longVacationDays = r.policy?.longVacationDays || 7;
        this.rule_longVacationWorkLimit = r.policy?.longVacationWorkLimit || 7;
        this.rule_noNightAfterOff = r.policy?.noNightAfterOff !== false;
        this.rule_protectPGY = r.policy?.protectPGY !== false;
        this.rule_protectPGY_List = r.policy?.protectPGY_List || [];
        
        // 志願排班比例
        this.rule_enablePrefRatio = r.policy?.enablePrefRatio === true;
        this.rule_preferenceRatio = {
            p1: (r.policy?.prefRatio1 ?? 50) / 100,
            p2: (r.policy?.prefRatio2 ?? 30) / 100,
            p3: (r.policy?.prefRatio3 ?? 20) / 100
        };

        // 權重優先級
        const prioritizePref = r.policy?.prioritizePref || 'must';
        const prioritizePreReq = r.policy?.prioritizePreReq || 'must';
        const prioritizeAvoid = r.policy?.prioritizeAvoid || 'must';

        this.rule_strictPref = (prioritizePref === 'must');
        this.rule_strictPreReq = (prioritizePreReq === 'must');
        this.rule_strictAvoid = (prioritizeAvoid === 'must');
        
        console.log('📋 規則載入完成:', {
            minGapHours: this.rule_minGapHours,
            protectPregnant: this.rule_protectPregnant,
            protectPGY: this.rule_protectPGY,
            protectPGY_List: this.rule_protectPGY_List
        });
    }

    buildShiftTimeMap() {
        const map = {};
        if (this.rules.shifts && Array.isArray(this.rules.shifts)) {
            this.rules.shifts.forEach(s => {
                const [startH, startM] = (s.startTime || '00:00').split(':').map(Number);
                const [endH, endM] = (s.endTime || '00:00').split(':').map(Number);
                
                map[s.code] = {
                    startTime: s.startTime,
                    endTime: s.endTime,
                    startHour: startH,
                    startMinute: startM || 0,
                    endHour: endH,
                    endMinute: endM || 0,
                    hours: s.hours || 8,
                    isBundleAvailable: s.isBundleAvailable === true
                };
            });
        }
        map['OFF'] = { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0, hours: 0 };
        map['REQ_OFF'] = { startHour: 0, startMinute: 0, endHour: 0, endMinute: 0, hours: 0 };
        
        console.log('⏰ 班別時間設定:', map);
        return map;
    }

    init() {
        this.staffList.forEach(s => {
            this.counters[s.id] = {};
            this.shiftCodes.forEach(code => {
                this.counters[s.id][code] = 0;
            });
            if (!this.counters[s.id]['REQ_OFF']) this.counters[s.id]['REQ_OFF'] = 0;
        });
        
        for (let d = 1; d <= this.daysInMonth; d++) {
            const dateStr = this.getDateStr(d);
            this.schedule[dateStr] = {};
            this.shiftCodes.forEach(code => {
                this.schedule[dateStr][code] = [];
            });
        }
        
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

    applyPreSchedules() {
        console.log('📝 開始預填 REQ_OFF 和指定班別...');
        let reqOffCount = 0;
        let preAssignCount = 0;
        
        this.staffList.forEach(staff => {
            const params = staff.schedulingParams || {};
            for (let d = 1; d <= this.daysInMonth; d++) {
                const dateStr = this.getDateStr(d);
                const req = params[dateStr];
                
                if (req) {
                    if (req === 'REQ_OFF') {
                        this.updateShift(dateStr, staff.id, 'OFF', 'REQ_OFF');
                        reqOffCount++;
                    } else if (this.shiftCodes.includes(req)) {
                        this.updateShift(dateStr, staff.id, 'OFF', req);
                        preAssignCount++;
                    }
                }
            }
        });
        
        console.log(`✅ 預填完成: REQ_OFF=${reqOffCount}, 指定班別=${preAssignCount}`);
    }

    // ✅ 核心修正：嚴格的合法性檢查
    isValidAssignment(staff, dateStr, shiftCode) {
        // ✅ 1. 未獨立人員不應該被排班
        const params = staff.schedulingParams || {};
        if (params.independence === 'dependent') {
            console.log(`      ❌ ${staff.name} 未獨立，不可單獨排班`);
            return false;
        }
        
        // 2. OFF 的特殊檢查
        if (shiftCode === 'OFF') {
            return this.checkOffGap(staff, dateStr);
        }

        // 3. 不能覆蓋預假
        if (this.isPreRequestOff(staff.id, dateStr) && shiftCode !== 'REQ_OFF') {
            console.log(`      ❌ ${staff.name} 在 ${dateStr} 已有預假`);
            return false;
        }

        // ✅ 4. 特殊身分保護（使用正確日期）
        if (this.rule_protectPregnant && !this.checkSpecialStatusByDate(staff, shiftCode, dateStr)) {
            return false;
        }
        if (this.rule_protectPGY && !this.checkPGYStatusByDate(staff, shiftCode, dateStr)) {
            return false;
        }
        
        // ✅ 5. 雙向休息檢查（使用完整日期時間）
        const prevDate = this.getPreviousDate(dateStr);
        const prevShift = this.getShiftByDateStr(prevDate, staff.id);
        
        if (this.rule_minGap11 && !this.checkRestPeriodWithDate(prevDate, prevShift, dateStr, shiftCode, staff.name)) {
            return false;
        }

        const nextDate = this.getNextDate(dateStr);
        const nextShift = this.getShiftByDateStr(nextDate, staff.id);
        
        if (this.rule_minGap11 && nextShift && nextShift !== 'OFF' && nextShift !== 'REQ_OFF') {
            if (!this.checkRestPeriodWithDate(dateStr, shiftCode, nextDate, nextShift, staff.name)) {
                console.log(`      ❌ ${staff.name} 排 ${shiftCode} 會導致明天上 ${nextShift} 休息不足`);
                return false;
            }
        }
        
        // 6. 週班別多樣性
        if (this.rule_maxDiversity3 && !this.checkFixedWeekDiversity(staff.id, dateStr, shiftCode)) {
            return false;
        }

        // 7. 志願排班邏輯
        const prefs = staff.preferences || staff.prefs || {};
        const priorities = prefs.priorities || [prefs.favShift, prefs.favShift2, prefs.favShift3].filter(Boolean);
        
        if (priorities.length > 0) {
            const pIndex = priorities.indexOf(shiftCode);
            
            if (this.rule_strictPref && pIndex === -1 && shiftCode !== 'OFF' && shiftCode !== 'REQ_OFF') {
                console.log(`      ❌ ${staff.name} 志願不包含 ${shiftCode}`);
                return false;
            }

            if (pIndex !== -1 && this.rule_enablePrefRatio) {
                const ratioKey = `p${pIndex + 1}`;
                const allowedRatio = this.rule_preferenceRatio[ratioKey] || 0;
                
                const offCount = (this.counters[staff.id].OFF || 0) + (this.counters[staff.id].REQ_OFF || 0);
                const totalWorkDays = this.daysInMonth - offCount;
                const currentShiftCount = this.counters[staff.id][shiftCode] || 0;
                
                if (allowedRatio > 0 && totalWorkDays > 0) {
                    if ((currentShiftCount / totalWorkDays) > (allowedRatio + 0.1)) {
                        console.log(`      ❌ ${staff.name} 的 ${shiftCode} 比例已超標`);
                        return false; 
                    }
                }
            }
        }

        // 8. 避開特定班別
        if (params[dateStr] === '!' + shiftCode) {
            if (this.rule_strictAvoid) {
                console.log(`      ❌ ${staff.name} 設定避開 ${shiftCode}`);
                return false;
            }
        }
        
        // 9. 指定班別
        const reqShift = params[dateStr];
        if (reqShift && reqShift !== 'REQ_OFF' && !reqShift.startsWith('!')) {
            if (reqShift !== shiftCode && this.rule_strictPreReq) {
                console.log(`      ❌ ${staff.name} 指定要上 ${reqShift}，不是 ${shiftCode}`);
                return false;
            }
        }

        // 10. 連續上班天數限制
        if (this.rule_limitConsecutive) {
            const currentCons = this.getConsecutiveWorkDays(staff.id, dateStr);
            let limit = parseInt(this.rule_maxConsDays) || 6;
            if (this.isLongVacationMonth(staff)) limit = parseInt(this.rule_longVacationWorkLimit) || 7;
            
            if (currentCons >= limit) {
                console.log(`      ❌ ${staff.name} 已連續上班 ${currentCons} 天，達到限制 ${limit} 天`);
                return false;
            }
        }

        // 11. 休假後不排夜班
        if (this.rule_noNightAfterOff && priorities.length === 0) {
            const isPrevReqOff = this.isPreRequestOff(staff.id, dateStr, -1);
            if (isPrevReqOff && this.isNightShift(shiftCode)) {
                console.log(`      ❌ ${staff.name} 昨天預假，今天不可排夜班`);
                return false;
            }
        }

        return true;
    }

    // ✅ 核心新方法：使用完整日期時間計算休息間隔
    checkRestPeriodWithDate(prevDateStr, prevShiftCode, currDateStr, currShiftCode, staffName = '') {
        // 跳過 OFF
        if (!prevShiftCode || prevShiftCode === 'OFF' || prevShiftCode === 'REQ_OFF') return true;
        if (!currShiftCode || currShiftCode === 'OFF' || currShiftCode === 'REQ_OFF') return true;
        
        const prevShift = this.shiftTimes[prevShiftCode];
        const currShift = this.shiftTimes[currShiftCode];
        if (!prevShift || !currShift) return true;

        try {
            // 1. 建立前一班的下班時間
            const prevEndDateTime = new Date(prevDateStr);
            prevEndDateTime.setHours(prevShift.endHour, prevShift.endMinute, 0, 0);
            
            // 處理跨日班別（下班時間 < 上班時間，表示跨日）
            if (prevShift.endHour < prevShift.startHour || 
                (prevShift.endHour === prevShift.startHour && prevShift.endMinute < prevShift.startMinute)) {
                prevEndDateTime.setDate(prevEndDateTime.getDate() + 1);
            }
            
            // 2. 建立當前班的上班時間
            const currStartDateTime = new Date(currDateStr);
            currStartDateTime.setHours(currShift.startHour, currShift.startMinute, 0, 0);
            
            // 3. 計算時間差（毫秒 → 小時）
            const diffMs = currStartDateTime - prevEndDateTime;
            const gap = diffMs / (1000 * 60 * 60);
            
            // 4. 檢查是否符合最小休息時間
            const minGap = this.rule_minGapHours || 11;
            const isValid = gap >= minGap;
            
            // 5. 記錄日誌（如果違規）
            if (!isValid) {
                const prevEndStr = this.formatDateTime(prevEndDateTime);
                const currStartStr = this.formatDateTime(currStartDateTime);
                console.warn(
                    `      ❌ ${staffName} 休息不足: ` +
                    `${prevShiftCode}(下班${prevEndStr}) → ${currShiftCode}(上班${currStartStr}) ` +
                    `= ${gap.toFixed(1)}h < ${minGap}h`
                );
            }
            
            return isValid;
            
        } catch (e) {
            console.error('計算休息時間錯誤:', e);
            return true; // 發生錯誤時放行，避免卡住排班
        }
    }

    // ✅ 格式化 DateTime 顯示
    formatDateTime(dateTime) {
        const month = dateTime.getMonth() + 1;
        const day = dateTime.getDate();
        const hours = String(dateTime.getHours()).padStart(2, '0');
        const minutes = String(dateTime.getMinutes()).padStart(2, '0');
        return `${month}/${day} ${hours}:${minutes}`;
    }

    // ✅ 取得前一天的日期字串
    getPreviousDate(dateStr) {
        const date = new Date(dateStr);
        date.setDate(date.getDate() - 1);
        return this.getDateStrFromDate(date);
    }

    // ✅ 取得後一天的日期字串
    getNextDate(dateStr) {
        const date = new Date(dateStr);
        date.setDate(date.getDate() + 1);
        return this.getDateStrFromDate(date);
    }

    // ✅ 根據日期字串取得班別（可跨月）
    getShiftByDateStr(dateStr, uid) {
        const date = new Date(dateStr);
        const targetMonth = date.getMonth() + 1;
        
        // 如果是不同月份
        if (targetMonth !== this.month) {
            // 如果是上個月
            if (targetMonth < this.month || (this.month === 1 && targetMonth === 12)) {
                return this.lastMonthData?.[uid]?.lastShift || 'OFF';
            }
            // 如果是下個月（還沒排）
            return null;
        }
        
        // 同月份，從 schedule 取得
        return this.getShiftByDate(dateStr, uid);
    }

    // ✅ 使用正確日期檢查特殊身分
    checkSpecialStatusByDate(staff, shiftCode, dateStr) {
        const isNight = this.isNightShift(shiftCode);
        if (!isNight) return true;
        
        const params = staff.schedulingParams || {};
        const checkDate = new Date(dateStr);
        
        // 懷孕保護
        if (params.isPregnant && params.pregnantExpiry) {
            const expiryDate = new Date(params.pregnantExpiry);
            if (checkDate <= expiryDate) {
                console.log(`      ❌ ${staff.name} 懷孕中（至${params.pregnantExpiry}），不可排夜班 ${shiftCode}`);
                return false;
            }
        }
        
        // 哺乳保護
        if (params.isBreastfeeding && params.breastfeedingExpiry) {
            const expiryDate = new Date(params.breastfeedingExpiry);
            if (checkDate <= expiryDate) {
                console.log(`      ❌ ${staff.name} 哺乳中（至${params.breastfeedingExpiry}），不可排夜班 ${shiftCode}`);
                return false;
            }
        }
        
        return true;
    }

    checkPGYStatusByDate(staff, shiftCode, dateStr) {
        if (!this.rule_protectPGY_List.includes(shiftCode)) return true;
        
        const params = staff.schedulingParams || {};
        const checkDate = new Date(dateStr);
        
        if (params.isPGY && params.pgyExpiry) {
            const expiryDate = new Date(params.pgyExpiry);
            if (checkDate <= expiryDate) {
                console.log(`      ❌ ${staff.name} 為PGY（至${params.pgyExpiry}），不可排 ${shiftCode} 班`);
                return false;
            }
        }
        
        return true;
    }

    getConsecutiveWorkDays(uid, dateStr) {
        const targetDate = new Date(dateStr);
        let count = 0;
        for (let i = 1; i <= 14; i++) {
            const checkDate = new Date(targetDate);
            checkDate.setDate(checkDate.getDate() - i);
            const checkDateStr = this.getDateStrFromDate(checkDate);
            let shift = this.getShiftByDateStr(checkDateStr, uid);
            
            if (!shift || shift === 'OFF' || shift === 'REQ_OFF') break;
            count++;
        }
        return count;
    }

    getShiftByDate(dateStr, uid) {
        if (!this.schedule[dateStr]) return null;
        for (const code of Object.keys(this.schedule[dateStr])) {
            if (this.schedule[dateStr][code].includes(uid)) return code;
        }
        return null;
    }

    getDateStr(d) {
        return `${this.year}-${String(this.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    getDateStrFromDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    updateShift(dateStr, uid, oldShift, newShift) {
        if (oldShift === newShift) return;
        if (oldShift && this.schedule[dateStr][oldShift]) {
            const arr = this.schedule[dateStr][oldShift];
            const idx = arr.indexOf(uid);
            if (idx > -1) {
                arr.splice(idx, 1);
                if (this.counters[uid]) this.counters[uid][oldShift]--;
            }
        }
        if (newShift && this.schedule[dateStr][newShift]) {
            this.schedule[dateStr][newShift].push(uid);
            if (this.counters[uid]) this.counters[uid][newShift]++;
        }
    }

    isPreRequestOff(uid, dateStr, offset = 0) {
        const targetDate = new Date(dateStr);
        targetDate.setDate(targetDate.getDate() + offset);
        const targetStr = this.getDateStrFromDate(targetDate);
        const staff = this.staffList.find(s => s.id === uid);
        return staff?.schedulingParams?.[targetStr] === 'REQ_OFF';
    }

    isNightShift(shiftCode) {
        const shift = this.shiftTimes[shiftCode];
        if (!shift) return false;
        
        const startHour = shift.startHour;
        const endHour = shift.endHour;
        
        return (startHour >= 22 || startHour <= 2) || (endHour < startHour);
    }

    checkFixedWeekDiversity(uid, dateStr, newShift) {
        return true; 
    }

    checkOffGap(staff, dateStr) {
        return true;
    }

    isLongVacationMonth(staff) {
        return false;
    }
}
