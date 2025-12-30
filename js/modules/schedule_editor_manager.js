// js/modules/schedule_editor_manager.js

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    shiftMap: {},
    staffMap: {}, 
    assignments: {}, // 當前顯示的班表
    _snapshot: null, // [新增] 用於預覽前的備份
    tempOptions: [], 

    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        if (!app.currentUser) return;
        
        await this.loadContext();
        await scheduleManager.loadContext(id, 'schedules'); 

        this.renderMatrix();
        this.updateRealTimeStats();
        this.setupEvents();
        this.setupModalEvents(); // [新增] 監聽 Modal 關閉
    },

    loadContext: async function() {
        try {
            const doc = await db.collection('schedules').doc(this.scheduleId).get();
            if (!doc.exists) throw new Error("班表不存在");
            this.data = doc.data();
            this.assignments = this.data.assignments || {};

            const shiftsSnap = await db.collection('shifts').where('unitId', '==', this.data.unitId).get();
            this.shifts = shiftsSnap.docs.map(d => d.data());
            this.shifts.forEach(s => this.shiftMap[s.code] = s);

            this.data.staffList.forEach(u => this.staffMap[u.uid] = u);

            document.getElementById('schTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
            this.updateStatusUI();
            
        } catch(e) { console.error(e); alert("載入失敗: " + e.message); }
    },

    // --- [核心] AI 排班入口 ---
    runAI: async function() {
        // 1. 備份當前狀態 (如果還沒備份)
        if (!this._snapshot) {
            this._snapshot = JSON.parse(JSON.stringify(this.assignments));
        }

        const modal = document.getElementById('aiResultModal');
        const container = document.getElementById('aiOptionsContainer');
        modal.classList.add('show');
        container.innerHTML = '<div style="padding:40px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>AI 正在平行運算 4 種排班方案...</div>';

        // 2. 執行運算
        setTimeout(async () => {
            try {
                const allStaff = this._prepareStaffDataForAI();
                const lastMonthData = this._prepareLastMonthData();
                const rules = this.data.rules || {};
                if (this.data.dailyNeeds) rules.dailyNeeds = this.data.dailyNeeds;

                // 呼叫批次執行器
                const runner = new ScheduleBatchRunner(allStaff, this.data.year, this.data.month, lastMonthData, rules);
                this.tempOptions = runner.runAll();
                
                this.renderAiOptions();

            } catch(e) { 
                console.error(e);
                container.innerHTML = `<div style="color:red; padding:20px;">運算失敗: ${e.message}</div>`; 
            }
        }, 100);
    },

    // --- [核心] 渲染選項卡片 ---
    renderAiOptions: function() {
        const c = document.getElementById('aiOptionsContainer'); 
        c.innerHTML = '';
        if (this.tempOptions.length === 0) { c.innerHTML = '無結果'; return; }

        this.tempOptions.forEach((o, i) => {
            const isError = !!o.error;
            const gap = o.metrics.gapCount;
            const gapColor = gap === 0 ? 'color:green' : 'color:red';
            const isRec = o.info.code === 'V3'; // 推薦 V3

            c.innerHTML += `
                <div class="ai-option-card" style="${isRec ? 'border:2px solid #3498db; background:#f0f8ff;' : ''}">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <span style="font-weight:bold; font-size:1.1rem;">${o.info.name}</span>
                        ${isRec ? '<span class="badge bg-primary">推薦</span>' : ''}
                    </div>
                    
                    ${isError 
                        ? `<p style="color:red;">運算失敗: ${o.error}</p>` 
                        : `<div style="font-size:0.9rem; color:#555; margin-bottom:10px;">
                             人力缺口: <span style="font-weight:bold; ${gapColor}">${gap}</span><br>
                             <small>點擊「預覽」以檢視完整班表</small>
                           </div>`
                    }
                    
                    <div style="text-align:right;">
                        <button class="btn btn-sm btn-info" onclick="scheduleEditorManager.previewOption(${i})" ${isError?'disabled':''}>
                            <i class="fas fa-eye"></i> 預覽
                        </button>
                        <button class="btn btn-sm btn-success" onclick="scheduleEditorManager.applyAiOption(${i})" ${isError?'disabled':''}>
                            <i class="fas fa-check"></i> 套用
                        </button>
                    </div>
                </div>
            `;
        });
    },

    // --- [核心] 預覽功能 (不存檔，只更新畫面) ---
    previewOption: function(i) {
        const opt = this.tempOptions[i];
        if(!opt || opt.error) return;

        // 1. 先還原到乾淨的備份狀態 (避免 V1 疊加在 V2 上)
        if (this._snapshot) {
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
        } else {
            this._snapshot = JSON.parse(JSON.stringify(this.assignments));
        }

        // 2. 套用選定的方案數據
        this.applyToLocalData(opt.schedule);

        // 3. 更新畫面與統計
        this.renderMatrix(); 
        this.updateRealTimeStats();
        
        // 4. 更新標題提示
        const titleEl = document.getElementById('schTitle');
        titleEl.innerHTML = `${this.data.year} / ${this.data.month} - <span style="color:#e67e22; font-weight:bold;">[預覽模式] ${opt.info.name}</span>`;
        
        // 5. 高亮選中的卡片
        document.querySelectorAll('.ai-option-card').forEach((el, idx) => {
            el.style.opacity = (idx === i) ? '1' : '0.6';
            el.style.transform = (idx === i) ? 'scale(1.02)' : 'scale(1)';
        });
    },

    // --- [核心] 套用功能 (確認修改) ---
    applyAiOption: function(i) {
        // 1. 確保拿到的是乾淨的數據 (從備份 + 新方案)
        if (this._snapshot) {
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
        }
        
        const opt = this.tempOptions[i];
        if(opt && !opt.error) {
            this.applyToLocalData(opt.schedule);
            
            // 2. 清除備份 (Commit)
            this._snapshot = null; 
            
            // 3. 關閉視窗並更新 UI
            document.getElementById('aiResultModal').classList.remove('show');
            this.renderMatrix(); 
            this.updateRealTimeStats();
            document.getElementById('schTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
            
            alert(`已成功套用：${opt.info.name}\n請記得點擊「儲存」以寫入資料庫。`);
        }
    },

    // --- [核心] 取消預覽 (還原) ---
    cancelPreview: function() {
        if (this._snapshot) {
            console.log("還原至排班前狀態...");
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
            this._snapshot = null;
            
            this.renderMatrix();
            this.updateRealTimeStats();
            document.getElementById('schTitle').textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
        }
        document.getElementById('aiResultModal').classList.remove('show');
    },

    setupModalEvents: function() {
        // 點擊遮罩或 X 按鈕時，觸發 cancelPreview
        const modal = document.getElementById('aiResultModal');
        // 假設 modal 有一個 close button
        const closeBtn = modal.querySelector('.close');
        if(closeBtn) closeBtn.onclick = () => this.cancelPreview();
        
        // 點擊背景關閉 (Optional)
        window.onclick = (event) => {
            if (event.target == modal) {
                this.cancelPreview();
            }
        };
    },

    // --- 資料轉換工具 ---
    applyToLocalData: function(scheduleData) {
        const dim = new Date(this.data.year, this.data.month, 0).getDate();
        
        // 1. 清空所有 current (保留 REQ_OFF)
        Object.keys(this.assignments).forEach(uid => {
            for(let d=1; d<=dim; d++) {
                if(this.assignments[uid][`current_${d}`] !== 'REQ_OFF') 
                    delete this.assignments[uid][`current_${d}`];
            }
        });
        
        // 2. 填入新數據
        Object.entries(scheduleData).forEach(([dateStr, shifts]) => {
            const day = parseInt(dateStr.split('-')[2]);
            ['N','E','D'].forEach(code => {
                if(shifts[code]) shifts[code].forEach(uid => {
                    if(!this.assignments[uid]) this.assignments[uid]={};
                    // 不要覆蓋 REQ_OFF
                    if(this.assignments[uid][`current_${day}`] !== 'REQ_OFF') {
                        this.assignments[uid][`current_${day}`] = code;
                    }
                });
            });
        });
    },

    _prepareStaffDataForAI: function() {
        // 同前版，確保讀取 packageType
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        return this.data.staffList.map(u => {
            const uid = u.uid;
            const assign = this.assignments[uid] || {};
            const pref = assign.preferences || {};
            const params = u.schedulingParams || {};

            let pkgType = null;
            if (pref.bundleShift) pkgType = pref.bundleShift;
            else if (params.canBundleShifts && params.bundleShift) pkgType = params.bundleShift;

            const aiPrefs = {};
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const val = assign[`current_${d}`];
                if (val === 'REQ_OFF' || (val && val.startsWith('!'))) aiPrefs[dateStr] = 'REQ_OFF';
                else if (pref.priority_1) {
                    if(!aiPrefs[dateStr]) aiPrefs[dateStr] = {};
                    aiPrefs[dateStr][1] = pref.priority_1;
                }
            }
            return { id: uid, name: u.name, packageType: pkgType, prefs: aiPrefs, isPregnant: params.isPregnant };
        });
    },

    _prepareLastMonthData: function() {
        const result = {};
        for (const [uid, stat] of Object.entries(scheduleManager.stats)) {
            result[uid] = { lastShiftCode: stat.lastShiftCode || 'OFF', consecutiveDays: stat.consecutiveDays || 0 };
        }
        return result;
    },

    // 保留原本的其他函式...
    updateStatusUI: function() { /* ... */ },
    togglePublish: function() { /* ... */ },
    renderMatrix: function() { /* ... */ },
    renderFooter: function(d) { /* ... */ },
    updateRealTimeStats: function() { /* ... */ },
    setupEvents: function() { /* ... */ },
    handleCellClick: function(u,d) { /* ... */ },
    handleRightClick: function(e,u,d) { /* ... */ },
    setShift: function(c) { /* ... */ },
    saveDraft: async function(silent) {
        await db.collection('schedules').doc(this.scheduleId).update({
            assignments: this.assignments, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if(!silent) alert("已儲存");
    }
};
