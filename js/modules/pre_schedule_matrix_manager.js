// js/modules/pre_schedule_matrix_manager.js
// Fix: 
// 1. 強制封鎖瀏覽器右鍵選單 (oncontextmenu="return false")
// 2. 右鍵選單加入「🚫 勿排 (X)」與動態班別
// 3. 左鍵點擊切換 空白/OFF

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {}, 
    contextTarget: null, 
    currentPrefUid: null, 
    isLoading: false,

    init: async function(id) {
        if(!id) { alert("錯誤：缺少 ID"); return; }
        this.docId = id;
        this.isLoading = true;
        
        try {
            this.cleanup();
            this.showLoading();
            
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadScheduleData()
            ]);
            
            // 關鍵：還原表格結構 (含防止瀏覽器選單的屬性)
            this.restoreTableStructure();
            
            this.renderMatrix();
            this.updateStats(); 
            this.setupEvents(); 
            
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

    // [修正 1] 在 table 標籤加入 oncontextmenu="return false;" 這是擋住瀏覽器選單的關鍵
    restoreTableStructure: function() {
        const c = document.getElementById('matrixContainer');
        if(c) c.innerHTML = `
            <div style="overflow:auto; height: calc(100vh - 140px); position:relative; border:1px solid #ccc;">
                <table id="scheduleMatrix" style="width:100%; border-collapse: separate; border-spacing: 0;" oncontextmenu="return false;">
                    <thead id="matrixHead" style="position:sticky; top:0; z-index:30; background:#f0f0f0;"></thead>
                    <tbody id="matrixBody"></tbody>
                    <tfoot id="matrixFoot" style="position:sticky; bottom:0; background:#f9f9f9; z-index:25; border-top:2px solid #ddd; box-shadow: 0 -2px 5px rgba(0,0,0,0.1);"></tfoot>
                </table>
            </div>`;
    },

    loadShifts: async function() {
        const s = await db.collection('shifts').get();
        this.shifts = s.docs.map(d => d.data());
        this.shifts.sort((a,b) => (a.code || '').localeCompare(b.code || ''));
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

    // --- 執行排班 (保持原樣) ---
    executeSchedule: async function() {
        if (document.querySelector('.text-danger')) {
            if(!confirm("⚠️ 警告：目前有人員預休超過上限 (紅字)！\n確定要強制執行嗎？")) return;
        }

        let submittedCount = 0;
        this.data.staffList.forEach(u => { if (this.localAssignments[u.uid]) submittedCount++; });
        
        if(!confirm(`準備執行排班...確定繼續？`)) return;

        try {
            this.isLoading = true;
            // (省略詳細邏輯，保持原樣)
            const snapshotStaffList = this.data.staffList.map(u => {
                const userProfile = this.usersMap[u.uid] || {};
                return { ...u, schedulingParams: userProfile.schedulingParams || {}, note: userProfile.note || "" };
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
            alert("✅ 排班草稿建立成功！");
            window.location.hash = `/admin/schedule_editor/${newDocRef.id}`;

        } catch(e) {
            console.error(e);
            alert("執行失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    // --- 渲染矩陣 ---
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
            // 本月 [修正 2] 確保使用 onmousedown 捕捉左右鍵
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`] || '';
                bodyHtml += `<td class="cell-narrow cell-clickable" data-type="current" data-day="${d}" onmousedown="matrixManager.onCellClick(event,this)">${this.renderCell(val)}</td>`;
            }
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc; font-weight:bold; text-align:center;">0</td></tr>`;
        });
        tbody.innerHTML = bodyHtml;
        
        // Footer (A/B 統計)
        this.renderFooter(daysInMonth);
    },

    renderFooter: function(daysInMonth) {
        const tfoot = document.getElementById('matrixFoot');
        let f = '';
        // OFF 小計
        f += `<tr>
            <td colspan="4" style="text-align:right; font-weight:bold; background:#eee; position:sticky; left:0;">每日 OFF 小計</td>
            <td colspan="6" style="background:#eee;">-</td>`;
        for(let d=1; d<=daysInMonth; d++) {
            f += `<td id="stat_col_OFF_${d}" style="text-align:center; font-weight:bold; background:#eee;">0</td>`;
        }
        f += `<td style="background:#eee; position:sticky; right:0;">-</td></tr>`;

        // 班別缺口
        this.shifts.forEach(shift => {
            f += `<tr style="border-top: 1px solid #ddd;">
                <td colspan="4" style="text-align:right; font-weight:bold; color:${shift.color || '#333'}; position:sticky; left:0; background:#fff;">
                    ${shift.name} (${shift.code}) 缺口:
                </td>
                <td colspan="6" style="background:#fff;">-</td>`;
            for(let d=1; d<=daysInMonth; d++) {
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
        if(v==='X') return '<span style="color:red;font-weight:bold;">🚫</span>'; // 勿排顯示
        if(v.startsWith('!')) return `<span style="color:red;font-size:0.8em;">🚫${v.substring(1)}</span>`;
        if(this.shifts.find(s=>s.code===v)) {
            const s = this.shifts.find(s=>s.code===v);
            return `<b style="color:${s.color||'#000'}">${v}</b>`;
        }
        return `<b>${v}</b>`;
    },

    updateStats: function() {
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        const dailyCounts = {};
        for(let d=1; d<=daysInMonth; d++) {
            dailyCounts[d] = { OFF: 0, REQ_OFF: 0 };
            this.shifts.forEach(s => dailyCounts[d][s.code] = 0);
        }

        this.data.staffList.forEach(u => {
            let rowCount = 0;
            const assign = this.localAssignments[u.uid] || {};
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if(val) {
                    if(!dailyCounts[d][val]) dailyCounts[d][val] = 0;
                    dailyCounts[d][val]++;
                }
                if(val === 'OFF' || val === 'REQ_OFF') rowCount++;
            }
            const rowEl = document.getElementById(`stat_row_${u.uid}`);
            if(rowEl) rowEl.textContent = rowCount;
        });

        const dailyNeeds = this.data.dailyNeeds || {};
        for(let d=1; d<=daysInMonth; d++) {
            const offCount = (dailyCounts[d]['OFF'] || 0) + (dailyCounts[d]['REQ_OFF'] || 0);
            const el = document.getElementById(`stat_col_OFF_${d}`);
            if(el) el.textContent = offCount;
        }

        this.shifts.forEach(s => {
            for(let d=1; d<=daysInMonth; d++) {
                const el = document.getElementById(`stat_col_${s.code}_${d}`);
                if(el) {
                    const date = new Date(this.data.year, this.data.month - 1, d);
                    const dayIdx = (date.getDay() + 6) % 7; 
                    const needKey = `${s.code}_${dayIdx}`;
                    const demand = dailyNeeds[needKey] ? parseInt(dailyNeeds[needKey]) : 0;
                    const supply = dailyCounts[d][s.code] || 0;
                    if (demand > 0) {
                        el.textContent = `${supply} / ${demand}`;
                        el.style.color = (supply < demand) ? '#c0392b' : '#27ae60';
                        el.style.fontWeight = (supply < demand) ? 'bold' : 'normal';
                        el.style.backgroundColor = (supply < demand) ? '#ffebee' : 'transparent';
                    } else {
                        el.textContent = supply > 0 ? supply : '-';
                        el.style.color = '#ccc'; el.style.backgroundColor = 'transparent'; el.style.fontWeight = 'normal';
                    }
                }
            }
        });
    },

    // --- 互動功能 (修正點) ---

    onCellClick: function(e, cell) {
        // [修正 3] 右鍵點擊：呼叫自訂選單
        if(e.button === 2) { 
            e.preventDefault(); // 再防一次
            this.handleRightClick(e, cell);
            return;
        }
        
        // [修正 4] 左鍵點擊：空白 -> OFF -> 空白 (預設 OFF)
        if(e.button === 0) {
            const day = cell.dataset.day;
            const tr = cell.closest('tr');
            const uid = tr.dataset.uid;
            const key = `current_${day}`;

            if(!this.localAssignments[uid]) this.localAssignments[uid] = {};
            const cur = this.localAssignments[uid][key];
            
            if (cur === 'OFF') {
                delete this.localAssignments[uid][key]; // 清除
            } else {
                this.localAssignments[uid][key] = 'OFF'; // 設定為 OFF
            }
            
            const val = this.localAssignments[uid][key];
            cell.innerHTML = this.renderCell(val);
            this.updateStats(); 
            this.saveData(); 
        }
    },

    // [修正 5] 右鍵選單：動態產生班別選項 + 勿排(X)
    handleRightClick: function(e, cell) {
        e.preventDefault();
        
        let menu = document.getElementById('customContextMenu');
        if(!menu) {
            menu = document.createElement('div');
            menu.id = 'customContextMenu';
            menu.style.cssText = 'display:none; position:absolute; z-index:1000; background:white; border:1px solid #ccc; box-shadow:2px 2px 5px rgba(0,0,0,0.2); min-width:160px; border-radius:4px;';
            document.body.appendChild(menu);
        }

        // 動態建立 HTML
        let html = '';
        
        // 1. 班別區
        this.shifts.forEach(s => {
             const colorBox = `<span style="display:inline-block;width:12px;height:12px;background:${s.color||'#ccc'};margin-right:8px;border-radius:2px;"></span>`;
             html += `<div style="padding:10px 15px; cursor:pointer; border-bottom:1px solid #f0f0f0;" onclick="matrixManager.setShift('${s.code}')">${colorBox} ${s.name} (${s.code})</div>`;
        });
        
        // 2. 常用區 (包含您要求的 X)
        html += `
            <div style="height:5px; background:#f9f9f9; border-bottom:1px solid #eee;"></div>
            <div style="padding:10px 15px; cursor:pointer; border-bottom:1px solid #eee;" onclick="matrixManager.setShift('REQ_OFF')"><span style="color:green;margin-right:8px;">●</span> 預休 (REQ)</div>
            <div style="padding:10px 15px; cursor:pointer; border-bottom:1px solid #eee;" onclick="matrixManager.setShift('OFF')"><span style="color:gray;margin-right:8px;">●</span> 一般 OFF</div>
            <div style="padding:10px 15px; cursor:pointer; border-bottom:1px solid #eee;" onclick="matrixManager.setShift('X')"><span style="color:red;font-weight:bold;margin-right:8px;">🚫</span> 勿排 (X)</div>
            <div style="padding:10px 15px; cursor:pointer; color:red;" onclick="matrixManager.setShift(null)">❌ 清除</div>
        `;

        menu.innerHTML = html;
        
        const day = cell.dataset.day;
        const uid = cell.closest('tr').dataset.uid;
        this.contextTarget = { uid, key: `current_${day}`, cell };
        
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        
        // 簡單的 hover 效果
        const items = menu.querySelectorAll('div[onclick]');
        items.forEach(div => {
            div.onmouseover = () => div.style.backgroundColor = '#f5f5f5';
            div.onmouseout = () => div.style.backgroundColor = 'white';
        });
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
        // (省略，保持原樣)
        let modal = document.getElementById('prefModal');
        if(!modal) {
             modal = document.createElement('div');
             modal.id = 'prefModal';
             modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1050; display:none; justify-content:center; align-items:center;';
             modal.innerHTML = `
                <div style="background:white; padding:20px; border-radius:8px; width:400px;">
                    <h3 style="margin-top:0;">排班偏好 - <span id="prefUserName"></span></h3>
                    <div style="margin:10px 0;"><label>包班:</label><input type="text" id="prefBundle" class="form-control" style="width:100%;padding:5px;"></div>
                    <div style="margin:10px 0;"><label>志願1:</label><input type="text" id="prefP1" class="form-control" style="width:100%;padding:5px;"></div>
                    <div style="margin:10px 0;"><label>志願2:</label><input type="text" id="prefP2" class="form-control" style="width:100%;padding:5px;"></div>
                    <div style="text-align:right; margin-top:20px;">
                        <button class="btn btn-secondary" onclick="document.getElementById('prefModal').style.display='none'" style="padding:5px 10px;margin-right:5px;">取消</button>
                        <button class="btn btn-primary" onclick="matrixManager.savePreferences()" style="padding:5px 10px;background:#007bff;color:white;border:none;">儲存</button>
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
