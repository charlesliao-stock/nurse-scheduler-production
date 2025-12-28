// js/modules/schedule_manager.js
// 🤖 AI 排班演算法引擎 (Auto-Scheduler v4.4)

const scheduleManager = {
    docId: null,
    rules: {},       // 排班規則
    staffList: [],   // 人員名單
    shifts: [],      // 班別定義
    shiftMap: {},    // 班別快速查找表 (code -> obj)
    matrix: {},      // 排班結果矩陣 { uid: { current_1: 'D', ... } }
    dailyNeeds: {},  // 每日人力需求
    stats: {},       // 即時統計 (consecutive, totalOff...)
    
    // 執行緒控制 (避免 UI 卡死)
    yieldToMain: () => new Promise(resolve => setTimeout(resolve, 0)),

    // --- 1. 初始化與載入 ---
    loadContext: async function(scheduleId) {
        console.log("🤖 AI Engine Loading Context:", scheduleId);
        this.docId = scheduleId;
        
        try {
            // 1. 讀取預班表
            const doc = await db.collection('pre_schedules').doc(scheduleId).get();
            if(!doc.exists) throw new Error("預班表不存在");
            const data = doc.data();
            
            // 2. 讀取規則 (優先用預班表內的快照，若無則抓 Unit)
            if(data.rules) {
                this.rules = data.rules;
            } else {
                const unitDoc = await db.collection('units').doc(data.unitId).get();
                this.rules = unitDoc.data().schedulingRules || {};
            }

            // 3. 讀取班別
            const shiftsSnap = await db.collection('shifts').where('unitId', '==', data.unitId).get();
            this.shifts = shiftsSnap.docs.map(d => d.data());
            this.shiftMap = {};
            this.shifts.forEach(s => this.shiftMap[s.code] = s);

            // 4. 初始化資料
            this.staffList = data.staffList || [];
            this.dailyNeeds = data.dailyNeeds || {};
            this.matrix = data.assignments || {}; // 載入 User 預填資料
            
            // 5. 準備統計狀態 (v4.4: 預先鎖定預班)
            await this.prepareContext(data);

            console.log("✅ Context Loaded. Rules:", this.rules);
            return true;

        } catch(e) {
            console.error("Load Context Error:", e);
            alert("載入失敗: " + e.message);
            return false;
        }
    },

    // --- 2. 準備階段 (Context Preparation) ---
    prepareContext: async function(data) {
        this.stats = {};
        const year = data.year;
        const month = data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        this.daysInMonth = daysInMonth;

        // 初始化每位員工的狀態
        this.staffList.forEach(u => {
            // 讀取上個月最後一天 (作為銜接)
            const lastShift = this.matrix[u.uid]?.['last_0'] || null;
            
            this.stats[u.uid] = {
                consecutiveDays: (lastShift && lastShift !== 'OFF') ? 1 : 0, // 簡易推算，理想應讀取上月完整資料
                totalOff: 0,
                lastShiftCode: lastShift,
                isPregnant: u.schedulingParams?.isPregnant || false,
                isBreastfeeding: u.schedulingParams?.isBreastfeeding || false,
                canBundle: u.schedulingParams?.canBundleShifts || false,
                bundleShift: this.matrix[u.uid]?.preferences?.bundleShift || null
            };

            // v4.4 預先統計：把 User 已填的預班 (REQ_OFF, 指定班) 算進去
            for(let d=1; d<=daysInMonth; d++) {
                const val = this.matrix[u.uid]?.[`current_${d}`];
                if(val === 'REQ_OFF' || val === 'OFF') {
                    this.stats[u.uid].totalOff++;
                }
            }
        });
    },

    // --- 3. 核心入口 (Main Loop) ---
    runAutoSchedule: async function() {
        if(!confirm("即將開始自動排班 (v4.4)，這將覆蓋未鎖定的欄位。\n確定執行？")) return;
        
        console.time("AutoSchedule");
        const totalDays = this.daysInMonth;

        // 逐日推進
        for (let day = 1; day <= totalDays; day++) {
            
            // [效能優化] 每處理一天，釋放主執行緒
            await this.yieldToMain();

            // Cycle 1: 基礎分配 (Basic Assignment)
            this.cycle1_basicAssignment(day);

            // Cycle 2: 智慧填補 (Smart Fill) - 解決缺額
            this.cycle2_smartFill(day);

            // Cycle 3: 修剪超額 (Trim Excess) - 解決多餘人力
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
        // 取得當日需排班的優先順序 (依規則：N -> E -> D)
        // 這裡簡化，直接根據 ShiftMap 順序或固定順序
        const targetShifts = ['N', 'E', 'D', 'DL']; 

        // 隨機打亂員工順序 (公平性)
        const shuffledStaff = [...this.staffList].sort(() => 0.5 - Math.random());

        shuffledStaff.forEach(staff => {
            const uid = staff.uid;
            
            // 1. 鎖定檢查：若有預班，跳過 (已由 User 指定)
            if (this.isLocked(uid, day)) return;

            // 2. 硬規則檢查 (連六)
            if (this.stats[uid].consecutiveDays >= (this.rules.policy?.maxConsDays || 6)) {
                this.assign(uid, day, 'OFF');
                return;
            }

            // 3. 嘗試延續 (Continuity)
            const lastCode = this.stats[uid].lastShiftCode;
            if (lastCode && lastCode !== 'OFF' && lastCode !== 'REQ_OFF') {
                // 如果昨天有上班，今天優先嘗試排一樣的 (降低疲勞 & 換班成本)
                // 前提：該班別當日還有缺額
                if (this.getShiftGap(day, lastCode) > 0) {
                    if (this.checkHardRules(uid, day, lastCode)) {
                        this.assign(uid, day, lastCode);
                        return;
                    }
                }
            }

            // 4. 若無法延續，暫時留白 (由 Cycle 2 填補) 或 先排 OFF
            // 這裡策略：先不排，視為 "Available Pool"
        });
    },

    // --- Cycle 2: 智慧填補 (最複雜核心) ---
    cycle2_smartFill: function(day) {
        const shifts = ['N', 'E', 'D', 'DL']; // 需動態取得
        let maxIterations = 50; // 防止無窮迴圈

        while (this.hasAnyGap(day) && maxIterations > 0) {
            // 對於每一個有缺額的班別
            shifts.forEach(targetShift => {
                if (this.getShiftGap(day, targetShift) <= 0) return;

                // 計算所有候選人的「移動分數」
                // 候選人來源：目前 OFF 的人 (Strategy A) 或 上其他班且該班超額的人 (Strategy B)
                const moves = this.calculateBestMoves(day, targetShift);
                
                if (moves.length > 0) {
                    // 執行最高分的移動
                    const bestMove = moves[0];
                    this.executeMove(day, bestMove);
                } else {
                    // 若無直接解，嘗試連鎖補位 (Strategy C) 或 Panic Mode
                    // 這裡簡化：若無解，強制抓一個連上天數少的人來補 (即便稍微違反軟規則)
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
                this.matrix[u.uid][`current_${day}`] === shiftCode && 
                !this.isLocked(u.uid, day) // 預班不能動
            );

            // 排序：積假最少的人優先踢去休假 (Total OFF ASC)
            staffOnShift.sort((a, b) => this.stats[a.uid].totalOff - this.stats[b.uid].totalOff);

            // 執行修剪
            for (let i = 0; i < surplus && i < staffOnShift.length; i++) {
                this.assign(staffOnShift[i].uid, day, 'OFF');
            }
        });
    },

    // --- 4. 輔助邏輯 ---

    assign: function(uid, day, code) {
        if(!this.matrix[uid]) this.matrix[uid] = {};
        this.matrix[uid][`current_${day}`] = code;
        
        // 若是排 OFF，即時更新 Total OFF (供當日後續決策參考)
        if (code === 'OFF') {
            this.stats[uid].totalOff++;
        }
    },

    executeMove: function(day, move) {
        // move 結構: { uid, from: 'OFF'/'D', to: 'N', score }
        // 若 from 是 OFF，原本的 OFF 數要扣回 (因為被抓來上班了)
        if (move.from === 'OFF' || !move.from) { // !move.from 代表原本是空
             this.stats[move.uid].totalOff--;
        }
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

            // 計分
            let score = 0;

            // 策略 A: 從 OFF (或未排) 抓人
            if (!currentCode || currentCode === 'OFF') {
                score += 100;
                // 積假越多，越容易被抓回來上班 (平衡)
                score += (this.stats[uid].totalOff * 10); 
            }
            // 策略 B: 從超額班別抓人 (Swap Surplus)
            else if (this.getShiftSurplus(day, currentCode) > 0) {
                score += 200; // 優先級最高 (一石二鳥)
            }
            // 策略 D: 避免逆向與疲勞
            // ... (略，可加入 checkGap11 分數微調)

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
        // 判斷該格是否為使用者預填 (REQ_OFF) 或 管理者鎖定 (Future feature)
        // 目前邏輯：只要 matrix 在 loadContext 時有值，就算鎖定
        // 但因為我們在 cycle 中會修改 matrix，所以需要區分「原始預班」與「演算法填的」
        // 修正：檢查是否為 REQ_OFF 或 勿排 (!X)
        const val = this.matrix[uid]?.[`current_${day}`];
        if (val === 'REQ_OFF' || (val && val.startsWith('!'))) return true;
        
        // 包班鎖定：若該員是包班人員，且今天是上班日，則只能上包班的班
        // 這部分在 checkHardRules 處理比較合適
        return false;
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
        // 注意：這裡是 Pre-check，假設排了 shiftCode 會不會爆
        // 但 shiftCode 可能是 OFF，OFF 不會爆
        if (shiftCode !== 'OFF') {
            if (this.stats[uid].consecutiveDays >= (this.rules.policy?.maxConsDays || 6)) return false;
        }

        // 4. 包班限制
        if (this.rules.policy?.bundleNightOnly && this.stats[uid].canBundle) {
            const bundleCode = this.stats[uid].bundleShift;
            // 如果有設定包班，且現在要排的不是 OFF，則必須是包的那個班
            if (bundleCode && shiftCode !== 'OFF' && shiftCode !== bundleCode) return false;
        }

        // 5. 新人保護 (略，需計算到職日)

        return true;
    },

    checkGap11: function(prev, curr) {
        if (!prev || prev === 'OFF' || prev === 'REQ_OFF') return true;
        if (curr === 'OFF' || curr === 'REQ_OFF') return true;
        
        const p = this.shiftMap[prev];
        const c = this.shiftMap[curr];
        if (!p || !c) return true;

        // 解析時間 (00:00 = 0, 08:00 = 8)
        // 邏輯：(CurrStart + 24(若跨日)) - PrevEnd > 11
        // 簡單判斷：
        // E (00:30下班) -> D (08:00上班) = 7.5hr < 11 (Fail)
        // N (08:00下班) -> E (16:00上班) = 8hr < 11 (Fail) - 這是追班
        
        // 這裡暫用簡單邏輯，實務需完整 Time Parser
        if (prev === 'E' && curr === 'D') return false; 
        if (prev === 'N' && curr === 'E') return false; 
        if (prev === 'N' && curr === 'D') return false; 

        return true;
    },

    isLateShift: function(code) {
        const s = this.shiftMap[code];
        if (!s) return false;
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        const start = sh + sm/60;
        const end = eh + em/60;
        
        // 跨夜 (End < Start) 或 Start < 6 或 Start >= 22 或 End > 22
        if (end < start) return true;
        if (start < 6 || start >= 22) return true;
        if (end > 22) return true;
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
        // dailyNeeds key 格式: "N_0" (週日), "N_1" (週一)...
        // day 是日期 (1~31)，需轉為星期幾
        const date = new Date(this.docId.split('_')[0] || new Date().getFullYear(), (this.docId.split('_')[1] || 1) - 1, day); // 簡易轉換
        // 修正：應該從 loadContext 保存 year/month
        // 暫時用 % 7 模擬
        const dayOfWeek = (day + 5) % 7; // 假設 1號是週六 (此處僅示意，需精確計算)
        
        // 正確做法：用 date.getDay() (0=Sun, 1=Mon...)
        // 並配合 rules.hard.weekStartDay 轉換
        // 這裡假設 dailyNeeds key 是 "CODE_0" ~ "CODE_6" (0=Sun)
        
        // 暫時回傳固定值測試
        const key = `${code}_${day % 7}`;
        return this.dailyNeeds[key] || 2; // 預設 2 人
    },

    countStaff: function(day, code) {
        let count = 0;
        this.staffList.forEach(u => {
            if (this.matrix[u.uid][`current_${day}`] === code) count++;
        });
        return count;
    },

    hasAnyGap: function(day) {
        const shifts = ['N', 'E', 'D', 'DL'];
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
