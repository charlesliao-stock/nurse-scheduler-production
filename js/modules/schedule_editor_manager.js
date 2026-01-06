// js/modules/schedule_editor_manager.js
// 🔧 修正版：修復語法錯誤並優化動態班別統計

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
        
        const isString = typeof val === 'string';
        if (isString && val.startsWith('!')) {
            return `<span style="color:red; font-size:0.8rem;"><i class="fas fa-ban"></i> ${val.replace('!', '')}</span>`;
        }

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

    // 🔧 [關鍵修正] AI 排班函數
    runAI: async function() {
        // 1. 檢查模組是否載入
        if (typeof SchedulerFactory === 'undefined') {
            alert("❌ AI 模組未載入!\n請確認 index.html 是否包含 SchedulerV2.js, SchedulerFactory.js 等檔案。");
            return;
        }

        if (!confirm("確定要執行 AI 排班嗎?\n這將重新計算並覆蓋現有草稿 (預休除外)。")) return;
        
        // 2. 顯示載入中
        this.isLoading = true;
        const tbody = document.getElementById('schBody');
        const originalHtml = tbody.innerHTML;
        tbody.innerHTML = '<tr><td colspan="20" style="padding:40px; text-align:center;"><i class="fas fa-robot fa-spin" style="font-size:3rem; color:#8e44ad;"></i><br><br><h3 style="color:#8e44ad;">🤖 AI 排班運算中...</h3><p style="color:#666;">請稍候，系統正在智慧分配班表</p></td></tr>';
        
        try {
            console.log("🤖 開始 AI 排班...");
            console.log("📊 人員數量:", this.data.staffList.length);
            console.log("📅 排班月份:", `${this.data.year}/${this.data.month}`);
            
            // 3. 準備 AI 輸入資料
            const staffListForAI = this.data.staffList.map(s => {
                const userAssign = this.assignments[s.uid] || {};
                return {
                    id: s.uid, 
                    uid: s.uid, 
                    name: s.name,
                    packageType: s.packageType || '', 
                    prefs: userAssign.preferences || {}
                };
            });

            // 🔧 修正：動態抓取單位班別，避免硬編碼 N/E/D
            const shiftCodes = this.shifts.map(s => s.code);
            
            const rules = {
                dailyNeeds: this.data.dailyNeeds || {},
                shiftCodes: shiftCodes, // 傳遞班別清單
                tolerance: 2, 
                backtrackDepth: 3,
                ...(this.data.settings || {})
            };

            console.log("⚙️ 規則設定:", rules);

            // 4. 執行 AI 排班
            const scheduler = SchedulerFactory.create('V2', staffListForAI, this.data.year, this.data.month, {}, rules);
            const aiResult = scheduler.run();

            console.log("✅ AI 排班完成，結果:", aiResult);

            // 5. 🔧 [關鍵修正] 完整清空並重建 assignments
            // 先保留預休 (REQ_OFF) 和勿排 (!)
            const preservedData = {};
            this.data.staffList.forEach(staff => {
                const uid = staff.uid;
                const userAssign = this.assignments[uid] || {};
                preservedData[uid] = {
                    preferences: userAssign.preferences || {}
                };
                
                // 保留上個月資料
                Object.keys(userAssign).forEach(key => {
                    if (key.startsWith('last_')) {
                        preservedData[uid][key] = userAssign[key];
                    }
                });

                // 保留預休與勿排
                Object.keys(userAssign).forEach(key => {
                    if (key.startsWith('current_')) {
                        const val = userAssign[key];
                        if (val === 'REQ_OFF' || (typeof val === 'string' && val.startsWith('!'))) {
                            preservedData[uid][key] = val;
                        }
                    }
                });
            });

            // 6. 🔧 重置 assignments 為保留的資料
            this.assignments = JSON.parse(JSON.stringify(preservedData));

            // 7. 🔧 填入 AI 結果
            let successCount = 0;
            
            Object.keys(aiResult).forEach(dateStr => {
                const parts = dateStr.split(/[-/]/); 
                const day = parseInt(parts[2], 10);
                if (isNaN(day)) return;

                const daySch = aiResult[dateStr];
                if (!daySch) return;

                Object.keys(daySch).forEach(shiftCode => {
                    let rawUsers = daySch[shiftCode];
                    let assignedUsers = Array.isArray(rawUsers) ? rawUsers : (rawUsers instanceof Set ? Array.from(rawUsers) : []);

                    assignedUsers.forEach(uid => {
                        if(!this.assignments[uid]) this.assignments[uid] = { preferences: {} };
                        
                        const key = `current_${day}`;
                        const currentVal = this.assignments[uid][key];

                        // 檢查是否鎖定 (預休 REQ_OFF 或 !鎖定)
                        const isPreOff = currentVal === 'REQ_OFF';
                        const isLocked = (typeof currentVal === 'string' && currentVal.startsWith('!'));

                        if (!isPreOff && !isLocked) {
                            this.assignments[uid][key] = shiftCode;
                            successCount++;
                        }
                    });
                });
            });
            
            console.log(`📝 最終寫入統計: ${successCount} 筆`);

            // 8. 🔧 強制重新渲染
            this.renderMatrix();
            this.updateRealTimeStats();
            
            // 9. 自動儲存
            await this.saveDraft(true);
            
            // 10. 成功提示
            alert(`✅ AI 排班完成!\n\n✓ 已分配 ${successCount} 個班次\n✓ 已保留預休與偏好設定\n✓ 草稿已自動儲存`);

        } catch (e) {
            console.error("❌ AI 執行失敗:", e);
            tbody.innerHTML = originalHtml;
            this.bindCellEvents();
            alert(`AI 執行失敗:\n\n${e.message}`);
        } finally {
            this.isLoading = false;
        }
    },

    resetSchedule: async function() {
        if (!confirm("確定要重置排班嗎?\n這將還原至「預班」初始狀態(保留預休、包班、偏好,清除手動排班)。")) return;
        
        this.isLoading = true;
        this.showLoading();
        
        try {
            if (!this.data.sourceId) throw new Error("無原始預班來源");
            const preDoc = await db.collection('pre_schedules').doc(this.data.sourceId).get();
            if(!preDoc.exists) throw new Error("預班表原始檔遺失");
            const preData = preDoc.data();
            const preAssign = preData.assignments || {};

            const newAssign = {};
            this.data.staffList.forEach(s => {
                const uid = s.uid;
                newAssign[uid] = {};
                
                if (preAssign[uid]) {
                    if (preAssign[uid].preferences) {
                        newAssign[uid].preferences = JSON.parse(JSON.stringify(preAssign[uid].preferences));
                    }
                    Object.keys(preAssign[uid]).forEach(key => {
                        const val = preAssign[uid][key];
                        const isString = typeof val === 'string';
                        if (val === 'REQ_OFF' || (isString && val.startsWith('!')) || key.startsWith('last_')) {
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
        } catch (e) { 
            console.error("儲存失敗:", e);
            if (!silent) alert("儲存失敗: " + e.message); 
        }
        finally { if (!silent) this.isLoading = false; }
    },

    publishSchedule: async function() {
        if (!confirm("確定發布?")) return;
        try {
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'published',
                publishedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.data.status = 'published';
            this.renderToolbar();
            alert("🎉 已發布!");
        } catch(e) { alert("失敗"); }
    },

    unpublishSchedule: async function() {
        if (!confirm("確定取消發布?(變回草稿)")) return;
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
            const userAssign = this.assignments[uid] || {};
            
            for(let d=1; d<=days; d++) {
                const val = userAssign[`current_${d}`];
                const date = new Date(this.data.year, this.data.month-1, d);
                const isW = (date.getDay()===0||date.getDay()===6);
                
                if(val==='OFF'||val==='REQ_OFF') {
                    off++; if(isW) hol++;
                } else if(val && val.includes('E')) E++;
                else if(val && val.includes('N')) N++;
                
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
        
        if(!this.assignments[uid]) this.assignments[uid] = {};
        
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
