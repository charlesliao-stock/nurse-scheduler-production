// js/modules/schedule_manager.js
// 🤖 AI 排班演算法引擎 (Auto-Scheduler v4.6 - Draft Support)

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
    
    yieldToMain: () => new Promise(resolve => setTimeout(resolve, 0)),

    // --- 1. 初始化與載入 (關鍵修正) ---
    loadContext: async function(docId, collectionName = 'pre_schedules') {
        console.log(`🤖 AI Engine Loading: ${docId} from [${collectionName}]`);
        this.docId = docId;
        
        try {
            // A. 讀取主文件 (可能是預班表，也可能是排班草稿)
            const doc = await db.collection(collectionName).doc(docId).get();
            if(!doc.exists) throw new Error("文件不存在");
            let data = doc.data();
            let sourceData = data; // 預設來源就是自己

            // B. 如果是「排班草稿 (schedules)」，需要去抓「原始預班表 (pre_schedules)」拿規則
            if (collectionName === 'schedules') {
                if (!data.sourceId) throw new Error("草稿缺少來源預班表 ID (sourceId)");
                console.log("🔗 Detected Draft. Fetching Source:", data.sourceId);
                
                const sourceDoc = await db.collection('pre_schedules').doc(data.sourceId).get();
                if (!sourceDoc.exists) throw new Error("原始預班表遺失");
                sourceData = sourceDoc.data();
                
                // 修正：草稿的 assignments 是最新的，但 staffList 可能要用 source 的以防人員變動
                // 這裡假設 staffList 在建立草稿時已複製，直接用 data 的
            }

            // --- 資料組裝 ---
            
            // 1. 規則與需求 (來自 Source)
            // 優先讀取 sourceData 裡的 rules (快照)，若無則去 Unit 抓
            if(sourceData.rules) {
                this.rules = sourceData.rules;
            } else {
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
            const year = sourceData.year;
            const month = sourceData.month;
            this.daysInMonth = new Date(year, month, 0).getDate();

            // 5. 準備統計狀態
            await this.prepareContext();

            console.log("✅ AI Context Ready.", { days: this.daysInMonth, staff: this.staffList.length });
            return true;

        } catch(e) {
            console.error("AI Load Error:", e);
            alert("AI 載入失敗: " + e.message);
            return false;
        }
    },

    // --- 2. 準備統計 (依賴 this.matrix) ---
    prepareContext: async function() {
        this.stats = {};
        
        this.staffList.forEach(u => {
            const lastShift = this.matrix[u.uid]?.['last_0'] || null;
            
            this.stats[u.uid] = {
                consecutiveDays: (lastShift && lastShift !== 'OFF') ? 1 : 0,
                totalOff: 0,
                lastShiftCode: lastShift,
                isPregnant: u.schedulingParams?.isPregnant || false,
                isBreastfeeding: u.schedulingParams?.isBreastfeeding || false,
                canBundle: u.schedulingParams?.canBundleShifts || false,
                bundleShift: this.matrix[u.uid]?.preferences?.bundleShift || null
            };

            // 統計目前已有的 OFF (含預班與已排班)
            for(let d=1; d<=this.daysInMonth; d++) {
                const val = this.matrix[u.uid]?.[`current_${d}`];
                if(val === 'REQ_OFF' || val === 'OFF') {
                    this.stats[u.uid].totalOff++;
                }
            }
        });
    },

    // --- 3. 執行排班 ---
    runAutoSchedule: async function() {
        // if(!confirm("即將執行 AI 排班，這將覆蓋空白欄位。")) return; // 由外部控制確認
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

    // ... (以下 cycle1, cycle2, cycle3, 輔助函式等邏輯保持不變，直接沿用 v4.4) ...
    // 為了節省篇幅，請保留您原本檔案中的 cycle1_basicAssignment, cycle2_smartFill 等函式
    // 只需要替換上面的 loadContext 與 prepareContext 即可
    
    // (為確保程式碼完整性，這裡補上必要的 cycle 函式結構，請確保您的檔案中有這些內容)
    cycle1_basicAssignment: function(day) {
        const shuffled = [...this.staffList].sort(() => 0.5 - Math.random());
        shuffled.forEach(staff => {
            const uid = staff.uid;
            if (this.isLocked(uid, day)) return;
            if (this.stats[uid].consecutiveDays >= (this.rules.policy?.maxConsDays || 6)) {
                this.assign(uid, day, 'OFF'); return;
            }
            const lastCode = this.stats[uid].lastShiftCode;
            if (lastCode && lastCode!=='OFF' && lastCode!=='REQ_OFF') {
                if (this.getShiftGap(day, lastCode) > 0 && this.checkHardRules(uid, day, lastCode)) {
                    this.assign(uid, day, lastCode);
                }
            }
        });
    },
    cycle2_smartFill: function(day) {
        // 簡易版：依序填補
        ['N','E','D','DL'].forEach(shift => {
            while(this.getShiftGap(day, shift) > 0) {
                const candidate = this.findBestCandidate(day, shift);
                if(candidate) this.assign(candidate.uid, day, shift);
                else break;
            }
        });
    },
    cycle3_trimExcess: function(day) { /* ... */ },
    
    // 輔助函式 (簡化版，請使用完整版)
    findBestCandidate: function(day, shift) {
        return this.staffList.find(u => !this.isLocked(u.uid, day) && this.checkHardRules(u.uid, day, shift));
    },
    isLocked: function(uid, day) {
        const val = this.matrix[uid]?.[`current_${day}`];
        return (val === 'REQ_OFF' || (val && val.startsWith('!')));
    },
    checkHardRules: function(uid, day, code) { return true; }, // 需實作完整邏輯
    getShiftGap: function(day, code) { return 1; }, // 需實作完整邏輯
    assign: function(uid, day, code) {
        if(!this.matrix[uid]) this.matrix[uid] = {};
        this.matrix[uid][`current_${day}`] = code;
        if(code==='OFF') this.stats[uid].totalOff++;
    },
    updateDailyStats: function(day) {
        this.staffList.forEach(u => {
            const code = this.matrix[u.uid][`current_${day}`];
            if(code && code!=='OFF' && code!=='REQ_OFF') this.stats[u.uid].consecutiveDays++;
            else this.stats[u.uid].consecutiveDays = 0;
            this.stats[u.uid].lastShiftCode = code;
        });
    },
    fillRemainingOffs: function() {
        Object.keys(this.matrix).forEach(uid => {
            for(let d=1; d<=this.daysInMonth; d++) {
                if(!this.matrix[uid][`current_${d}`]) this.matrix[uid][`current_${d}`] = 'OFF';
            }
        });
    }
};
