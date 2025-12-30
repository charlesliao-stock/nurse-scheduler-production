// js/modules/schedule_editor_manager.js
// 完整修正版 (vFinal_UI_Fix): 修復按鈕文字看不見的問題 (高對比配色)

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    shiftMap: {},
    staffMap: {}, 
    assignments: {}, // 當前顯示的班表
    _snapshot: null, // 預覽前的備份
    tempOptions: [], 

    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;
        if (!app.currentUser) return;
        
        try {
            await this.loadContext();
            // 初始化 AI 引擎
            if (typeof scheduleManager !== 'undefined') {
                await scheduleManager.loadContext(id, 'schedules'); 
            }

            this.renderMatrix();
            this.updateRealTimeStats();
            this.setupEvents();
            this.setupModalEvents();
        } catch (e) {
            console.error(e);
            alert("初始化失敗: " + e.message);
        }
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if (!doc.exists) throw new Error("班表不存在");
        this.data = doc.data();
        this.assignments = this.data.assignments || {};

        const shiftsSnap = await db.collection('shifts').where('unitId', '==', this.data.unitId).get();
        this.shifts = shiftsSnap.docs.map(d => d.data());
        this.shifts.forEach(s => this.shiftMap[s.code] = s);

        // 建立人員索引
        this.data.staffList.forEach(u => this.staffMap[u.uid] = u);

        const titleEl = document.getElementById('schTitle');
        if(titleEl) titleEl.textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
        
        this.updateStatusUI();
    },

    updateStatusUI: function() {
        const st = this.data.status;
        const badge = document.getElementById('schStatus');
        const btnPublish = document.getElementById('btnPublish');
        const btnSave = document.getElementById('btnSave');
        const btnAI = document.getElementById('btnAI');
        const btnReset = document.getElementById('btnReset'); 

        if(badge) {
            badge.textContent = st === 'published' ? '已發布' : '草稿';
            badge.className = `badge ${st === 'published' ? 'bg-success' : 'bg-warning'}`;
        }

        const isLocked = (st === 'published');
        if(btnSave) btnSave.disabled = isLocked;
        if(btnAI) btnAI.disabled = isLocked;
        if(btnReset) btnReset.disabled = isLocked;
        
        if(btnPublish) {
            btnPublish.textContent = isLocked ? '撤回發布' : '發布班表';
            btnPublish.className = isLocked ? 'btn btn-secondary' : 'btn btn-success';
            btnPublish.onclick = () => this.togglePublish();
        }
    },

    // --- AI 排班核心入口 ---
    runAI: async function() {
        if(!confirm("系統將運算 4 種排班方案供您選擇。\n這可能需要幾秒鐘，確定執行？")) return;
        
        // 1. 備份當前狀態
        if (!this._snapshot) {
            this._snapshot = JSON.parse(JSON.stringify(this.assignments));
        }

        const modal = document.getElementById('aiResultModal');
        const container = document.getElementById('aiOptionsContainer');
        if(modal) modal.classList.add('show');
        if(container) container.innerHTML = '<div style="padding:40px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>AI 正在平行運算多重宇宙...</div>';

        // 2. 執行運算
        setTimeout(async () => {
            try {
                const allStaff = this._prepareStaffDataForAI();
                const lastMonthData = this._prepareLastMonthData();
                const rules = this.data.rules || {};
                if (this.data.dailyNeeds) rules.dailyNeeds = this.data.dailyNeeds;

                if (typeof ScheduleBatchRunner === 'undefined') {
                    throw new Error("找不到 ScheduleBatchRunner，請確認 JS 檔案是否正確引入");
                }

                const runner = new ScheduleBatchRunner(allStaff, this.data.year, this.data.month, lastMonthData, rules);
                this.tempOptions = runner.runAll();
                
                this.renderAiOptions();

            } catch(e) { 
                console.error(e);
                if(container) container.innerHTML = `<div style="color:red; padding:20px;">運算失敗: ${e.message}</div>`; 
            }
        }, 100);
    },

    // 資料轉譯：Staff
    _prepareStaffDataForAI: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        return this.data.staffList.map(u => {
            const uid = u.uid;
            const assign = this.assignments[uid] || {};
            const pref = assign.preferences || {};
            const params = u.schedulingParams || {};

            // 讀取包班屬性
            let pkgType = null;
            if (pref.bundleShift && pref.bundleShift !== '') {
                pkgType = pref.bundleShift;
            } else if (params.canBundleShifts && params.bundleShift) {
                pkgType = params.bundleShift;
            }

            const aiPrefs = {};
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const val = assign[`current_${d}`];
                
                if (val === 'REQ_OFF' || (val && val.startsWith('!'))) {
                    aiPrefs[dateStr] = 'REQ_OFF'; 
                } else if (pref.priority_1) {
                     if(!aiPrefs[dateStr]) aiPrefs[dateStr] = {};
                     aiPrefs[dateStr][1] = pref.priority_1;
                }
            }

            return {
                id: uid,
                name: u.name,
                packageType: pkgType,
                prefs: aiPrefs,
                isPregnant: params.isPregnant
            };
        });
    },

    _prepareLastMonthData: function() {
        const result = {};
        if (typeof scheduleManager !== 'undefined' && scheduleManager.stats) {
            for (const [uid, stat] of Object.entries(scheduleManager.stats)) {
                result[uid] = {
                    lastShiftCode: stat.lastShiftCode || 'OFF',
                    consecutiveDays: stat.consecutiveDays || 0
                };
            }
        }
        return result;
    },

    // --- [UI修正] 渲染選項卡片 (強制內聯樣式以確保對比度) ---
    renderAiOptions: function() {
        const c = document.getElementById('aiOptionsContainer'); 
        if(!c) return;
        c.innerHTML = '';
        
        if (this.tempOptions.length === 0) {
            c.innerHTML = '無結果'; return;
        }

        this.tempOptions.forEach((o, i) => {
            const isError = !!o.error;
            const gap = o.metrics.gapCount;
            const gapColor = gap === 0 ? 'color:green' : 'color:red';
            const isRec = o.info.code === 'V3'; // 推薦 V3

            // 使用 style 屬性強制設定按鈕顏色，避免 CSS 衝突
            const btnPreviewStyle = isError ? '' : 'background-color:#17a2b8; color:white; border:none; font-weight:bold;';
            const btnApplyStyle = isError ? '' : 'background-color:#28a745; color:white; border:none; font-weight:bold;';

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
                        <button class="btn btn-sm" style="${btnPreviewStyle}" onclick="scheduleEditorManager.previewOption(${i})" ${isError?'disabled':''}>
                            <i class="fas fa-eye"></i> 預覽
                        </button>
                        <button class="btn btn-sm" style="${btnApplyStyle}" onclick="scheduleEditorManager.applyAiOption(${i})" ${isError?'disabled':''}>
                            <i class="fas fa-check"></i> 套用
                        </button>
                    </div>
                </div>
            `;
        });
    },

    // --- [UI修正] 懸浮預覽控制列 (高對比度配色) ---
    showPreviewBar: function(planName, index) {
        let bar = document.getElementById('aiPreviewBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'aiPreviewBar';
            bar.style.cssText = `
                position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
                background: rgba(33, 37, 41, 0.95); color: white; padding: 15px 30px;
                border-radius: 50px; z-index: 9999; display: flex; align-items: center; gap: 20px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.5); backdrop-filter: blur(5px);
                font-family: 'Segoe UI', sans-serif; border: 1px solid #444;
            `;
            document.body.appendChild(bar);
        }
        
        // 按鈕樣式：白色按鈕配黑字，綠色按鈕配白字，確保絕對清晰
        bar.innerHTML = `
            <span style="font-weight:bold; font-size:1.1rem; color:#fff; text-shadow:0 1px 2px black;">
                👁️ 正在預覽：<span style="color:#4db8ff;">${planName}</span>
            </span>
            <div style="width:1px; height:20px; background:#666;"></div>
            
            <button class="btn btn-sm" onclick="scheduleEditorManager.backToAiModal()" 
                style="background: #ffffff; color: #333; border: none; border-radius: 20px; font-weight: bold; padding: 8px 20px;">
                <i class="fas fa-arrow-left"></i> 返回選擇
            </button>
            
            <button class="btn btn-sm" onclick="scheduleEditorManager.confirmApply(${index})" 
                style="background: #28a745; color: #fff; border: none; border-radius: 20px; font-weight: bold; padding: 8px 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">
                <i class="fas fa-check"></i> 確認套用
            </button>
        `;
        bar.style.display = 'flex';
    },

    hidePreviewBar: function() {
        const bar = document.getElementById('aiPreviewBar');
        if(bar) bar.style.display = 'none';
    },

    backToAiModal: function() {
        this.hidePreviewBar();
        const modal = document.getElementById('aiResultModal');
        if(modal) modal.classList.add('show');
    },

    confirmApply: function(index) {
        this.applyAiOption(index);
        this.hidePreviewBar();
    },

    // --- 預覽功能 ---
    previewOption: function(i) {
        const opt = this.tempOptions[i];
        if(!opt || opt.error) return;

        // 還原到備份
        if (this._snapshot) {
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
        } else {
            this._snapshot = JSON.parse(JSON.stringify(this.assignments));
        }

        this.applyToLocalData(opt.schedule);
        this.renderMatrix(); 
        this.updateRealTimeStats();
        
        // 隱藏 Modal，顯示懸浮條
        const modal = document.getElementById('aiResultModal');
        if(modal) modal.classList.remove('show');
        this.showPreviewBar(opt.info.name, i);
    },

    applyAiOption: function(i) {
        // 確保基底是乾淨的
        if (this._snapshot) {
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
        }
        
        const opt = this.tempOptions[i];
        if(opt && !opt.error) {
            this.applyToLocalData(opt.schedule);
            this._snapshot = null; // 清除備份
            
            const modal = document.getElementById('aiResultModal');
            if(modal) modal.classList.remove('show');
            this.hidePreviewBar();
            
            this.renderMatrix(); 
            this.updateRealTimeStats();
            
            const titleEl = document.getElementById('schTitle');
            if(titleEl) titleEl.textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
            
            alert(`已成功套用：${opt.info.name}\n請記得點擊「儲存」以寫入資料庫。`);
        }
    },

    cancelPreview: function() {
        if (this._snapshot) {
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
            this._snapshot = null;
            this.renderMatrix();
            this.updateRealTimeStats();
            const titleEl = document.getElementById('schTitle');
            if(titleEl) titleEl.textContent = `${this.data.year} 年 ${this.data.month} 月 - 排班作業`;
        }
        const modal = document.getElementById('aiResultModal');
        if(modal) modal.classList.remove('show');
        this.hidePreviewBar();
    },

    setupModalEvents: function() {
        const modal = document.getElementById('aiResultModal');
        if(modal) {
            const closeBtn = modal.querySelector('.close');
            if(closeBtn) closeBtn.onclick = () => this.cancelPreview();
            window.onclick = (event) => {
                if (event.target == modal) this.cancelPreview();
            };
        }
    },

    applyToLocalData: function(scheduleData) {
        const dim = new Date(this.data.year, this.data.month, 0).getDate();
        
        // 清空
        Object.keys(this.assignments).forEach(uid => {
            for(let d=1; d<=dim; d++) {
                if(this.assignments[uid][`current_${d}`] !== 'REQ_OFF') 
                    delete this.assignments[uid][`current_${d}`];
            }
        });
        
        // 填入
        Object.entries(scheduleData).forEach(([dateStr, shifts]) => {
            const day = parseInt(dateStr.split('-')[2]);
            ['N','E','D'].forEach(code => {
                if(shifts[code]) shifts[code].forEach(uid => {
                    if(!this.assignments[uid]) this.assignments[uid]={};
                    if(this.assignments[uid][`current_${day}`] !== 'REQ_OFF') {
                        this.assignments[uid][`current_${day}`] = code;
                    }
                });
            });
        });
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        
        if(!thead || !tbody) {
            console.error("找不到表格容器 (schHead/schBody)");
            return;
        }
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();

        // 1. 表頭渲染
        let h1 = `<tr>
            <th rowspan="2" class="sticky-col name-col" style="min-width:80px; z-index:20;">姓名</th>
            <th rowspan="2" class="sticky-col attr-col" style="min-width:40px; z-index:20;">註</th>
            <th colspan="6" class="header-last" style="background:#eee;">上月</th>`;
        
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(year, month-1, d).getDay();
            const c = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${c}; min-width:30px;">${d}</th>`;
        }
        h1 += `<th colspan="4" style="background:#f9f9f9;">統計</th></tr>`;
        
        let h2 = `<tr>`;
        for(let i=5; i>=0; i--) h2 += `<th class="cell-last-month cell-narrow" style="color:#666;">${lastMonthLastDay - i}</th>`;
        for(let d=1; d<=daysInMonth; d++) h2 += `<th></th>`;
        h2 += `<th style="font-size:0.8rem;">O</th><th style="font-size:0.8rem;">假</th><th style="font-size:0.8rem;">N</th><th style="font-size:0.8rem;">E</th></tr>`;

        thead.innerHTML = h1 + h2;

        // 2. 內容渲染
        let bodyHtml = '';
        this.data.staffList.forEach(u => {
            const assign = this.assignments[u.uid] || {};
            const params = u.schedulingParams || {};
            
            let icons = '';
            if(params.canBundleShifts) icons += '<span title="包班" style="color:blue; font-weight:bold;">包</span>';
            if(params.isPregnant) icons += '<span title="孕">🤰</span>';
            
            bodyHtml += `<tr data-uid="${u.uid}">
                <td class="sticky-col name-col">${u.name}</td>
                <td class="sticky-col attr-col">${icons}</td>`;
            
            // 上月
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const val = assign[`last_${d}`] || '';
                bodyHtml += `<td class="cell-last-month cell-narrow">${val}</td>`;
            }

            // 本月
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                let disp = val || '';
                let style = '';
                let cssClass = 'cell-clickable';
                
                if(val === 'REQ_OFF') { disp='休'; style='color:green;font-weight:bold;background:#e8f8f5;'; }
                else if(val && val.startsWith('!')) { disp='🚫'; style='color:red;background:#fdedec;'; }
                else if(val === 'N') style='color:red;font-weight:bold;';
                else if(val === 'E') style='color:orange;font-weight:bold;';
                else if(val === 'D') style='color:black;font-weight:bold;';
                else if(val === 'OFF') { disp='OFF'; style='color:#ccc;'; }
                
                bodyHtml += `<td class="${cssClass}" style="${style}" 
                    onclick="scheduleEditorManager.handleCellClick('${u.uid}',${d})" 
                    oncontextmenu="scheduleEditorManager.handleRightClick(event,'${u.uid}',${d})">${disp}</td>`;
            }

            // 統計欄位
            bodyHtml += `<td id="stat_off_${u.uid}">0</td>
                         <td id="stat_hol_${u.uid}">0</td>
                         <td id="stat_n_${u.uid}">0</td>
                         <td id="stat_e_${u.uid}">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;

        this.renderFooter(daysInMonth);
    },

    renderFooter: function(dim) {
        const tfoot = document.getElementById('schFoot');
        if(!tfoot) return;
        
        let html = `<tr><td colspan="8" style="text-align:right; font-weight:bold;">缺口:</td>`;
        const dailyNeeds = this.data.dailyNeeds || {};

        for(let d=1; d<=dim; d++) {
             const date = new Date(this.data.year, this.data.month-1, d);
             const dayIdx = date.getDay()===0?6:date.getDay()-1;
             
             let txt = [];
             this.shifts.forEach(s => {
                 const need = dailyNeeds[`${s.code}_${dayIdx}`] || 0;
                 let have = 0;
                 Object.values(this.assignments).forEach(a => { if(a[`current_${d}`]===s.code) have++; });
                 
                 if(need > have) {
                     txt.push(`${s.code}:${need-have}`);
                 }
             });

             const style = txt.length > 0 ? 'background:#fff3cd; color:#c0392b; font-weight:bold; font-size:0.7em;' : '';
             html += `<td style="${style}">${txt.join('<br>')}</td>`;
        }
        html += '<td colspan="4"></td></tr>';
        tfoot.innerHTML = html;
    },

    updateRealTimeStats: function() {
        const dim = new Date(this.data.year, this.data.month, 0).getDate();
        this.data.staffList.forEach(u => {
            let off=0, n=0, e=0, hol=0;
            for(let d=1; d<=dim; d++) {
                const v = this.assignments[u.uid]?.[`current_${d}`];
                if(v==='OFF' || !v) off++;
                else if(v==='REQ_OFF') { off++; hol++; }
                else if(v==='N') n++;
                else if(v==='E') e++;
            }
            const set = (k,v) => { const el=document.getElementById(k); if(el) el.textContent=v; };
            set(`stat_off_${u.uid}`, off); 
            set(`stat_hol_${u.uid}`, hol);
            set(`stat_n_${u.uid}`, n); 
            set(`stat_e_${u.uid}`, e);
        });
    },

    resetSchedule: async function() {
        if(!confirm("重置將清除所有排班結果，恢復到預班初始狀態。確定重置？")) return;
        const newAssignments = await scheduleManager.resetToSource();
        if (newAssignments) {
            this.assignments = newAssignments;
            this.renderMatrix();
            this.updateRealTimeStats();
            this.saveDraft(true);
        }
    },

    saveDraft: async function(silent) {
        await db.collection('schedules').doc(this.scheduleId).update({
            assignments: this.assignments, 
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if(!silent) alert("已儲存");
    },
    
    togglePublish: async function() {
        const isPublished = (this.data.status === 'published');
        const action = isPublished ? '撤回' : '發布';
        if(!confirm(`確定要${action}此班表嗎？`)) return;
        try {
            const newStatus = isPublished ? 'draft' : 'published';
            await db.collection('schedules').doc(this.scheduleId).update({
                status: newStatus, assignments: this.assignments, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = newStatus; this.updateStatusUI(); alert(`已${action}！`);
        } catch(e) { alert("操作失敗: " + e.message); }
    },

    handleCellClick: function(uid, d) {
        console.log(`Clicked ${uid}, Day ${d}`);
    },

    handleRightClick: function(e, uid, d) { 
        e.preventDefault(); 
        this.targetCell = { uid, d };
        const menu = document.getElementById('schContextMenu'); 
        if(menu) { 
            menu.style.display='block'; 
            menu.style.left=e.pageX+'px'; 
            menu.style.top=e.pageY+'px'; 
        }
    },

    setShift: function(code) { 
        if(this.targetCell) {
            const {uid, d} = this.targetCell;
            if(!this.assignments[uid]) this.assignments[uid]={};
            
            if(code===null) delete this.assignments[uid][`current_${d}`];
            else this.assignments[uid][`current_${d}`] = code;
            
            this.renderMatrix(); 
            this.updateRealTimeStats();
            document.getElementById('schContextMenu').style.display='none';
        }
    },

    setupEvents: function() { 
        document.addEventListener('click', e => {
            const m = document.getElementById('schContextMenu');
            if(m && !m.contains(e.target)) m.style.display='none';
        });
    }
};
