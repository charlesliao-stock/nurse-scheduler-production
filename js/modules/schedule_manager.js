// js/modules/schedule_manager.js
// 🤖 AI 排班演算法 (v5.18 - Strict Preference Whitelist)
// Fix: 嚴格遵守「白名單」邏輯。若員工有設定包班或志願，絕對禁止安排該範圍以外的班別。

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
        
        console.group("🤖 AI Context Check (Strict Mode)");
        this.staffList.forEach(u => {
            if (!this.matrix[u.uid]) this.matrix[u.uid] = {};
            const lastShift = this.matrix[u.uid]['last_0'] || null;
            const monthlyPref = this.matrix[u.uid].preferences || {};
            const userParams = u.schedulingParams || {};

            // 判斷包班
            const canBundle = userParams.canBundleShifts === true;
            const targetBundle = monthlyPref.bundleShift || userParams.bundleShift || null;

            let reqOffCount = 0;
            for(let d=1; d<=this.daysInMonth; d++) { if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') reqOffCount++; }
            
            // 建立白名單集合 (Set)
            const allowedShifts = new Set();
            if (canBundle && targetBundle) allowedShifts.add(targetBundle);
            if (monthlyPref.priority_1) allowedShifts.add(monthlyPref.priority_1);
            if (monthlyPref.priority_2) allowedShifts.add(monthlyPref.priority_2);
            if (monthlyPref.priority_3) allowedShifts.add(monthlyPref.priority_3);

            this.stats[u.uid] = {
                consecutiveDays: (lastShift && lastShift !== 'OFF') ? 1 : 0,
                totalOff: 0,
                lastShiftCode: lastShift,
                isLongLeave: reqOffCount >= longLeaveThres,
                isPregnant: userParams.isPregnant,
                isBreastfeeding: userParams.isBreastfeeding,
                
                canBundle: canBundle,
                bundleShift: targetBundle,
                
                p1: monthlyPref.priority_1,
                p2: monthlyPref.priority_2,
                p3: monthlyPref.priority_3,
                
                // [關鍵] 將允許的班別轉為 Array 存起來
                // 如果是空陣列，代表「無偏好 (隨便排)」
                allowedList: Array.from(allowedShifts) 
            };
            
            // Debug: 顯示每人的允許班別
            if (this.stats[u.uid].allowedList.length > 0) {
                console.log(`🔒 ${u.name}: 僅限排 [${this.stats[u.uid].allowedList.join(', ')}]`);
            } else {
                console.log(`🔓 ${u.name}: 無限制 (全能工)`);
            }

            for(let d=1; d<=this.daysInMonth; d++) {
                if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') this.stats[u.uid].totalOff++;
            }
        });
        console.groupEnd();
    },

    generateOptions: async function() {
        const options = [];
        // [參數調整] 因為範圍已經被硬規則鎖死，這裡的權重主要影響「在合法範圍內」誰先被選中
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

    cycle1_foundation: function(day) {
        this.staffList.forEach(u => {
            if(this.isLocked(u.uid, day)) return;
            const limit = (this.stats[u.uid].isLongLeave && this.rules.policy?.longLeaveAdjust) ? 7 : (this.rules.policy?.maxConsDays || 6);
            if(this.stats[u.uid].consecutiveDays >= limit) this.assign(u.uid, day, 'OFF');
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
            
            // 🛑 硬規則檢查 (含嚴格白名單)
            if(!this.checkHardRules(uid, day, targetShift)) return;

            let score = 0;
            const st = this.stats[uid];
            const myOff = st.totalOff;
            const diff = myOff - avgOff; 

            // 1. 基礎分
            if(!cur || cur==='OFF') {
                score += 500; 
                if(diff > tol) score += (diff * wBal); 
                else if(diff < -tol) score -= (Math.abs(diff) * wBal); 
                else score += (diff * wBal * 0.5);
            } else if(this.getShiftSurplus(day, cur) > 0) {
                score += 300; 
            }

            // 2. 偏好加分 (區分志願序)
            // 這裡的加分只是為了在「合法候選人」中區分高下
            if(st.bundleShift === targetShift) score += 5000;
            else if(st.p1 === targetShift) score += 3000;
            else if(st.p2 === targetShift) score += 1500;
            else if(st.p3 === targetShift) score += 500;

            // 3. 連續性
            const prev = st.lastShiftCode;
            if(prev === targetShift) score += wCont;

            // 4. 缺口救火 (現在只對合法的人有效)
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
                if (!this.checkHardRules(richUser.uid, day, s)) continue; // 必須合規
                
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

    // --- [核心] 硬規則檢查 (Strict Whitelist) ---
    checkHardRules: function(uid, day, shiftCode) {
        const st = this.stats[uid];
        
        // 1. [絕對白名單] 偏好限制
        // 如果此人有設定任何「允許班別」(包班或 P1/P2/P3)
        // 則除此之外的班別一律禁止 (OFF 除外)
        if (st.allowedList.length > 0) {
            if (shiftCode !== 'OFF' && !st.allowedList.includes(shiftCode)) {
                return false; // 非白名單內的班別，禁止！
            }
        }

        // 2. 雙向間隔檢查
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

        // 4. 連續
        if (shiftCode !== 'OFF') {
            const limit = (st.isLongLeave && this.rules.policy?.longLeaveAdjust) ? 7 : (this.rules.policy?.maxConsDays || 6);
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
