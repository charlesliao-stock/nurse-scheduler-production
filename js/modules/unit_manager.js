// js/modules/unit_manager.js (優化版)

const unitManager = {
    allUnits: [],
    allUsers: [],
    sortState: { field: 'id', order: 'asc' },
    isLoading: false,
    
    // --- 初始化 ---
    init: async function() {
        console.log("Unit Manager Loaded.");
        
        const searchInput = document.getElementById('searchUnitInput');
        if(searchInput) {
            searchInput.oninput = this.debounce(() => this.renderTable(), 300);
        }

        // 權限控制
        const btnAdd = document.getElementById('btnAddUnit');
        const btnImport = document.getElementById('btnImportUnit');
        if (app.userRole !== 'system_admin') {
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
            console.log(`載入 ${this.allUsers.length} 位使用者`);
        } catch (e) {
            console.error("載入使用者失敗:", e);
        }
    },

    fetchUnits: async function() {
        if(this.isLoading) {
            console.log("資料載入中...");
            return;
        }

        const tbody = document.getElementById('unitTableBody');
        if(!tbody) {
            console.error("找不到表格 tbody");
            return;
        }

        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">資料載入中...</td></tr>';
        this.isLoading = true;
        
        try {
            const snapshot = await db.collection('units').get();
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

    // --- 2. 排序功能 ---
    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    // --- 3. 渲染列表 ---
    renderTable: function() {
        const tbody = document.getElementById('unitTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '';

        // 更新表頭圖示
        document.querySelectorAll('th i[id^="sort_icon_unit_"]').forEach(i => {
            i.className = 'fas fa-sort';
        });
        const activeIcon = document.getElementById(`sort_icon_unit_${this.sortState.field}`);
        if(activeIcon) {
            activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        }

        const searchTerm = (document.getElementById('searchUnitInput')?.value || '').toLowerCase().trim();
        
        // 1. 篩選
        let filtered = this.allUnits.filter(u => {
            if(!searchTerm) return true;
            return u.id.toLowerCase().includes(searchTerm) || 
                   (u.name && u.name.toLowerCase().includes(searchTerm));
        });

        // 2. 排序
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

        // 3. 渲染
        const fragment = document.createDocumentFragment();
        
        filtered.forEach(u => {
            const managerNames = this.getNames(u.managers);
            const schedulerNames = this.getNames(u.schedulers);
            
            let deleteBtn = '';
            if (app.userRole === 'system_admin') {
                deleteBtn = `<button class="btn btn-delete" onclick="unitManager.deleteUnit('${u.id}')">刪除</button>`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${u.id}</strong></td>
                <td>${u.name}</td>
                <td>${managerNames}</td>
                <td>${schedulerNames}</td>
                <td>
                    <button class="btn btn-edit" onclick="unitManager.openModal('${u.id}')">編輯</button>
                    ${deleteBtn}
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

    // --- 4. Modal 操作 ---
    openModal: function(unitId = null) {
        const modal = document.getElementById('unitModal');
        if(!modal) {
            console.error("找不到 Modal");
            return;
        }
        
        modal.classList.add('show');
        
        const inputId = document.getElementById('inputUnitId');
        const inputName = document.getElementById('inputUnitName');
        const isAdmin = (app.userRole === 'system_admin');

        if (unitId) {
            // 編輯模式
            document.getElementById('currentMode').value = 'edit';
            const unit = this.allUnits.find(u => u.id === unitId);
            
            if (!unit) {
                alert("找不到該單位資料");
                this.closeModal();
                return;
            }
            
            inputId.value = unit.id;
            inputId.disabled = true;
            
            inputName.value = unit.name;
            inputName.disabled = !isAdmin;

            // 過濾該單位人員
            const unitStaff = this.allUsers.filter(u => u.unitId === unit.id);
            
            this.renderCheckboxList('managerList', 'mgr_', unitStaff, unit.managers || []);
            this.renderCheckboxList('schedulerList', 'sch_', unitStaff, unit.schedulers || []);
            
        } else {
            // 新增模式
            document.getElementById('currentMode').value = 'add';
            
            inputId.value = '';
            inputId.disabled = false;
            
            inputName.value = '';
            inputName.disabled = false;

            document.getElementById('managerList').innerHTML = 
                '<div style="padding:20px; text-align:center; color:#999;">請先儲存建立單位,<br>再至「人員管理」指派人員。</div>';
            document.getElementById('schedulerList').innerHTML = 
                '<div style="padding:20px; text-align:center; color:#999;">請先儲存建立單位,<br>再至「人員管理」指派人員。</div>';
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
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">此單位目前尚無人員。<br>請至「人員管理」新增。</div>';
            return;
        }

        staffList.forEach(user => {
            const isChecked = (checkedUids && checkedUids.includes(user.uid)) ? 'checked' : '';
            
            const label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; padding:8px; cursor:pointer; border-bottom:1px solid #eee;';
            label.innerHTML = `
                <input type="checkbox" id="${prefix}${user.uid}" value="${user.uid}" ${isChecked} style="margin-right:8px;">
                <span style="flex:1;"><strong>${user.name}</strong> <span style="color:#666; font-size:0.85rem;">(${user.empId})</span></span>
            `;
            
            label.onmouseover = () => label.style.backgroundColor = '#f0f8ff';
            label.onmouseout = () => label.style.backgroundColor = 'transparent';
            
            container.appendChild(label);
        });
    },

    getCheckedValues: function(containerId) {
        const container = document.getElementById(containerId);
        if(!container) return [];
        
        const inputs = container.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(inputs).map(cb => cb.value);
    },

    // --- 5. 儲存資料 (含權限連動) ---
    saveData: async function() {
        const mode = document.getElementById('currentMode').value;
        const unitId = document.getElementById('inputUnitId').value.trim();
        const unitName = document.getElementById('inputUnitName').value.trim();

        // 驗證
        if (!unitId) { 
            alert("請輸入單位代碼"); 
            document.getElementById('inputUnitId').focus();
            return; 
        }
        if (!unitName) { 
            alert("請輸入單位名稱"); 
            document.getElementById('inputUnitName').focus();
            return; 
        }

        // 代碼格式驗證（只允許英數字和底線）
        if (!/^[A-Za-z0-9_]+$/.test(unitId)) {
            alert("單位代碼只能包含英文、數字和底線");
            document.getElementById('inputUnitId').focus();
            return;
        }

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
                // 檢查是否已存在
                const check = await unitRef.get();
                if (check.exists) { 
                    alert("單位代碼已存在,請使用其他代碼"); 
                    document.getElementById('inputUnitId').focus();
                    return; 
                }
                
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
                    if (managers.includes(user.uid)) {
                        newRole = 'unit_manager';
                    } else if (schedulers.includes(user.uid)) {
                        newRole = 'unit_scheduler';
                    }

                    if (user.role !== newRole) {
                        const userRef = db.collection('users').doc(user.uid);
                        batch.update(userRef, { 
                            role: newRole,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        console.log(`更新 ${user.name} 角色: ${user.role} -> ${newRole}`);
                    }
                });
            }

            await batch.commit();
            alert("儲存成功！相關人員權限已同步更新。");
            this.closeModal();
            await this.fetchAllUsers(); 
            await this.fetchUnits();
            
        } catch (e) {
            console.error("Save Error:", e);
            alert("儲存失敗: " + e.message);
        }
    },

    deleteUnit: async function(id) {
        // 檢查是否有人員
        const staffCount = this.allUsers.filter(u => u.unitId === id).length;
        
        let confirmMsg = `確定要刪除單位 ${id} 嗎？`;
        if(staffCount > 0) {
            confirmMsg += `\n\n注意：此單位目前有 ${staffCount} 位人員,刪除後這些人員將失去單位歸屬。`;
        }
        
        if (!confirm(confirmMsg)) return;

        try {
            await db.collection('units').doc(id).delete();
            alert("刪除成功");
            await this.fetchUnits();
        } catch (e) {
            console.error("Delete Error:", e);
            alert("刪除失敗: " + e.message);
        }
    },

    // --- 6. 匯入功能 ---
    openImportModal: function() {
        const modal = document.getElementById('unitImportModal');
        if(!modal) return;
        
        modal.classList.add('show');
        document.getElementById('csvUnitFile').value = '';
        document.getElementById('unitImportResult').innerHTML = '';
    },

    closeImportModal: function() {
        const modal = document.getElementById('unitImportModal');
        if(modal) modal.classList.remove('show');
    },

    downloadTemplate: function() {
        const content = "\uFEFF單位代碼,單位名稱\nICU01,內科加護病房\n9B,9B病房";
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "單位匯入範例.csv";
        link.click();
    },

    processImport: async function() {
        const file = document.getElementById('csvUnitFile')?.files[0];
        const resultDiv = document.getElementById('unitImportResult');
        
        if(!file) { 
            alert("請選擇檔案"); 
            return; 
        }
        
        resultDiv.innerHTML = "讀取中...";
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const rows = e.target.result.split(/\r\n|\n/);
                const batch = db.batch();
                let count = 0;
                let errors = [];
                
                for(let i = 1; i < rows.length; i++) {
                    const row = rows[i].trim();
                    if(!row) continue;
                    
                    const cols = row.split(',');
                    if(cols.length < 2) {
                        errors.push(`第 ${i+1} 行：欄位不足`);
                        continue;
                    }
                    
                    const uid = cols[0].trim();
                    const uname = cols[1].trim();
                    
                    if(!uid || !uname) {
                        errors.push(`第 ${i+1} 行：資料不完整`);
                        continue;
                    }
                    
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
                    alert(`匯入完成！共 ${count} 筆\n${errors.length > 0 ? '\n錯誤：\n' + errors.join('\n') : ''}`);
                    this.closeImportModal();
                    await this.fetchUnits();
                } else {
                    resultDiv.innerHTML = "無有效資料";
                }
                
            } catch(error) {
                console.error("Import Error:", error);
                resultDiv.innerHTML = `<span style="color:red;">匯入失敗: ${error.message}</span>`;
            }
        };
        
        reader.onerror = () => {
            resultDiv.innerHTML = '<span style="color:red;">檔案讀取失敗</span>';
        };
        
        reader.readAsText(file);
    }
};
