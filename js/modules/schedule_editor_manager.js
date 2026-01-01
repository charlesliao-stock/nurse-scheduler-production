// js/modules/schedule_editor_manager.js
// Fix: 
// 1. 介面顯示完整偏好 (支援顯示 1.N 與 2.D)。
// 2. 重置功能：強制從「預班表」同步最新資料 (含特註、偏好)。
// 3. 按鈕樣式與定位優化。

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    shiftMap: {},
    staffMap: {}, 
    assignments: {}, 
    _snapshot: null, 
    tempOptions: [], 
    targetCell: null, 

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

            this.renderToolbar(); // 渲染工具列按鈕
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
        
        if(badge) {
            badge.textContent = st === 'published' ? '已發布' : '草稿';
            badge.className = `badge ${st === 'published' ? 'bg-success' : 'bg-warning'}`;
        }

        // 強制設定發布按鈕樣式
        const btnPublish = document.getElementById('btnPublish');
        if(btnPublish) {
            btnPublish.className = 'btn btn-success'; // 綠色
            btnPublish.style.opacity = '1';
            btnPublish.textContent = st === 'published' ? '撤回發布' : '發布班表';
            if(st === 'published') btnPublish.className = 'btn btn-secondary';
            btnPublish.onclick = () => this.togglePublish();
        }
    },

    // --- [核心修正] 渲染工具列 (重置按鈕) ---
    renderToolbar: function() {
        // 防止重複渲染
        if (document.getElementById('btnResetSchedule')) return;

        // 建立重置按鈕
        const btnReset = document.createElement('button');
        btnReset.id = 'btnResetSchedule';
        btnReset.className = 'btn btn-danger'; // 紅色
        btnReset.innerHTML = '<i class="fas fa-undo"></i> 重置';
        btnReset.style.marginRight = '8px';
        btnReset.style.fontWeight = 'bold';
        btnReset.style.opacity = '1';
        btnReset.title = "清除目前排班，並重新同步預班表的最新設定";
        btnReset.onclick = () => this.resetSchedule();

        // 尋找插入點 (優先找 AI 按鈕，其次找儲存按鈕)
        let targetAnchor = null;
        const allBtns = document.querySelectorAll('button');
        for(let btn of allBtns) {
            if(btn.textContent.includes('AI') || btn.textContent.includes('自動')) {
                targetAnchor = btn;
                break;
            }
        }
        if(!targetAnchor) targetAnchor = document.getElementById('btnSave');

        // 執行插入
        if (targetAnchor && targetAnchor.parentNode) {
            targetAnchor.parentNode.insertBefore(btnReset, targetAnchor);
        } else {
            // 備案：掛在標題列
            const header = document.querySelector('.d-flex') || document.getElementById('schTitle')?.parentNode;
            if(header) header.appendChild(btnReset);
        }
    },

    // --- [核心功能] 重置並同步預班表 ---
    resetSchedule: async function() {
        if(!confirm("⚠️ [重置確認]\n這將清除目前所有排班內容！\n系統將會重新從「預班表」載入最新的特註、偏好設定(含第一/第二志願)與預休假。\n\n確定要執行嗎？")) return;
        
        try {
            if (!this.data.sourceId) {
                alert("錯誤：此班表沒有連結的預班來源，無法同步。");
                return;
            }

            // 1. 讀取最新預班表
            const preDoc = await db.collection('pre_schedules').doc(this.data.sourceId).get();
            if (!preDoc.exists) {
                alert("錯誤：找不到原始預班表資料。");
                return;
            }
            const preData = preDoc.data();

            // 2. 準備覆蓋的資料 (深拷貝以防參照問題)
            const newStaffList = preData.staffList || this.data.staffList;
            
            this.assignments = JSON.parse(JSON.stringify(preData.assignments || {})); 
            this.data.staffList = JSON.parse(JSON.stringify(newStaffList)); 
            if (preData.dailyNeeds) this.data.dailyNeeds = JSON.parse(JSON.stringify(preData.dailyNeeds));

            // 3. 更新索引
            this.data.staffList.forEach(u => this.staffMap[u.uid] = u);

            // 4. 寫入資料庫
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                staffList: this.data.staffList,
                dailyNeeds: this.data.dailyNeeds || {},
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // 5. 重繪介面
            this.renderMatrix();
            this.updateRealTimeStats();
            
            alert("✅ 重置成功！已還原至預班表最新狀態。");

        } catch(e) {
            console.error(e);
            alert("重置失敗: " + e.message);
        }
    },

    // --- AI 排班流程 ---
    runAI: async function() {
        if(!confirm("系統將運算 4 種排班方案供您選擇。\n這可能需要幾秒鐘，確定執行？")) return;
        
        if (!this._snapshot) {
            this._snapshot = JSON.parse(JSON.stringify(this.assignments));
        }

        const modal = document.getElementById('aiResultModal');
        const container = document.getElementById('aiOptionsContainer');
        if(modal) modal.classList.add('show');
        if(container) container.innerHTML = '<div style="padding:40px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>AI 正在平行運算多重宇宙...</div>';

        setTimeout(async () => {
            try {
                const allStaff = this._prepareStaffDataForAI();
                const lastMonthData = this._prepareLastMonthData();
                const rules = this.data.rules || {};
                if (this.data.dailyNeeds) rules.dailyNeeds = this.data.dailyNeeds;

                if (typeof ScheduleBatchRunner === 'undefined') {
                    throw new Error("找不到 ScheduleBatchRunner");
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

    // 資料轉譯：將人員資料轉給演算法
// ... existing code ...
    _prepareStaffDataForAI: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        return this.data.staffList.map(u => {
            const uid = u.uid;
            const assign = this.assignments[uid] || {};
            const pref = assign.preferences || {};
            const params = u.schedulingParams || {};

            let pkgType = null;
            if (pref.bundleShift && pref.bundleShift !== '') {
                pkgType = pref.bundleShift;
            } else if (params.canBundleShifts && params.bundleShift) {
                pkgType = params.bundleShift;
            }

            // 轉譯每日偏好 (給 V1 使用)
            const aiPrefs = {};
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${this.data.year}-${String(this.data.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const val = assign[`current_${d}`];
                
                if (val === 'REQ_OFF' || (val && val.startsWith('!'))) {
                    aiPrefs[dateStr] = 'REQ_OFF'; 
                } else {
                    // [修正] 完整傳遞三個志願
                    if(!aiPrefs[dateStr]) aiPrefs[dateStr] = {};
                    if (pref.priority_1) aiPrefs[dateStr][1] = pref.priority_1;
                    if (pref.priority_2) aiPrefs[dateStr][2] = pref.priority_2;
                    if (pref.priority_3) aiPrefs[dateStr][3] = pref.priority_3;
                }
            }

            return {
                id: uid,
                name: u.name,
                packageType: pkgType, 
                prefs: aiPrefs,
                isPregnant: params.isPregnant,
                // [新增] 傳遞特註
                isBreastfeeding: params.isBreastfeeding
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
            const isRec = o.info.code === 'V3'; 

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

    previewOption: function(i) {
        const opt = this.tempOptions[i];
        if(!opt || opt.error) return;

        if (this._snapshot) {
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
        } else {
            this._snapshot = JSON.parse(JSON.stringify(this.assignments));
        }

        this.applyToLocalData(opt.schedule);
        this.renderMatrix(); 
        this.updateRealTimeStats();
        
        const modal = document.getElementById('aiResultModal');
        if(modal) modal.classList.remove('show');
        this.showPreviewBar(opt.info.name, i);
    },

    applyAiOption: function(i) {
        if (this._snapshot) {
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
        }
        
        const opt = this.tempOptions[i];
        if(opt && !opt.error) {
            this.applyToLocalData(opt.schedule);
            this._snapshot = null; 
            
            const modal = document.getElementById('aiResultModal');
            if(modal) modal.classList.remove('show');
            this.hidePreviewBar();
            
            this.renderMatrix(); 
            this.updateRealTimeStats();
            
            alert(`已成功套用：${opt.info.name}\n請記得點擊「儲存」以寫入資料庫。`);
        }
    },

    cancelPreview: function() {
        if (this._snapshot) {
            this.assignments = JSON.parse(JSON.stringify(this._snapshot));
            this._snapshot = null;
            this.renderMatrix();
            this.updateRealTimeStats();
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
        Object.keys(this.assignments).forEach(uid => {
            for(let d=1; d<=dim; d++) {
                if(this.assignments[uid][`current_${d}`] !== 'REQ_OFF') 
                    delete this.assignments[uid][`current_${d}`];
            }
        });
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

    // --- [核心修正] 渲染矩陣：加入特註、偏好 (支援 1.N 2.D) ---
    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        
        if(!thead || !tbody) return;
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();

        // 1. 表頭 (加寬偏好欄位)
        let h1 = `<tr>
            <th rowspan="2" class="sticky-col" style="min-width:60px; left:0; z-index:20;">員編</th>
            <th rowspan="2" class="sticky-col" style="min-width:70px; left:60px; z-index:20;">姓名</th>
            <th rowspan="2" style="width:40px; z-index:20;">註</th>
            <th rowspan="2" style="min-width:80px; z-index:20;">偏好</th> 
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

        // 2. 內容
        let bodyHtml = '';
        this.data.staffList.forEach(u => {
            const assign = this.assignments[u.uid] || {};
            const pref = assign.preferences || {};
            const params = u.schedulingParams || {};
            const note = u.note || ""; 

            let iconHtml = '';
            if(params.isPregnant) iconHtml += '🤰 ';
            if(params.isBreastfeeding) iconHtml += '🤱 ';
            if(note) iconHtml += `<span title="${note}" style="cursor:help;">📝</span>`;

            // [修正] 完整顯示偏好
            let prefHtml = '';
            if (pref.bundleShift) {
                prefHtml = `<span class="badge bg-info">包${pref.bundleShift}</span>`;
            } else if (pref.priority_1) {
                prefHtml = `<span style="color:blue; font-size:0.8em; font-weight:bold;">1.${pref.priority_1}</span>`;
                if (pref.priority_2) {
                    prefHtml += `<br><span style="color:gray; font-size:0.8em;">2.${pref.priority_2}</span>`;
                }
            } else if (params.canBundleShifts && params.bundleShift) {
                prefHtml = `<span class="badge bg-info">包${params.bundleShift}</span>`;
            } else {
                 prefHtml = `<span style="color:#999; font-size:0.8em;">設定</span>`;
            }
            
            bodyHtml += `<tr data-uid="${u.uid}">
                <td class="sticky-col" style="left:0; background:#fff;">${u.empId || ''}</td>
                <td class="sticky-col" style="left:60px; background:#fff;">${u.name}</td>
                <td>${iconHtml}</td>
                <td>${prefHtml}</td>`;
            
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

            // 統計
            bodyHtml += `<td id="stat_off_${u.uid}">0</td>
                         <td id="stat_hol_${u.uid}">0</td>
                         <td id="stat_n_${u.uid}">0</td>
                         <td id="stat_e_${u.uid}">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3. 底部
        this.renderFooter(daysInMonth);
    },

    renderFooter: function(daysInMonth) {
        const tfoot = document.getElementById('schFoot');
        if(!tfoot) return;
        
        let f = '';
        const dailyNeeds = this.data.dailyNeeds || {};

        this.shifts.forEach(shift => {
            f += `<tr style="border-top: 1px solid #ddd;">
                <td colspan="4" style="text-align:right; font-weight:bold; color:${shift.color || '#333'}; position:sticky; left:0; background:#fff;">
                    ${shift.name} (${shift.code}) 缺口:
                </td>
                <td colspan="6" style="background:#fff;">-</td>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                f += `<td id="stat_col_${shift.code}_${d}" style="text-align:center; font-size:0.85em; background:#fff;">-</td>`;
            }
            f += `<td colspan="4" style="background:#fff;">-</td></tr>`;
        });
        tfoot.innerHTML = f;
    },

    updateRealTimeStats: function() {
        const dim = new Date(this.data.year, this.data.month, 0).getDate();
        const dailyNeeds = this.data.dailyNeeds || {};

        // 1. 初始化每日計數
        const dailyCounts = {}; 
        for(let d=1; d<=dim; d++) {
            dailyCounts[d] = {};
            this.shifts.forEach(s => dailyCounts[d][s.code] = 0);
        }

        // 2. 遍歷人員
        this.data.staffList.forEach(u => {
            let off=0, n=0, e=0, hol=0;
            const assign = this.assignments[u.uid] || {};

            for(let d=1; d<=dim; d++) {
                const v = assign[`current_${d}`];
                
                if(v==='OFF' || !v) off++;
                else if(v==='REQ_OFF') { off++; hol++; }
                else if(v==='N') n++;
                else if(v==='E') e++;

                if(v && dailyCounts[d][v] !== undefined) {
                    dailyCounts[d][v]++;
                }
            }
            
            const set = (k,v) => { const el=document.getElementById(k); if(el) el.textContent=v; };
            set(`stat_off_${u.uid}`, off); 
            set(`stat_hol_${u.uid}`, hol);
            set(`stat_n_${u.uid}`, n); 
            set(`stat_e_${u.uid}`, e);
        });

        // 3. 更新底部
        this.shifts.forEach(s => {
            for(let d=1; d<=dim; d++) {
                const el = document.getElementById(`stat_col_${s.code}_${d}`);
                if(el) {
                    const date = new Date(this.data.year, this.data.month - 1, d);
                    const dayIdx = (date.getDay() + 6) % 7; 
                    const needKey = `${s.code}_${dayIdx}`;
                    const demand = dailyNeeds[needKey] ? parseInt(dailyNeeds[needKey]) : 0;
                    const supply = dailyCounts[d][s.code] || 0;

                    if (demand > 0) {
                        el.textContent = `${supply} / ${demand}`; 
                        if (supply < demand) {
                            el.style.backgroundColor = '#ffebee';
                            el.style.color = '#c0392b';
                            el.style.fontWeight = 'bold';
                        } else {
                            el.style.backgroundColor = 'transparent';
                            el.style.color = '#27ae60';
                            el.style.fontWeight = 'normal';
                        }
                    } else {
                        el.textContent = supply > 0 ? supply : '-';
                        el.style.backgroundColor = 'transparent';
                        el.style.color = '#ccc';
                        el.style.fontWeight = 'normal';
                    }
                }
            }
        });
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
