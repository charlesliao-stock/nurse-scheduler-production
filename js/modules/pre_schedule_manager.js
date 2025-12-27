// js/modules/pre_schedule_manager.js (優化版 - Part 1)

const preScheduleManager = {
    currentUnitId: null,
    currentUnitGroups: [],
    staffListSnapshot: [], 
    staffSortState: { field: 'isSupport', order: 'asc' },
    isLoading: false,
    
    // --- 初始化 ---
    init: async function() {
        console.log("Pre-Schedule Manager Loaded.");
        
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法管理預班表</p>
                </div>
            `;
            return;
        }
        
        await this.loadUnitDropdown();
    },

    // --- 1. 載入單位 ---
    loadUnitDropdown: async function() {
        const select = document.getElementById('filterPreUnit');
        if(!select) return;

        select.innerHTML = '<option value="">載入中...</option>';
        
        try {
            let query = db.collection('units');
            
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }
            
            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });
            
            if (snapshot.size === 1) {
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
        
        const tbody = document.getElementById('preScheduleTableBody');
        if(!tbody) return;

        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">載入中...</td></tr>';

        if (!unitId) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;"><i class="fas fa-arrow-up" style="font-size:2rem; display:block; margin-bottom:10px;"></i>請先選擇單位</td></tr>';
            return;
        }

        // 載入單位組別資料
        try {
            const unitDoc = await db.collection('units').doc(unitId).get();
            this.currentUnitGroups = unitDoc.exists ? (unitDoc.data().groups || []) : [];
        } catch(e) {
            console.error("Load Unit Groups Error:", e);
            this.currentUnitGroups = [];
        }

        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .get();

            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">尚無預班表<br><button class="btn btn-add" style="margin-top:10px;" onclick="preScheduleManager.openModal()">立即新增</button></td></tr>';
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
                const progress = d.progress ? `${d.progress.submitted} / ${d.progress.total}` : '0 / 0';
                
                // 狀態判斷
                let statusHtml = '<span class="badge" style="background:#95a5a6;">未知</span>';
                if(d.status === 'closed') {
                    statusHtml = '<span class="badge" style="background:#e74c3c;">已截止</span>';
                } else {
                    if (today < openDate) {
                        statusHtml = '<span class="badge" style="background:#f39c12;">準備中</span>';
                    } else if (today > closeDate) {
                        statusHtml = '<span class="badge" style="background:#e74c3c;">已截止</span>';
                    } else {
                        statusHtml = '<span class="badge" style="background:#2ecc71;">開放中</span>';
                    }
                }

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
                fragment.appendChild(tr);
            });
            
            tbody.appendChild(fragment);
            
        } catch (e) {
            console.error("Load Data Error:", e);
            tbody.innerHTML = `<tr><td colspan="5" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        }
    },

    // --- 3. Modal 操作 ---
    openModal: async function(docId = null) {
        if(!this.currentUnitId) { 
            alert("請先選擇單位"); 
            return; 
        }
        
        const modal = document.getElementById('preScheduleModal');
        if(!modal) {
            console.error("找不到 Modal");
            return;
        }
        
        modal.classList.add('show');
        document.getElementById('preScheduleDocId').value = docId || '';
        document.getElementById('currentMode').value = docId ? 'edit' : 'add';
        document.getElementById('searchResults').innerHTML = ''; 
        document.getElementById('inputSearchStaff').value = '';

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
                this.renderGroupLimitsTable(data.groupLimits || {});
                
            } catch(e) {
                console.error("Load Schedule Error:", e);
                alert("載入失敗: " + e.message);
                this.closeModal();
            }
            
        } else {
            // 新增模式
            document.getElementById('btnImportLast').style.display = 'inline-block';
            
            // 預設下個月
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
        const modal = document.getElementById('preScheduleModal');
        if(modal) modal.classList.remove('show');
    },

    switchTab: function(tabName) {
        const modal = document.getElementById('preScheduleModal');
        if (!modal) return;
        
        // 切換內容
        const contents = modal.querySelectorAll('.tab-content');
        contents.forEach(c => c.classList.remove('active'));
        const target = modal.querySelector(`#tab-${tabName}`);
        if(target) target.classList.add('active');
        
        // 切換按鈕
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
        if(div) {
            div.style.display = (mode === "2") ? 'block' : 'none';
        }
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
            
            console.log(`載入 ${this.staffListSnapshot.length} 位單位人員`);
            
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

        resultDiv.innerHTML = '<div style="padding:10px;">搜尋中...</div>';

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

            resultDiv.innerHTML = '';

            found.forEach(doc => {
                const u = doc.data();
                const exists = this.staffListSnapshot.find(x => x.uid === doc.id);
                
                const btnState = exists ? 
                    '<button class="btn" disabled style="background:#ccc; cursor:not-allowed;">已在名單</button>' :
                    `<button class="btn btn-add" onclick="preScheduleManager.addSupport('${doc.id}')"><i class="fas fa-plus"></i> 加入支援</button>`;

                const div = document.createElement('div');
                div.className = 'search-result-card';
                div.style.cssText = 'display:flex; align-items:center; justify-content:space-between; background:#e8f6f3; border:1px solid #a2d9ce; padding:10px; border-radius:4px; margin-top:10px;';
                div.innerHTML = `
                    <div>
                        <span class="search-info" style="font-weight:bold; color:#16a085;">${u.displayName}</span>
                        <span class="search-detail" style="color:#555; margin-left:10px; font-size:0.9rem;"><i class="fas fa-id-badge"></i> ${u.employeeId}</span>
                        <span class="search-detail" style="color:#555; margin-left:10px; font-size:0.9rem;"><i class="fas fa-hospital"></i> ${u.unitId}</span>
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
            if(!doc.exists) {
                alert("找不到該使用者");
                return;
            }
            
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

    // 繼續第2部分...
};
// js/modules/pre_schedule_manager.js (優化版 - Part 2)
// 接續 Part 1

// 在 preScheduleManager 物件中繼續新增方法...

preScheduleManager.sortStaff = function(field) {
    if (this.staffSortState.field === field) {
        this.staffSortState.order = this.staffSortState.order === 'asc' ? 'desc' : 'asc';
    } else {
        this.staffSortState.field = field;
        this.staffSortState.order = 'asc';
    }
    this.renderStaffList();
};

preScheduleManager.renderStaffList = function() {
    const tbody = document.getElementById('preStaffBody');
    if(!tbody) return;
    
    tbody.innerHTML = '';
    
    const countEl = document.getElementById('staffTotalCount');
    if(countEl) countEl.textContent = this.staffListSnapshot.length;

    // 更新排序圖示
    document.querySelectorAll('th i[id^="sort_icon_pre_"]').forEach(i => {
        i.className = 'fas fa-sort';
    });
    const icon = document.getElementById(`sort_icon_pre_${this.staffSortState.field}`);
    if(icon) {
        icon.className = this.staffSortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
    }

    if(this.staffListSnapshot.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#999;">尚無人員,請使用上方搜尋功能加入</td></tr>';
        return;
    }

    // 排序
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

    // 渲染
    sorted.forEach((u, index) => {
        let badge = u.isSupport ? 
            `<span class="badge" style="background:#e67e22;">支援 (${u.unitName})</span>` : 
            '<span class="badge" style="background:#3498db;">本單位</span>';
            
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.empId}</td>
            <td>${u.name}</td>
            <td>${u.level}</td>
            <td><input type="text" value="${u.group}" class="input-mini" style="width:80px; padding:4px; border:1px solid #ddd; border-radius:3px; text-align:center;" onchange="preScheduleManager.updateStaffGroup(${index}, this.value)"></td>
            <td>${badge}</td>
            <td><button class="btn btn-delete" style="padding:2px 5px;" onclick="preScheduleManager.removeStaff(${index})">移除</button></td>
        `;
        tbody.appendChild(tr);
    });
};

