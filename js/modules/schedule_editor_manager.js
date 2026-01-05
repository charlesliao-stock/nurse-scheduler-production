// js/modules/schedule_editor_manager.js
// 修正版：重置功能改為「還原預班資料」、修復 AI 呼叫

const scheduleEditorManager = {
    scheduleId: null,
    data: null,
    shifts: [],
    staffMap: {},
    assignments: {},
    usersMap: {}, 
    isLoading: false,
    targetCell: null, 

    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;

        if (!app.currentUser) { alert("請先登入"); return; }
        
        this.cleanup();
        this.showLoading();

        try {
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadContext()
            ]);
            
            this.assignments = this.data.assignments || {};

            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats();
            this.setupEvents();
            
            const menu = document.getElementById('schContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }

            console.log("✅ 排班編輯器初始化完成");

        } catch (e) {
            console.error(e);
            alert("初始化失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const tbody = document.getElementById('schBody');
        if(tbody) tbody.innerHTML = '<tr><td colspan="20" style="padding:40px;"><i class="fas fa-spinner fa-spin"></i> 載入中...</td></tr>';
    },

    loadShifts: async function() {
        const snap = await db.collection('shifts').get();
        this.shifts = snap.docs.map(d => d.data());
    },

    loadUsers: async function() {
        const snap = await db.collection('users').get();
        snap.forEach(doc => { this.usersMap[doc.id] = doc.data(); });
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if (!doc.exists) throw new Error("找不到此排班表");
        
        this.data = doc.data();
        if(this.data.unitId) {
            this.shifts = this.shifts.filter(s => s.unitId === this.data.unitId);
        }
        this.data.staffList.forEach(s => { this.staffMap[s.uid] = s; });

        const titleEl = document.getElementById('schTitle'); 
        if(titleEl) {
            let statusText = this.data.status === 'published' ? '(已發布)' : '(草稿)';
            titleEl.innerHTML = `<i class="fas fa-calendar-alt"></i> 排班作業 <small>${statusText}</small>`;
        }
    },

    renderToolbar: function() {
        const statusBadge = document.getElementById('schStatus'); 
        if(statusBadge) {
            const isPub = this.data.status === 'published';
            statusBadge.textContent = isPub ? '已發布' : '草稿';
            statusBadge.className = `badge ${isPub ? 'badge-success' : 'badge-warning'}`;
        }

        const rightGroup = document.getElementById('toolbarRight');
        if(rightGroup) {
            const isPublished = this.data.status === 'published';
            
            const aiBtn = `<button class="btn" style="background:#8e44ad; color:white;" onclick="scheduleEditorManager.runAI()"><i class="fas fa-robot"></i> AI 自動排班</button>`;
            const resetBtn = `<button class="btn btn-warning" onclick="scheduleEditorManager.resetSchedule()"><i class="fas fa-undo"></i> 重置 (還原預班)</button>`;
            const saveBtn = `<button class="btn btn-primary" onclick="scheduleEditorManager.saveDraft()"><i class="fas fa-save"></i> 儲存</button>`;
            
            const pubBtn = isPublished 
                ? `<button class="btn btn-secondary" onclick="scheduleEditorManager.unpublishSchedule()"><i class="fas fa-eye-slash"></i> 取消發布</button>`
                : `<button class="btn btn-success" onclick="scheduleEditorManager.publishSchedule()"><i class="fas fa-paper-plane"></i> 發布班表</button>`;

            rightGroup.innerHTML = `${aiBtn} <span style="border-left:1px solid #ccc; height:20px; margin:0 5px;"></span> ${resetBtn} ${saveBtn} ${pubBtn}`;
        }
    },

    renderMatrix: function() {
        const thead = document.getElementById('schHead');
        const tbody = document.getElementById('schBody');
        const tfoot = document.getElementById('schFoot');
        if (!thead || !tbody) return;

        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        
        const lastMonthDate = new Date(year, month - 1, 0);
        const lastMonthEnd = lastMonthDate.getDate();
        const prevShowDays = 6; 
        
        // 表頭
        let h1 = `<tr>
            <th rowspan="2" style="width:60px; position:sticky; left:0; z-index:110; background:#f8f9fa; vertical-align:middle;">職編</th>
            <th rowspan="2" style="width:80px; position:sticky; left:60px; z-index:110; background:#f8f9fa; vertical-align:middle;">姓名</th>
            <th rowspan="2" style="width:60px; vertical-align:middle;">備註</th>
            <th rowspan="2" style="width:50px; vertical-align:middle;">包班</th>
            <th rowspan="2" style="width:100px; vertical-align:middle;">偏好</th>`;
        
        for(let i=prevShowDays-1; i>=0; i--) {
            h1 += `<th class="cell-narrow" style="background:#eee; color:#666;">${lastMonthEnd - i}</th>`;
        }
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = date.getDay();
            const color = (w===0||w===6) ? 'color:red;' : '';
            h1 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        h1 += `<th rowspan="2" style="width:40px; border-left:2px solid #ccc; color:#007bff; vertical-align:middle;">OFF</th>
               <th rowspan="2" style="width:40px; vertical-align:middle;">小夜</th>
               <th rowspan="2" style="width:40px; vertical-align:middle;">大夜</th>
               <th rowspan="2" style="width:40px; vertical-align:middle;">假日</th></tr>`;

        let h2 = `<tr>`;
        for(let i=0; i<prevShowDays; i++) h2 += `<th style="background:#eee;"></th>`;
        const weeks = ['日','一','二','三','四','五','六'];
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(year, month-1, d);
            const w = weeks[date.getDay()];
            const color = (date.getDay()===0 || date.getDay()===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="font-size:0.8rem; ${color}">${w}</th>`;
        }
        h2 += `</tr>`;
        thead.innerHTML = h1 + h2;

        // 內容
        let bodyHtml = '';
        const sortedStaff = [...this.data.staffList].sort((a,b) => {
            const idA = this.usersMap[a.uid]?.employeeId || '';
            const idB = this.usersMap[b.uid]?.employeeId || '';
            return idA.localeCompare(idB);
        });

        sortedStaff.forEach(staff => {
            const uid = staff.uid;
            const userDetail = this.usersMap[uid] || {};
            const empId = userDetail.employeeId || '';
            const note = userDetail.note || ''; 
            
            const userAssign = this.assignments[uid] || {};
            const userPrefs = userAssign.preferences || {};
            
            let bundleHtml = userPrefs.bundleShift ? `<span class="badge badge-info">${userPrefs.bundleShift}</span>` : '-';
            
            let prefHtml = '';
            const priorities = [];
            if(userPrefs.priority_1) priorities.push(userPrefs.priority_1);
            if(userPrefs.priority_2) priorities.push(userPrefs.priority_2);
            if(priorities.length > 0) prefHtml = `<span style="font-size:0.75rem; color:#666;">${priorities.join('>')}</span>`;
            else prefHtml = '-';

            bodyHtml += `<tr data-uid="${uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:100; border-right:1px solid #ddd;">${empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:100; font-weight:bold; border-right:1px solid #ddd; white-space:nowrap;">${staff.name}</td>
                <td style="font-size:0.8rem; color:#666;">${note}</td>
                <td>${bundleHtml}</td>
                <td>${prefHtml}</td>`;
            
            for(let i=prevShowDays-1; i>=0; i--) {
                const d = lastMonthEnd - i;
                const val = userAssign[`last_${d}`] || '';
                bodyHtml += `<td class="cell-narrow" style="background:#f9f9f9; color:#999;">${val}</td>`;
            }

            for(let d=1; d<=daysInMonth; d++) {
                const val = userAssign[`current_${d}`] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" 
                            data-uid="${uid}" data-day="${d}"
                            style="cursor:pointer;">${this.renderCellContent(val)}</td>`;
            }

            bodyHtml += `<td id="stat_off_${uid}" style="border-left:2px solid #ccc; font-weight:bold; color:#007bff;">0</td>
                         <td id="stat_E_${uid}">0</td>
                         <td id="stat_N_${uid}">0</td>
                         <td id="stat_hol_${uid}">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 底部
        let fHtml = `<tr><td colspan="5" style="text-align:right; padding-right:10px; font-weight:bold;">每日上班人數</td>`;
        for(let i=0; i<prevShowDays; i++) fHtml += `<td></td>`;
        for(let d=1; d<=daysInMonth; d++) fHtml += `<td id="day_count_${d}" style="font-weight:bold;">0</td>`;
        fHtml += `<td colspan="4"></td></tr>`;
        tfoot.innerHTML = fHtml;

        this.bindCellEvents();
    },

    renderCellContent: function(val) {
        if (!val) return '';
        if (val === 'OFF') return '<span style="color:#bdc3c7; font-weight:bold;">OFF</span>';
        if (val === 'REQ_OFF') return '<span class="badge badge-success">休</span>';
        const shift = this.shifts.find(s => s.code === val);
        const bg = shift ? shift.color : '#3498db';
        return `<span class="badge" style="background:${bg}; color:white;">${val}</span>`;
    },

    bindCellEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        cells.forEach(cell => {
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                this.handleRightClick(e, cell.dataset.uid, cell.dataset.day);
                return false;
            });
        });
    },

    // --- AI 核心 ---
    runAI: async function() {
        if (typeof SchedulerFactory === 'undefined') {
            alert("❌ AI 模組未載入！\n請確認 index.html 是否包含 SchedulerV2.js, SchedulerFactory.js 等檔案。");
            return;
        }

        if (!confirm("確定要執行 AI 排班嗎？\n這將重新計算並覆蓋現有草稿 (預休除外)。")) return;
        this.isLoading = true;
        this.showLoading();
        
        try {
            // 準備資料 (傳遞 preferences)
            const staffListForAI = this.data.staffList.map(s => {
                const userAssign = this.assignments[s.uid] || {};
                return {
                    id: s.uid, uid: s.uid, name: s.name,
                    packageType: s.packageType || '', 
                    prefs: userAssign.preferences || {}
                };
            });

            const rules = {
                dailyNeeds: this.data.dailyNeeds || {},
                tolerance: 2, backtrackDepth: 3,
                ...(this.data.settings || {})
            };

            const scheduler = SchedulerFactory.create('V2', staffListForAI, this.data.year, this.data.month, {}, rules);
            const aiResult = scheduler.run();

            // 套用結果
            Object.keys(aiResult).forEach(dateStr => {
                const day = parseInt(dateStr.split('-')[2]);
                const daySch = aiResult[dateStr];
                ['N','E','D','OFF'].forEach(code => {
                    if(daySch[code]) {
                        daySch[code].forEach(uid => {
                            if(!this.assignments[uid]) this.assignments[uid] = {};
                            this.assignments[uid][`current_${day}`] = code;
                        });
                    }
                });
            });

            this.renderMatrix();
            this.updateRealTimeStats();
            await this.saveDraft(true);
            alert("✅ AI 排班完成！");

        } catch (e) {
            console.error(e);
            alert("AI 執行失敗: " + e.message);
            this.renderMatrix(); 
        } finally {
            this.isLoading = false;
        }
    },

    // --- [關鍵修正] 還原至預班狀態 ---
    resetSchedule: async function() {
        if (!confirm("確定要重置排班嗎？\n這將還原至「預班」初始狀態（保留預休、包班、偏好，清除手動排班）。")) return;
        
        this.isLoading = true;
        this.showLoading();
        
        try {
            // 1. 讀取原始預班表資料
            if (!this.data.sourceId) throw new Error("無原始預班來源");
            const preDoc = await db.collection('pre_schedules').doc(this.data.sourceId).get();
            if(!preDoc.exists) throw new Error("預班表原始檔遺失");
            const preData = preDoc.data();
            const preAssign = preData.assignments || {};

            // 2. 重建 assignments
            const newAssign = {};
            this.data.staffList.forEach(s => {
                const uid = s.uid;
                newAssign[uid] = {};
                
                // 複製偏好與預班內容
                if (preAssign[uid]) {
                    if (preAssign[uid].preferences) {
                        newAssign[uid].preferences = JSON.parse(JSON.stringify(preAssign[uid].preferences));
                    }
                    Object.keys(preAssign[uid]).forEach(key => {
                        const val = preAssign[uid][key];
                        // 恢復 REQ_OFF, 指定班(!), 以及 last_ 月份資料
                        if (val === 'REQ_OFF' || (val && val.startsWith('!')) || key.startsWith('last_')) {
                            newAssign[uid][key] = val;
                        }
                    });
                }
            });
            
            this.assignments = newAssign;
            
            await this.saveDraft(true);
            this.renderMatrix();
            this.updateRealTimeStats();
            alert("✅ 已還原至預班初始狀態");

        } catch(e) {
            console.error(e);
            alert("重置失敗: " + e.message);
            this.renderMatrix();
        } finally {
            this.isLoading = false;
        }
    },

    saveDraft: async function(silent = false) {
        try {
            if (!silent) this.isLoading = true;
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (!silent) alert("✅ 草稿已儲存");
        } catch (e) { alert("儲存失敗"); }
        finally { if (!silent) this.isLoading = false; }
    },

    publishSchedule: async function() {
        if (!confirm("確定發布？")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'published',
                publishedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'published';
            this.renderToolbar();
            alert("🎉 已發布！");
        } catch(e) { alert("失敗"); }
    },

    unpublishSchedule: async function() {
        if (!confirm("確定取消發布？(變回草稿)")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({ status: 'draft' });
            this.data.status = 'draft';
            this.renderToolbar();
            alert("✅ 已轉回草稿");
        } catch(e) { alert("失敗"); }
    },

    updateRealTimeStats: function() {
        const days = new Date(this.data.year, this.data.month, 0).getDate();
        const dayCounts = {}; for(let d=1; d<=days; d++) dayCounts[d]=0;

        this.data.staffList.forEach(s => {
            let off=0, E=0, N=0, hol=0;
            const uid = s.uid;
            for(let d=1; d<=days; d++) {
                const val = this.assignments[uid][`current_${d}`];
                const date = new Date(this.data.year, this.data.month-1, d);
                const isW = (date.getDay()===0||date.getDay()===6);
                
                if(val==='OFF'||val==='REQ_OFF') {
                    off++; if(isW) hol++;
                } else if(val==='E') E++;
                else if(val==='N') N++;
                
                if(val && val!=='OFF' && val!=='REQ_OFF') dayCounts[d]++;
            }
            const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
            set(`stat_off_${uid}`, off);
            set(`stat_E_${uid}`, E);
            set(`stat_N_${uid}`, N);
            set(`stat_hol_${uid}`, hol);
        });
        
        for(let d=1; d<=days; d++) {
            const el=document.getElementById(`day_count_${d}`);
            if(el) el.textContent=dayCounts[d];
        }
    },

    handleRightClick: function(e, uid, d) {
        this.targetCell = { uid, d };
        const menu = document.getElementById('schContextMenu');
        if (!menu) return;
        
        let list = menu.querySelector('ul');
        if(!list) { list = document.createElement('ul'); menu.appendChild(list); }
        list.innerHTML = '';
        
        list.innerHTML += `<li style="background:#f8f9fa; font-weight:bold; cursor:default;">${d}日 設定</li>`;
        
        this.shifts.forEach(s => {
            list.innerHTML += `<li onclick="scheduleEditorManager.setShift('${s.code}')">
                <span style="color:${s.color}">●</span> ${s.code}
            </li>`;
        });
        
        list.innerHTML += `<hr style="margin:5px 0;">`;
        list.innerHTML += `<li onclick="scheduleEditorManager.setShift('OFF')">OFF (排休)</li>`;
        list.innerHTML += `<li onclick="scheduleEditorManager.setShift(null)" style="color:red;"><i class="fas fa-trash"></i> 清除</li>`;

        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    },

    setShift: function(code) {
        if (!this.targetCell) return;
        const { uid, d } = this.targetCell;
        const key = `current_${d}`;
        
        if (code === null) delete this.assignments[uid][key];
        else this.assignments[uid][key] = code;
        
        const cell = document.querySelector(`td[data-uid="${uid}"][data-day="${d}"]`);
        if(cell) cell.innerHTML = this.renderCellContent(code);
        
        document.getElementById('schContextMenu').style.display = 'none';
        this.updateRealTimeStats();
    },
    
    setupEvents: function() {
        document.addEventListener('click', (e) => {
            const m = document.getElementById('schContextMenu');
            if(m) m.style.display='none';
        });
    },
    cleanup: function() {
        const m = document.getElementById('schContextMenu');
        if(m) m.style.display='none';
    }
};
