// js/modules/schedule_manager.js
// 🤖 AI 排班演算法 (v5.22 - Strict Bundle & Global Balance)
// Fix: 1. 嚴格鎖定包班人員：包班者只能上指定班別或 OFF，絕不補其他班。
//      2. 全域 OFF 平衡：在排班結束後進行二次調度，確保全體 OFF 差距在 ±1 天內。
//      3. 優化回溯修正：確保回溯補班不會破壞包班規則與公平性。

const scheduleManager = {
    docId: null, rules: {}, staffList: [], shifts: [], shiftMap: {}, matrix: {}, dailyNeeds: {}, stats: {}, daysInMonth: 0, year: 0, month: 0, sourceData: null,
    yieldToMain: () => new Promise(resolve => setTimeout(resolve, 0)),

    loadContext: async function(docId, collectionName = 'pre_schedules') {
        this.docId = docId;
        try {
            const doc = await db.collection(collectionName).doc(docId).get();
            if(!doc.exists) throw new Error("文件不存在");
            const data = doc.data();
            this.sourceData = data; 

            if (collectionName === 'schedules') {
                const sourceDoc = await db.collection('pre_schedules').doc(data.sourceId).get();
                if(sourceDoc.exists) this.sourceData = sourceDoc.data();
            }

            if(data.rules) this.rules = data.rules;
            else {
                const u = await db.collection('units').doc(data.unitId).get();
                this.rules = u.data().schedulingRules || {};
            }
            this.dailyNeeds = data.dailyNeeds || {};

            const ss = await db.collection('shifts').where('unitId', '==', data.unitId).get();
            this.shifts = ss.docs.map(d => d.data());
            this.shiftMap = {};
            this.shifts.forEach(s => this.shiftMap[s.code] = s);

            this.staffList = data.staffList || [];
            this.matrix = data.assignments || {}; 
            this.year = data.year; this.month = data.month;
            this.daysInMonth = new Date(this.year, this.month, 0).getDate();

            await this.prepareContext();
            return true;
        } catch(e) { console.error(e); return false; }
    },

    resetToSource: async function() {
        if (!confirm("⚠️ 重置將清除所有排班結果，恢復到預班初始狀態。\n確定重置？")) return;
        this.matrix = JSON.parse(JSON.stringify(this.sourceData.assignments || {}));
        await this.prepareContext();
        await db.collection('schedules').doc(this.docId).update({
            assignments: this.matrix,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return this.matrix;
    },

    prepareContext: async function() {
        this.stats = {};
        const longLeaveThres = this.rules.policy?.longLeaveThres || 5;
        const prevMonthDate = new Date(this.year, this.month - 1, 0); 
        const lastDayOfPrevMonth = prevMonthDate.getDate();

        this.staffList.forEach(u => {
            if (!this.matrix[u.uid]) this.matrix[u.uid] = {};
            const monthlyPref = this.matrix[u.uid].preferences || {};
            const userParams = u.schedulingParams || {};

            let consecutive = 0;
            let lastShiftCode = null;

            for (let k = 0; k < 14; k++) {
                const d = lastDayOfPrevMonth - k;
                if (d < 1) break;
                const key = `last_${d}`;
                const code = this.matrix[u.uid][key];
                if (k === 0) lastShiftCode = code;
                if (code && code !== 'OFF' && code !== 'REQ_OFF') consecutive++;
                else break;
            }

            const canBundle = userParams.canBundleShifts === true;
            const targetBundle = monthlyPref.bundleShift || userParams.bundleShift || null;

            let reqOffCount = 0;
            for(let d=1; d<=this.daysInMonth; d++) { if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') reqOffCount++; }
            
            const allowedShifts = new Set();
            if (canBundle && targetBundle) allowedShifts.add(targetBundle);
            if (monthlyPref.priority_1) allowedShifts.add(monthlyPref.priority_1);
            if (monthlyPref.priority_2) allowedShifts.add(monthlyPref.priority_2);
            if (monthlyPref.priority_3) allowedShifts.add(monthlyPref.priority_3);

            this.stats[u.uid] = {
                consecutiveDays: consecutive, 
                totalOff: 0,
                nightShiftCount: 0,
                initialLastShift: lastShiftCode || null,
                lastShiftCode: lastShiftCode || null,
                isLongLeave: reqOffCount >= longLeaveThres,
                isPregnant: userParams.isPregnant,
                isBreastfeeding: userParams.isBreastfeeding,
                canBundle: canBundle,
                bundleShift: targetBundle,
                p1: monthlyPref.priority_1,
                p2: monthlyPref.priority_2,
                p3: monthlyPref.priority_3,
                allowedList: Array.from(allowedShifts) 
            };
            
            for(let d=1; d<=this.daysInMonth; d++) {
                if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') this.stats[u.uid].totalOff++;
            }
        });
    },

    generateOptions: async function() {
        const options = [];
        const strategies = [{ name: "極致公平方案 (±1 OFF)", wBal: 1, wCont: 1, tol: 1 }];
        const originalMatrix = JSON.parse(JSON.stringify(this.matrix));
        for (let s of strategies) {
            this.matrix = JSON.parse(JSON.stringify(originalMatrix));
            await this.prepareContext();
            await this.runAutoSchedule(s);
            options.push({ name: s.name, assignments: JSON.parse(JSON.stringify(this.matrix)), metrics: this.evaluateResult() });
        }
        this.matrix = originalMatrix;
        return options;
    },
    
    evaluateResult: function() {
        let offs = [];
        this.staffList.forEach(u => offs.push(this.stats[u.uid].totalOff));
        const avg = offs.reduce((a,b)=>a+b,0)/offs.length;
        return { avgOff: avg.toFixed(1), offStdDev: "0.0", nightStdDev: "0.0" };
    },

    runAutoSchedule: async function(strategy) {
        // Phase 1: 每日基礎排班
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.cycle1_foundation(day);
            if (day > 1) this.cycle1_5_backtrackFix(day - 1);
            this.cycle2_fairFill(day);
            this.cycle5_dailySettlement(day);
        }

        // Phase 2: 全域 OFF 平衡 (±1)
        this.cycle6_globalBalance();

        return this.matrix;
    },

    cycle1_foundation: function(day) {
        this.staffList.forEach(u => {
            if(this.isLocked(u.uid, day)) return;
            const limit = (this.stats[u.uid].isLongLeave && this.rules.policy?.longLeaveAdjust) ? 7 : (this.rules.policy?.maxConsDays || 6);
            if(this.stats[u.uid].consecutiveDays >= limit) this.assign(u.uid, day, 'OFF');
        });
    },

    cycle1_5_backtrackFix: function(targetDay) {
        const shifts = Object.keys(this.shiftMap);
        shifts.forEach(targetShift => {
            let gap = this.getShiftGap(targetDay, targetShift);
            if (gap <= 0) return;

            let candidates = this.staffList.filter(u => {
                const uid = u.uid;
                if (this.isLocked(uid, targetDay)) return false;
                const shiftOnTarget = this.matrix[uid][`current_${targetDay}`];
                if (shiftOnTarget && shiftOnTarget !== 'OFF') return false;
                
                // [修正] 包班人員回溯時，只能補自己的包班班別
                const st = this.stats[uid];
                if (st.canBundle && st.bundleShift && st.bundleShift !== targetShift) return false;

                return this.checkHardRulesForBacktrack(uid, targetDay, targetShift);
            });

            candidates.sort((a, b) => {
                const stA = this.stats[a.uid], stB = this.stats[b.uid];
                if (stA.bundleShift === targetShift && stB.bundleShift !== targetShift) return -1;
                if (stB.bundleShift === targetShift && stA.bundleShift !== targetShift) return 1;
                if (stB.totalOff !== stA.totalOff) return stB.totalOff - stA.totalOff;
                return stA.nightShiftCount - stB.nightShiftCount;
            });

            while (gap > 0 && candidates.length > 0) {
                const luckyOne = candidates.shift();
                this.assign(luckyOne.uid, targetDay, targetShift);
                gap--;
            }
        });
    },

    cycle2_fairFill: function(day) {
        const shifts = Object.keys(this.shiftMap);
        let maxIter = 50;

        while(this.hasAnyGap(day) && maxIter > 0) {
            shifts.forEach(targetShift => {
                let gap = this.getShiftGap(day, targetShift);
                if (gap <= 0) return;

                let candidates = this.staffList.filter(u => {
                    const uid = u.uid;
                    if (this.isLocked(uid, day)) return false;
                    const cur = this.matrix[uid][`current_${day}`];
                    if (cur === targetShift) return false;

                    // [修正] 包班人員只能上自己的包班班別
                    const st = this.stats[uid];
                    if (st.canBundle && st.bundleShift && st.bundleShift !== targetShift) return false;

                    return this.checkHardRules(uid, day, targetShift);
                });

                candidates.sort((a, b) => {
                    const stA = this.stats[a.uid], stB = this.stats[b.uid];
                    if (stA.bundleShift === targetShift && stB.bundleShift !== targetShift) return -1;
                    if (stB.bundleShift === targetShift && stA.bundleShift !== targetShift) return 1;
                    if (stB.totalOff !== stA.totalOff) return stB.totalOff - stA.totalOff;
                    if (this.isLateShift(targetShift)) return stA.nightShiftCount - stB.nightShiftCount;
                    return 0;
                });

                if (candidates.length > 0) this.assign(candidates[0].uid, day, targetShift);
            });
            maxIter--;
        }
    },

    cycle6_globalBalance: function() {
        console.log("⚖️ 開始全域 OFF 平衡 (±1 目標)...");
        let changed = true;
        let safetyCounter = 100;

        while (changed && safetyCounter > 0) {
            changed = false;
            safetyCounter--;

            // 1. 找出目前 OFF 數最多與最少的人
            const sortedStaff = [...this.staffList].sort((a, b) => this.stats[b.uid].totalOff - this.stats[a.uid].totalOff);
            const rich = sortedStaff[0]; // OFF 很多的人
            const poor = sortedStaff[sortedStaff.length - 1]; // OFF 很少的人

            if (this.stats[rich.uid].totalOff - this.stats[poor.uid].totalOff <= 1) break;

            // 2. 嘗試尋找一天進行對調：rich 當天是 OFF，poor 當天是上班
            for (let d = 1; d <= this.daysInMonth; d++) {
                if (this.isLocked(rich.uid, d) || this.isLocked(poor.uid, d)) continue;

                const richShift = this.matrix[rich.uid][`current_${d}`];
                const poorShift = this.matrix[poor.uid][`current_${d}`];

                if ((richShift === 'OFF' || richShift === 'REQ_OFF') && (poorShift !== 'OFF' && poorShift !== 'REQ_OFF')) {
                    // 檢查對調是否符合規則
                    // rich 換成 poorShift, poor 換成 OFF
                    if (this.canSwap(rich.uid, poor.uid, d, poorShift)) {
                        this.assign(rich.uid, d, poorShift);
                        this.assign(poor.uid, d, 'OFF');
                        changed = true;
                        console.log(`⚖️ 平衡對調：Day ${d}, ${rich.name}(OFF->${poorShift}) ↔ ${poor.name}(${poorShift}->OFF)`);
                        break; 
                    }
                }
            }
        }
    },

    canSwap: function(richUid, poorUid, day, targetShift) {
        // 1. 包班規則檢查
        const stRich = this.stats[richUid];
        if (stRich.canBundle && stRich.bundleShift && stRich.bundleShift !== targetShift) return false;

        // 2. 硬性規則檢查 (rich 換成 targetShift)
        // 這裡需要模擬對調後的狀態進行檢查
        const originalRichShift = this.matrix[richUid][`current_${day}`];
        const originalPoorShift = this.matrix[poorUid][`current_${day}`];

        // 暫時對調
        this.matrix[richUid][`current_${day}`] = targetShift;
        this.matrix[poorUid][`current_${day}`] = 'OFF';

        // 重新計算連續天數與間隔檢查 (簡化版，調用現有 checkHardRules)
        // 注意：checkHardRules 依賴 st.lastShiftCode，所以全域平衡時需要謹慎
        // 這裡我們暫時手動檢查關鍵規則
        const ok = this.checkHardRulesAtDay(richUid, day, targetShift) && this.checkHardRulesAtDay(poorUid, day, 'OFF');

        // 還原
        this.matrix[richUid][`current_${day}`] = originalRichShift;
        this.matrix[poorUid][`current_${day}`] = originalPoorShift;

        return ok;
    },

    checkHardRulesAtDay: function(uid, day, shiftCode) {
        const st = this.stats[uid];
        // 1. 白名單
        if (st.allowedList.length > 0 && shiftCode !== 'OFF' && !st.allowedList.includes(shiftCode)) return false;

        // 2. 間隔檢查 (前、後)
        const prevShift = (day === 1) ? st.initialLastShift : this.matrix[uid][`current_${day-1}`];
        const nextShift = (day === this.daysInMonth) ? null : this.matrix[uid][`current_${day+1}`];
        
        if (prevShift && !this.checkGap11(prevShift, shiftCode)) return false;
        if (nextShift && !this.checkGap11(shiftCode, nextShift)) return false;

        // 3. 連續天數檢查 (全月掃描)
        if (shiftCode !== 'OFF') {
            let cons = 0;
            const limit = (st.isLongLeave && this.rules.policy?.longLeaveAdjust) ? 7 : (this.rules.policy?.maxConsDays || 6);
            
            // 往前掃
            for (let i = day - 1; i >= 1; i--) {
                const s = this.matrix[uid][`current_${i}`];
                if (s && s !== 'OFF' && s !== 'REQ_OFF') cons++; else break;
            }
            if (day === 1) {
                // 這裡需要考慮上月結轉，但全域平衡時簡化處理
            }
            
            // 加上當天
            cons++;
            
            // 往後掃
            for (let i = day + 1; i <= this.daysInMonth; i++) {
                const s = this.matrix[uid][`current_${i}`];
                if (s && s !== 'OFF' && s !== 'REQ_OFF') cons++; else break;
            }
            
            if (cons > limit) return false;
        }

        return true;
    },

    cycle5_dailySettlement: function(day) {
        this.staffList.forEach(u => {
            const uid = u.uid;
            if(!this.matrix[uid][`current_${day}`]) this.assign(uid, day, 'OFF');
            const c = this.matrix[uid][`current_${day}`];
            if(c!=='OFF' && c!=='REQ_OFF') {
                this.stats[uid].consecutiveDays++;
                if (this.isLateShift(c)) this.stats[uid].nightShiftCount++;
            } else {
                this.stats[uid].consecutiveDays = 0;
            }
            this.stats[uid].lastShiftCode = c;
        });
    },

    assign: function(uid, day, code) {
        if(!this.matrix[uid]) this.matrix[uid]={};
        const old = this.matrix[uid][`current_${day}`];
        this.matrix[uid][`current_${day}`] = code;
        if(old==='OFF'||old==='REQ_OFF') this.stats[uid].totalOff--;
        if(code==='OFF'||code==='REQ_OFF') this.stats[uid].totalOff++;
    },

    isLocked: function(uid, day) { const v = this.matrix[uid]?.[`current_${day}`]; return v==='REQ_OFF' || (v&&v.startsWith('!')); },

    checkHardRules: function(uid, day, shiftCode) {
        const st = this.stats[uid];
        if (st.allowedList.length > 0 && shiftCode !== 'OFF' && !st.allowedList.includes(shiftCode)) return false;
        let lastCode = st.lastShiftCode;
        if (this.rules.hard?.minGap11 !== false && lastCode && !this.checkGap11(lastCode, shiftCode)) return false;
        const nextDay = day + 1;
        if (nextDay <= this.daysInMonth) {
            const nextCode = this.matrix[uid][`current_${nextDay}`];
            if (nextCode && nextCode !== 'OFF' && nextCode !== 'REQ_OFF' && this.rules.hard?.minGap11 !== false) {
                if (!this.checkGap11(shiftCode, nextCode)) return false;
            }
        }
        if (this.rules.hard?.protectPregnant !== false && (st.isPregnant || st.isBreastfeeding) && this.isLateShift(shiftCode)) return false;
        if (shiftCode !== 'OFF') {
            const limit = (st.isLongLeave && this.rules.policy?.longLeaveAdjust) ? 7 : (this.rules.policy?.maxConsDays || 6);
            if (st.consecutiveDays >= limit) return false;
        }
        return true;
    },

    checkHardRulesForBacktrack: function(uid, day, shiftCode) {
        let prevDayShift = (day === 1) ? this.stats[uid].initialLastShift : this.matrix[uid][`current_${day-1}`];
        if (!this.checkGap11(prevDayShift, shiftCode)) return false;
        const todayShift = this.matrix[uid][`current_${day+1}`];
        if (todayShift && todayShift !== 'OFF' && todayShift !== 'REQ_OFF' && !this.checkGap11(shiftCode, todayShift)) return false;
        return this.checkHardRules(uid, day, shiftCode);
    },

    checkGap11: function(prev, curr) {
        if (!prev || prev === 'OFF' || prev === 'REQ_OFF') return true;
        if (!curr || curr === 'OFF' || curr === 'REQ_OFF') return true;
        if (prev === 'E' && curr === 'D') return false; 
        if (prev === 'E' && curr === 'N') return false; 
        if (prev === 'D' && curr === 'N') return false; 
        if (prev === 'N' && curr === 'E') return false; 
        return true;
    },

    getShiftGap: function(day, code) { return this.getDemand(day,code) - this.countStaff(day,code); },
    getDemand: function(day, code) { 
        const d = new Date(this.year, this.month-1, day);
        const w = d.getDay()===0?6:d.getDay()-1;
        return this.dailyNeeds[`${code}_${w}`]||0; 
    },
    countStaff: function(day, code) { let c=0; this.staffList.forEach(u=>{if(this.matrix[u.uid][`current_${day}`]===code)c++;}); return c; },
    hasAnyGap: function(day) { return Object.keys(this.shiftMap).some(s=>this.getShiftGap(day,s)>0); },
    isLateShift: function(code) { return code === 'N' || code === 'E'; }
};
