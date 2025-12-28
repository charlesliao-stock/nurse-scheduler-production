// js/modules/schedule_manager.js
// 🤖 AI 排班演算法引擎 (Auto-Scheduler v4.6 - Full Logic)

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

    // --- 1. 初始化與載入 (支援草稿讀取) ---
    loadContext: async function(docId, collectionName = 'pre_schedules') {
        console.log(`🤖 AI Engine Loading: ${docId} from [${collectionName}]`);
        this.docId = docId;
        
        try {
            // A. 讀取主文件 (預班表或排班草稿)
            const doc = await db.collection(collectionName).doc(docId).get();
            if(!doc.exists) throw new Error("文件不存在");
            
            const data = doc.data();
            let sourceData = data; // 預設來源就是自己

            // B. 若是「排班草稿」，需抓取「原始預班表」以取得規則與需求
            if (collectionName === 'schedules') {
                if (!data.sourceId) throw new Error("草稿缺少來源預班表 ID (sourceId)");
                console.log("🔗 Detected Draft. Fetching Source:", data.sourceId);
                
                const sourceDoc = await db.collection('pre_schedules').doc(data.sourceId).get();
                if (!sourceDoc.exists) throw new Error("原始預班表遺失");
                sourceData = sourceDoc.data();
            }

            // --- 資料組裝 ---
            
            // 1. 規則與需求 (來自 Source)
            if(sourceData.rules) {
                this.rules = sourceData.rules;
            } else {
                // 若 Source 沒存規則，則去 Unit 抓最新版
                const unitDoc = await db.collection('units').doc(sourceData.unitId).get();
                this.rules = unitDoc.data().schedulingRules || {};
            }
            this.dailyNeeds = sourceData.dailyNeeds || {};

            // 2. 班別定義 (來自 Unit)
            const shiftsSnap = await db.collection('shifts').where('unitId', '==', sourceData.unitId).get();
            this.shifts = shiftsSnap.docs.map(d => d.data());
            this.shiftMap = {};
            this.shifts.forEach(s => this.shiftMap[s.code] = s);

            // 3. 人員與目前排班狀態 (來自 Data - 即草稿本身)
            this.staffList = data.staffList || [];
            this.matrix = data.assignments || {}; 
            
            // 4. 時間參數 (來自 Source)
            this.year = sourceData.year;
            this.month = sourceData.month;
            this.daysInMonth = new Date(this.year, this.month, 0).getDate();

            // 5. 準備統計狀態
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
            // 讀取上個月最後一天 (作為銜接)
            const lastShift = this.matrix[u.uid]?.['last_0'] || null;
            
            this.stats[u.uid] = {
                consecutiveDays: (lastShift && lastShift !== 'OFF') ? 1 : 0,
                totalOff: 0,
                lastShiftCode: lastShift,
                // 特殊身份讀取
                isPregnant: u.schedulingParams?.isPregnant || false,
                isBreastfeeding: u.schedulingParams?.isBreastfeeding || false,
                canBundle: u.schedulingParams?.canBundleShifts || false,
                // 從 Preferences 讀取包班意願
                bundleShift: this.matrix[u.uid]?.preferences?.bundleShift || null
            };

            // 預先統計目前已有的 OFF (含預班與已排班)
            for(let d=1; d<=this.daysInMonth; d++) {
                const val = this.matrix[u.uid]?.[`current_${d}`];
                if(val === 'REQ_OFF' || val === 'OFF') {
                    this.stats[u.uid].totalOff++;
                }
            }
        });
    },

    // --- 3. 核心入口 (Main Loop) ---
    runAutoSchedule: async function() {
        console.time("AutoSchedule");

        // 逐日推進
        for (let day = 1; day <= this.daysInMonth; day++) {
            
            // [效能優化] 每處理一天，釋放主執行緒
            await this.yieldToMain();

            // Cycle 1: 基礎分配 (延續與填空)
            this.cycle1_basicAssignment(day);

            // Cycle 2: 智慧填補 (解決缺額)
            this.cycle2_smartFill(day);

            // Cycle 3: 修剪超額 (解決多餘人力)
            this.cycle3_trimExcess(day);
            
            // 結算當日狀態 (更新 consecutive, lastShift)
            this.updateDailyStats(day);
        }

        // 最後檢查：補滿剩餘空位為 OFF
        this.fillRemainingOffs();

        console.timeEnd("AutoSchedule");
        return this.matrix;
    },

    // --- Cycle 1: 基礎分配 ---
    cycle1_basicAssignment: function(day) {
        // 取得當日需排班的優先順序 (依規則或固定 N -> E -> D)
        // 這裡簡化，直接根據 ShiftMap 順序或固定順序
        // 未來可從 rules.pattern.rotationOrder 解析
        const targetShifts = ['N', 'E', 'D', 'DL']; 

        // 隨機打亂員工順序 (公平性)
        const shuffledStaff = [...this.staffList].sort(() => 0.5 - Math.random());

        shuffledStaff.forEach(staff => {
            const uid = staff.uid;
            
            // 1. 鎖定檢查：若有預班，跳過
            if (this.isLocked(uid, day)) return;

            // 2. 硬規則檢查 (連六)
            if (this.stats[uid].consecutiveDays >= (this.rules.policy?.maxConsDays || 6)) {
                this.assign(uid, day, 'OFF');
                return;
            }

            // 3. 嘗試延續 (Continuity)
            // 如果昨天有上班，今天優先嘗試排一樣的 (降低疲勞 & 換班成本)
            const lastCode = this.stats[uid].lastShiftCode;
            if (lastCode && lastCode !== 'OFF' && lastCode !== 'REQ_OFF') {
                // 檢查該班別是否還有缺額
                if (this.getShiftGap(day, lastCode) > 0) {
                    if (this.checkHardRules(uid, day, lastCode)) {
                        this.assign(uid, day, lastCode);
                        return;
                    }
                }
            }

            // 4. 若無法延續，暫時留白，留待 Cycle 2 填補
        });
    },

    // --- Cycle 2: 智慧填補 (最複雜核心) ---
    cycle2_smartFill: function(day) {
        // 取得本單位所有班別代號
        const shifts = Object.keys(this.shiftMap);
        
        let maxIterations = 50; // 防止無窮迴圈保險

        while (this.hasAnyGap(day) && maxIterations > 0) {
            
            // 對於每一個有缺額的班別
            shifts.forEach(targetShift => {
                if (this.getShiftGap(day, targetShift) <= 0) return;

                // 計算所有候選人的「移動分數」
                const moves = this.calculateBestMoves(day, targetShift);
                
                if (moves.length > 0) {
                    // 執行最高分的移動 (Strategy A or B)
                    const bestMove = moves[0];
                    this.executeMove(day, bestMove);
                } else {
                    // 若無直接解，這裡可以加入 Panic Mode (強制抓人)
                    // 暫時略過，保留空缺讓管理者手動處理
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

            // 找出當天排這個班的所有人 (排除鎖定者)
            const staffOnShift = this.staffList.filter(u => 
                this.matrix[u.uid][`current_${day}`] === shiftCode && 
                !this.isLocked(u.uid, day)
            );

            // 排序：積假最少的人優先踢去休假 (Total OFF ASC)
            // 這樣可以讓 OFF 數較少的人獲得休假，平衡積假
            staffOnShift.sort((a, b) => this.stats[a.uid].totalOff - this.stats[b.uid].totalOff);

            // 執行修剪
            for (let i = 0; i < surplus && i < staffOnShift.length; i++) {
                this.assign(staffOnShift[i].uid, day, 'OFF');
            }
        });
    },

    // --- 4. 動作執行與計分 ---

    assign: function(uid, day, code) {
        if(!this.matrix[uid]) this.matrix[uid] = {};
        const oldCode = this.matrix[uid][`current_${day}`];
        
        // 更新矩陣
        this.matrix[uid][`current_${day}`] = code;
        
        // 即時維護 Total OFF 統計
        if (oldCode === 'OFF' || oldCode === 'REQ_OFF') this.stats[uid].totalOff--;
        if (code === 'OFF' || code === 'REQ_OFF') this.stats[uid].totalOff++;
    },

    executeMove: function(day, move) {
        // move 結構: { uid, from: 'OFF'/'D', to: 'N', score }
        this.assign(move.uid, day, move.to);
    },

    calculateBestMoves: function(day, targetShift) {
        const moves = [];
        
        this.staffList.forEach(staff => {
            const uid = staff.uid;
            if (this.isLocked(uid, day)) return;

            const currentCode = this.matrix[uid][`current_${day}`] || null; // null 為未排
            if (currentCode === targetShift) return; // 已經是該班

            // 硬規則檢查
            if (!this.checkHardRules(uid, day, targetShift)) return;

            // 計分邏輯
            let score = 0;

            // 策略 A: 從 OFF (或未排) 抓人
            if (!currentCode || currentCode === 'OFF') {
                score += 100;
                // 積假越多，越容易被抓回來上班 (平衡 OFF)
                score += (this.stats[uid].totalOff * 5); 
            }
            // 策略 B: 從超額班別抓人 (Swap Surplus)
            else if (this.getShiftSurplus(day, currentCode) > 0) {
                score += 200; // 優先級最高 (解決兩邊問題)
            }
            
            // 策略 C: 順向輪替加分
            const prevCode = this.stats[uid].lastShiftCode;
            if (this.checkRotationPattern(prevCode, targetShift)) {
                score += 50;
            }

            // 策略 D: 避免連續上班過多
            if (this.stats[uid].consecutiveDays > 4) {
                score -= 50; // 連上很多天了，盡量別再排
            }

            moves.push({ uid, from: currentCode, to: targetShift, score });
        });

        // 分數高到低排序
        return moves.sort((a, b) => b.score - a.score);
    },

    updateDailyStats: function(day) {
        this.staffList.forEach(u => {
            const code = this.matrix[u.uid][`current_${day}`];
            
            // 更新連續上班天數
            if (code && code !== 'OFF' && code !== 'REQ_OFF') {
                this.stats[u.uid].consecutiveDays++;
            } else {
                this.stats[u.uid].consecutiveDays = 0;
            }
            
            // 更新上一班 (供明天判斷 11 小時)
            this.stats[u.uid].lastShiftCode = code;
        });
    },

    // --- 5. 驗證與規則檢查 (Validator) ---

    isLocked: function(uid, day) {
        const val = this.matrix[uid]?.[`current_${day}`];
        // 預班 (REQ_OFF) 或 勿排 (!X) 視為鎖定，AI 不可動
        // 若未來支援管理者手動鎖定 (Locked)，也可加在此處
        return (val === 'REQ_OFF' || (val && val.startsWith('!')));
    },

    checkHardRules: function(uid, day, shiftCode) {
        // 1. 11 小時休息
        const lastCode = this.stats[uid].lastShiftCode;
        if (lastCode && !this.checkGap11(lastCode, shiftCode)) return false;

        // 2. 懷孕/哺乳保護 (禁夜班)
        if (this.stats[uid].isPregnant || this.stats[uid].isBreastfeeding) {
            if (this.isLateShift(shiftCode)) return false;
        }

        // 3. 連續上班限制 (若今日上班會導致 > Max)
        if (shiftCode !== 'OFF') {
            if (this.stats[uid].consecutiveDays >= (this.rules.policy?.maxConsDays || 6)) return false;
        }

        // 4. 包班限制
        if (this.rules.policy?.bundleNightOnly && this.stats[uid].canBundle) {
            const bundleCode = this.stats[uid].bundleShift;
            // 如果此人有包班 (e.g., 'N')
            // 規則：若是上班日(非OFF)，且要排的班(shiftCode)不等於包的班(bundleCode)，則禁止
            if (bundleCode && shiftCode !== 'OFF' && shiftCode !== bundleCode) return false;
        }

        return true;
    },

    checkGap11: function(prev, curr) {
        if (!prev || prev === 'OFF' || prev === 'REQ_OFF') return true;
        if (curr === 'OFF' || curr === 'REQ_OFF') return true;
        
        // 簡單的時間判斷 (實務上建議用 Moment.js 或完整時間計算)
        // 這裡針對常見違規做阻擋
        if (prev === 'E' && curr === 'D') return false; // 小夜接白班 (00:30 -> 08:00 = 7.5hr)
        if (prev === 'N' && curr === 'D') return false; // 大夜接白班 (追班)
        if (prev === 'N' && curr === 'E') return false; // 大夜接小夜 (08:00 -> 16:00 = 8hr)
        
        return true;
    },

    isLateShift: function(code) {
        const s = this.shiftMap[code];
        if (!s) return false;
        // 判斷是否跨夜或在 22-06 區間
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        const start = sh + sm/60;
        const end = eh + em/60;
        
        if (end < start) return true; // 跨夜
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
        
        // 簡單判斷：往右移動 (index 增加) 或 循環 (最後接第一)
        if (idxCurr === idxPrev + 1) return true;
        if (idxPrev === order.length - 1 && idxCurr === 0) return true;
        
        return false;
    },

    // --- 6. 供需計算 ---

    getShiftGap: function(day, code) {
        // 需求 - 現有
        const needed = this.getDemand(day, code);
        const current = this.countStaff(day, code);
        return needed - current;
    },

    getShiftSurplus: function(day, code) {
        // 現有 - 需求
        const needed = this.getDemand(day, code);
        const current = this.countStaff(day, code);
        return current - needed;
    },

    getDemand: function(day, code) {
        // 從 dailyNeeds 取得
        // 計算星期幾 (0=Sun, 1=Mon... 6=Sat)
        const date = new Date(this.year, this.month - 1, day);
        const dayOfWeek = date.getDay(); 
        
        // 轉換為 dailyNeeds 的 key 格式 "CODE_X"
        // 注意：UI 上的 dailyNeeds 是依據 column index 存的 (0~6)
        // 假設 UI 上 0 是週一，6 是週日 (視 UI 定義而定)
        // 這裡假設 dailyNeeds key: "CODE_0" 是週一 ... "CODE_6" 是週日
        const uiDayIndex = (dayOfWeek === 0) ? 6 : dayOfWeek - 1; // 將 JS 的 Sun(0) 轉為 UI 的 6 (Sun)
        
        const key = `${code}_${uiDayIndex}`;
        return this.dailyNeeds[key] || 0; 
    },

    countStaff: function(day, code) {
        let count = 0;
        this.staffList.forEach(u => {
            if (this.matrix[u.uid][`current_${day}`] === code) count++;
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
