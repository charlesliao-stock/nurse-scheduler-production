// js/modules/schedule_manager.js
// 🤖 AI 排班演算法 (v5.19 - Historical Trace Fix)
// Fix: 1. 修正 prepareContext 中連續天數的計算，改為「回溯上月真實天數」直到遇見 OFF。
//      2. 確保 Day 1 能正確繼承上個月的疲勞度，嚴格執行「第 7 天強制 OFF」。

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
        
        // [關鍵修正] 計算上個月的最後一天是幾號 (例如 30, 31, 28)
        const prevMonthDate = new Date(this.year, this.month - 1, 0); 
        const lastDayOfPrevMonth = prevMonthDate.getDate();

        console.group("🤖 AI Context Check (Consecutive Trace)");
        
        this.staffList.forEach(u => {
            if (!this.matrix[u.uid]) this.matrix[u.uid] = {};
            const monthlyPref = this.matrix[u.uid].preferences || {};
            const userParams = u.schedulingParams || {};

            // 1. [核心修正] 回溯計算連續上班天數 (Look-back Algorithm)
            let consecutive = 0;
            let lastShiftCode = null;

            // 往前檢查最多 14 天 (足夠覆蓋連六限制)
            for (let k = 0; k < 14; k++) {
                const d = lastDayOfPrevMonth - k;
                if (d < 1) break; // 邊界檢查
                
                // 預班表儲存的 key 是 last_31, last_30...
                const key = `last_${d}`;
                const code = this.matrix[u.uid][key];

                // 紀錄最後一天的班別 (for 間隔檢查)
                if (k === 0) lastShiftCode = code;

                // 判斷是否為上班
                // 若 code 存在且不是 OFF/REQ_OFF，則視為上班 -> 累加
                if (code && code !== 'OFF' && code !== 'REQ_OFF') {
                    consecutive++;
                } else {
                    // 遇到 OFF 或空值，中斷計數
                    break;
                }
            }

            // 判斷包班
            const canBundle = userParams.canBundleShifts === true;
            const targetBundle = monthlyPref.bundleShift || userParams.bundleShift || null;

            let reqOffCount = 0;
            for(let d=1; d<=this.daysInMonth; d++) { if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') reqOffCount++; }
            
            // 建立白名單
            const allowedShifts = new Set();
            if (canBundle && targetBundle) allowedShifts.add(targetBundle);
            if (monthlyPref.priority_1) allowedShifts.add(monthlyPref.priority_1);
            if (monthlyPref.priority_2) allowedShifts.add(monthlyPref.priority_2);
            if (monthlyPref.priority_3) allowedShifts.add(monthlyPref.priority_3);

            this.stats[u.uid] = {
                // 使用回溯計算出的精確天數
                consecutiveDays: consecutive, 
                totalOff: 0,
                lastShiftCode: lastShiftCode || null, // 確保最後一天班別正確
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
            
            // Debug Log: 確認是否正確抓到上個月的尾巴
            if (consecutive > 0) {
                console.log(`📊 ${u.name}: 上月結轉連上 ${consecutive} 天 (Last: ${lastShiftCode})`);
            }

            for(let d=1; d<=this.daysInMonth; d++) {
                if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') this.stats[u.uid].totalOff++;
            }
        });
        console.groupEnd();
    },

    generateOptions: async function() {
        const options = [];
        const strategies = [
            { name: "方案 A (均衡優先)", wBal: 8000, wCont: 20, tol: 1 },
            { name: "方案 B (偏好權重)", wBal: 5000, wCont: 50, tol: 2 },
            { name: "方案 C (連續性優先)", wBal: 3000, wCont: 200, tol: 3 }
        ];
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
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.cycle1_foundation(day);
            this.cycle2_scoringFill(day, strategy);
            this.cycle3_taxTheRich(day, strategy);
            this.cycle5_dailySettlement(day);
        }
        return this.matrix;
    },

    // Cycle 1: 基礎鋪底 (強制執行連續上班限制)
    cycle1_foundation: function(day) {
        this.staffList.forEach(u => {
            if(this.isLocked(u.uid, day)) return;
            
            const limit = (this.stats[u.uid].isLongLeave && this.rules.policy?.longLeaveAdjust) ? 7 : (this.rules.policy?.maxConsDays || 6);
            
            // 如果目前累積天數 >= 限制 (例如已連上 6 天)
            // 則當日 (第 7 天) 強制排 OFF
            if(this.stats[u.uid].consecutiveDays >= limit) {
                this.assign(u.uid, day, 'OFF');
            }
        });
    },

    cycle2_scoringFill: function(day, strategy) {
        const shifts = Object.keys(this.shiftMap);
        let maxIter = 50;
        let totalOff = 0; this.staffList.forEach(u => totalOff+=this.stats[u.uid].totalOff);
        const avgOff = totalOff / this.staffList.length;

        while(this.hasAnyGap(day) && maxIter > 0) {
            shifts.forEach(target => {
                if(this.getShiftGap(day, target) <= 0) return;
                const moves = this.calculateBestMoves(day, target, avgOff, strategy);
                if(moves.length > 0) this.executeMove(day, moves[0]);
            });
            maxIter--;
        }
    },

    calculateBestMoves: function(day, targetShift, avgOff, strategy) {
        const moves = [];
        const { tol, wBal, wCont } = strategy;

        this.staffList.forEach(u => {
            const uid = u.uid;
            if(this.isLocked(uid, day)) return;
            const cur = this.matrix[uid][`current_${day}`] || null;
            if(cur === targetShift) return; 
            
            if(!this.checkHardRules(uid, day, targetShift)) return;

            let score = 0;
            const st = this.stats[uid];
            const myOff = st.totalOff;
            const diff = myOff - avgOff; 

            if(!cur || cur==='OFF') {
                score += 500; 
                if(diff > tol) score += (diff * wBal); 
                else if(diff < -tol) score -= (Math.abs(diff) * wBal); 
                else score += (diff * wBal * 0.5);
            } else if(this.getShiftSurplus(day, cur) > 0) {
                score += 300; 
            }

            if(st.bundleShift === targetShift) score += 5000;
            else if(st.p1 === targetShift) score += 3000;
            else if(st.p2 === targetShift) score += 1500;
            else if(st.p3 === targetShift) score += 500;

            const prev = st.lastShiftCode;
            if(prev === targetShift) score += wCont;

            if(this.getShiftGap(day, targetShift) > 0) score += 2000;

            moves.push({ uid, from: cur, to: targetShift, score });
        });

        return moves.sort((a,b) => b.score - a.score);
    },

    cycle3_taxTheRich: function(day, strategy) {
        const richStaff = [...this.staffList].sort((a, b) => this.stats[b.uid].totalOff - this.stats[a.uid].totalOff);
        for (let richUser of richStaff) {
            if (this.isLocked(richUser.uid, day)) continue;
            const cur = this.matrix[richUser.uid][`current_${day}`];
            if (cur && cur !== 'OFF') continue;

            const shifts = Object.keys(this.shiftMap);
            for (let s of shifts) {
                if (!this.checkHardRules(richUser.uid, day, s)) continue;
                
                const workers = this.staffList.filter(u => this.matrix[u.uid][`current_${day}`]===s && !this.isLocked(u.uid, day));
                workers.sort((a, b) => this.stats[a.uid].totalOff - this.stats[b.uid].totalOff);
                
                if (workers.length > 0) {
                    const poorUser = workers[0];
                    if (this.stats[richUser.uid].totalOff > (this.stats[poorUser.uid].totalOff + 2)) {
                        this.assign(richUser.uid, day, s);
                        this.assign(poorUser.uid, day, 'OFF');
                        break;
                    }
                }
            }
        }
    },

    cycle5_dailySettlement: function(day) {
        this.staffList.forEach(u => {
            const uid = u.uid;
            if(!this.matrix[uid][`current_${day}`]) this.assign(uid, day, 'OFF');
            const c = this.matrix[uid][`current_${day}`];
            if(c!=='OFF' && c!=='REQ_OFF') this.stats[uid].consecutiveDays++; else this.stats[uid].consecutiveDays=0;
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
    executeMove: function(day, m) { this.assign(m.uid, day, m.to); },
    isLocked: function(uid, day) { const v = this.matrix[uid]?.[`current_${day}`]; return v==='REQ_OFF' || (v&&v.startsWith('!')); },

    checkHardRules: function(uid, day, shiftCode) {
        const st = this.stats[uid];
        
        // 1. 白名單 (偏好/包班)
        if (st.allowedList.length > 0) {
            if (shiftCode !== 'OFF' && !st.allowedList.includes(shiftCode)) {
                return false; 
            }
        }

        // 2. 雙向間隔
        let lastCode = st.lastShiftCode;
        if (this.rules.hard?.minGap11 !== false) {
            if (lastCode && !this.checkGap11(lastCode, shiftCode)) return false;
        }
        const nextDay = day + 1;
        if (nextDay <= this.daysInMonth) {
            const nextCode = this.matrix[uid][`current_${nextDay}`];
            if (nextCode && nextCode !== 'OFF' && nextCode !== 'REQ_OFF') {
                if (this.rules.hard?.minGap11 !== false) {
                    if (!this.checkGap11(shiftCode, nextCode)) return false;
                }
            }
        }

        // 3. 孕哺
        if (this.rules.hard?.protectPregnant !== false) {
            if ((st.isPregnant || st.isBreastfeeding) && this.isLateShift(shiftCode)) return false;
        }

        // 4. 連續上班 (嚴格執行)
        if (shiftCode !== 'OFF') {
            const limit = (st.isLongLeave && this.rules.policy?.longLeaveAdjust) ? 7 : (this.rules.policy?.maxConsDays || 6);
            // 如果目前已經連上 X 天 (例如 6)，則今天 (第 7 天) 不能再排班
            if (st.consecutiveDays >= limit) return false;
        }

        return true;
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

    checkRotationPattern: function(prev, curr) { return true; }, 
    getShiftGap: function(day, code) { return this.getDemand(day,code) - this.countStaff(day,code); },
    getShiftSurplus: function(day, code) { return this.countStaff(day,code) - this.getDemand(day,code); },
    getDemand: function(day, code) { 
        const d = new Date(this.year, this.month-1, day);
        const w = d.getDay()===0?6:d.getDay()-1;
        return this.dailyNeeds[`${code}_${w}`]||0; 
    },
    countStaff: function(day, code) { let c=0; this.staffList.forEach(u=>{if(this.matrix[u.uid][`current_${day}`]===code)c++;}); return c; },
    hasAnyGap: function(day) { return Object.keys(this.shiftMap).some(s=>this.getShiftGap(day,s)>0); },
    isLateShift: function(code) {
        const s = this.shiftMap[code];
        if (!s) return false;
        return code === 'N' || code === 'E'; 
    }
};
