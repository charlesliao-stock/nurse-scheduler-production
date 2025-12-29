// js/modules/schedule_manager.js
// 🤖 AI 排班演算法引擎 (Auto-Scheduler v5.11 - Robin Hood "Tax the Rich" Logic)
// 重大更新：新增「富人搶班」機制，主動將積假多的人強制安插進班表，替換掉積假少的人。

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
        const longLeaveThres = this.rules.policy?.longLeaveThres || 5;

        this.staffList.forEach(u => {
            if (!this.matrix[u.uid]) this.matrix[u.uid] = {};
            
            const lastShift = this.matrix[u.uid]['last_0'] || null;
            const pref = this.matrix[u.uid].preferences || {};

            let reqOffCount = 0;
            for(let d=1; d<=this.daysInMonth; d++) {
                if(this.matrix[u.uid][`current_${d}`] === 'REQ_OFF') reqOffCount++;
            }
            const isLongLeave = reqOffCount >= longLeaveThres;

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
                if(val === 'REQ_OFF') {
                    this.stats[u.uid].totalOff++;
                }
            }
        });
    },

    generateOptions: async function() {
        // 強制使用高強度平衡參數
        const ai = this.rules.aiParams || {};
        const baseWBalance = 8000; // 超高權重
        const baseWContinuity = 20; // 降低連續性權重，避免鎖死
        const baseTolerance = 1; // 容忍度極低

        const options = [];
        const strategies = [
            { name: "方案 A (劫富濟貧)", wBal: baseWBalance, wCont: baseWContinuity, tol: baseTolerance },
            { name: "方案 B (絕對平均)", wBal: 10000, wCont: 0, tol: 0 }, 
            { name: "方案 C (彈性平衡)", wBal: 5000, wCont: 100, tol: 2 }
        ];

        const originalMatrix = JSON.parse(JSON.stringify(this.matrix));

        for (let strategy of strategies) {
            this.matrix = JSON.parse(JSON.stringify(originalMatrix));
            await this.prepareContext();
            await this.runAutoSchedule(strategy);

            const metrics = this.evaluateResult();
            options.push({
                name: strategy.name,
                assignments: JSON.parse(JSON.stringify(this.matrix)),
                metrics: metrics
            });
        }

        this.matrix = originalMatrix;
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
            // 1. 鋪底 (僅硬規則檢查)
            this.cycle1_foundation(day);
            
            // 2. 填補 (競價)
            this.cycle2_scoringFill(day, strategy);
            
            // 3. [核心] 富人搶班 (Tax The Rich)
            // 取代原本的 Active Swap，改用更激進的邏輯
            this.cycle3_taxTheRich(day, strategy);
            
            // 4. 回溯救急
            this.cycle3_backtrack(day);
            
            // 5. 修剪過剩
            this.cycle4_trimExcess(day);
            
            // 6. 日結算
            this.cycle5_dailySettlement(day);
        }
        return this.matrix;
    },

    cycle1_foundation: function(day) {
        this.staffList.forEach(staff => {
            const uid = staff.uid;
            if (this.isLocked(uid, day)) return;
            
            let limit = this.rules.policy?.maxConsDays || 6;
            if (this.rules.policy?.longLeaveAdjust && this.stats[uid].isLongLeave) {
                limit = this.rules.policy?.longLeaveMaxCons || 7;
            }
            
            if (this.stats[uid].consecutiveDays >= limit) {
                this.assign(uid, day, 'OFF'); 
            }
            // 移除慣性延續，強迫進入 Cycle 2 重新競價
        });
    },

    cycle2_scoringFill: function(day, strategy) {
        let maxIterations = 50; 
        
        const sortedShifts = Object.keys(this.shiftMap).sort((a, b) => {
            const score = code => {
                if (code === 'N') return 1;
                if (code === 'D') return 2;
                if (code === 'E') return 3;
                return 4;
            };
            return score(a) - score(b);
        });

        let totalOffSum = 0;
        this.staffList.forEach(u => totalOffSum += this.stats[u.uid].totalOff);
        const avgOff = totalOffSum / this.staffList.length;

        while (this.hasAnyGap(day) && maxIterations > 0) {
            sortedShifts.forEach(targetShift => {
                if (this.getShiftGap(day, targetShift) <= 0) return;
                const moves = this.calculateBestMoves(day, targetShift, avgOff, strategy);
                if (moves.length > 0) this.executeMove(day, moves[0]);
            });
            maxIterations--;
        }
    },

    // [v5.11 新增] 富人搶班機制 (Tax The Rich)
    // 邏輯：找出當天沒上班的「富人」，強制掃描所有班別，看能不能把「窮人」擠掉
    cycle3_taxTheRich: function(day, strategy) {
        // 1. 排序：積假越多的越前面 (富人優先)
        const richStaff = [...this.staffList].sort((a, b) => this.stats[b.uid].totalOff - this.stats[a.uid].totalOff);
        
        for (let richUser of richStaff) {
            // 如果富人今天已經有班，或是被鎖定，跳過
            if (this.isLocked(richUser.uid, day)) continue;
            const currentCode = this.matrix[richUser.uid][`current_${day}`];
            if (currentCode && currentCode !== 'OFF') continue;

            // 富人開始尋找獵物
            const shifts = Object.keys(this.shiftMap);
            for (let shiftCode of shifts) {
                // 富人能上這個班嗎？
                if (!this.checkHardRules(richUser.uid, day, shiftCode)) continue;

                // 找出這個班目前是誰在上 (潛在獵物)
                const workersOnShift = this.staffList.filter(u => 
                    this.matrix[u.uid][`current_${day}`] === shiftCode && 
                    !this.isLocked(u.uid, day)
                );

                // 排序獵物：積假最少的 (最窮的) 排前面
                workersOnShift.sort((a, b) => this.stats[a.uid].totalOff - this.stats[b.uid].totalOff);

                if (workersOnShift.length > 0) {
                    const poorUser = workersOnShift[0];
                    
                    // 只有當「富人 OFF」顯著多於「窮人 OFF」時才搶 (例如多 2 天以上)
                    // 這樣可以避免無意義的微小交換
                    if (this.stats[richUser.uid].totalOff > this.stats[poorUser.uid].totalOff + 1) {
                        
                        console.log(`💰 Tax The Rich (Day ${day}): ${richUser.name} (${this.stats[richUser.uid].totalOff}) 搶了 ${poorUser.name} (${this.stats[poorUser.uid].totalOff}) 的 ${shiftCode}`);
                        
                        // 執行交換
                        this.assign(richUser.uid, day, shiftCode);
                        this.assign(poorUser.uid, day, 'OFF'); // 窮人去休息
                        
                        break; // 富人找到工作了，停止尋找
                    }
                }
            }
        }
    },

    cycle3_backtrack: function(day) {
        const shifts = Object.keys(this.shiftMap);
        if (this.hasAnyGap(day)) {
            shifts.forEach(targetShift => {
                if (this.getShiftGap(day, targetShift) <= 0) return;
                this.attemptBacktrack(day, targetShift);
            });
        }
    },

    cycle4_trimExcess: function(day) {
        const shifts = Object.keys(this.shiftMap);
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
    },

    cycle5_dailySettlement: function(day) {
        this.staffList.forEach(u => {
            const uid = u.uid;
            if (!this.matrix[uid][`current_${day}`]) {
                this.assign(uid, day, 'OFF');
            }
            const code = this.matrix[uid][`current_${day}`];
            if (code && code !== 'OFF' && code !== 'REQ_OFF') {
                this.stats[uid].consecutiveDays++;
            } else {
                this.stats[uid].consecutiveDays = 0;
            }
            this.stats[uid].lastShiftCode = code;
        });
    },

    calculateBestMoves: function(day, targetShift, avgOff, strategy) {
        const moves = [];
        const tolerance = strategy.tol; 
        const wBal = strategy.wBal;
        const wCont = strategy.wCont;
        const wSurp = this.rules.aiParams?.w_surplus || 150;

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
                score += 100; 
                if (diff > tolerance) score += (diff * wBal * 3); 
                else if (diff < -tolerance) score -= (Math.abs(diff) * wBal * 3);
                else score += (diff * wBal);
            } else if (this.getShiftSurplus(day, currentCode) > 0) {
                score += wSurp; 
            }

            const prevCode = this.stats[uid].lastShiftCode;
            if (prevCode === targetShift) {
                score += wCont; 
            } else if (this.checkRotationPattern(prevCode, targetShift)) {
                score += (wCont * 0.5); 
            }

            score += Math.random() * 10; 
            moves.push({ uid, from: currentCode, to: targetShift, score });
        });

        return moves.sort((a, b) => b.score - a.score);
    },

    attemptBacktrack: function(day, targetShift) {
        const MAX_DEPTH = this.rules.aiParams?.backtrack_depth || 3;
        const MAX_ATTEMPTS = this.rules.aiParams?.max_attempts || 20;
        let attemptsCount = 0;

        for (let depth = 1; depth <= MAX_DEPTH; depth++) {
            const prevDay = day - depth; if (prevDay < 1) break;
            const candidates = [...this.staffList].sort(() => 0.5 - Math.random());
            
            for (let staff of candidates) {
                if (attemptsCount >= MAX_ATTEMPTS) return;
                const uid = staff.uid;
                if (this.isLocked(uid, day) || this.isLocked(uid, prevDay)) continue;
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

    assign: function(uid, day, code) {
        if(!this.matrix[uid]) this.matrix[uid] = {}; 
        const oldCode = this.matrix[uid][`current_${day}`];
        this.matrix[uid][`current_${day}`] = code;
        
        if (oldCode === 'OFF' || oldCode === 'REQ_OFF') this.stats[uid].totalOff--;
        if (code === 'OFF' || code === 'REQ_OFF') this.stats[uid].totalOff++;
    },
    executeMove: function(day, move) { this.assign(move.uid, day, move.to); },
    updateDailyStats: function(day) { },
    
    isLocked: function(uid, day) {
        const val = this.matrix[uid] ? this.matrix[uid][`current_${day}`] : null;
        return (val === 'REQ_OFF' || (val && val.startsWith('!')));
    },

    checkHardRules: function(uid, day, shiftCode, optionalPrevCode) {
        let lastCode = optionalPrevCode || this.stats[uid].lastShiftCode;
        if (this.rules.hard?.minGap11 !== false) {
            if (lastCode && !this.checkGap11(lastCode, shiftCode)) return false;
        }
        if (this.rules.hard?.protectPregnant !== false) {
            if (this.stats[uid].isPregnant || this.stats[uid].isBreastfeeding) {
                if (this.isLateShift(shiftCode)) return false;
            }
        }
        if (this.rules.policy?.limitConsecutive !== false && shiftCode !== 'OFF') {
            if (optionalPrevCode !== 'OFF') {
                let limit = this.rules.policy?.maxConsDays || 6;
                if (this.rules.policy?.longLeaveAdjust && this.stats[uid].isLongLeave) {
                    limit = this.rules.policy?.longLeaveMaxCons || 7;
                }
                if (this.stats[uid].consecutiveDays >= limit) return false;
            }
        }
        if (this.rules.policy?.bundleNightOnly !== false && this.stats[uid].canBundle) {
            const bundleCode = this.stats[uid].bundleShift;
            if (bundleCode && shiftCode !== 'OFF' && shiftCode !== bundleCode) return false;
        }
        if (!this.checkWeeklyConsistency(uid, day, shiftCode)) return false;
        return true;
    },

    checkWeeklyConsistency: function(uid, day, shiftCode) {
        if (shiftCode !== 'N' && shiftCode !== 'E') return true;
        const startDay = parseInt(this.rules.hard?.weekStartDay || 1); 
        const date = new Date(this.year, this.month - 1, day);
        let dayOfWeek = date.getDay(); 
        if (dayOfWeek === 0) dayOfWeek = 7;
        
        const daysToCheck = [];
        let checkDay = day;
        for(let i=0; i<7; i++) {
            if (checkDay < 1) break;
            const dObj = new Date(this.year, this.month - 1, checkDay);
            const dw = dObj.getDay() === 0 ? 7 : dObj.getDay();
            daysToCheck.push(checkDay);
            if (dw === startDay) break; 
            checkDay--;
        }
        for (let d of daysToCheck) {
            if (d === day) continue;
            const code = this.matrix[uid][`current_${d}`];
            if (shiftCode === 'N' && code === 'E') return false; 
            if (shiftCode === 'E' && code === 'N') return false; 
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
    fillRemainingOffs: function() { }
};
