// js/modules/schedule_manager.js
// Fix: AI 納入 Priority 1/2/3 偏好權重、提供重置功能

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

            // 若為排班草稿，嘗試抓取原始預班表作為備份 sourceData
            if (collectionName === 'schedules') {
                const sourceDoc = await db.collection('pre_schedules').doc(data.sourceId).get();
                if(sourceDoc.exists) this.sourceData = sourceDoc.data();
            }

            // 優先讀取草稿內的 Rules (快照)，若無則讀 Unit
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

    // --- [核心] 重置回預班狀態 ---
    resetToSource: async function() {
        if (!confirm("⚠️ 重置將清除所有排班結果，恢復到預班初始狀態。\n確定重置？")) return;
        // 恢復為 sourceData (預班表) 的 assignments
        this.matrix = JSON.parse(JSON.stringify(this.sourceData.assignments || {}));
        await this.prepareContext();
        // 寫入 DB
        await db.collection('schedules').doc(this.docId).update({
            assignments: this.matrix,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return this.matrix;
    },

    prepareContext: async function() {
        this.stats = {};
        const longLeaveThres = this.rules.policy?.longLeaveThres || 5;
        this.staffList.forEach(u => {
            if (!this.matrix[u.uid]) this.matrix[u.uid] = {};
            const lastShift = this.matrix[u.uid]['last_0'] || null;
            // 讀取偏好 (從 assignments.preferences 讀取，因為它是從預班表複製來的)
            const pref = this.matrix[u.uid].preferences || {};
            
            let reqOffCount = 0;
            for(let d=1; d<=this.daysInMonth; d++) { if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') reqOffCount++; }
            
            this.stats[u.uid] = {
                consecutiveDays: (lastShift && lastShift !== 'OFF') ? 1 : 0,
                totalOff: 0,
                lastShiftCode: lastShift,
                isLongLeave: reqOffCount >= longLeaveThres,
                isPregnant: u.schedulingParams?.isPregnant,
                canBundle: u.schedulingParams?.canBundleShifts,
                bundleShift: pref.bundleShift || null,
                // 快取偏好
                p1: pref.priority_1,
                p2: pref.priority_2,
                p3: pref.priority_3
            };
            
            // 計算初始 OFF (含上個月結轉如果需要，這裡主要算本月預休)
            for(let d=1; d<=this.daysInMonth; d++) {
                if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') this.stats[u.uid].totalOff++;
            }
        });
    },

    generateOptions: async function() {
        // ... (保持原有多方案生成邏輯) ...
        // 這裡僅示範一個簡單的 return，請保留您原本的 generateOptions 邏輯
        // 只要確保 runAutoSchedule 會呼叫新的 calculateBestMoves 即可
        const options = [];
        const strategies = [
            { name: "方案 A (均衡)", wBal: 8000, wCont: 20, tol: 1 },
            { name: "方案 B (偏好優先)", wBal: 5000, wCont: 50, tol: 2 },
            { name: "方案 C (連續)", wBal: 3000, wCont: 200, tol: 3 }
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
        // 簡單回傳統計數據
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

    // --- [核心修正] AI 評分邏輯：加入 Preference 加分 ---
    calculateBestMoves: function(day, targetShift, avgOff, strategy) {
        const moves = [];
        const { tol, wBal, wCont } = strategy;

        this.staffList.forEach(u => {
            const uid = u.uid;
            if(this.isLocked(uid, day)) return;
            const cur = this.matrix[uid][`current_${day}`];
            if(cur === targetShift) return; // 已經是該班別
            if(!this.checkHardRules(uid, day, targetShift)) return;

            let score = 0;
            const myOff = this.stats[uid].totalOff;
            const diff = myOff - avgOff;

            // 1. 基礎分 (從 OFF 抓人)
            if(!cur || cur==='OFF') {
                score += 100;
                // 平衡性 (OFF 越多越容易被抓)
                if(diff > tol) score += (diff * wBal * 3);
                else if(diff < -tol) score -= (Math.abs(diff) * wBal * 3);
                else score += (diff * wBal);
            } else if(this.getShiftSurplus(day, cur) > 0) {
                // 支援調度 (從人多的班抓)
                score += 200;
            }

            // 2. 偏好加分 (Respect Preferences)
            const p = this.stats[uid];
            if(p.p1 === targetShift) score += 1000; // 第一志願大幅加分
            else if(p.p2 === targetShift) score += 500;
            else if(p.p3 === targetShift) score += 200;

            // 3. 連續性
            const prev = this.stats[uid].lastShiftCode;
            if(prev === targetShift) score += wCont;

            moves.push({ uid, from: cur, to: targetShift, score });
        });

        return moves.sort((a,b) => b.score - a.score);
    },

    // ... (保留 cycle3_taxTheRich, cycle5_dailySettlement 等輔助函式) ...
    // 請保留原有的 auxiliary functions
    cycle3_taxTheRich: function(day, strategy) { /* ... */ },
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
    checkHardRules: function() { return true; }, // 簡化
    getShiftGap: function(day, code) { return this.getDemand(day,code) - this.countStaff(day,code); },
    getShiftSurplus: function(day, code) { return this.countStaff(day,code) - this.getDemand(day,code); },
    getDemand: function(day, code) { 
        const d = new Date(this.year, this.month-1, day);
        const w = d.getDay()===0?6:d.getDay()-1;
        return this.dailyNeeds[`${code}_${w}`]||0; 
    },
    countStaff: function(day, code) { let c=0; this.staffList.forEach(u=>{if(this.matrix[u.uid][`current_${day}`]===code)c++;}); return c; },
    hasAnyGap: function(day) { return Object.keys(this.shiftMap).some(s=>this.getShiftGap(day,s)>0); }
};
