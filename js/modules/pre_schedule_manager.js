// js/modules/pre_schedule_manager.js

const preScheduleManager = {
    currentUnitId: null,
    currentUnitGroups: [],
    activeShifts: [], // [新增] 儲存該單位的班別列表，用於產生需求矩陣
    staffListSnapshot: [], 
    staffSortState: { field: 'isSupport', order: 'asc' },
    isLoading: false,
    
    // --- 初始化 ---
    init: async function() {
        console.log("Pre-Schedule Manager Loaded.");
        
        // 根據權限隱藏/顯示管理者工具列 (新增按鈕)
        const adminToolbar = document.getElementById('adminToolbar');
        if (adminToolbar) {
            // 只有一般使用者 (user) 隱藏新增按鈕，其他管理角色顯示
            if (app.userRole === 'user') {
                adminToolbar.style.display = 'none';
            } else {
                adminToolbar.style.display = 'block';
            }
        }

        await this.loadUnitDropdown();
    },

    // --- 1. 載入單位 (含鎖定邏輯) ---
    loadUnitDropdown: async function() {
        const select = document.getElementById('filterPreUnit');
        if(!select) return;

        select.innerHTML = '<option value="">載入中...</option>';
        select.disabled = false; // 預設開啟
        
        try {
            let query = db.collection('units');
            const isManager = ['unit_manager', 'unit_scheduler', 'user'].includes(app.userRole);
            
            // 如果是單位管理者或一般使用者，只撈取自己的單位
            if (isManager && app.userUnitId) {
                query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
            }
            
            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });
            
            // 自動選擇並鎖定
            if (isManager && app.userUnitId) {
                select.value = app.userUnitId;
                select.disabled = true; // [關鍵] 鎖定下拉選單
                this.loadData();
            } else if (snapshot.size === 1) {
                // 只有一個單位可選時也自動選
                select.selectedIndex = 1;
                this.loadData();
            }
            
            select.onchange = () => this.loadData();
            
        } catch (e) {
            console.error("Load Units Error:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    // --- 2. 載入列表 ---
    loadData: async function() {
        const unitId = document.getElementById('filterPreUnit').value;
        this.currentUnitId = unitId;
        const select = document.getElementById('filterPreUnit');
        const unitName = select.options[select.selectedIndex]?.text || '';
        
        const tbody = document.getElementById('preScheduleTableBody');
        if(!tbody) return;

        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">載入中...</td></tr>';

        if (!unitId) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">請先選擇單位</td></tr>';
            return;
        }

        // [新增] 預先載入該單位的班別 (為了後續 Modal 設定矩陣用)
        try {
            const shiftsSnap = await db.collection('shifts').where('unitId', '==', unitId).get();
            this.activeShifts = shiftsSnap.docs.map(d => d.data());
            
            const unitDoc = await db.collection('units').doc(unitId).get();
            this.currentUnitGroups = unitDoc.exists ? (unitDoc.data().groups || []) : [];
        } catch(e) { console.error("Load Shifts/Groups Error:", e); }

        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .get();

            if (snapshot.empty) {
                let emptyMsg = '尚無預班表';
                // 只有管理者才提示新增
                if(app.userRole !== 'user') {
                    emptyMsg += '<br><button class="btn btn-add" style="margin-top:10px;" onclick="preScheduleManager.openModal()">立即新增</button>';
                }
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">${emptyMsg}</td></tr>`;
                return;
            }

            tbody.innerHTML = '';
            const today = new Date().toISOString().split('T')[0];
            const fragment = document.createDocumentFragment();

            snapshot.forEach(doc => {
                const d = doc.data();
                const s = d.settings || {};
                const openDate = s.openDate || '9999-12-31';
                const closeDate = s.closeDate || '1970-01-01';
                const period = `${openDate} ~ ${closeDate}`;
                const progress = d.progress ? `${d.progress.submitted} / ${d.progress.total}` : '-';
                
                // 狀態判斷邏輯
                let statusText = '未知';
                let statusColor = '#95a5a6';
                let isFillable = false; // 是否可填寫

                if (d.status === 'closed') {
                    statusText = '已截止 (鎖定)';
                    statusColor = '#e74c3c'; // 紅
                } else if (today < openDate) {
                    statusText = '準備中';
                    statusColor = '#f39c12'; // 橘
                } else if (today > closeDate) {
                    statusText = '已截止 (日期)';
                    statusColor = '#e74c3c'; // 紅
                } else {
                    statusText = '開放中';
                    statusColor = '#2ecc71'; // 綠
                    isFillable = true;
                }

                // 操作按鈕邏輯
                let actionsHtml = '';
                
                if (app.userRole === 'user') {
                    // 一般使用者：檢查是否為參與人員
                    const isParticipant = (d.staffList || []).some(u => u.uid === app.currentUser.uid);
                    
                    if (isParticipant) {
                        if (isFillable) {
                            // 開放中 -> 填寫
                            actionsHtml = `<button class="btn btn-add" onclick="staffPreScheduleManager.open('${doc.id}')"><i class="fas fa-edit"></i> 填寫預班</button>`;
                        } else {
                            // 已截止/準備中 -> 檢視 (唯讀)
                            actionsHtml = `<button class="btn" style="background:#95a5a6;" onclick="staffPreScheduleManager.open('${doc.id}')"><i class="fas fa-eye"></i> 檢視</button>`;
                        }
                    } else {
                        actionsHtml = `<span style="color:#999; font-size:0.9rem;">非參與人員</span>`;
                    }
                } else {
                    // 管理者：管理、設定、刪除
                    actionsHtml = `
                        <button class="btn btn-primary" style="padding:4px 8px;" onclick="preScheduleManager.manage('${doc.id}')">管理</button>
                        <button class="btn btn-edit" style="padding:4px 8px;" onclick="preScheduleManager.openModal('${doc.id}')">設定</button>
                        <button class="btn btn-delete" style="padding:4px 8px;" onclick="preScheduleManager.deleteSchedule('${doc.id}')">刪除</button>
                    `;
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${unitName}</td>
                    <td style="font-weight:bold;">${d.year} 年 ${d.month} 月</td>
                    <td><small>${period}</small></td>
                    <td><span class="badge" style="background:${statusColor};">${statusText}</span></td>
                    <td>${progress}</td>
                    <td>${actionsHtml}</td>
                `;
                fragment.appendChild(tr);
            });
            
            tbody.appendChild(fragment);
            
        } catch (e) {
            console.error("Load Data Error:", e);
            tbody.innerHTML = `<tr><td colspan="6" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        }
    },

    // --- 3. Modal 操作 (設定) ---
    openModal: async function(docId = null) {
        if(!this.currentUnitId) { 
            alert("請先選擇單位"); 
            return; 
        }
        
        const modal = document.getElementById('preScheduleModal');
        if(!modal) return;
        
        modal.classList.add('show');
        document.getElementById('preScheduleDocId').value = docId || '';
        document.getElementById('currentMode').value = docId ? 'edit' : 'add';
        document.getElementById('searchResults').innerHTML = ''; 
        document.getElementById('inputSearchStaff').value = '';

        // 預設切換到第一頁
        this.switchTab('basic');

        if (docId) {
            // 編輯模式
            document.getElementById('btnImportLast').style.display = 'none';
            try {
                const doc = await db.collection('pre_schedules').doc(docId).get();
                if(!doc.exists) {
                    alert("找不到該預班表資料");
                    this.closeModal();
                    return;
                }
                const data = doc.data();
                this.fillForm(data); 
                this.staffListSnapshot = data.staffList || [];
                this.renderStaffList();
                this.renderGroupLimitsTable(data.groupLimits);
                this.renderDailyNeedsTable(data.dailyNeeds); // [新增] 載入需求矩陣
            } catch(e) {
                console.error("Load Schedule Error:", e);
                alert("載入失敗: " + e.message);
                this.closeModal();
            }
        } else {
            // 新增模式
            document.getElementById('btnImportLast').style.display = 'inline-block';
            
            const nextMonth = new Date();
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            const y = nextMonth.getFullYear();
            const m = nextMonth.getMonth() + 1;
            const mStr = m < 10 ? '0'+m : m;
            
            document.getElementById('inputPreYearMonth').value = `${y}-${mStr}`;
            document.getElementById('inputOpenDate').value = `${y}-${mStr}-01`;
            document.getElementById('inputCloseDate').value = `${y}-${mStr}-10`;

            document.getElementById('inputMaxOff').value = 8;
            document.getElementById('inputMaxHoliday').value = 2;
            document.getElementById('inputDailyReserve').value = 1; // 預設保留 1
            document.getElementById('checkShowAllNames').checked = true;
            document.getElementById('inputShiftMode').value = "3";
            this.toggleThreeShiftOption();
            
            await this.loadCurrentUnitStaff();
            this.renderStaffList();
            this.renderGroupLimitsTable({});
            this.renderDailyNeedsTable({}); // [新增] 空矩陣
        }
    },

    closeModal: function() {
        const modal = document.getElementById('preScheduleModal');
        if(modal) modal.classList.remove('show');
    },

    switchTab: function(tabName) {
        const modal = document.getElementById('preScheduleModal');
        if (!modal) return;
        
        const contents = modal.querySelectorAll('.tab-content');
        contents.forEach(c => c.classList.remove('active'));
        const target = modal.querySelector(`#tab-${tabName}`);
        if(target) target.classList.add('active');
        
        const btns = modal.querySelectorAll('.tab-btn');
        btns.forEach(btn => {
            btn.classList.remove('active');
            if(btn.getAttribute('onclick').includes(`'${tabName}'`)) {
                btn.classList.add('active');
            }
        });
    },

    toggleThreeShiftOption: function() {
        const mode = document.getElementById('inputShiftMode').value;
        const div = document.getElementById('divAllowThree');
        if(div) div.style.display = (mode === "2") ? 'block' : 'none';
    },

    // --- 4. 人員管理 ---
    loadCurrentUnitStaff: async function() {
        try {
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
        } catch(e) {
            console.error("Load Staff Error:", e);
            this.staffListSnapshot = [];
        }
    },

    handleSearchEnter: function(event) { 
        if (event.key === 'Enter') this.searchStaff(); 
    },
    
    searchStaff: async function() {
        const keyword = document.getElementById('inputSearchStaff').value.trim();
        const resultDiv = document.getElementById('searchResults');
        
        if(!resultDiv) return;
        resultDiv.innerHTML = '';

        if(!keyword) {
            resultDiv.innerHTML = '<div style="color:#999; padding:10px;">請輸入搜尋關鍵字</div>';
            return;
        }

        try {
            const snapshot = await db.collection('users').where('isActive', '==', true).get();
            const found = snapshot.docs.filter(d => {
                const empId = d.data().employeeId || '';
                const name = d.data().displayName || '';
                return empId.includes(keyword) || name.includes(keyword);
            });

            if(found.length === 0) {
                resultDiv.innerHTML = '<div style="color:red; padding:10px;">找不到符合的人員</div>';
                return;
            }

            found.forEach(doc => {
                const u = doc.data();
                const exists = this.staffListSnapshot.find(x => x.uid === doc.id);
                
                const btnState = exists ? 
                    '<button class="btn" disabled style="background:#ccc;">已在名單</button>' :
                    `<button class="btn btn-add" onclick="preScheduleManager.addSupport('${doc.id}')">加入支援</button>`;

                const div = document.createElement('div');
                div.className = 'search-result-card';
                div.innerHTML = `
                    <div>
                        <span class="search-info" style="font-weight:bold; color:#16a085;">${u.displayName}</span>
                        <span class="search-detail" style="color:#555; margin-left:10px;">${u.employeeId}</span>
                    </div>
                    ${btnState}
                `;
                resultDiv.appendChild(div);
            });
            
        } catch(e) {
            console.error("Search Error:", e);
            resultDiv.innerHTML = `<div style="color:red; padding:10px;">搜尋失敗: ${e.message}</div>`;
        }
    },

    addSupport: async function(uid) {
        try {
            const doc = await db.collection('users').doc(uid).get();
            if(!doc.exists) { alert("找不到使用者"); return; }
            
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
            
        } catch(e) {
            console.error("Add Support Error:", e);
            alert("加入失敗: " + e.message);
        }
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
        if(!tbody) return;
        tbody.innerHTML = '';
        
        document.getElementById('staffTotalCount').textContent = this.staffListSnapshot.length;

        document.querySelectorAll('th i[id^="sort_icon_pre_"]').forEach(i => i.className = 'fas fa-sort');
        const icon = document.getElementById(`sort_icon_pre_${this.staffSortState.field}`);
        if(icon) icon.className = this.staffSortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

        const { field, order } = this.staffSortState;
        const sorted = [...this.staffListSnapshot].sort((a, b) => {
            let valA = a[field] || ''; 
            let valB = b[field] || '';
            if(typeof valA === 'string') valA = valA.toLowerCase();
            if(typeof valB === 'string') valB = valB.toLowerCase();
            
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        sorted.forEach((u, index) => {
            let badge = u.isSupport ? 
                `<span class="badge" style="background:#e67e22;">支援 (${u.unitName})</span>` : 
                '<span class="badge" style="background:#3498db;">本單位</span>';
                
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.empId}</td>
                <td>${u.name}</td>
                <td>${u.level}</td>
                <td><input type="text" value="${u.group}" class="input-mini" style="width:80px; text-align:center;" onchange="preScheduleManager.updateStaffGroup(${index}, this.value)"></td>
                <td>${badge}</td>
                <td><button class="btn btn-delete" onclick="preScheduleManager.removeStaff(${index})">移除</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    updateStaffGroup: function(index, val) { this.staffListSnapshot[index].group = val; },

    removeStaff: function(index) {
        if(confirm("確定移除？")) {
            this.staffListSnapshot.splice(index, 1);
            this.renderStaffList();
        }
    },

    // --- 5. 限制表格 (含每日需求矩陣) ---
    
    // [新增] 渲染每日需求矩陣 (Daily Needs Matrix)
    renderDailyNeedsTable: function(savedNeeds = {}) {
        const table = document.getElementById('dailyNeedsTable');
        if(!table) return;
        table.innerHTML = '';

        const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
        
        // 表頭
        let thead = '<thead><tr><th style="background:#f8f9fa;">班別 \\ 星期</th>';
        days.forEach(d => thead += `<th style="background:#f8f9fa; min-width:60px;">${d}</th>`);
        thead += '</tr></thead>';
        table.innerHTML = thead;

        // 內容
        let tbody = '<tbody>';
        if (this.activeShifts.length === 0) {
            tbody += `<tr><td colspan="8" style="padding:20px; text-align:center; color:#999;">此單位無班別設定，請先至「班別管理」新增。</td></tr>`;
        } else {
            this.activeShifts.forEach(shift => {
                tbody += `<tr><td style="font-weight:bold;">${shift.name} (${shift.code})</td>`;
                
                // 0=Mon ... 6=Sun
                for(let i=0; i<7; i++) {
                    // key 格式: "SHIFTCODE_DAYINDEX" (e.g. "D_0")
                    const key = `${shift.code}_${i}`; 
                    const val = (savedNeeds && savedNeeds[key] !== undefined) ? savedNeeds[key] : '';
                    tbody += `<td><input type="number" class="limit-input needs-input" data-key="${key}" value="${val}" style="width:100%; text-align:center;"></td>`;
                }
                tbody += `</tr>`;
            });
        }
        tbody += '</tbody>';
        table.innerHTML += tbody;
    },

    // 渲染組別限制表格 (原功能)
    renderGroupLimitsTable: function(savedLimits = {}) {
        const table = document.getElementById('groupLimitTable');
        if(!table) return;
        table.innerHTML = '';

        const columns = [
            { key: 'minTotal', label: '每班至少' },
            { key: 'minE', label: '小夜至少' },
            { key: 'minN', label: '大夜至少' },
            { key: 'maxE', label: '小夜最多' },
            { key: 'maxN', label: '大夜最多' }
        ];

        let thead = '<thead><tr><th style="background:#f8f9fa; width:120px;">組別</th>';
        columns.forEach(col => { thead += `<th style="background:#f8f9fa; min-width: 100px;">${col.label}</th>`; });
        thead += '</tr></thead>';
        table.innerHTML += thead;

        let tbody = '<tbody>';
        if (this.currentUnitGroups.length === 0) {
            tbody += `<tr><td colspan="${columns.length + 1}" style="padding:20px; text-align:center;">無組別資料</td></tr>`;
        } else {
            this.currentUnitGroups.forEach(g => {
                tbody += `<tr><td style="font-weight:bold; background:#fff;">${g}</td>`;
                columns.forEach(col => {
                    const val = (savedLimits[g] && savedLimits[g][col.key]) ?? '';
                    tbody += `<td><input type="number" class="limit-input" placeholder="不限" data-group="${g}" data-key="${col.key}" value="${val}" style="width:100%; text-align:center;"></td>`;
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
            this.renderGroupLimitsTable(lastData.groupLimits || {});
            this.renderDailyNeedsTable(lastData.dailyNeeds || {}); // [新增]
            this.staffListSnapshot = lastData.staffList || [];
            this.renderStaffList();
            alert("已帶入資料！");
        } catch(e) { console.error(e); alert("帶入失敗"); }
    },

    fillForm: function(data) {
        if(data.year && data.month) {
            const mStr = data.month < 10 ? '0' + data.month : data.month;
            document.getElementById('inputPreYearMonth').value = `${data.year}-${mStr}`;
        }
        const s = data.settings || {};
        document.getElementById('inputOpenDate').value = s.openDate || '';
        document.getElementById('inputCloseDate').value = s.closeDate || '';
        document.getElementById('inputMaxOff').value = s.maxOffDays || 8;
        document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs || 2;
        document.getElementById('inputDailyReserve').value = s.dailyReserved || 1;
        document.getElementById('checkShowAllNames').checked = s.showAllNames !== false;
        document.getElementById('inputShiftMode').value = s.shiftTypeMode || "3";
        this.toggleThreeShiftOption(); 
        if(s.shiftTypeMode === "2") document.getElementById('checkAllowThree').checked = s.allowThreeShifts;
    },

    // --- 6. 儲存 ---
    saveData: async function() {
        const docId = document.getElementById('preScheduleDocId').value;
        const yearMonth = document.getElementById('inputPreYearMonth').value;
        
        if(!yearMonth) { 
            alert("請選擇預班月份"); 
            this.switchTab('basic'); 
            return; 
        }
        
        const year = parseInt(yearMonth.split('-')[0]);
        const month = parseInt(yearMonth.split('-')[1]);
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

        if(!settings.openDate || !settings.closeDate) { 
            alert("請設定開放區間"); 
            this.switchTab('basic'); 
            return; 
        }

        // 蒐集 Group Limits
        const groupLimits = {};
        document.querySelectorAll('#groupLimitTable .limit-input').forEach(inp => {
            const g = inp.dataset.group;
            const k = inp.dataset.key;
            if(!groupLimits[g]) groupLimits[g] = {};
            groupLimits[g][k] = inp.value === '' ? null : parseInt(inp.value);
        });

        // [新增] 蒐集 Daily Needs
        const dailyNeeds = {};
        document.querySelectorAll('.needs-input').forEach(inp => {
            if(inp.value) {
                dailyNeeds[inp.dataset.key] = parseInt(inp.value);
            }
        });

        const data = {
            unitId: this.currentUnitId, year, month,
            status: 'open',
            progress: { submitted: 0, total: this.staffListSnapshot.length },
            settings,
            groupLimits,
            dailyNeeds, // [新增]
            staffList: this.staffListSnapshot,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if(docId) {
                const oldDoc = await db.collection('pre_schedules').doc(docId).get();
                if(oldDoc.exists) {
                    data.status = oldDoc.data().status; 
                    if(oldDoc.data().progress) data.progress.submitted = oldDoc.data().progress.submitted;
                }
                await db.collection('pre_schedules').doc(docId).update(data);
            } else {
                const check = await db.collection('pre_schedules')
                    .where('unitId', '==', unitId)
                    .where('year', '==', year)
                    .where('month', '==', month).get();
                if(!check.empty) { alert("該月份已存在！"); return; }
                
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.assignments = {}; 
                await db.collection('pre_schedules').add(data);
            }
            alert("儲存成功！");
            this.closeModal();
            this.loadData();
        } catch(e) { console.error(e); alert("儲存失敗: " + e.message); }
    },

    deleteSchedule: async function(id) {
        if(confirm("確定刪除？")) {
            await db.collection('pre_schedules').doc(id).delete();
            this.loadData();
        }
    },

    manage: function(id) {
        window.location.hash = `/admin/pre_schedule_matrix?id=${id}`;
    }
};
