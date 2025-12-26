// js/modules/unit_manager.js

const unitManager = {
    allUnits: [],
    allUsers: [],
    // [排序狀態]
    sortState: { field: 'id', order: 'asc' }, 
    
    // --- 初始化 ---
    init: async function() {
        console.log("Unit Manager Loaded.");
        const searchInput = document.getElementById('searchUnitInput');
        if(searchInput) searchInput.oninput = () => this.renderTable();

        const btnAdd = document.getElementById('btnAddUnit');
        const btnImport = document.getElementById('btnImportUnit');
        if (app.userRole !== 'system_admin') {
            if(btnAdd) btnAdd.style.display = 'none';
            if(btnImport) btnImport.style.display = 'none';
        }

        await this.fetchAllUsers(); 
        await this.fetchUnits();    
    },

    // --- 1. 取得資料 ---
    fetchAllUsers: async function() {
        try {
            const snapshot = await db.collection('users').where('isActive', '==', true).get();
            this.allUsers = snapshot.docs.map(doc => ({
                uid: doc.id,
                name: doc.data().displayName || '未命名',
                empId: doc.data().employeeId || '',
                unitId: doc.data().unitId || '',
                role: doc.data().role || 'user'
            }));
        } catch (e) { console.error(e); }
    },

    fetchUnits: async function() {
        const tbody = document.getElementById('unitTableBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">資料載入中...</td></tr>';
        
        try {
            const snapshot = await db.collection('units').get();
            this.allUnits = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            this.renderTable();
        } catch (e) {
            console.error("Fetch Units Error:", e);
            tbody.innerHTML = '<tr><td colspan="5" style="color:red;">載入失敗</td></tr>';
        }
    },

    // --- [新增] 排序功能 ---
    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    // --- 2. 渲染列表 ---
    renderTable: function() {
        const tbody = document.getElementById('unitTableBody');
        tbody.innerHTML = '';

        // 更新表頭圖示
        document.querySelectorAll('th i[id^="sort_icon_unit_"]').forEach(i => i.className = 'fas fa-sort');
        const activeIcon = document.getElementById(`sort_icon_unit_${this.sortState.field}`);
        if(activeIcon) activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

        const searchTerm = (document.getElementById('searchUnitInput').value || '').toLowerCase();
        
        // 1. 篩選
        let filtered = this.allUnits.filter(u => 
            u.id.toLowerCase().includes(searchTerm) || (u.name && u.name.toLowerCase().includes(searchTerm))
        );

        // 2. 排序
        const { field, order } = this.sortState;
        filtered.sort((a, b) => {
            let valA, valB;

            // 特殊欄位轉換 (人名列表)
            if (field === 'managers') {
                valA = this.getNames(a.managers);
                valB = this.getNames(b.managers);
            } else if (field === 'schedulers') {
                valA = this.getNames(a.schedulers);
                valB = this.getNames(b.schedulers);
            } else {
                valA = a[field] || '';
                valB = b[field] || '';
            }

            if(typeof valA === 'string') valA = valA.toLowerCase();
            if(typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        if(filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">無符合資料</td></tr>';
            return;
        }

        filtered.forEach(u => {
            const managerNames = this.getNames(u.managers);
            const schedulerNames = this.getNames(u.schedulers);
            
            let deleteBtn = '';
            if (app.userRole === 'system_admin') {
                deleteBtn = `<button class="btn btn-delete" onclick="unitManager.deleteUnit('${u.id}')">刪除</button>`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.id}</td>
                <td>${u.name}</td>
                <td>${managerNames}</td>
                <td>${schedulerNames}</td>
                <td>
                    <button class="btn btn-edit" onclick="unitManager.openModal('${u.id}')">編輯</button>
                    ${deleteBtn}
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    getNames: function(uidArray) {
        if(!uidArray || !Array.isArray(uidArray) || uidArray.length === 0) return ''; 
        const names = uidArray.map(uid => {
            const user = this.allUsers.find(p => p.uid === uid);
            return user ? user.name : '';
        }).filter(n => n);
        return names.length > 0 ? names.join(', ') : '(未設定)';
    },

    // --- 3. Modal 操作 ---
    openModal: function(unitId = null) {
        const modal = document.getElementById('unitModal');
        modal.classList.add('show');
        
        const inputId = document.getElementById('inputUnitId');
        const inputName = document.getElementById('inputUnitName');
        const isAdmin = (app.userRole === 'system_admin');

        if (unitId) {
            // [編輯模式]
            document.getElementById('currentMode').value = 'edit';
            const unit = this.allUnits.find(u => u.id === unitId);
            
            if (unit) {
                inputId.value = unit.id;
                inputId.disabled = true;
                
                inputName.value = unit.name;
                inputName.disabled = !isAdmin;

                // 過濾該單位人員
                const unitStaff = this.allUsers.filter(u => u.unitId === unit.id);
                
                this.renderCheckboxList('managerList', 'mgr_', unitStaff, unit.managers);
                this.renderCheckboxList('schedulerList', 'sch_', unitStaff, unit.schedulers);
            }
        } else {
            // [新增模式]
            document.getElementById('currentMode').value = 'add';
            
            inputId.value = '';
            inputId.disabled = false;
            
            inputName.value = '';
            inputName.disabled = false;

            document.getElementById('managerList').innerHTML = 
                '<div class="empty-tip">請先儲存建立單位，<br>再至「人員管理」指派人員。</div>';
            document.getElementById('schedulerList').innerHTML = 
                '<div class="empty-tip">請先儲存建立單位，<br>再至「人員管理」指派人員。</div>';
        }
    },

    closeModal: function() {
        document.getElementById('unitModal').classList.remove('show');
    },

    renderCheckboxList: function(containerId, prefix, staffList, checkedUids) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        if (!staffList || staffList.length === 0) {
            container.innerHTML = '<div class="empty-tip">此單位目前尚無人員。<br>請至「人員管理」新增。</div>';
            return;
        }

        staffList.forEach(user => {
            const isChecked = (checkedUids && checkedUids.includes(user.uid)) ? 'checked' : '';
            const label = document.createElement('label');
            label.className = 'staff-item';
            label.innerHTML = `
                <input type="checkbox" id="${prefix}${user.uid}" value="${user.uid}" ${isChecked}>
                <span class="staff-name">${user.name}</span>
                <span class="staff-id">(${user.empId})</span>
            `;
            container.appendChild(label);
        });
    },

    getCheckedValues: function(containerId) {
        const container = document.getElementById(containerId);
        const inputs = container.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(inputs).map(cb => cb.value);
    },

    // --- 4. 儲存資料 (含權限連動) ---
    saveData: async function() {
        const mode = document.getElementById('currentMode').value;
        const unitId = document.getElementById('inputUnitId').value.trim();
        const unitName = document.getElementById('inputUnitName').value.trim();

        if (!unitId || !unitName) { alert("代碼與名稱為必填"); return; }

        const managers = this.getCheckedValues('managerList');
        const schedulers = this.getCheckedValues('schedulerList');

        const unitData = {
            name: unitName,
            managers: managers,
            schedulers: schedulers,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const batch = db.batch();
            const unitRef = db.collection('units').doc(unitId);

            if (mode === 'edit') {
                batch.update(unitRef, unitData);
            } else {
                const check = await unitRef.get();
                if (check.exists) { alert("單位代碼已存在"); return; }
                unitData.groups = [];
                unitData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                batch.set(unitRef, unitData);
            }

            // 同步人員 Role
            if (mode === 'edit') {
                const unitStaff = this.allUsers.filter(u => u.unitId === unitId);
                unitStaff.forEach(user => {
                    if (user.role === 'system_admin') return; // 保護管理員

                    let newRole = 'user';
                    if (managers.includes(user.uid)) newRole = 'unit_manager';
                    else if (schedulers.includes(user.uid)) newRole = 'unit_scheduler';

                    if (user.role !== newRole) {
                        const userRef = db.collection('users').doc(user.uid);
                        batch.update(userRef, { role: newRole });
                    }
                });
            }

            await batch.commit();
            alert("儲存成功，相關人員權限已同步更新！");
            this.closeModal();
            await this.fetchAllUsers(); 
            await this.fetchUnits();
        } catch (e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    deleteUnit: async function(id) {
        if (confirm(`確定要刪除單位 ${id} 嗎？`)) {
            try {
                await db.collection('units').doc(id).delete();
                this.fetchUnits();
            } catch (e) { alert("刪除失敗: " + e.message); }
        }
    },

    // --- 5. 匯入功能 ---
    openImportModal: function() {
        document.getElementById('unitImportModal').classList.add('show');
        document.getElementById('csvUnitFile').value = '';
        document.getElementById('unitImportResult').innerHTML = '';
    },
    closeImportModal: function() {
        document.getElementById('unitImportModal').classList.remove('show');
    },
    downloadTemplate: function() {
        const content = "\uFEFF單位代碼,單位名稱\nICU01,內科加護病房\n9B,9B病房";
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "單位匯入範例.csv";
        link.click();
    },
    processImport: function() {
        const file = document.getElementById('csvUnitFile').files[0];
        if(!file) { alert("請選擇檔案"); return; }
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const rows = e.target.result.split(/\r\n|\n/);
            const batch = db.batch();
            let count = 0;
            
            for(let i=1; i<rows.length; i++) {
                const cols = rows[i].split(',');
                if(cols.length < 2) continue;
                const uid = cols[0].trim();
                const uname = cols[1].trim();
                if(uid && uname) {
                    batch.set(db.collection('units').doc(uid), {
                        name: uname,
                        managers: [], schedulers: [], groups: [],
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                }
            }
            if(count>0) {
                await batch.commit();
                alert(`匯入 ${count} 筆`);
                this.closeImportModal();
                this.fetchUnits();
            } else {
                alert("無有效資料");
            }
        };
        reader.readAsText(file);
    }
};
