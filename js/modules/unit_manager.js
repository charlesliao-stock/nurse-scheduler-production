// js/modules/unit_manager.js

const unitManager = {
    allUnits: [],
    allUsers: [],
    currentUnitId: null,
    currentUnitGroups: [],
    
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
                groupId: doc.data().groupId || ''
            }));
        } catch (e) { console.error(e); }
    },

    fetchUnits: async function() {
        try {
            const snapshot = await db.collection('units').get();
            this.allUnits = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                groups: doc.data().groups || []
            }));
            this.renderTable();
        } catch (e) { console.error(e); }
    },

    // --- 2. 渲染主列表 ---
    renderTable: function() {
        const tbody = document.getElementById('unitTableBody');
        tbody.innerHTML = '';
        const searchTerm = (document.getElementById('searchUnitInput').value || '').toLowerCase();
        
        const filtered = this.allUnits.filter(u => 
            u.id.toLowerCase().includes(searchTerm) || (u.name && u.name.toLowerCase().includes(searchTerm))
        );

        if(filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">無符合資料</td></tr>';
            return;
        }

        filtered.forEach(u => {
            const managerNames = this.getNamesFromIds(u.managers);
            const schedulerNames = this.getNamesFromIds(u.schedulers);
            
            let deleteBtn = app.userRole === 'system_admin' ? 
                `<button class="btn btn-delete" onclick="unitManager.deleteUnit('${u.id}')">刪除</button>` : 
                `<button class="btn btn-delete" disabled style="opacity:0.3; cursor:not-allowed;">刪除</button>`;

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

    getNamesFromIds: function(idArray) {
        if (!idArray || !Array.isArray(idArray) || idArray.length === 0) return '<span style="color:#ccc;">(未設定)</span>';
        return idArray.map(uid => {
            const user = this.allUsers.find(p => p.uid === uid);
            return user ? `<span class="badge" style="background:#eee; color:#333; margin-right:3px;">${user.name}</span>` : '';
        }).join(' ');
    },

    // --- 3. Modal 操作 ---
    switchTab: function(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        event.currentTarget.classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');

        const mainSaveBtn = document.getElementById('btnSaveUnitInfo');
        if (tabName === 'info') {
            mainSaveBtn.style.display = 'inline-block';
        } else {
            mainSaveBtn.style.display = 'none';
            this.renderGroupStaffList();
        }
    },

    openModal: function(unitId = null) {
        const modal = document.getElementById('unitModal');
        modal.classList.add('show');
        this.currentUnitId = unitId;

        // Reset Tab
        const tabs = document.querySelectorAll('.tab-btn');
        if(tabs.length > 0) tabs[0].click();

        const isAdmin = (app.userRole === 'system_admin');
        const inputId = document.getElementById('inputUnitId');
        const inputName = document.getElementById('inputUnitName');
        const mgrContainer = document.getElementById('containerManagerAuth');
        const schContainer = document.getElementById('containerSchedulerAuth');

        // 權限控制
        if (isAdmin) {
            mgrContainer.style.pointerEvents = 'auto';
            mgrContainer.style.opacity = '1';
        } else {
            mgrContainer.style.pointerEvents = 'none';
            mgrContainer.style.opacity = '0.6';
        }
        schContainer.style.pointerEvents = 'auto';
        schContainer.style.opacity = '1';

        if(unitId) {
            // Edit
            document.getElementById('currentMode').value = 'edit';
            const unit = this.allUnits.find(u => u.id === unitId);
            if(unit) {
                document.getElementById('originalUnitId').value = unit.id;
                inputId.value = unit.id;
                inputId.disabled = true;
                
                inputName.value = unit.name;
                inputName.disabled = !isAdmin;

                this.renderUserCheckboxes('managerListContainer', 'chk_mgr_', unit.id);
                this.renderUserCheckboxes('schedulerListContainer', 'chk_sch_', unit.id);
                this.checkUsers('chk_mgr_', unit.managers);
                this.checkUsers('chk_sch_', unit.schedulers);

                this.currentUnitGroups = [...(unit.groups || [])];
                this.renderGroupList();
            }
        } else {
            // Add
            document.getElementById('currentMode').value = 'add';
            document.getElementById('originalUnitId').value = '';
            inputId.value = '';
            inputId.disabled = false;
            inputName.value = '';
            inputName.disabled = false;

            this.renderUserCheckboxes('managerListContainer', 'chk_mgr_', 'NEW_UNIT');
            this.renderUserCheckboxes('schedulerListContainer', 'chk_sch_', 'NEW_UNIT');

            this.currentUnitGroups = [];
            this.renderGroupList();
            document.getElementById('groupStaffListArea').innerHTML = '<div style="padding:10px; color:#666; text-align:center;">請先儲存單位。</div>';
        }
    },

    closeModal: function() {
        document.getElementById('unitModal').classList.remove('show');
    },

    // --- [關鍵修正] 渲染 Checkbox (配合 CSS) ---
    renderUserCheckboxes: function(containerId, prefix, targetUnitId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        const validUsers = this.allUsers.filter(u => u.unitId === targetUnitId);

        if (validUsers.length === 0) {
            const msg = targetUnitId === 'NEW_UNIT' ? "請先建立單位" : "此單位尚無人員";
            container.innerHTML = `<div style="color:#666; padding:15px; text-align:center;">${msg}</div>`;
            return;
        }

        validUsers.forEach(user => {
            const div = document.createElement('div');
            // 使用新定義的 CSS Class: user-checkbox-row
            div.className = 'user-checkbox-row'; 
            
            // 結構：Checkbox + 文字 (使用 span class="user-info-text")
            div.innerHTML = `
                <label>
                    <input type="checkbox" id="${prefix}${user.uid}" value="${user.uid}">
                    <span class="user-info-text">
                        ${user.name} <span class="u-emp-id">(${user.empId})</span>
                    </span>
                </label>
            `;
            container.appendChild(div);
        });
    },

    checkUsers: function(prefix, idArray) {
        if(!idArray) return;
        idArray.forEach(uid => {
            const el = document.getElementById(prefix + uid);
            if(el) el.checked = true;
        });
    },

    filterUserList: function(type) {
        const inputId = type === 'manager' ? 'searchManagerInput' : 'searchSchedulerInput';
        const containerId = type === 'manager' ? 'managerListContainer' : 'schedulerListContainer';
        const keyword = document.getElementById(inputId).value.toLowerCase();
        const container = document.getElementById(containerId);
        const items = container.querySelectorAll('.user-checkbox-row'); // 使用新的 Class
        items.forEach(item => {
            const text = item.innerText.toLowerCase();
            // user-checkbox-row 是 block 元素
            item.style.display = text.includes(keyword) ? 'block' : 'none'; 
        });
    },

    // --- Tab 1 儲存 ---
    saveUnitInfo: async function() {
        const mode = document.getElementById('currentMode').value;
        const unitId = document.getElementById('inputUnitId').value.trim();
        const unitName = document.getElementById('inputUnitName').value.trim();

        if(!unitId || !unitName) { alert("代碼與名稱為必填"); return; }

        const managers = this.getCheckedValues('managerListContainer');
        const schedulers = this.getCheckedValues('schedulerListContainer');

        const data = {
            name: unitName,
            managers: managers,
            schedulers: schedulers,
        };

        try {
            if (mode === 'edit') {
                await db.collection('units').doc(unitId).update(data);
            } else {
                if (app.userRole !== 'system_admin') { alert("權限不足"); return; }
                const check = await db.collection('units').doc(unitId).get();
                if(check.exists) { alert("代碼重複"); return; }
                
                data.groups = [];
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('units').doc(unitId).set(data);
            }
            alert("單位資訊儲存成功！");
            if(mode === 'add') this.closeModal();
            this.fetchUnits();
        } catch (e) {
            alert("儲存失敗: " + e.message);
        }
    },

    getCheckedValues: function(containerId) {
        const container = document.getElementById(containerId);
        const checked = container.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checked).map(cb => cb.value);
    },

    // --- Tab 2 Group Management ---
    renderGroupList: function() {
        const container = document.getElementById('groupListArea');
        container.innerHTML = '';
        this.currentUnitGroups.forEach((groupName, index) => {
            const div = document.createElement('div');
            div.className = 'group-list-item';
            div.innerHTML = `
                <span style="font-weight:bold;">${groupName}</span>
                <div>
                    <button class="btn btn-edit" style="padding:2px 5px; font-size:0.8rem;" onclick="unitManager.editGroup(${index})">編輯</button>
                    <button class="btn btn-delete" style="padding:2px 5px; font-size:0.8rem;" onclick="unitManager.deleteGroup(${index})">刪除</button>
                </div>
            `;
            container.appendChild(div);
        });
    },

    addGroup: async function() {
        if(!this.currentUnitId) return;
        const input = document.getElementById('inputNewGroup');
        const name = input.value.trim();
        if(!name) return;
        if(this.currentUnitGroups.includes(name)) { alert("名稱重複"); return; }

        this.currentUnitGroups.push(name);
        input.value = '';
        this.renderGroupList();
        await this.updateUnitGroupsDB();
    },

    editGroup: async function(index) {
        const oldName = this.currentUnitGroups[index];
        const newName = prompt("新組別名稱:", oldName);
        if(newName && newName.trim() && newName !== oldName) {
            this.currentUnitGroups[index] = newName.trim();
            this.renderGroupList();
            this.renderGroupStaffList();
            await this.updateUnitGroupsDB();
        }
    },

    deleteGroup: async function(index) {
        if(confirm("確定刪除？")) {
            this.currentUnitGroups.splice(index, 1);
            this.renderGroupList();
            this.renderGroupStaffList();
            await this.updateUnitGroupsDB();
        }
    },

    updateUnitGroupsDB: async function() {
        try {
            await db.collection('units').doc(this.currentUnitId).update({
                groups: this.currentUnitGroups
            });
        } catch(e) { alert("更新失敗: " + e.message); }
    },

    renderGroupStaffList: function() {
        const container = document.getElementById('tableGroupStaff');
        container.innerHTML = '';
        const unitStaff = this.allUsers.filter(u => u.unitId === this.currentUnitId);
        
        if(unitStaff.length === 0) {
            container.innerHTML = '<tr><td colspan="2" style="padding:15px; text-align:center; color:#999;">此單位尚無人員</td></tr>';
            return;
        }

        unitStaff.forEach(user => {
            let rowOptions = '<option value="">(未分組)</option>';
            this.currentUnitGroups.forEach(g => {
                const sel = (user.groupId === g) ? 'selected' : '';
                rowOptions += `<option value="${g}" ${sel}>${g}</option>`;
            });

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #eee';
            tr.innerHTML = `
                <td style="padding:10px;">
                    <span style="font-weight:bold;">${user.name}</span> 
                    <span style="color:#888; font-size:0.8rem;">(${user.empId})</span>
                </td>
                <td style="padding:8px;">
                    <select class="group-select" data-uid="${user.uid}" style="width:100%; padding:5px; border-radius:4px; border:1px solid #ddd;">
                        ${rowOptions}
                    </select>
                </td>
            `;
            container.appendChild(tr);
        });
    },

    saveUserGroups: async function() {
        if(!confirm("確定更新人員組別？")) return;
        const selects = document.querySelectorAll('.group-select');
        const batch = db.batch();
        let count = 0;

        selects.forEach(sel => {
            const uid = sel.getAttribute('data-uid');
            const newGroup = sel.value;
            const user = this.allUsers.find(u => u.uid === uid);
            if(user && user.groupId !== newGroup) {
                batch.update(db.collection('users').doc(uid), { groupId: newGroup });
                user.groupId = newGroup;
                count++;
            }
        });

        if(count > 0) {
            await batch.commit();
            alert(`已更新 ${count} 位人員`);
        } else {
            alert("無變更");
        }
    },

    deleteUnit: async function(id) {
        if(app.userRole !== 'system_admin') return;
        if(confirm(`確定刪除 ${id}?`)) {
            await db.collection('units').doc(id).delete();
            this.fetchUnits();
        }
    },

    // --- 匯入功能 (完整版) ---
    openImportModal: function() {
        if (app.userRole !== 'system_admin') return;
        document.getElementById('unitImportModal').classList.add('show');
        document.getElementById('unitImportResult').innerHTML = '';
        document.getElementById('csvUnitFile').value = '';
    },
    
    closeImportModal: function() {
        document.getElementById('unitImportModal').classList.remove('show');
    },

    downloadTemplate: function() {
        const content = "\uFEFF單位代碼,單位名稱\nICU01,內科加護病房\nICU02,外科加護病房";
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "單位匯入範例.csv";
        link.click();
    },

    processImport: function() {
        const fileInput = document.getElementById('csvUnitFile');
        const resultDiv = document.getElementById('unitImportResult');
        const file = fileInput.files[0];
        
        if(!file) { alert("請選擇檔案"); return; }

        resultDiv.innerHTML = "讀取中...";

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                const rows = text.split(/\r\n|\n/);
                const batch = db.batch();
                let count = 0;
                let errorCount = 0;

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i].trim();
                    if (!row) continue;
                    const cols = row.split(',');
                    if (cols.length < 2) { errorCount++; continue; }

                    const unitId = cols[0].trim();
                    const unitName = cols[1].trim();

                    if (unitId && unitName) {
                        const docRef = db.collection('units').doc(unitId);
                        batch.set(docRef, {
                            name: unitName,
                            managers: [],
                            schedulers: [],
                            groups: [],
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        count++;
                    } else {
                        errorCount++;
                    }
                    if (count % 450 === 0) await batch.commit();
                }

                if (count > 0) {
                    await batch.commit();
                    resultDiv.innerHTML = `<span style="color:green;">成功匯入: ${count} 筆</span>`;
                    alert(`匯入完成！成功新增 ${count} 個單位。`);
                    this.closeImportModal();
                    this.fetchUnits();
                } else {
                    resultDiv.innerHTML = "<span style='color:red'>沒有有效資料。</span>";
                }
            } catch (err) {
                console.error(err);
                resultDiv.innerHTML = `<span style='color:red'>錯誤: ${err.message}</span>`;
            }
        };
        reader.readAsText(file);
    }
};