preScheduleManager.updateStaffGroup = function(index, val) { 
    this.staffListSnapshot[index].group = val; 
};

preScheduleManager.removeStaff = function(index) {
    const staff = this.staffListSnapshot[index];
    if(confirm(`確定將 ${staff.name} 從本次預班名單移除？`)) {
        this.staffListSnapshot.splice(index, 1);
        this.renderStaffList();
    }
};

// --- 5. 組別限制表格 (橫向矩陣) ---
preScheduleManager.renderGroupLimitsTable = function(savedLimits = {}) {
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

    // 表頭
    let thead = '<thead><tr><th style="background:#f8f9fa; width:120px;">組別</th>';
    columns.forEach(col => { 
        thead += `<th style="background:#f8f9fa; min-width: 100px;">${col.label}</th>`; 
    });
    thead += '</tr></thead>';
    table.innerHTML += thead;

    // 內容
    let tbody = '<tbody>';
    
    if (this.currentUnitGroups.length === 0) {
        tbody += `<tr><td colspan="${columns.length + 1}" style="padding:20px; color:#999; text-align:center;">此單位尚未設定組別,請先至「單位管理」設定組別。</td></tr>`;
    } else {
        this.currentUnitGroups.forEach(g => {
            tbody += `<tr><td style="font-weight:bold; background:#fff;">${g}</td>`;
            
            columns.forEach(col => {
                const val = (savedLimits[g] && savedLimits[g][col.key] !== undefined && savedLimits[g][col.key] !== null) 
                            ? savedLimits[g][col.key] 
                            : '';
                
                tbody += `<td>
                    <input type="number" class="limit-input" 
                           placeholder="不限" 
                           data-group="${g}" 
                           data-key="${col.key}" 
                           value="${val}"
                           style="width:100%; padding:6px; text-align:center; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;">
                </td>`;
            });
            tbody += `</tr>`;
        });
    }
    tbody += '</tbody>';
    table.innerHTML += tbody;
};

