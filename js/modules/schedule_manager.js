// js/modules/schedule_manager.js
// 🤖 AI 排班演算法引擎 (Auto-Scheduler v4.8 - Fix Missing Pre-Schedule)

const scheduleManager = {
    docId: null,
    rules: {},       // 排班規則
    staffList: [],   // 人員名單
    shifts: [],      // 班別定義
    shiftMap: {},    // 班別快速查找表 (code -> obj)
    matrix: {},      // 排班結果矩陣 { uid: { current_1: 'D', ... } }
    dailyNeeds: {},  // 每日人力需求
    stats: {},       // 即時統計 (consecutive, totalOff...)
    daysInMonth: 0,
    year: 0,
    month: 0,
    
    // 執行緒控制 (避免 UI 卡死)
    yieldToMain: () => new Promise(resolve => setTimeout(resolve, 0)),

    // --- 1. 初始化與載入 ---
    loadContext: async function(docId, collectionName = 'pre_schedules') {
        console.log(`🤖 AI Engine Loading: ${docId} from [${collectionName}]`);
        this.docId = docId;
        
        try {
            // A. 讀取主文件
            const doc = await db.collection(collectionName).doc(docId).get();
            if(!doc.exists) throw new Error("文件不存在");
            
            const data = doc.data();
            let sourceData = data; 

            // B. 若是「排班草稿」，需抓取「原始預班表」
            if (collectionName === 'schedules') {
                if (!data.sourceId) throw new Error("草稿缺少來源預班表 ID");
                console.log("🔗 Detected Draft. Fetching Source:", data.sourceId);
                
                const sourceDoc = await db.collection('pre_schedules').doc(data.sourceId).get();
                if (!sourceDoc.exists) throw new Error("原始預班表遺失");
                sourceData = sourceDoc.data();
            }

            // --- 資料組裝 ---
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
            
            // [修正] 這裡可能 assignments 是 undefined (若沒人填過)，需給預設值
            this.matrix = data.assignments || {}; 
            
            this.year = sourceData.year;
            this.month = sourceData.month;
            this.daysInMonth = new Date(this.year, this.month, 0).getDate();

            // 5. 準備統計與初始化 Matrix (關鍵步驟)
            await this.prepareContext();

            console.log(`✅ AI Context Ready. Days: ${this.daysInMonth}, Staff: ${this.staffList.length}`);
            return true;

        } catch(e) {
            console.error("AI Load Error:", e);
            alert("AI 載入失敗: " + e.message);
            return false;
        }
    },

    // --- 2. 準備階段 (Context Preparation) ---
    prepareContext: async function() {
        this.stats = {};
        
        this.staffList.forEach(u => {
            // [關鍵修正]：若該員未提交預班 (assignments 中無此 uid)，自動補上空物件
            // 這樣系統會視為他「沒有任何預班需求 (REQ_OFF)」，AI 可以自由排班
            if (!this.matrix[u.uid]) {
                this.matrix[u.uid] = {};
            }

            // 安全讀取上個月資料
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

            // 統計目前已有的 OFF
            for(let d=1; d<=this.daysInMonth; d++) {
                const val = this.matrix[u.uid][`current_${d}`];
                if(val === 'REQ_OFF' || val === 'OFF') {
                    this.stats[u.uid].totalOff++;
                }
            }
        });
    },

    // --- 3. 核心入口 ---
    runAutoSchedule: async function() {
        console.time("AutoSchedule");

        for (let day = 1; day <= this.daysInMonth; day++) {
            await this.yieldToMain();
            this.cycle1_basicAssignment(day);
            this.cycle2_smartFill(day);
            this.cycle3_trimExcess(day);
            this.updateDailyStats(day);
        }
        this.fillRemainingOffs();

        console.timeEnd("AutoSchedule");
        return this.matrix;
    },

    // --- Cycle 1: 基礎分配 ---
    cycle1_basicAssignment: function(day) {
        // 洗牌以示公平
        const shuffledStaff = [...this.staffList].sort(() => 0.5 - Math.random());

        shuffledStaff.forEach(staff => {
            const uid = staff.uid;
            
            // 這裡已經保證 matrix[uid] 存在，不會報錯
            if (this.isLocked(uid, day)) return;

            // 連六檢查
            if (this.stats[uid].consecutiveDays >= (this.rules.policy?.maxConsDays || 6)) {
                this.assign(uid, day, 'OFF');
                return;
            }

            // 延續班別
            const lastCode = this.stats[uid].lastShiftCode;
            if (lastCode && lastCode !== 'OFF' && lastCode !== 'REQ_OFF') {
                if (this.getShiftGap(day, lastCode) > 0) {
                    if (this.checkHardRules(uid, day, lastCode)) {
                        this.assign(uid, day, lastCode);
                        return;
                    }
                }
            }
        });
    },

    // --- Cycle 2: 智慧填補 ---
    cycle2_smartFill: function(day) {
        const shifts = Object.keys(this.shiftMap);
        let maxIterations = 50; 

        while (this.hasAnyGap(day) && maxIterations > 0) {
            shifts.forEach(targetShift => {
                if (this.getShiftGap(day, targetShift) <= 0) return;

                const moves = this.calculateBestMoves(day, targetShift);
                
                if (moves.length > 0) {
                    const bestMove = moves[0];
                    this.executeMove(day, bestMove);
                }
            });
            maxIterations--;
        }
    },

    // --- Cycle 3: 修剪超額 ---
    cycle3_trimExcess: function(day) {
        const shifts = Object.keys(this.shiftMap);
        
        shifts.forEach(shiftCode => {
            let surplus = this.getShiftSurplus(day, shiftCode);
            if (surplus <= 0) return;

            // 找出當天排這個班的所有人
            const staffOnShift = this.staffList.filter(u => 
                this.matrix[u.uid] && // 防呆
                this.matrix[u.uid][`current_${day}`] === shiftCode && 
                !this.isLocked(u.uid, day)
            );

            // 積假少的優先休
            staffOnShift.sort((a, b) => this.stats[a.uid].totalOff - this.stats[b.uid].totalOff);

            for (let i = 0; i < surplus && i < staffOnShift.length; i++) {
                this.assign(staffOnShift[i].uid, day, 'OFF');
            }
        });
    },

    // --- 4. 動作執行與計分 ---

    assign: function(uid, day, code) {
        // 雙重保險
        if(!this.matrix[uid]) this.matrix[uid] = {}; 
        
        const oldCode = this.matrix[uid][`current_${day}`];
        this.matrix[uid][`current_${day}`] = code;
        
        if (oldCode === 'OFF' || oldCode === 'REQ_OFF') this.stats[uid].totalOff--;
        if (code === 'OFF' || code === 'REQ_OFF') this.stats[uid].totalOff++;
    },

    executeMove: function(day, move) {
        this.assign(move.uid, day, move.to);
    },

    calculateBestMoves: function(day, targetShift) {
        const moves = [];
        
        this.staffList.forEach(staff => {
            const uid = staff.uid;
            // 這裡也防呆，確保安全
            if (!this.matrix[uid]) this.matrix[uid] = {};

            if (this.isLocked(uid, day)) return;

            const currentCode = this.matrix[uid][`current_${day}`] || null; 
            if (currentCode === targetShift) return; 

            if (!this.checkHardRules(uid, day, targetShift)) return;

            let score = 0;

            // 策略: 從 OFF 抓人 (優先抓假多的)
            if (!currentCode || currentCode === 'OFF') {
                score += 100;
                score += (this.stats[uid].totalOff * 5); 
            }
            // 策略: 從超額班別抓人
            else if (this.getShiftSurplus(day, currentCode) > 0) {
                score += 200; 
            }
            
            const prevCode = this.stats[uid].lastShiftCode;
            if (this.checkRotationPattern(prevCode, targetShift)) {
                score += 50;
            }

            if (this.stats[uid].consecutiveDays > 4) {
                score -= 50; 
            }

            moves.push({ uid, from: currentCode, to: targetShift, score });
        });

        return moves.sort((a, b) => b.score - a.score);
    },

    updateDailyStats: function(day) {
        this.staffList.forEach(u => {
            // 安全讀取
            const code = this.matrix[u.uid] ? this.matrix[u.uid][`current_${day}`] : null;
            
            if (code && code !== 'OFF' && code !== 'REQ_OFF') {
                this.stats[u.uid].consecutiveDays++;
            } else {
                this.stats[u.uid].consecutiveDays = 0;
            }
            this.stats[u.uid].lastShiftCode = code;
        });
    },

    // --- 5. 驗證與規則檢查 ---

    isLocked: function(uid, day) {
        // 安全讀取
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
        const start = sh + sm/60;
        const end = eh + em/60;
        
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

    // --- 6. 供需計算 ---

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
            // [關鍵防呆]：確保 matrix[u.uid] 存在再讀取
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
