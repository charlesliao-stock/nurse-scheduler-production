// js/modules/unit_manager.js (完整版 - 雙向同步)

const unitManager = {
    allUnits: [],
    allUsers: [],
    sortState: { field: 'id', order: 'asc' },
    isLoading: false,
    
    // --- 1. 初始化 ---
    init: async function() {
        console.log("Unit Manager Initializing...");
        
        const searchInput = document.getElementById('searchUnitInput');
        if(searchInput) {
            searchInput.oninput = this.debounce(() => this.renderTable(), 300);
        }

        // 權限控制
        const activeRole = app.impersonatedRole || app.userRole;
        const btnAdd = document.getElementById('btnAddUnit');
        const btnImport = document.getElementById('btnImportUnit');
        if (activeRole !== 'system_admin') {
            if(btnAdd) btnAdd.style.display = 'none';
            if(btnImport) btnImport.style.display = 'none';
        }

        await this.fetchAllUsers(); 
        await this.fetchUnits();    
    },

    debounce: function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    },

    // --- 2. 取得資料 ---
    fetchAllUsers: async function() {
        try {
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            let query = db.collection('users').where('isActive', '==', true);
            
            if ((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && activeUnitId) {
                query = query.where('unitId', '==', activeUnitId);
            }
            
            const snapshot = await query.get();
            this.allUsers = snapshot.docs.map(doc => ({
                uid: doc.id,
                name: doc.data().displayName || '未命名',
                empId: doc.data().employeeId || '',
                unitId: doc.data().unitId || '',
                role: doc.data().role || 'user'
            }));
            console.log(`載入 ${this.allUsers.length} 位使用者`);
        } catch (e) {
            console.error("載入使用者失敗:", e);
        }
    },

    fetchUnits: async function() {
        if(this.isLoading) return;

        const tbody = document.getElementById('unitTableBody');
        if(!tbody) return;

        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">資料載入中...</td></tr>';
        this.isLoading = true;
        
        try {
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            let query = db.collection('units');
            
            if ((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && activeUnitId) {
                query = query.where(firebase.firestore.FieldPath.documentId(), '==', activeUnitId);
            }
            
            const snapshot = await query.get();
            this.allUnits = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            console.log(`成功載入 ${this.allUnits.length} 個單位`);
            this.renderTable();
        } catch (e) {
            console.error("Fetch Units Error:", e);
            tbody.innerHTML = `<tr><td colspan="5" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        } finally {
            this.isLoading = false;
        }
    },

    // --- 3. 渲染列表 ---
    renderTable: function() {
        const tbody = document.getElementById('unitTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '';

        document.querySelectorAll('th i[id^="sort_icon_unit_"]').forEach(i => {
            i.className = 'fas fa-sort';
        });
        const activeIcon = document.getElementById(`sort_icon_unit_${this.sortState.field}`);
        if(activeIcon) {
            activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        }

        const searchTerm = (document.getElementById('searchUnitInput')?.value || '').toLowerCase().trim();
        
        let filtered = this.allUnits.filter(u => {
            if(!searchTerm) return true;
            return u.id.toLowerCase().includes(searchTerm) || 
                   (u.name && u.name.toLowerCase().includes(searchTerm));
        });

        const { field, order } = this.sortState;
        filtered.sort((a, b) => {
            let valA, valB;
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
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#999;">無符合資料</td></tr>';
            return;
        }

        const activeRole = app.impersonatedRole || app.userRole;
        const isSystemAdmin = (activeRole === 'system_admin');

        const fragment = document.createDocumentFragment();
        filtered.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${u.id}</strong></td>
                <td>${u.name}</td>
                <td>${this.getNames(u.managers)}</td>
                <td>${this.getNames(u.schedulers)}</td>
                <td>
                    <button class="btn btn-edit" onclick="unitManager.openModal('${u.id}')">編輯</button>
                    ${isSystemAdmin ? `<button class="btn btn-delete" onclick="unitManager.deleteUnit('${u.id}')">刪除</button>` : ''}
                </td>
            `;
            fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
    },

    getNames: function(uidArray) {
        if(!uidArray || !Array.isArray(uidArray) || uidArray.length === 0) {
            return '<span style="color:#999;">(未設定)</span>'; 
        }
        const names = uidArray.map(uid => {
            const user = this.allUsers.find(p => p.uid === uid);
            return user ? user.name : null;
        }).filter(n => n);
        return names.length > 0 ? names.join(', ') : '<span style="color:#999;">(未設定)</span>';
    },

    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    // --- 4. Modal 操作 ---
    openModal: function(unitId = null) {
        const modal = document.getElementById('unitModal');
        if(!modal) return;
        modal.classList.add('show');
        
        const inputId = document.getElementById('inputUnitId');
        const inputName = document.getElementById('inputUnitName');
        const activeRole = app.impersonatedRole || app.userRole;
        const isAdmin = (activeRole === 'system_admin');

        if (unitId) {
            document.getElementById('currentMode').value = 'edit';
            const unit = this.allUnits.find(u => u.id === unitId);
            if (!unit) { this.closeModal(); return; }
            inputId.value = unit.id;
            inputId.disabled = true;
            inputName.value = unit.name;
            inputName.disabled = !isAdmin;
            const unitStaff = this.allUsers.filter(u => u.unitId === unit.id);
            this.renderCheckboxList('managerList', 'mgr_', unitStaff, unit.managers || []);
            this.renderCheckboxList('schedulerList', 'sch_', unitStaff, unit.schedulers || []);
        } else {
            document.getElementById('currentMode').value = 'add';
            inputId.value = '';
            inputId.disabled = false;
            inputName.value = '';
            inputName.disabled = false;
            document.getElementById('managerList').innerHTML = '<div style="padding:20px; text-align:center; color:#999;">請先儲存建立單位再指派人員。</div>';
            document.getElementById('schedulerList').innerHTML = '<div style="padding:20px; text-align:center; color:#999;">請先儲存建立單位再指派人員。</div>';
        }
    },

    closeModal: function() {
        const modal = document.getElementById('unitModal');
        if(modal) modal.classList.remove('show');
    },

    renderCheckboxList: function(containerId, prefix, staffList, checkedUids) {
        const container = document.getElementById(containerId);
        if(!container) return;
        container.innerHTML = '';
        if (!staffList || staffList.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">此單位尚無人員。</div>';
            return;
        }
        staffList.forEach(user => {
            const isChecked = (checkedUids && checkedUids.includes(user.uid)) ? 'checked' : '';
            const label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; padding:8px; cursor:pointer; border-bottom:1px solid #eee;';
            label.innerHTML = `
                <input type="checkbox" id="${prefix}${user.uid}" value="${user.uid}" ${isChecked} style="margin-right:8px;">
                <span style="flex:1;"><strong>${user.name}</strong> (${user.empId})</span>
            `;
            container.appendChild(label);
        });
    },

    getCheckedValues: function(containerId) {
        const container = document.getElementById(containerId);
        if(!container) return [];
        const inputs = container.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(inputs).map(cb => cb.value);
    },

    // --- 5. 儲存（含雙向同步） ---
    saveData: async function() {
        const mode = document.getElementById('currentMode').value;
        const unitId = document.getElementById('inputUnitId').value.trim();
        const unitName = document.getElementById('inputUnitName').value.trim();

        if (!unitId || !unitName) { alert("請填寫代碼與名稱"); return; }
        if (!/^[A-Za-z0-9_]+$/.test(unitId)) { alert("代碼僅限英數字底線"); return; }

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
                if (check.exists) { alert("代碼已存在"); return; }
                unitData.groups = [];
                unitData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                batch.set(unitRef, unitData);
            }

            // ✅ 雙向同步：更新所有該單位人員的 role
            const unitStaff = this.allUsers.filter(u => u.unitId === unitId);
            
            unitStaff.forEach(user => {
                const userRef = db.collection('users').doc(user.uid);
                let newRole = 'user';
                
                if (managers.includes(user.uid)) {
                    newRole = 'unit_manager';
                } else if (schedulers.includes(user.uid)) {
                    newRole = 'unit_scheduler';
                }
                
                // 只在 role 改變時更新
                if (user.role !== newRole) {
                    batch.update(userRef, {
                        role: newRole,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`✅ 同步：${user.name} 的角色更新為 ${newRole}`);
                }
            });

            await batch.commit();
            alert("儲存成功！");
            this.closeModal();
            await this.fetchAllUsers(); // 重新載入使用者以反映角色變更
            await this.fetchUnits();
        } catch (e) { 
            console.error("儲存失敗:", e);
            alert("儲存失敗: " + e.message); 
        }
    },

    deleteUnit: async function(id) {
        if (!confirm(`確定要刪除單位 ${id} 嗎？`)) return;
        try {
            await db.collection('units').doc(id).delete();
            alert("刪除成功");
            await this.fetchUnits();
        } catch (e) { alert("刪除失敗: " + e.message); }
    },

    // --- 6. 匯入 ---
    openImportModal: function() {
        const modal = document.getElementById('unitImportModal');
        if(modal) modal.classList.add('show');
    },

    closeImportModal: function() {
        const modal = document.getElementById('unitImportModal');
        if(modal) modal.classList.remove('show');
    },

    processImport: async function() {
        const file = document.getElementById('csvUnitFile')?.files[0];
        const resultDiv = document.getElementById('unitImportResult');
        if(!file) { alert("請選擇檔案"); return; }
        
        resultDiv.innerHTML = "讀取中...";
        
        const existingNames = new Set(this.allUnits.map(u => u.name));
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const rows = e.target.result.split(/\r\n|\n/);
                const batch = db.batch();
                let count = 0;
                let skipCount = 0;
                let errors = [];
                const currentImportNames = new Set();
                
                for(let i = 1; i < rows.length; i++) {
                    const row = rows[i].trim();
                    if(!row) continue;
                    const cols = row.split(',');
                    if(cols.length < 2) continue;
                    
                    const uid = cols[0].trim();
                    const uname = cols[1].trim();

                    if(!uid || !uname) continue;

                    if (existingNames.has(uname) || currentImportNames.has(uname)) {
                        errors.push(`第 ${i+1} 行：名稱 「${uname}」 已重複，已略過。`);
                        skipCount++;
                        continue; 
                    }

                    currentImportNames.add(uname);
                    batch.set(db.collection('units').doc(uid), {
                        name: uname,
                        managers: [],
                        schedulers: [],
                        groups: [],
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    count++;
                }
                
                if(count > 0) {
                    await batch.commit();
                    let msg = `匯入完成！成功：${count} 筆`;
                    if(skipCount > 0) msg += `，略過重複：${skipCount} 筆`;
                    alert(msg + (errors.length > 0 ? '\n\n詳細記錄：\n' + errors.join('\n') : ''));
                    this.closeImportModal();
                    await this.fetchUnits();
                } else {
                    alert("無有效資料匯入（可能全部重複）。");
                    resultDiv.innerHTML = "匯入取消：無新資料";
                }
            } catch(error) {
                console.error(error);
                resultDiv.innerHTML = `<span style="color:red;">匯入失敗: ${error.message}</span>`;
            }
        };
        reader.readAsText(file);
    },

    downloadTemplate: function() {
        const content = "\uFEFF單位代碼,單位名稱\nICU01,內科加護病房\n9B,9B病房";
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "單位匯入範例.csv";
        link.click();
    }
};

window.unitManager = unitManager;
