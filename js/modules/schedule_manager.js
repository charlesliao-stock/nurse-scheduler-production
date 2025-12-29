// js/modules/schedule_manager.js
// 🤖 AI 排班演算法 (v5.15 - Strict Gap Check & Preference Boost)
// Fix: 1. 雙向檢查 (前後日) 防止 E接D/N 2. 提高填補缺口優先級 3. 加重個人偏好權重

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
        this.staffList.forEach(u => {
            if (!this.matrix[u.uid]) this.matrix[u.uid] = {};
            const lastShift = this.matrix[u.uid]['last_0'] || null;
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
                p1: pref.priority_1,
                p2: pref.priority_2,
                p3: pref.priority_3
            };
            
            for(let d=1; d<=this.daysInMonth; d++) {
                if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') this.stats[u.uid].totalOff++;
            }
        });
    },

    generateOptions: async function() {
        const options = [];
        // [調整] 提高 Preference 權重，並確保缺口填補
        const strategies = [
            { name: "方案 A (均衡)", wBal: 5000, wCont: 20, tol: 1 },
            { name: "方案 B (偏好優先)", wBal: 3000, wCont: 50, tol: 2 },
            { name: "方案 C (強力填補)", wBal: 1000, wCont: 100, tol: 3 } // 降低平衡權重，讓缺口更容易被填滿
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
            
            // [關鍵] 檢查 Hard Rules (包含前後日)
            if(!this.checkHardRules(uid, day, targetShift)) return;

            let score = 0;
            const myOff = this.stats[uid].totalOff;
            const diff = myOff - avgOff; 

            // 1. 基礎分 (從 OFF 抓人)
            if(!cur || cur==='OFF') {
                score += 500; // 提高基礎分，鼓勵填坑
                // 平衡性 (OFF 越多越容易被抓)
                if(diff > tol) score += (diff * wBal); 
                else if(diff < -tol) score -= (Math.abs(diff) * wBal); 
                else score += (diff * wBal * 0.5);
            } else if(this.getShiftSurplus(day, cur) > 0) {
                score += 300; // 支援調度
            }

            // 2. 偏好加分 (大幅提高權重)
            const p = this.stats[uid];
            if(p.p1 === targetShift) score += 5000; // 第一志願：絕對優先
            else if(p.p2 === targetShift) score += 2000;
            else if(p.p3 === targetShift) score += 1000;

            // 3. 連續性
            const prev = this.stats[uid].lastShiftCode;
            if(prev === targetShift) score += wCont;

            // 4. [新增] 缺口救火分
            // 如果這個班目前很缺人，且該員能上，大幅加分，避免留白
            if(this.getShiftGap(day, targetShift) > 0) {
                score += 1000;
            }

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

            // 嘗試搶班
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

    // --- [核心修正] 硬規則檢查 (包含前後日) ---
    checkHardRules: function(uid, day, shiftCode) {
        // 1. 檢查前一日 (Backward)
        let lastCode = this.stats[uid].lastShiftCode;
        if (this.rules.hard?.minGap11 !== false) {
            if (lastCode && !this.checkGap11(lastCode, shiftCode)) return false;
        }

        // 2. [新增] 檢查後一日 (Forward / Look-ahead)
        // 防止今天排了 E，結果明天已經鎖定 D，造成 E->D
        const nextDay = day + 1;
        if (nextDay <= this.daysInMonth) {
            const nextCode = this.matrix[uid][`current_${nextDay}`];
            if (nextCode && nextCode !== 'OFF' && nextCode !== 'REQ_OFF') {
                // 如果明天有班，檢查 "今天->明天" 是否合法
                if (this.rules.hard?.minGap11 !== false) {
                    if (!this.checkGap11(shiftCode, nextCode)) return false;
                }
            }
        }

        // 3. 孕哺限制
        if (this.rules.hard?.protectPregnant !== false) {
            if ((this.stats[uid].isPregnant || this.stats[uid].isBreastfeeding) && this.isLateShift(shiftCode)) return false;
        }

        // 4. 連續上班限制
        if (shiftCode !== 'OFF') {
            const limit = (this.stats[uid].isLongLeave && this.rules.policy?.longLeaveAdjust) ? 7 : (this.rules.policy?.maxConsDays || 6);
            if (this.stats[uid].consecutiveDays >= limit) return false;
        }

        // 5. 包班限制
        if (this.rules.policy?.bundleNightOnly !== false && this.stats[uid].canBundle) {
            const bundleCode = this.stats[uid].bundleShift;
            if (bundleCode && shiftCode !== 'OFF' && shiftCode !== bundleCode) return false;
        }

        return true;
    },

    // --- [核心修正] 11小時/逆向排班檢查 ---
    checkGap11: function(prev, curr) {
        if (!prev || prev === 'OFF' || prev === 'REQ_OFF') return true;
        if (!curr || curr === 'OFF' || curr === 'REQ_OFF') return true;
        
        // 嚴格禁止逆向 (Retrograde Rotation)
        // E (16-24) -> D (08-16): 間隔 8hr -> 禁止
        if (prev === 'E' && curr === 'D') return false; 
        
        // E (16-24) -> N (00-08): 間隔 0hr -> 禁止
        if (prev === 'E' && curr === 'N') return false; 
        
        // D (08-16) -> N (00-08): 間隔 8hr -> 禁止 (雖非法規11hr但通常不排)
        if (prev === 'D' && curr === 'N') return false; 
        
        // N (00-08) -> E (16-24): 間隔 8hr -> 禁止 (若需嚴格11hr)
        // 如果貴單位允許 N -> E (間隔8hr)，可註解掉下面這行
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
        // 簡單判定：N 或 E 算晚班
        return code === 'N' || code === 'E';
    }
};
