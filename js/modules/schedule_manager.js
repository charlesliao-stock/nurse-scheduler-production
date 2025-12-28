// js/modules/schedule_manager.js
// 🤖 AI 排班演算法引擎 (Auto-Scheduler v4.9 - Multi-Options & Draft Support)

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
            
            // 安全讀取
            const lastShift = this.matrix[u.uid]['last_0'] || null;
            const pref = this.matrix[u.uid].preferences || {};

            this.stats[u.uid] = {
                consecutiveDays: (lastShift && lastShift !== 'OFF') ? 1 : 0,
                totalOff: 0,
                lastShiftCode: lastShift,
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

    // --- [新增] 生成 3 種方案 ---
    generateOptions: async function() {
        const options = [];
        const strategies = [
            { name: "方案 A (均衡優先)", type: 'balanced' },
            { name: "方案 B (隨機探索)", type: 'random1' },
            { name: "方案 C (隨機探索 II)", type: 'random2' }
        ];

        // 備份原始 Matrix (因為每次跑都會修改 this.matrix)
        const originalMatrix = JSON.parse(JSON.stringify(this.matrix));
        const originalStats = JSON.parse(JSON.stringify(this.stats));

        for (let strategy of strategies) {
            // 1. 還原狀態
            this.matrix = JSON.parse(JSON.stringify(originalMatrix));
            this.stats = JSON.parse(JSON.stringify(originalStats));

            // 2. 執行排班
            await this.runAutoSchedule();

            // 3. 評估結果
            const metrics = this.evaluateResult();
            
            // 4. 儲存結果
            options.push({
                name: strategy.name,
                assignments: JSON.parse(JSON.stringify(this.matrix)), // 深拷貝結果
                metrics: metrics
            });
        }

        // 還原回最後一個狀態 (或初始狀態)
        this.matrix = originalMatrix;
        this.stats = originalStats;

        return options;
    },

    evaluateResult: function() {
        let totalOffs = [];
        let totalNights = []; // 大夜 + 小夜
        
        this.staffList.forEach(u => {
            let off = 0;
            let night = 0;
            for(let d=1; d<=this.daysInMonth; d++) {
                const code = this.matrix[u.uid][`current_${d}`];
                if(code === 'OFF' || code === 'REQ_OFF') off++;
                else if(code === 'N' || code === 'E') night++;
            }
            totalOffs.push(off);
            totalNights.push(night);
        });

        // 計算標準差 (Standard Deviation) - 越小越平均
        const stdDev = (arr) => {
            const n = arr.length;
            if(n === 0) return 0;
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
    runAutoSchedule: async function() {
        for (let day = 1; day <= this.daysInMonth; day++) {
            // await this.yieldToMain(); // 跑多次時若不卡頓可先拿掉，或減少頻率
            this.cycle1_basicAssignment(day);
            this.cycle2_smartFill(day);
            this.cycle3_trimExcess(day);
            this.updateDailyStats(day);
        }
        this.fillRemainingOffs();
        return this.matrix;
    },

    // --- Cycles (邏輯與之前相同，但確保 shuffledStaff 每次都隨機) ---
    cycle1_basicAssignment: function(day) {
        // [關鍵] 每次呼叫都重新洗牌，這就是產生不同結果的來源
        const shuffledStaff = [...this.staffList].sort(() => 0.5 - Math.random());

        shuffledStaff.forEach(staff => {
            const uid = staff.uid;
            if (this.isLocked(uid, day)) return;
            if (this.stats[uid].consecutiveDays >= (this.rules.policy?.maxConsDays || 6)) {
                this.assign(uid, day, 'OFF');
                return;
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

    cycle2_smartFill: function(day) {
        const shifts = Object.keys(this.shiftMap);
        let maxIterations = 50; 
        while (this.hasAnyGap(day) && maxIterations > 0) {
            shifts.forEach(targetShift => {
                if (this.getShiftGap(day, targetShift) <= 0) return;
                const moves = this.calculateBestMoves(day, targetShift);
                if (moves.length > 0) {
                    const bestMove = moves[0]; // 這裡可以加隨機性：有時候選第二好的
                    this.executeMove(day, bestMove);
                }
            });
            maxIterations--;
        }
    },

    cycle3_trimExcess: function(day) {
        const shifts = Object.keys(this.shiftMap);
        shifts.forEach(shiftCode => {
            let surplus = this.getShiftSurplus(day, shiftCode);
            if (surplus <= 0) return;
            const staffOnShift = this.staffList.filter(u => 
                this.matrix[u.uid] && 
                this.matrix[u.uid][`current_${day}`] === shiftCode && 
                !this.isLocked(u.uid, day)
            );
            staffOnShift.sort((a, b) => this.stats[a.uid].totalOff - this.stats[b.uid].totalOff);
            for (let i = 0; i < surplus && i < staffOnShift.length; i++) {
                this.assign(staffOnShift[i].uid, day, 'OFF');
            }
        });
    },

    // --- 輔助函式 ---
    assign: function(uid, day, code) {
        if(!this.matrix[uid]) this.matrix[uid] = {}; 
        const oldCode = this.matrix[uid][`current_${day}`];
        this.matrix[uid][`current_${day}`] = code;
        if (oldCode === 'OFF' || oldCode === 'REQ_OFF') this.stats[uid].totalOff--;
        if (code === 'OFF' || code === 'REQ_OFF') this.stats[uid].totalOff++;
    },

    executeMove: function(day, move) { this.assign(move.uid, day, move.to); },

    calculateBestMoves: function(day, targetShift) {
        const moves = [];
        this.staffList.forEach(staff => {
            const uid = staff.uid;
            if (!this.matrix[uid]) this.matrix[uid] = {};
            if (this.isLocked(uid, day)) return;
            const currentCode = this.matrix[uid][`current_${day}`] || null; 
            if (currentCode === targetShift) return; 
            if (!this.checkHardRules(uid, day, targetShift)) return;

            let score = 0;
            if (!currentCode || currentCode === 'OFF') {
                score += 100;
                score += (this.stats[uid].totalOff * 5); 
            } else if (this.getShiftSurplus(day, currentCode) > 0) {
                score += 200; 
            }
            const prevCode = this.stats[uid].lastShiftCode;
            if (this.checkRotationPattern(prevCode, targetShift)) score += 50;
            if (this.stats[uid].consecutiveDays > 4) score -= 50; 
            moves.push({ uid, from: currentCode, to: targetShift, score });
        });
        return moves.sort((a, b) => b.score - a.score);
    },

    updateDailyStats: function(day) {
        this.staffList.forEach(u => {
            const code = this.matrix[u.uid] ? this.matrix[u.uid][`current_${day}`] : null;
            if (code && code !== 'OFF' && code !== 'REQ_OFF') this.stats[u.uid].consecutiveDays++;
            else this.stats[u.uid].consecutiveDays = 0;
            this.stats[u.uid].lastShiftCode = code;
        });
    },

    // Validator & Getters
    isLocked: function(uid, day) {
        const val = this.matrix[uid] ? this.matrix[uid][`current_${day}`] : null;
        return (val === 'REQ_OFF' || (val && val.startsWith('!')));
    },
    checkHardRules: function(uid, day, shiftCode) {
        const lastCode = this.stats[uid].lastShiftCode;
        if (lastCode && !this.checkGap11(lastCode, shiftCode)) return false;
        if (this.stats[uid].isPregnant || this.stats[uid].isBreastfeeding) {
            if (this.isLateShift(shiftCode)) return false;
        }
        if (shiftCode !== 'OFF') {
            if (this.stats[uid].consecutiveDays >= (this.rules.policy?.maxConsDays || 6)) return false;
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