preScheduleManager.importLastSettings = async function() {
    try {
        const snapshot = await db.collection('pre_schedules')
            .where('unitId', '==', this.currentUnitId)
            .orderBy('year', 'desc')
            .orderBy('month', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) { 
            alert("找不到過去的設定資料"); 
            return; 
        }
        
        const lastData = snapshot.docs[0].data();
        this.fillForm(lastData);
        this.renderGroupLimitsTable(lastData.groupLimits || {});
        this.staffListSnapshot = lastData.staffList || [];
        this.renderStaffList();
        alert("已帶入資料！請記得檢查日期設定。");
        
    } catch(e) { 
        console.error("Import Last Error:", e); 
        alert("帶入失敗: " + e.message); 
    }
};

// 填寫表單資料
preScheduleManager.fillForm = function(data) {
    if(data.year && data.month) {
        const mStr = data.month < 10 ? '0' + data.month : data.month;
        document.getElementById('inputPreYearMonth').value = `${data.year}-${mStr}`;
    }

    const s = data.settings || {};
    document.getElementById('inputOpenDate').value = s.openDate || '';
    document.getElementById('inputCloseDate').value = s.closeDate || '';
    document.getElementById('inputMaxOff').value = s.maxOffDays || 8;
    document.getElementById('inputMaxHoliday').value = s.maxHolidayOffs || 2;
    document.getElementById('inputDailyReserve').value = s.dailyReserved || 2;
    document.getElementById('checkShowAllNames').checked = s.showAllNames !== false;
    document.getElementById('inputShiftMode').value = s.shiftTypeMode || "3";
    
    this.toggleThreeShiftOption(); 
    
    if(s.shiftTypeMode === "2") {
        document.getElementById('checkAllowThree').checked = s.allowThreeShifts || false;
    }
};

// --- 6. 儲存資料 ---
preScheduleManager.saveData = async function() {
    const docId = document.getElementById('preScheduleDocId').value;
    const yearMonth = document.getElementById('inputPreYearMonth').value;
    
    if(!yearMonth) { 
        alert("請選擇預班月份"); 
        this.switchTab('basic');
        document.getElementById('inputPreYearMonth').focus();
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

    // 日期驗證
    if(settings.openDate > settings.closeDate) {
        alert("開放日期不可晚於截止日期");
        this.switchTab('basic');
        return;
    }

    // 收集組別限制
    const groupLimits = {};
    document.querySelectorAll('.limit-input').forEach(inp => {
        const g = inp.dataset.group;
        const k = inp.dataset.key;
        if(!groupLimits[g]) groupLimits[g] = {};
        groupLimits[g][k] = inp.value === '' ? null : parseInt(inp.value);
    });

    const data = {
        unitId, 
        year, 
        month,
        status: 'open',
        progress: { 
            submitted: 0, 
            total: this.staffListSnapshot.length 
        },
        settings,
        groupLimits,
        staffList: this.staffListSnapshot,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        if(docId) {
            // 更新
            const oldDoc = await db.collection('pre_schedules').doc(docId).get();
            if(oldDoc.exists) {
                data.status = oldDoc.data().status; 
                if(oldDoc.data().progress) {
                    data.progress.submitted = oldDoc.data().progress.submitted;
                }
            }
            await db.collection('pre_schedules').doc(docId).update(data);
            
        } else {
            // 新增 - 檢查重複
            const check = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .where('year', '==', year)
                .where('month', '==', month)
                .get();
                
            if(!check.empty) { 
                alert("該月份的預班表已存在！"); 
                return; 
            }
            
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            data.assignments = {}; 
            await db.collection('pre_schedules').add(data);
        }
        
        alert("儲存成功！");
        this.closeModal();
        this.loadData();
        
    } catch(e) {
        console.error("Save Error:", e); 
        alert("儲存失敗: " + e.message);
    }
};

preScheduleManager.deleteSchedule = async function(id) {
    if(!confirm("確定刪除此預班表？所有設定與預填資料將消失。")) {
        return;
    }

    try {
        await db.collection('pre_schedules').doc(id).delete();
        alert("刪除成功");
        this.loadData();
    } catch(e) {
        console.error("Delete Error:", e);
        alert("刪除失敗: " + e.message);
    }
};

// 跳轉到矩陣介面
preScheduleManager.manage = function(id) {
    console.log("Jumping to matrix with ID:", id);
    window.location.hash = `/admin/pre_schedule_matrix?id=${id}`;
};
