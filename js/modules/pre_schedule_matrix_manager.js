// js/modules/pre_schedule_matrix_manager.js
// Fix: 預班表矩陣增加「人力供需 (A/B)」即時統計列，並修復互動功能

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {}, 
    contextTarget: null, // 用於右鍵選單定位
    currentPrefUid: null, // 當前正在編輯偏好的 User ID
    isLoading: false,

    init: async function(id) {
        if(!id) { alert("錯誤：缺少 ID"); return; }
        this.docId = id;
        this.isLoading = true;
        
        try {
            // 初始化前先清理舊 DOM
            this.cleanup();

            this.showLoading();
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadScheduleData()
            ]);
            
            this.restoreTableStructure();
            this.renderMatrix();
            this.updateStats(); // 計算初始統計
            this.setupEvents(); // 綁定事件與選單
            
        } catch(error) {
            console.error(error);
            alert("載入失敗: " + error.message);
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = '<div style="padding:50px;text-align:center;">資料載入中...</div>';
    },

    restoreTableStructure: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = `
            <table id="scheduleMatrix" oncontextmenu="return false;">
                <thead id="matrixHead"></thead>
                <tbody id="matrixBody"></tbody>
                <tfoot id="matrixFoot" style="position:sticky; bottom:0; background:#f9f9f9; z-index:25; border-top:2px solid #ddd; box-shadow: 0 -2px 5px rgba(0,0,0,0.1);"></tfoot>
            </table>`;
    },

    loadShifts: async function() {
        const s = await db.collection('shifts').get();
        this.shifts = s.docs.map(d => d.data());
    },

    loadUsers: async function() {
        const s = await db.collection('users').where('isActive', '==', true).get();
        s.forEach(d => { this.usersMap[d.id] = d.data(); });
    },

    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) throw new Error("資料不存在");
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        
        const t = document.getElementById('matrixTitle');
        if(t) t.innerHTML = `${this.data.year} 年 ${this.data.month} 月 - 預班作業`;
        
        const stBadge = document.getElementById('matrixStatus');
        if(stBadge) {
            const st = this.data.status || 'open';
            stBadge.textContent = st === 'open' ? '開放中' : (st==='scheduled'?'已排班':'已截止');
            stBadge.className = `badge ${st === 'open' ? 'bg-success' : 'bg-secondary'}`;
        }
    },

    // --- [核心] 執行排班 ---
    executeSchedule: async function() {
        if (document.querySelector('.text-danger')) {
            if(!confirm("⚠️ 警告：目前有人員預休超過上限 (紅字)！\n確定要強制執行嗎？")) return;
        }

        let submittedCount = 0;
        this.data.staffList.forEach(u => { if (this.localAssignments[u.uid]) submittedCount++; });
        const unsubmitted = this.data.staffList.length - submittedCount;
        
        const msg = `準備執行排班：\n總人數：${this.data.staffList.length}\n已預班：${submittedCount}\n未預班：${unsubmitted}\n\n執行後將鎖定此預班表並建立排班草稿。\n確定繼續？`;
        if(!confirm(msg)) return;

        try {
            this.isLoading = true;

            const snapshotStaffList = this.data.staffList.map(u => {
                const userProfile = this.usersMap[u.uid] || {};
                const params = userProfile.schedulingParams || {};
                const note = userProfile.note || ""; 
                return { ...u, schedulingParams: params, note: note };
            });

            const newScheduleData = {
                unitId: this.data.unitId,
                year: this.data.year,
                month: this.data.month,
                sourceId: this.docId,
                status: 'draft',
                staffList: JSON.parse(JSON.stringify(snapshotStaffList)),
                assignments: JSON.parse(JSON.stringify(this.localAssignments)),
                rules: this.data.rules || {}, 
                dailyNeeds: JSON.parse(JSON.stringify(this.data.dailyNeeds || {})),
                createdBy: app.currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            const batch = db.batch();
            const newDocRef = db.collection('schedules').doc();
            batch.set(newDocRef, newScheduleData);
            
            const preDocRef = db.collection('pre_schedules').doc(this.docId);
            batch.update(preDocRef, {
                status: 'scheduled',
                assignments: this.localAssignments, 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();
            alert("✅ 排班草稿建立成功！\n即將進入排班作業頁面...");
            window.location.hash = `/admin/schedule_editor/${newDocRef.id}`;

        } catch(e) {
            console.error(e);
            alert("執行失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    // --- 渲染矩陣主體 ---
    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();
        
        // 表頭
        let h1 = `<tr>
            <th rowspan="2" style="min-width:60px; position:sticky; left:0; z-index:30; background:#f8f9fa;">員編</th>
            <th rowspan="2" style="min-width:70px; position:sticky; left:60px; z-index:30; background:#f8f9fa;">姓名</th>
            <th rowspan="2" style="width:40px; z-index:20;">註</th>
            <th rowspan="2" style="min-width:50px; z-index:20;">偏好</th>
            <th colspan="6" style="background:#eee;">上月</th>
            <th colspan="${daysInMonth}">本月 ${month} 月</th>
            <th rowspan="2" style="background:#fff; position:sticky; right:0; border-left:2px solid #ccc; z-index:30;">統計</th>
        </tr>`;
        
        let h2 = `<tr>`;
        for(let i=5; i>=0; i--) h2 += `<th class="cell-last-month cell-narrow">${lastMonthLastDay - i}</th>`;
        for(let d=1; d<=daysInMonth; d++) {
            const w = new Date(year, month-1, d).getDay();
            const c = (w===0||w===6) ? 'color:red;' : '';
            h2 += `<th class="cell-narrow" style="${c}">${d}</th>`;
        }
        h2 += `</tr>`;
        thead.innerHTML = h1 + h2;

        // 內容
        let bodyHtml = '';
        const list = this.data.staffList || [];
        list.sort((a,b) => (a.empId||'').localeCompare(b.empId||''));

        list.forEach(u => {
            const userProfile = this.usersMap[u.uid] || {};
            const params = userProfile.schedulingParams || {};
            let icon = '';
            if(params.isPregnant) icon += '🤰 ';
            if(params.isBreastfeeding) icon += '🤱 ';
            if(userProfile.note) icon += `<span title="${userProfile.note}">📝</span>`;
            
            const assign = this.localAssignments[u.uid] || {};
            const pref = assign.preferences || {};
            let prefInfo = pref.bundleShift ? `<span class="badge bg-info">包${pref.bundleShift}</span>` : '設定';

            bodyHtml += `<tr data-uid="${u.uid}">
                <td style="position:sticky; left:0; background:#fff; z-index:10;">${u.empId}</td>
                <td style="position:sticky; left:60px; background:#fff; z-index:10;">${u.name}</td>
                <td>${icon}</td>
                <td style="cursor:pointer; color:blue;" onclick="matrixManager.openPreferenceModal('${u.uid}','${u.name}')">${prefInfo}</td>`;
            
            // 上月
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const val = assign[`last_${d}`] || '';
                bodyHtml += `<td class="cell-last-month cell-narrow" data-type="last" data-day="${d}">${this.renderCell(val)}</td>`;
            }
            // 本月
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`] || '';
                bodyHtml += `<td class="cell-narrow cell-clickable" data-type="current" data-day="${d}" onmousedown="matrixManager.onCellClick(event,this)">${this.renderCell(val)}</td>`;
            }
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc; font-weight:bold; text-align:center;">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;
        
        // 渲染 Footer
        this.renderFooter(daysInMonth);
    },

    // --- [新增] 渲染 Footer (含每日 OFF 小計與各班別供需) ---
    renderFooter: function(daysInMonth) {
        const tfoot = document.getElementById('matrixFoot');
        let f = '';

        // 1. 每日 OFF 小計列
        f += `<tr>
            <td colspan="4" style="text-align:right; font-weight:bold; background:#eee; position:sticky; left:0;">每日 OFF 小計</td>
            <td colspan="6" style="background:#eee;">-</td>`; // 上月 padding
        for(let d=1; d<=daysInMonth; d++) {
            f += `<td id="stat_col_OFF_${d}" style="text-align:center; font-weight:bold; background:#eee;">0</td>`;
        }
        f += `<td style="background:#eee; position:sticky; right:0;">-</td></tr>`;

        // 2. 各班別供需列 (A/B)
        // 根據 shifts 動態生成
        this.shifts.forEach(shift => {
            f += `<tr style="border-top: 1px solid #ddd;">
                <td colspan="4" style="text-align:right; font-weight:bold; color:${shift.color || '#333'}; position:sticky; left:0; background:#fff;">
                    ${shift.name} (${shift.code}) 缺口:
                </td>
                <td colspan="6" style="background:#fff;">-</td>`;
            
            for(let d=1; d<=daysInMonth; d++) {
                // 給予唯一 ID，方便 updateStats 更新
                f += `<td id="stat_col_${shift.code}_${d}" style="text-align:center; font-size:0.85em; background:#fff;">-</td>`;
            }
            f += `<td style="background:#fff; position:sticky; right:0;">-</td></tr>`;
        });

        tfoot.innerHTML = f;
    },

    renderCell: function(v) {
        if(!v) return '';
        if(v==='OFF') return '<span style="color:#ccc;">OFF</span>';
        if(v==='REQ_OFF') return '<span style="color:green;font-weight:bold;">休</span>';
        if(v.startsWith('!')) return `<span style="color:red;font-size:0.8em;">🚫${v.substring(1)}</span>`;
        return `<b>${v}</b>`;
    },

    // --- [核心] 統計更新 (含 A/B 供需計算) ---
    updateStats: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        
        // 1. 初始化計數器
        const dailyCounts = {}; // { 1: { OFF:0, N:0, E:0 ... }, 2: ... }
        for(let d=1; d<=daysInMonth; d++) {
            dailyCounts[d] = { OFF: 0, REQ_OFF: 0 };
            this.shifts.forEach(s => dailyCounts[d][s.code] = 0);
        }

        // 2. 遍歷所有人員，計算行統計與累積每日計數
        this.data.staffList.forEach(u => {
            let rowCount = 0;
            const assign = this.localAssignments[u.uid] || {};
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if(val) {
                    if(!dailyCounts[d][val]) dailyCounts[d][val] = 0;
                    dailyCounts[d][val]++;
                }
                
                if(val === 'OFF' || val === 'REQ_OFF') {
                    rowCount++;
                }
            }
            // 更新行統計 (右側)
            const rowEl = document.getElementById(`stat_row_${u.uid}`);
            if(rowEl) rowEl.textContent = rowCount;
        });

        // 3. 更新 Footer (底部)
        const dailyNeeds = this.data.dailyNeeds || {};

        // 3.1 更新 OFF 小計
        for(let d=1; d<=daysInMonth; d++) {
            const offCount = (dailyCounts[d]['OFF'] || 0) + (dailyCounts[d]['REQ_OFF'] || 0);
            const el = document.getElementById(`stat_col_OFF_${d}`);
            if(el) el.textContent = offCount;
        }

        // 3.2 更新各班別供需 (A/B)
        this.shifts.forEach(s => {
            for(let d=1; d<=daysInMonth; d++) {
                const el = document.getElementById(`stat_col_${s.code}_${d}`);
                if(el) {
                    // 計算需求
                    const date = new Date(this.data.year, this.data.month - 1, d);
                    const dayIdx = (date.getDay() + 6) % 7; // JS 0=Sun, 轉為 0=Mon
                    const needKey = `${s.code}_${dayIdx}`;
                    const demand = dailyNeeds[needKey] ? parseInt(dailyNeeds[needKey]) : 0;
                    const supply = dailyCounts[d][s.code] || 0;

                    // 顯示邏輯
                    if (demand > 0) {
                        el.textContent = `${supply} / ${demand}`; // A / B
                        
                        // 顏色判斷
                        if (supply < demand) {
                            // 缺人：紅底紅字
                            el.style.backgroundColor = '#ffebee';
                            el.style.color = '#c0392b';
                            el.style.fontWeight = 'bold';
                        } else {
                            // 足夠：綠字
                            el.style.backgroundColor = 'transparent';
                            el.style.color = '#27ae60';
                            el.style.fontWeight = 'normal';
                        }
                    } else {
                        // 無需求
                        el.textContent = supply > 0 ? supply : '-';
                        el.style.backgroundColor = 'transparent';
                        el.style.color = '#ccc';
                        el.style.fontWeight = 'normal';
                    }
                }
            }
        });
    },

    // --- 互動功能 ---
    onCellClick: function(e, cell) {
        if(e.button === 2) { // 右鍵
            this.handleRightClick(e, cell);
            return;
        }
        // 左鍵
        const day = cell.dataset.day;
        const tr = cell.closest('tr');
        const uid = tr.dataset.uid;
        
        this.handleLeftClick(uid, `current_${day}`);
        
        const val = this.localAssignments[uid][`current_${day}`];
        cell.innerHTML = this.renderCell(val);
        this.updateStats(); // 即時更新統計
        this.saveData(); // 自動儲存
    },

    handleLeftClick: function(uid, key) {
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
        const cur = this.localAssignments[uid][key];
        
        // 循環邏輯: 空 -> REQ_OFF -> OFF -> 空
        if(!cur) this.localAssignments[uid][key] = 'REQ_OFF';
        else if(cur === 'REQ_OFF') this.localAssignments[uid][key] = 'OFF';
        else delete this.localAssignments[uid][key];
    },

    handleRightClick: function(e, cell) {
        e.preventDefault();
        const menu = document.getElementById('customContextMenu');
        if(!menu) return;
        
        const day = cell.dataset.day;
        const uid = cell.closest('tr').dataset.uid;
        this.contextTarget = { uid, key: `current_${day}`, cell };
        
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    },

    setShift: function(val) {
        if(this.contextTarget) {
            const { uid, key, cell } = this.contextTarget;
            if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
            
            if(val === null) delete this.localAssignments[uid][key];
            else this.localAssignments[uid][key] = val;
            
            cell.innerHTML = this.renderCell(val);
            this.updateStats();
            this.saveData();
        }
        const menu = document.getElementById('customContextMenu');
        if(menu) menu.style.display = 'none';
    },

    openPreferenceModal: function(uid, name) {
        // 清除舊 Modal
        let modal = document.getElementById('prefModal');
        const userNameSpan = document.getElementById('prefUserName');
        if (modal && !userNameSpan) { modal.remove(); modal = null; }

        if(!modal) {
            modal = document.createElement('div');
            modal.id = 'prefModal';
            modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1050; display:none; justify-content:center; align-items:center;';
            modal.innerHTML = `
                <div style="background:white; padding:20px; border-radius:8px; width:400px; box-shadow:0 4px 15px rgba(0,0,0,0.3);">
                    <h3 style="margin-top:0;">排班偏好 - <span id="prefUserName" style="color:blue;"></span></h3>
                    <div style="margin-bottom:15px;">
                        <label>包班請求 (例如: N):</label>
                        <input type="text" id="prefBundle" style="width:100%; padding:8px; margin-top:5px;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>志願序 1:</label>
                        <input type="text" id="prefP1" style="width:100%; padding:8px; margin-top:5px;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>志願序 2:</label>
                        <input type="text" id="prefP2" style="width:100%; padding:8px; margin-top:5px;">
                    </div>
                    <div style="text-align:right;">
                        <button class="btn btn-secondary" onclick="document.getElementById('prefModal').style.display='none'">取消</button>
                        <button class="btn btn-primary" onclick="matrixManager.savePreferences()">儲存</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }
        
        this.currentPrefUid = uid;
        document.getElementById('prefUserName').textContent = name;
        const assign = this.localAssignments[uid] || {};
        const pref = assign.preferences || {};
        
        document.getElementById('prefBundle').value = pref.bundleShift || '';
        document.getElementById('prefP1').value = pref.priority_1 || '';
        document.getElementById('prefP2').value = pref.priority_2 || '';
        
        modal.style.display = 'flex';
    },

    savePreferences: function() {
        const uid = this.currentPrefUid;
        if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if(!this.localAssignments[uid].preferences) this.localAssignments[uid].preferences = {};
        
        const p = this.localAssignments[uid].preferences;
        p.bundleShift = document.getElementById('prefBundle').value.trim();
        p.priority_1 = document.getElementById('prefP1').value.trim();
        p.priority_2 = document.getElementById('prefP2').value.trim();
        
        document.getElementById('prefModal').style.display = 'none';
        this.renderMatrix(); 
        this.saveData();
    },

    saveData: async function() {
        if(!this.docId) return;
        try {
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch(e) { console.error("Auto save failed", e); }
    },

    setupEvents: function() {
        document.addEventListener('click', e => {
            const m = document.getElementById('customContextMenu');
            if(m && !m.contains(e.target)) m.style.display='none';
        });
        
        if(!document.getElementById('customContextMenu')) {
            const menu = document.createElement('div');
            menu.id = 'customContextMenu';
            menu.style.cssText = 'display:none; position:absolute; z-index:1000; background:white; border:1px solid #ccc; box-shadow:2px 2px 5px rgba(0,0,0,0.2); min-width:120px;';
            menu.innerHTML = `
                <div style="padding:10px 15px; cursor:pointer; border-bottom:1px solid #eee;" onclick="matrixManager.setShift('REQ_OFF')">🟢 設為 休(預)</div>
                <div style="padding:10px 15px; cursor:pointer; border-bottom:1px solid #eee;" onclick="matrixManager.setShift('OFF')">⚪ 設為 OFF</div>
                <div style="padding:10px 15px; cursor:pointer; color:red;" onclick="matrixManager.setShift(null)">❌ 清除</div>
            `;
            document.body.appendChild(menu);
        }
    },
    
    cleanup: function() {
        const ids = ['prefModal', 'customContextMenu', 'scheduleMatrix'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.remove();
        });
    }
};

// Hook Init
const _origInit = matrixManager.init;
matrixManager.init = function(id) { 
    if(this.cleanup) this.cleanup(); 
    _origInit.call(this, id); 
};
