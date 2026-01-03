// js/modules/pre_schedule_matrix_manager.js (完整修正版)

const matrixManager = {
    docId: null,
    data: null,
    shifts: [],
    localAssignments: {},
    usersMap: {},
    globalClickListener: null,
    isLoading: false,

    init: async function(id) {
        console.log("🎯 Matrix Manager Init:", id);
        
        if(!id) {
            alert("錯誤:缺少預班表 ID");
            window.location.hash = '/admin/pre_schedules';
            return;
        }
        
        // [修正] 先清理舊的資源
        this.cleanup();
        
        this.docId = id;
        this.isLoading = true;
        
        try {
            this.showLoading();
            
            await Promise.all([
                this.loadShifts(),
                this.loadUsers(),
                this.loadScheduleData()
            ]);
            
            this.restoreTableStructure();
            this.renderMatrix();
            this.updateStats();
            this.setupEvents();
            
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }
            
            console.log("✅ Matrix 初始化完成");
            
        } catch(error) {
            console.error("❌ Matrix 初始化失敗:", error);
            alert("載入失敗: " + error.message);
        } finally {
            this.isLoading = false;
        }
    },

    showLoading: function() {
        const container = document.getElementById('matrixContainer');
        if(container) {
            container.innerHTML = '<div style="padding:60px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin" style="font-size:3rem; margin-bottom:20px;"></i><br>載入排班矩陣中...</div>';
        }
    },

    restoreTableStructure: function() {
        const container = document.getElementById('matrixContainer');
        if(container) {
            container.innerHTML = `
                <table id="scheduleMatrix">
                    <thead id="matrixHead"></thead>
                    <tbody id="matrixBody"></tbody>
                    <tfoot id="matrixFoot" style="position:sticky; bottom:0; background:#f9f9f9; z-index:25; font-weight:bold; border-top:2px solid #ddd;"></tfoot>
                </table>
            `;
        }
    },

    loadShifts: async function() {
        const snapshot = await db.collection('shifts').get();
        this.shifts = snapshot.docs.map(doc => doc.data());
    },

    loadUsers: async function() {
        const snapshot = await db.collection('users').where('isActive', '==', true).get();
        snapshot.forEach(doc => { this.usersMap[doc.id] = doc.data(); });
    },

    loadScheduleData: async function() {
        const doc = await db.collection('pre_schedules').doc(this.docId).get();
        if (!doc.exists) throw new Error("資料不存在");
        
        this.data = doc.data();
        this.localAssignments = this.data.assignments || {};
        
        const titleEl = document.getElementById('matrixTitle');
        if(titleEl) titleEl.innerHTML = `${this.data.year} 年 ${this.data.month} 月 - 預班作業`;
        
        const statusMap = { 'open':'開放中', 'closed':'已截止', 'scheduled':'已排班' };
        const st = this.data.status || 'open';
        const statusEl = document.getElementById('matrixStatus');
        if(statusEl) {
            statusEl.textContent = statusMap[st] || st;
            statusEl.className = `badge ${st === 'open' ? 'bg-success' : 'bg-secondary'}`;
        }
    },

    renderMatrix: function() {
        const thead = document.getElementById('matrixHead');
        const tbody = document.getElementById('matrixBody');
        const tfoot = document.getElementById('matrixFoot');
        
        if(!thead || !tbody) return;
        
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const today = new Date().toISOString().split('T')[0];
        
        // 1. 表頭
        let header1 = `<tr><th rowspan="2">員編</th><th rowspan="2">姓名</th><th rowspan="2">特註</th><th rowspan="2">偏好</th><th colspan="6" style="background:#eee;">上月</th><th colspan="${daysInMonth}">本月 ${month} 月</th><th rowspan="2" style="background:#fff; position:sticky; right:0; z-index:20; border-left:2px solid #ccc; width:60px;">統計<br>(OFF)</th></tr>`;
        let header2 = `<tr>`;
        
        const lastMonthLastDay = new Date(year, month - 1, 0).getDate();
        for(let i=5; i>=0; i--) {
            const d = lastMonthLastDay - i;
            header2 += `<th class="cell-last-month cell-narrow">${d}</th>`;
        }
        for(let d=1; d<=daysInMonth; d++) {
            const dateObj = new Date(year, month-1, d);
            const dayOfWeek = dateObj.getDay(); 
            const color = (dayOfWeek===0 || dayOfWeek===6) ? 'color:red;' : '';
            header2 += `<th class="cell-narrow" style="${color}">${d}</th>`;
        }
        header2 += `</tr>`;
        thead.innerHTML = header1 + header2;

        // 2. 內容
        let bodyHtml = '';
        const staffList = this.data.staffList || [];
        staffList.sort((a,b) => (a.empId||'').localeCompare(b.empId||''));

        staffList.forEach(u => {
            const userInfo = this.usersMap[u.uid] || {};
            const params = userInfo.schedulingParams || {};
            let noteIcon = '';

            const isPregnant = params.isPregnant && (!params.pregnantExpiry || params.pregnantExpiry >= today);
            const isBreastfeeding = params.isBreastfeeding && (!params.breastfeedingExpiry || params.breastfeedingExpiry >= today);

            if (isPregnant) noteIcon += '<i class="fas fa-baby" title="孕" style="color:#e67e22;"></i> ';
            if (isBreastfeeding) noteIcon += '<i class="fas fa-cookie" title="哺" style="color:#d35400;"></i>';
            
            const assign = this.localAssignments[u.uid] || {};
            const pref = assign.preferences || {};
            let prefHtml = '';
            if (pref.bundleShift) {
                prefHtml += `<div class="badge" style="background:#3498db; margin-bottom:2px;">包 (${pref.bundleShift})</div>`;
            }
            let orders = [];
            for(let i=1; i<=3; i++) {
                if(pref[`priority_${i}`]) orders.push(pref[`priority_${i}`]);
            }
            if (orders.length > 0) {
                prefHtml += `<div style="font-size:0.8rem; color:#666;">${orders.join(' > ')}</div>`;
            }

            bodyHtml += `<tr data-uid="${u.uid}">
                <td>${u.empId}</td>
                <td>${u.name}</td>
                <td>${noteIcon}</td>
                <td style="cursor:pointer;" onclick="matrixManager.openPreferenceModal('${u.uid}', '${u.name}')">${prefHtml}</td>`;
            
            for(let i=5; i>=0; i--) {
                const d = lastMonthLastDay - i;
                const key = `last_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-last-month cell-narrow" 
                    data-type="last" data-day="${d}" 
                    data-uid="${u.uid}">${this.renderCellContent(val)}</td>`;
            }
            
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = assign[key] || '';
                bodyHtml += `<td class="cell-clickable cell-narrow" 
                    data-type="current" data-day="${d}" 
                    data-uid="${u.uid}">${this.renderCellContent(val)}</td>`;
            }
            
            bodyHtml += `<td id="stat_row_${u.uid}" style="position:sticky; right:0; background:#fff; border-left:2px solid #ccc; font-weight:bold; color:#333;">0</td>`;
            bodyHtml += `</tr>`;
        });
        tbody.innerHTML = bodyHtml;

        // 3. 底部
        let footHtml = `<tr><td colspan="4">每日OFF小計</td>`;
        for(let i=0; i<6; i++) footHtml += `<td class="cell-narrow" style="background:#eee;">-</td>`;
        for(let d=1; d<=daysInMonth; d++) {
            footHtml += `<td id="stat_col_${d}" class="cell-narrow" style="font-weight:bold; color:#333;">0</td>`;
        }
        footHtml += `<td>-</td></tr>`;
        tfoot.innerHTML = footHtml;
        
        // 渲染完成後綁定事件
        this.bindCellEvents();
    },

    renderCellContent: function(val) {
        if(!val) return '';
        if(val === 'OFF') return '<span class="shift-admin-off">OFF</span>';
        if(val === 'REQ_OFF') return '<span class="shift-req-off">休</span>';
        if(val.startsWith('!')) return `<span class="shift-ban"><i class="fas fa-ban"></i> ${val.replace('!', '')}</span>`;
        return `<span class="shift-normal">${val}</span>`;
    },

    // [關鍵修正] 綁定儲存格事件
    bindCellEvents: function() {
        const cells = document.querySelectorAll('.cell-clickable');
        
        cells.forEach(cell => {
            // 左鍵點擊
            cell.addEventListener('mousedown', (e) => {
                if (e.button === 0) { // 只處理左鍵
                    const uid = cell.dataset.uid;
                    const type = cell.dataset.type;
                    const day = cell.dataset.day;
                    const key = type === 'last' ? `last_${day}` : `current_${day}`;
                    
                    this.handleLeftClick(uid, key);
                    const val = (this.localAssignments[uid] && this.localAssignments[uid][key]) || '';
                    cell.innerHTML = this.renderCellContent(val);
                    this.updateStats();
                }
            });
            
            // [關鍵] 右鍵選單
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault(); // 阻擋瀏覽器預設選單
                e.stopPropagation();
                
                const uid = cell.dataset.uid;
                const type = cell.dataset.type;
                const day = cell.dataset.day;
                const key = type === 'last' ? `last_${day}` : `current_${day}`;
                
                this.handleRightClick(e, uid, key, type, day);
                
                return false;
            });
        });
    },

    openPreferenceModal: function(uid, name) {
        const modal = document.getElementById('prefModal');
        if(!modal) return;
        
        document.getElementById('prefTargetUid').value = uid;
        document.getElementById('prefTargetName').textContent = `人員:${name}`;
        modal.classList.add('show');

        const bundleSel = document.getElementById('editBundleShift');
        bundleSel.innerHTML = '<option value="">無 (不包班)</option>';
        const validShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId && sh.isBundleAvailable);
        validShifts.forEach(sh => {
            bundleSel.innerHTML += `<option value="${sh.code}">${sh.name} (${sh.code})</option>`;
        });

        const prefContainer = document.getElementById('editPrefContainer');
        prefContainer.innerHTML = '';
        const s = this.data.settings || {};
        const mode = s.shiftTypeMode; 
        const allowThree = s.allowThreeShifts;
        let count = 0;
        if (mode === "2") count = 2;
        else if (mode === "3") count = allowThree ? 3 : 0;

        if (count > 0) {
            for(let i=1; i<=count; i++) {
                const div = document.createElement('div');
                div.style.cssText = 'display:flex; align-items:center; gap:10px;';
                div.innerHTML = `
                    <span style="font-size:0.9rem; width:60px;">第 ${i} 志願:</span>
                    <select class="pref-select-admin" id="edit_priority_${i}" style="flex:1; padding:6px; border:1px solid #ccc; border-radius:4px;">
                    </select>
                `;
                prefContainer.appendChild(div);
            }
        } else {
            prefContainer.innerHTML = '<div style="color:#999;">此設定模式無需排班志願。</div>';
        }

        const assign = this.localAssignments[uid] || {};
        const pref = assign.preferences || {};
        
        bundleSel.value = pref.bundleShift || "";
        bundleSel.onchange = () => this.updateAdminPrefOptions(uid);
        this.updateAdminPrefOptions(uid);
        
        for(let i=1; i<=count; i++) {
            const sel = document.getElementById(`edit_priority_${i}`);
            if(sel && pref[`priority_${i}`]) sel.value = pref[`priority_${i}`];
        }
    },

    updateAdminPrefOptions: function(uid) {
        const s = this.data.settings || {};
        const mode = s.shiftTypeMode;
        const bundleVal = document.getElementById('editBundleShift').value;
        const unitShifts = this.shifts.filter(sh => sh.unitId === this.data.unitId);
        
        const selects = document.querySelectorAll('.pref-select-admin');
        selects.forEach(sel => {
            const currentVal = sel.value; 
            sel.innerHTML = '<option value="">請選擇</option>';
            
            unitShifts.forEach(sh => {
                let isHidden = false;
                if (mode === "2" && bundleVal !== "") {
                    if (sh.isBundleAvailable && sh.code !== bundleVal) {
                        isHidden = true;
                    }
                }
                if (!isHidden) {
                    sel.innerHTML += `<option value="${sh.code}">${sh.name}</option>`;
                }
            });
            sel.value = currentVal;
            if(sel.selectedIndex === -1) sel.value = "";
        });
    },

    savePreferences: function() {
        const uid = document.getElementById('prefTargetUid').value;
        const bundleShift = document.getElementById('editBundleShift').value;
        
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if (!this.localAssignments[uid].preferences) this.localAssignments[uid].preferences = {};
        
        const pref = this.localAssignments[uid].preferences;
        pref.bundleShift = bundleShift;
        
        const selects = document.querySelectorAll('.pref-select-admin');
        selects.forEach(sel => {
            const key = sel.id.replace('edit_', ''); 
            pref[key] = sel.value;
        });

        this.closePrefModal();
        this.renderMatrix(); 
    },

    closePrefModal: function() {
        const modal = document.getElementById('prefModal');
        if(modal) modal.classList.remove('show');
    },

    handleLeftClick: function(uid, key) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        const current = this.localAssignments[uid][key];
        if (current === 'OFF') delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = 'OFF';
    },

    handleRightClick: function(e, uid, key, type, day) {
        const menu = document.getElementById('customContextMenu');
        const options = document.getElementById('contextMenuOptions');
        const title = document.getElementById('contextMenuTitle');
        
        if (!menu || !options || !title) return;
        
        title.textContent = `設定 ${day} 日 (右鍵)`;
        let html = '';
        
        if (type === 'current') {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'OFF')">
                <span class="menu-icon"><span class="color-dot" style="background:#9b59b6;"></span></span> 強制休 (Admin)
            </div>`;
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'REQ_OFF')">
                <span class="menu-icon"><span class="color-dot" style="background:#2ecc71;"></span></span> 預休 (User)
            </div>`;
            html += `<div class="menu-separator"></div>`;
        } else {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', 'OFF')">
                <span class="menu-icon">O</span> OFF
            </div>`;
            html += `<div class="menu-separator"></div>`;
        }
        
        this.shifts.forEach(s => {
            html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', '${s.code}')">
                <span class="menu-icon" style="color:${s.color}; font-weight:bold;">${s.code}</span> 指定 ${s.name}
            </div>`;
        });
        
        if (type === 'current') {
            html += `<div class="menu-separator"></div>`;
            this.shifts.forEach(s => {
                html += `<div class="menu-item" onclick="matrixManager.setShift('${uid}', '${key}', '!${s.code}')" style="color:#c0392b;">
                    <span class="menu-icon"><i class="fas fa-ban"></i></span> 勿排 ${s.name}
                </div>`;
            });
        }
        
        html += `<div class="menu-separator"></div>`;
        html += `<div class="menu-item" style="color:red;" onclick="matrixManager.setShift('${uid}', '${key}', null)">
            <span class="menu-icon"><i class="fas fa-eraser"></i></span> 清除
        </div>`;
        
        options.innerHTML = html;
        
        // 顯示選單
        menu.style.display = 'block';
        menu.style.visibility = 'hidden';
        
        requestAnimationFrame(() => {
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            let x = e.pageX;
            let y = e.pageY;
            
            if (e.clientX + menuWidth > viewportWidth) {
                x = e.pageX - menuWidth;
            }
            
            if (e.clientY + menuHeight > viewportHeight) {
                y = e.pageY - menuHeight;
            }
            
            x = Math.max(10, Math.min(x, viewportWidth - menuWidth - 10));
            y = Math.max(10, Math.min(y, viewportHeight - menuHeight - 10));
            
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.visibility = 'visible';
        });
    },

    setShift: function(uid, key, val) {
        if (!this.localAssignments[uid]) this.localAssignments[uid] = {};
        if (val === null) delete this.localAssignments[uid][key];
        else this.localAssignments[uid][key] = val;
        
        const type = key.startsWith('last') ? 'last' : 'current';
        const day = key.split('_')[1];
        const row = document.querySelector(`tr[data-uid="${uid}"]`);
        const cell = row?.querySelector(`td[data-type="${type}"][data-day="${day}"]`);
        if(cell) cell.innerHTML = this.renderCellContent(val);
        
        this.updateStats();
        
        const menu = document.getElementById('customContextMenu');
        if(menu) menu.style.display = 'none';
    },

    updateStats: function() {
        const year = this.data.year;
        const month = this.data.month;
        const daysInMonth = new Date(year, month, 0).getDate();
        const maxOff = this.data.settings?.maxOffDays || 8; 
        const colStats = {}; 
        for(let d=1; d<=daysInMonth; d++) colStats[d] = 0;
        
        this.data.staffList.forEach(u => {
            const assign = this.localAssignments[u.uid] || {};
            let totalOff = 0; 
            let userReqOff = 0; 
            for(let d=1; d<=daysInMonth; d++) {
                const val = assign[`current_${d}`];
                if (val === 'OFF' || val === 'REQ_OFF') {
                    totalOff++;
                    colStats[d]++;
                }
                if (val === 'REQ_OFF') userReqOff++;
            }
            const cell = document.getElementById(`stat_row_${u.uid}`);
            if(cell) {
                cell.textContent = totalOff;
                if (userReqOff > maxOff) {
                    cell.classList.add('text-danger');
                    cell.title = `預休 ${userReqOff} 天,超過上限 ${maxOff} 天`;
                } else {
                    cell.classList.remove('text-danger');
                    cell.title = '';
                }
            }
        });
        
        for(let d=1; d<=daysInMonth; d++) {
            const cell = document.getElementById(`stat_col_${d}`);
            if(cell) cell.textContent = colStats[d];
        }
    },

    setupEvents: function() {
        // 全局點擊監聽 (關閉選單)
        this.globalClickListener = (e) => {
            const menu = document.getElementById('customContextMenu');
            if (menu && menu.style.display === 'block') {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                }
            }
        };
        document.addEventListener('click', this.globalClickListener);
    },

    cleanup: function() {
        // 移除全局點擊監聽
        if (this.globalClickListener) {
            document.removeEventListener('click', this.globalClickListener);
            this.globalClickListener = null;
        }
        
        // [新增] 清理儲存格事件監聽器
        const cells = document.querySelectorAll('.cell-clickable');
        cells.forEach(cell => {
            // 使用 cloneNode 移除所有事件監聽器
            const newCell = cell.cloneNode(true);
            cell.parentNode?.replaceChild(newCell, cell);
        });
        
        // 清理選單元素
        const menu = document.getElementById('customContextMenu');
        if (menu) {
            menu.style.display = 'none';
        }
        
        console.log("🧹 Matrix 清理完成");
    },

    saveData: async function() {
        try {
            this.isLoading = true;
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                'progress.submitted': Object.keys(this.localAssignments).length, 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("✅ 草稿已儲存");
        } catch(e) { 
            console.error(e); 
            alert("儲存失敗: " + e.message); 
        } finally { 
            this.isLoading = false; 
        }
    },

    executeSchedule: async function() {
        if (document.querySelector('.text-danger')) {
            if(!confirm("⚠️ 警告:有紅字!確定強制執行?")) return;
        } else {
            if(!confirm("確定執行排班?執行後將截止預班。")) return;
        }
        try {
            this.isLoading = true;
            await db.collection('pre_schedules').doc(this.docId).update({
                assignments: this.localAssignments,
                status: 'closed', 
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert("✅ 執行成功!");
            history.back(); 
        } catch(e) { 
            alert("執行失敗: " + e.message); 
        } finally { 
            this.isLoading = false; 
        }
    }
};

// [移除] 不需要額外的初始化包裝,在 init 內部已經呼叫 cleanup
