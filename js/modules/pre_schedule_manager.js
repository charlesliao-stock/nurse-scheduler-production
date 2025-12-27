// js/modules/pre_schedule_manager.js

const preScheduleManager = {
    currentUnitId: null,
    currentUnitGroups: [],
    staffListSnapshot: [], 
    staffSortState: { field: 'isSupport', order: 'asc' },
    
    // --- 初始化 ---
    init: async function() {
        console.log("Pre-Schedule Manager Loaded.");
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = '<h3 style="color:red; padding:20px;">權限不足</h3>';
            return;
        }
        await this.loadUnitDropdown();
    },

    // --- 1. 載入單位 ---
    loadUnitDropdown: async function() {
        const select = document.getElementById('filterPreUnit');
        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
            }
            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            snapshot.forEach(doc => {
                select.innerHTML += `<option value="${doc.id}">${doc.data().name}</option>`;
            });
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadData();
            }
            select.onchange = () => this.loadData();
        } catch (e) { console.error(e); }
    },

    // --- 2. 載入列表 ---
    loadData: async function() {
        const unitId = document.getElementById('filterPreUnit').value;
        this.currentUnitId = unitId;
        const tbody = document.getElementById('preScheduleTableBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">載入中...</td></tr>';

        if (!unitId) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">請先選擇單位</td></tr>';
            return;
        }

        const unitDoc = await db.collection('units').doc(unitId).get();
        this.currentUnitGroups = unitDoc.exists ? (unitDoc.data().groups || []) : [];

        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc').orderBy('month', 'desc')
                .get();

            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">尚無預班表，請點擊新增</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            snapshot.forEach(doc => {
                const d = doc.data();
                const period = `${d.settings.openDate} ~ ${d.settings.closeDate}`;
                const progress = d.progress ? `${d.progress.submitted} / ${d.progress.total}` : '0 / 0';
                
                let statusHtml = '<span class="badge" style="background:#95a5a6;">未知</span>';
                if(d.status === 'open') statusHtml = '<span class="badge" style="background:#2ecc71;">開放中</span>';
                else if(d.status === 'closed') statusHtml = '<span class="badge" style="background:#e74c3c;">已截止</span>';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:bold;">${d.year} 年 ${d.month} 月</td>
                    <td><small>${period}</small></td>
                    <td>${progress}</td>
                    <td>${statusHtml}</td>
                    <td>
                        <button class="btn btn-primary" style="padding:4px 8px;" onclick="preScheduleManager.manage('${doc.id}')">管理</button>
                        <button class="btn btn-edit" onclick="preScheduleManager.openModal('${doc.id}')">設定</button>
                        <button class="btn btn-delete" onclick="preScheduleManager.deleteSchedule('${doc.id}')">刪除</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="5" style="color:red;">載入失敗</td></tr>';
        }
    },

    // --- 3. Modal 操作 ---
    openModal: async function(docId = null) {
        if(!this.currentUnitId) { alert("請先選擇單位"); return; }
        
        const modal = document.getElementById('preScheduleModal');
        modal.classList.add('show');
        document.getElementById('preScheduleDocId').value = docId || '';
        document.getElementById('currentMode').value = docId ? 'edit' : 'add';
        document.getElementById('searchResults').innerHTML = ''; 
        document.getElementById('inputSearchStaff').value = '';

        this.switchTab('basic');

        if (docId) {
            document.getElementById('btnImportLast').style.display = 'none';
            const doc = await db.collection('pre_schedules').doc(docId).get();
            const data = doc.data();
            this.fillForm(data);
            this.staffListSnapshot = data.staffList || [];
            this.renderStaffList();
            this.renderGroupLimitsTable(data.groupLimits);
        } else {
            document.getElementById('btnImportLast').style.display = 'inline-block';
            
            const nextMonth = new Date();
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            document.getElementById('inputPreYear').value = nextMonth.getFullYear();
            document.getElementById('inputPreMonth').value = nextMonth.getMonth() + 1;
            
            const y = nextMonth.getFullYear();
            const m = nextMonth.getMonth() + 1;
            const mStr = m < 10 ? '0'+m : m;
            document.getElementById('inputOpenDate').value = `${y}-${mStr}-01`;
            document.getElementById('inputCloseDate').value = `${y}-${mStr}-10`;

            document.getElementById('inputMaxOff').value = 8;
            document.getElementById('inputMaxHoliday').value = 2;
            document.getElementById('inputDailyReserve').value = 2;
            document.getElementById('checkShowAllNames').checked = true;
            document.getElementById('inputShiftMode').value = "3";
            this.toggleThreeShiftOption();
            
            await this.loadCurrentUnitStaff();
            this.renderStaffList();
            this.renderGroupLimitsTable({});
        }
    },

    closeModal: function() {
        document.getElementById('preScheduleModal').classList.remove('show');
    },

    switchTab: function(tabName) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        const btns = document.querySelectorAll('.tab-btn');
        if(tabName==='basic') btns[0].classList.add('active');
        if(tabName==='limits') btns[1].classList.add('active');
        if(tabName==='staff') btns[2].classList.add('active');

        document.getElementById(`tab-${tabName}`).classList.add('active');
    },

    toggleThreeShiftOption: function() {
        const mode = document.getElementById('inputShiftMode').value;
        const div = document.getElementById('divAllowThree');
        div.style.display = (mode === "2") ? 'block' : 'none';
    },

    // --- 4. 人員管理 ---
    
    loadCurrentUnitStaff: async function() {
        const snapshot = await db.collection('users')
            .where('unitId', '==', this.currentUnitId)
            .where('isActive', '==', true)
            .get();
        
        this.staffListSnapshot = snapshot.docs.map(doc => ({
            uid: doc.id,
            empId: doc.data().employeeId,
            name: doc.data().displayName,
            level: doc.data().level,
            group: doc.data().groupId || '',
            unitName: '本單位',
            isSupport: false
        }));
    },

    handleSearchEnter: function(event) {
        if (event.key === 'Enter') {
            this.searchStaff();
        }
    },

    searchStaff: async function() {
        const keyword = document.getElementById('inputSearchStaff').value.trim();
        const resultDiv = document.getElementById('searchResults');
        resultDiv.innerHTML = '';

        if(!keyword) return;

        const snapshot = await db.collection('users').where('isActive', '==', true).get();
        const found = snapshot.docs.filter(d => 
            (d.data().employeeId && d.data().employeeId.includes(keyword)) || 
            (d.data().displayName && d.data().displayName.includes(keyword))
        );

        if(found.length === 0) {
            resultDiv.innerHTML = '<div style="color:red; padding:10px;">找不到符合的人員</div>';
            return;
        }

        found.forEach(doc => {
            const u = doc.data();
            const exists = this.staffListSnapshot.find(x => x.uid === doc.id);
            const btnState = exists ? 
                '<button class="btn" disabled style="background:#ccc; cursor:not-allowed;">已在名單</button>' :
                `<button class="btn btn-add" onclick="preScheduleManager.addSupport('${doc.id}')"><i class="fas fa-plus"></i> 加入支援</button>`;

            const div = document.createElement('div');
            div.className = 'search-result-card';
            div.innerHTML = `
                <div>
                    <span class="search-info">${u.displayName}</span>
                    <span class="search-detail"><i class="fas fa-id-badge"></i> ${u.employeeId}</span>
                    <span class="search-detail"><i class="fas fa-hospital"></i> ${u.unitId}</span>
                </div>
                ${btnState}
            `;
            resultDiv.appendChild(div);
        });
    },

    addSupport: async function(uid) {
        const doc = await db.collection('users').doc(uid).get();
        if(!doc.exists) return;
        
        const u = doc.data();
        this.staffListSnapshot.push({
            uid: doc.id,
            empId: u.employeeId,
            name: u.displayName,
            level: u.level,
            group: u.groupId || '',
            unitName: u.unitId,
            isSupport: true
        });

        document.getElementById('searchResults').innerHTML = ''; 
        document.getElementById('inputSearchStaff').value = '';
        this.renderStaffList();
    },

    sortStaff: function(field) {
        if (this.staffSortState.field === field) {
            this.staffSortState.order = this.staffSortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.staffSortState.field = field;
            this.staffSortState.order = 'asc';
        }
        this.renderStaffList();
    },

    renderStaffList: function() {
        const tbody = document.getElementById('preStaffBody');
        tbody.innerHTML = '';
        
        document.getElementById('staffTotalCount').textContent = this.staffListSnapshot.length;

        document.querySelectorAll('th i[id^="sort_icon_pre_"]').forEach(i => i.className = 'fas fa-sort');
        const icon = document.getElementById(`sort_icon_pre_${this.staffSortState.field}`);
        if(icon) icon.className = this.staffSortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

        const { field, order } = this.staffSortState;
        this.staffListSnapshot.sort((a,b) => {
            let valA = a[field] || '';
            let valB = b[field] || '';
            if(typeof valA === 'string') valA = valA.toLowerCase();
            if(typeof valB === 'string') valB = valB.toLowerCase();
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        this.staffListSnapshot.forEach((u, index) => {
            let badge = u.isSupport ? 
                `<span class="badge" style="background:#e67e22;">支援 (${u.unitName})</span>` : 
                '<span class="badge" style="background:#3498db;">本單位</span>';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.empId}</td>
                <td>${u.name}</td>
                <td>${u.level}</td>
                <td><input type="text" value="${u.group}" class="input-mini" onchange="preScheduleManager.updateStaffGroup(${index}, this.value)"></td>
                <td>${badge}</td>
                <td><button class="btn btn-delete" style="padding:2px 5px;" onclick="preScheduleManager.removeStaff(${index})">移除</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    updateStaffGroup: function(index, val) {
        this.staffListSnapshot[index].group = val;
    },

    removeStaff: function(index) {
        if(confirm("確定將此人從本次預班名單移除？")) {
            this.staffListSnapshot.splice(index, 1);
            this.renderStaffList();
        }
    },

    // --- 5. 矩陣表格 (組別限制) - [修改] 轉置為橫向表格 ---
    renderGroupLimitsTable: function(savedLimits = {}) {
        const table = document.getElementById('groupLimitTable');
        table.innerHTML = '';

        // 定義欄位 (Columns)
        const columns = [
            { key: 'minTotal', label: '每班至少' },
            { key: 'minE', label: '小夜至少' },
            { key: 'minN', label: '大夜至少' },
            { key: 'maxE', label: '小夜最多' },
            { key: 'maxN', label: '大夜最多' }
        ];

        // 1. 產生表頭
        let thead = '<thead><tr><th style="background:#f0f0f0; width:120px;">組別</th>';
        columns.forEach(col => { 
            thead += `<th style="background:#f0f0f0; min-width: 100px;">${col.label}</th>`; 
        });
        thead += '</tr></thead>';
        table.innerHTML += thead;

        // 2. 產生內容 (每一列是一個組別)
        let tbody = '<tbody>';
        
        if (this.currentUnitGroups.length === 0) {
            tbody += `<tr><td colspan="${columns.length + 1}" style="padding:20px; color:#999;">此單位尚未設定組別，請先至「單位管理」設定組別。</td></tr>`;
        } else {
            this.currentUnitGroups.forEach(g => {
                tbody += `<tr>`;
                // 第一欄：組別名稱
                tbody += `<td style="font-weight:bold; background:#f8f9fa;">${g}</td>`;
                
                // 後續欄位：各個限制輸入框
                columns.forEach(col => {
                    // 取得舊值
                    const val = (savedLimits[g] && savedLimits[g][col.key]) !== undefined && (savedLimits[g][col.key] !== null) 
                                ? savedLimits[g][col.key] 
                                : '';
                    
                    tbody += `<td>
                        <input type="number" class="limit-input" 
                               placeholder="不限" 
                               data-group="${g}" 
                               data-key="${col.key}" 
                               value="${val}"
                               style="width: 100%; box-sizing: border-box;">
                    </td>`;
                });
                tbody += `</tr>`;
            });
        }
        tbody += '</tbody>';
        table.innerHTML += tbody;
    },

    importLastSettings: async function() {
        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', this.currentUnitId)
                .orderBy('year', 'desc').orderBy('month', 'desc')
                .limit(1).get();

            if (snapshot.empty) { alert("找不到過去的設定資料"); return; }
            
            const lastData = snapshot.docs[0].data();
            this.fillForm(lastData);
            this.renderGroupLimitsTable(lastData.groupLimits);
            this.staffListSnapshot = lastData.staffList || [];
            this.renderStaffList();
            alert("已帶入資料 (日期請自行檢查)");
        } catch(e) { console.error(e); alert("帶入失敗"); }
    },

    fillForm: function(data) {
        const s = data.settings;
        document.getElementById('inputMaxOff').value = s.maxOffDays;
        document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs;
        document.getElementById('inputDailyReserve').value = s.dailyReserved;
        document.getElementById('checkShowAllNames').checked = s.showAllNames;
        document.getElementById('inputShiftMode').value = s.shiftTypeMode;
        if(s.shiftTypeMode === "2") {
            document.getElementById('divAllowThree').style.display = 'block';
            document.getElementById('checkAllowThree').checked = s.allowThreeShifts;
        } else {
            document.getElementById('divAllowThree').style.display = 'none';
        }
    },

    // --- 6. 儲存 ---
    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId').value;
        const year = parseInt(document.getElementById('inputPreYear').value);
        const month = parseInt(document.getElementById('inputPreMonth').value);
        const unitId = this.currentUnitId;

        const settings = {
            openDate: document.getElementById('inputOpenDate').value,
            closeDate: document.getElementById('inputCloseDate').value,
            showAllNames: document.getElementById('checkShowAllNames').checked,
            maxOffDays: parseInt(document.getElementById('inputMaxOff').value) || 0,
            maxHolidayOffs: parseInt(document.getElementById('inputMaxHoliday').value) || 0,
            dailyReserved: parseInt(document.getElementById('inputDailyReserve').value) || 0,
            shiftTypeMode: document.getElementById('inputShiftMode').value,
            allowThreeShifts: document.getElementById('checkAllowThree').checked
        };

        if(!settings.openDate || !settings.closeDate) { alert("請設定開放區間"); return; }

        // 收集組別限制 (邏輯不變，因為 class 名稱與 dataset 結構沒變)
        const groupLimits = {};
        document.querySelectorAll('.limit-input').forEach(inp => {
            const g = inp.dataset.group;
            const k = inp.dataset.key;
            if(!groupLimits[g]) groupLimits[g] = {};
            // 空值存為 null
            groupLimits[g][k] = inp.value === '' ? null : parseInt(inp.value);
        });

        const data = {
            unitId, year, month,
            status: 'open',
            progress: { submitted: 0, total: this.staffListSnapshot.length },
            settings,
            groupLimits,
            staffList: this.staffListSnapshot,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if(docId) {
                const oldDoc = await db.collection('pre_schedules').doc(docId).get();
                if(oldDoc.exists && oldDoc.data().progress) {
                    data.progress.submitted = oldDoc.data().progress.submitted;
                }
                await db.collection('pre_schedules').doc(docId).update(data);
            } else {
                const check = await db.collection('pre_schedules')
                    .where('unitId', '==', unitId)
                    .where('year', '==', year)
                    .where('month', '==', month).get();
                if(!check.empty) { alert("該月份的預班表已存在！"); return; }
                
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.assignments = {}; 
                await db.collection('pre_schedules').add(data);
            }
            alert("儲存成功！");
            this.closeModal();
            this.loadData();
        } catch(e) {
            console.error(e); alert("儲存失敗: " + e.message);
        }
    },

    deleteSchedule: async function(id) {
        if(confirm("確定刪除此預班表？所有設定與預填資料將消失。")) {
            await db.collection('pre_schedules').doc(id).delete();
            this.loadData();
        }
    },

    manage: function(id) {
        alert("準備進入大表排班介面 (ID: " + id + ")\n此功能將在下一階段實作。");
    }
};
