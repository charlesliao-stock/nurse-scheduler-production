// js/modules/schedule_manager.js
// 🤖 AI 排班演算法引擎 (Auto-Scheduler v5.3 - Fully Customizable)

const scheduleManager = {
    docId: null,
    rules: {},       
    staffList: [],   
    shifts: [],      
    shiftMap: {},    
    matrix: {},      
    dailyNeeds: {},  
    stats: {},       
    daysInMonth: 0,
    year: 0,
    month: 0,
    
    yieldToMain: () => new Promise(resolve => setTimeout(resolve, 0)),

    // --- 1. 初始化與載入 ---
    loadContext: async function(docId, collectionName = 'pre_schedules') {
        console.log(`🤖 AI Engine Loading: ${docId} from [${collectionName}]`);
        this.docId = docId;
        
        try {
            const doc = await db.collection(collectionName).doc(docId).get();
            if(!doc.exists) throw new Error("文件不存在");
            
            const data = doc.data();
            let sourceData = data; 

            if (collectionName === 'schedules') {
                if (!data.sourceId) throw new Error("草稿缺少來源預班表 ID");
                const sourceDoc = await db.collection('pre_schedules').doc(data.sourceId).get();
                if (!sourceDoc.exists) throw new Error("原始預班表遺失");
                sourceData = sourceDoc.data();
            }

            if(sourceData.rules) {
                this.rules = sourceData.rules;
            } else {
                const unitDoc = await db.collection('units').doc(sourceData.unitId).get();
                this.rules = unitDoc.data().schedulingRules || {};
            }
            this.dailyNeeds = sourceData.dailyNeeds || {};

            const shiftsSnap = await db.collection('shifts').where('unitId', '==', sourceData.unitId).get();
            this.shifts = shiftsSnap.docs.map(d => d.data());
            this.shiftMap = {};
            this.shifts.forEach(s => this.shiftMap[s.code] = s);

            this.staffList = data.staffList || [];
            this.matrix = data.assignments || {}; 
            
            this.year = sourceData.year;
            this.month = sourceData.month;
            this.daysInMonth = new Date(this.year, this.month, 0).getDate();

            await this.prepareContext();
            console.log(`✅ AI Context Ready.`);
            return true;

        } catch(e) {
            console.error("AI Load Error:", e);
            alert("AI 載入失敗: " + e.message);
            return false;
        }
    },

    prepareContext: async function() {
        this.stats = {};
        this.staffList.forEach(u => {
            if (!this.matrix[u.uid]) this.matrix[u.uid] = {};
            
            const lastShift = this.matrix[u.uid]['last_0'] || null;
            const pref = this.matrix[u.uid].preferences || {};

            let reqOffCount = 0;
            for(let d=1; d<=this.daysInMonth; d++) {
                if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') reqOffCount++;
            }
            const isLongLeave = reqOffCount >= (this.rules.policy?.longLeaveThres || 5);

            this.stats[u.uid] = {
                consecutiveDays: (lastShift && lastShift !== 'OFF') ? 1 : 0,
                totalOff: 0,
                lastShiftCode: lastShift,
                isLongLeave: isLongLeave,
                isPregnant: u.schedulingParams?.isPregnant || false,
                isBreastfeeding: u.schedulingParams?.isBreastfeeding || false,
                canBundle: u.schedulingParams?.canBundleShifts || false,
                bundleShift: pref.bundleShift || null
            };

            for(let d=1; d<=this.daysInMonth; d++) {
                const val = this.matrix[u.uid][`current_${d}`];
                if(val === 'REQ_OFF' || val === 'OFF') {
                    this.stats[u.uid].totalOff++;
                }
            }
        });
    },

    // --- 生成選項 (基於設定值) ---
    generateOptions: async function() {
        // 從規則中讀取設定，若無則使用預設
        const ai = this.rules.aiParams || {};
        const baseWBalance = ai.w_balance || 200;
        const baseWContinuity = ai.w_continuity || 50;
        const baseWSurplus = ai.w_surplus || 150;
        const baseTolerance = ai.tolerance || 2;

        const options = [];
        const strategies = [
            // 方案 A: 使用者設定 (標準)
            { name: "方案 A (標準設定)", wBal: baseWBalance, wCont: baseWContinuity, tol: baseTolerance },
            // 方案 B: 強調平衡 (權重 +50%, 容忍度 -1)
            { name: "方案 B (嚴格平衡)", wBal: baseWBalance * 1.5, wCont: baseWContinuity * 0.8, tol: Math.max(1, baseTolerance - 1) },
            // 方案 C: 強調連續 (平衡權重減半, 容忍度放寬)
            { name: "方案 C (連續優先)", wBal: baseWBalance * 0.5, wCont: baseWContinuity * 1.5, tol: baseTolerance + 2 }
        ];

        const originalMatrix = JSON.parse(JSON.stringify(this.matrix));
        const originalStats = JSON.parse(JSON.stringify(this.stats));

        for (let strategy of strategies) {
            this.matrix = JSON.parse(JSON.stringify(originalMatrix));
            this.stats = JSON.parse(JSON.stringify(originalStats));
            
            await this.runAutoSchedule(strategy);

            const metrics = this.evaluateResult();
            options.push({
                name: strategy.name,
                assignments: JSON.parse(JSON.stringify(this.matrix)),
                metrics: metrics
            });
        }

        this.matrix = originalMatrix;
        this.stats = originalStats;
        return options;
    },

    evaluateResult: function() {
        let totalOffs = [];
        let totalNights = [];
        this.staffList.forEach(u => {
            let off = 0; let night = 0;
            for(let d=1; d<=this.daysInMonth; d++) {
                const code = this.matrix[u.uid][`current_${d}`];
                if(code === 'OFF' || code === 'REQ_OFF') off++;
                else if(code === 'N' || code === 'E') night++;
            }
            totalOffs.push(off); totalNights.push(night);
        });
        const stdDev = (arr) => {
            const n = arr.length; if(n===0)return 0;
            const mean = arr.reduce((a, b) => a + b) / n;
            return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
        };
        return {
            offStdDev: stdDev(totalOffs).toFixed(2),
            nightStdDev: stdDev(totalNights).toFixed(2),
            avgOff: (totalOffs.reduce((a,b)=>a+b,0) / totalOffs.length).toFixed(1)
        };
    },

    // --- 核心入口 ---
    runAutoSchedule: async function(strategy) {
        for (let day = 1; day <= this.daysInMonth; day++) {
            this.cycle1_foundation(day);
            this.cycle2_scoringFill(day, strategy);
            this.cycle3_trimAndBacktrack(day);
            this.updateDailyStats(day);
        }
        this.fillRemainingOffs();
        return this.matrix;
    },

    cycle1_foundation: function(day) {
        const shuffledStaff = [...this.staffList].sort(() => 0.5 - Math.random());
        shuffledStaff.forEach(staff => {
            const uid = staff.uid;
            if (this.isLocked(uid, day)) return;
            const limit = this.stats[uid].isLongLeave 
                ? (this.rules.policy?.longLeaveMaxCons || 7) : (this.rules.policy?.maxConsDays || 6);
            if (this.stats[uid].consecutiveDays >= limit) {
                this.assign(uid, day, 'OFF'); return;
            }
            const lastCode = this.stats[uid].lastShiftCode;
            if (lastCode && lastCode !== 'OFF' && lastCode !== 'REQ_OFF') {
                if (this.getShiftGap(day, lastCode) > 0) {
                    if (this.checkHardRules(uid, day, lastCode)) {
                        this.assign(uid, day, lastCode);
                    }
                }
            }
        });
    },

    cycle2_scoringFill: function(day, strategy) {
        const shifts = Object.keys(this.shiftMap);
        let maxIterations = 50; 
        let totalOffSum = 0;
        this.staffList.forEach(u => totalOffSum += this.stats[u.uid].totalOff);
        const avgOff = totalOffSum / this.staffList.length;

        while (this.hasAnyGap(day) && maxIterations > 0) {
            shifts.forEach(targetShift => {
                if (this.getShiftGap(day, targetShift) <= 0) return;
                const moves = this.calculateBestMoves(day, targetShift, avgOff, strategy);
                if (moves.length > 0) this.executeMove(day, moves[0]);
            });
            maxIterations--;
        }
    },

    cycle3_trimAndBacktrack: function(day) {
        const shifts = Object.keys(this.shiftMap);
        
        // A. 修剪
        shifts.forEach(shiftCode => {
            let surplus = this.getShiftSurplus(day, shiftCode);
            if (surplus <= 0) return;
            const staffOnShift = this.staffList.filter(u => 
                this.matrix[u.uid] && this.matrix[u.uid][`current_${day}`] === shiftCode && !this.isLocked(u.uid, day)
            );
            staffOnShift.sort((a, b) => this.stats[a.uid].totalOff - this.stats[b.uid].totalOff);
            for (let i = 0; i < surplus && i < staffOnShift.length; i++) {
                this.assign(staffOnShift[i].uid, day, 'OFF');
            }
        });

        // B. 回溯
        if (this.hasAnyGap(day)) {
            shifts.forEach(targetShift => {
                if (this.getShiftGap(day, targetShift) <= 0) return;
                this.attemptBacktrack(day, targetShift);
            });
        }
    },

    attemptBacktrack: function(day, targetShift) {
        // 從參數讀取限制
        const ai = this.rules.aiParams || {};
        const MAX_DEPTH = ai.backtrack_depth || 3;
        const MAX_ATTEMPTS = ai.max_attempts || 20;
        
        let attemptsCount = 0;

        for (let depth = 1; depth <= MAX_DEPTH; depth++) {
            const prevDay = day - depth;
            if (prevDay < 1) break;
            const candidates = [...this.staffList].sort(() => 0.5 - Math.random());

            for (let staff of candidates) {
                if (attemptsCount >= MAX_ATTEMPTS) return;
                const uid = staff.uid;
                if (this.isLocked(uid, day) || this.isLocked(uid, prevDay)) continue;
                const currentCode = this.matrix[uid][`current_${day}`];
                if (currentCode && currentCode !== 'OFF') continue; 
                const prevCode = this.matrix[uid][`current_${prevDay}`];
                
                if (prevCode && prevCode !== 'OFF' && this.getShiftSurplus(prevDay, prevCode) >= 0) {
                    attemptsCount++;
                    if (this.checkHardRules(uid, day, targetShift, 'OFF')) {
                        this.assign(uid, prevDay, 'OFF');
                        this.assign(uid, day, targetShift);
                        if (this.getShiftGap(day, targetShift) <= 0) return;
                    }
                }
            }
        }
    },

    calculateBestMoves: function(day, targetShift, avgOff, strategy) {
        const moves = [];
        const tolerance = strategy.tol; // 使用當前策略的容忍值
        const wBal = strategy.wBal;
        const wCont = strategy.wCont;
        const wSurp = (this.rules.aiParams?.w_surplus || 150); // 支援調度權重

        this.staffList.forEach(staff => {
            const uid = staff.uid;
            if (!this.matrix[uid]) this.matrix[uid] = {};
            if (this.isLocked(uid, day)) return;
            const currentCode = this.matrix[uid][`current_${day}`] || null; 
            if (currentCode === targetShift) return; 
            if (!this.checkHardRules(uid, day, targetShift)) return;

            let score = 0;
            const myOff = this.stats[uid].totalOff;
            const diff = myOff - avgOff; 

            if (!currentCode || currentCode === 'OFF') {
                score += 0; 
                if (diff > tolerance) {
                    // 積假過多，強力抓回來，分數由 wBal 決定
                    score += wBal; 
                } else if (diff < -tolerance) {
                    score -= wBal;
                }
            } else if (this.getShiftSurplus(day, currentCode) > 0) {
                score += wSurp;
            }

            const prevCode = this.stats[uid].lastShiftCode;
            if (prevCode === targetShift) {
                score += wCont; // 連續性分數
            } else if (this.checkRotationPattern(prevCode, targetShift)) {
                score += (wCont * 0.6); // 順向分數略低於連續
            }

            moves.push({ uid, from: currentCode, to: targetShift, score });
        });

        return moves.sort((a, b) => b.score - a.score);
    },

    // ... 輔助函式維持不變 ...
    assign: function(uid, day, code) {
        if(!this.matrix[uid]) this.matrix[uid] = {}; 
        const oldCode = this.matrix[uid][`current_${day}`];
        this.matrix[uid][`current_${day}`] = code;
        if (oldCode === 'OFF' || oldCode === 'REQ_OFF') this.stats[uid].totalOff--;
        if (code === 'OFF' || code === 'REQ_OFF') this.stats[uid].totalOff++;
    },
    executeMove: function(day, move) { this.assign(move.uid, day, move.to); },
    updateDailyStats: function(day) {
        this.staffList.forEach(u => {
            const code = this.matrix[u.uid] ? this.matrix[u.uid][`current_${day}`] : null;
            if (code && code !== 'OFF' && code !== 'REQ_OFF') this.stats[u.uid].consecutiveDays++;
            else this.stats[u.uid].consecutiveDays = 0;
            this.stats[u.uid].lastShiftCode = code;
        });
    },
    isLocked: function(uid, day) {
        const val = this.matrix[uid] ? this.matrix[uid][`current_${day}`] : null;
        return (val === 'REQ_OFF' || (val && val.startsWith('!')));
    },
    checkHardRules: function(uid, day, shiftCode, optionalPrevCode) {
        let lastCode = optionalPrevCode || this.stats[uid].lastShiftCode;
        if (lastCode && !this.checkGap11(lastCode, shiftCode)) return false;
        if (this.stats[uid].isPregnant || this.stats[uid].isBreastfeeding) {
            if (this.isLateShift(shiftCode)) return false;
        }
        if (shiftCode !== 'OFF') {
            if (optionalPrevCode !== 'OFF') {
                const limit = this.stats[uid].isLongLeave 
                    ? (this.rules.policy?.longLeaveMaxCons || 7) : (this.rules.policy?.maxConsDays || 6);
                if (this.stats[uid].consecutiveDays >= limit) return false;
            }
        }
        if (this.rules.policy?.bundleNightOnly && this.stats[uid].canBundle) {
            const bundleCode = this.stats[uid].bundleShift;
            if (bundleCode && shiftCode !== 'OFF' && shiftCode !== bundleCode) return false;
        }
        return true;
    },
    checkGap11: function(prev, curr) {
        if (!prev || prev === 'OFF' || prev === 'REQ_OFF') return true;
        if (curr === 'OFF' || curr === 'REQ_OFF') return true;
        if (prev === 'E' && curr === 'D') return false; 
        if (prev === 'N' && curr === 'D') return false; 
        if (prev === 'N' && curr === 'E') return false; 
        return true;
    },
    isLateShift: function(code) {
        const s = this.shiftMap[code];
        if (!s) return false;
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        const start = sh + sm/60; const end = eh + em/60;
        if (end < start) return true; 
        if (start < 6 || start >= 22) return true;
        if (end > 22) return true;
        return false;
    },
    checkRotationPattern: function(prev, curr) {
        const orderStr = this.rules.pattern?.rotationOrder || 'OFF,N,D,E';
        const order = orderStr.split(',');
        const idxPrev = order.indexOf(prev);
        const idxCurr = order.indexOf(curr);
        if (idxPrev === -1 || idxCurr === -1) return false;
        if (idxCurr === idxPrev + 1) return true;
        if (idxPrev === order.length - 1 && idxCurr === 0) return true;
        return false;
    },
    getShiftGap: function(day, code) {
        const needed = this.getDemand(day, code);
        const current = this.countStaff(day, code);
        return needed - current;
    },
    getShiftSurplus: function(day, code) {
        const needed = this.getDemand(day, code);
        const current = this.countStaff(day, code);
        return current - needed;
    },
    getDemand: function(day, code) {
        const date = new Date(this.year, this.month - 1, day);
        const dayOfWeek = date.getDay(); 
        const uiDayIndex = (dayOfWeek === 0) ? 6 : dayOfWeek - 1; 
        const key = `${code}_${uiDayIndex}`;
        return this.dailyNeeds[key] || 0; 
    },
    countStaff: function(day, code) {
        let count = 0;
        this.staffList.forEach(u => {
            if (this.matrix[u.uid] && this.matrix[u.uid][`current_${day}`] === code) count++;
        });
        return count;
    },
    hasAnyGap: function(day) {
        const shifts = Object.keys(this.shiftMap);
        return shifts.some(s => this.getShiftGap(day, s) > 0);
    },
    fillRemainingOffs: function() {
        Object.keys(this.matrix).forEach(uid => {
            for(let d=1; d<=this.daysInMonth; d++) {
                if(!this.matrix[uid][`current_${d}`]) {
                    this.matrix[uid][`current_${d}`] = 'OFF';
                }
            }
        });
    }
};
