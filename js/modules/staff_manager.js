// js/modules/staff_manager.js

const staffManager = {
    allData: [],
    unitCache: {}, 

    // --- 模組初始化 ---
    init: async function() {
        console.log("Staff Manager Module Loaded.");
        
        const searchInput = document.getElementById('searchStaffInput');
        if(searchInput) {
            searchInput.oninput = () => this.renderTable();
        }

        await this.loadUnitDropdown();
        await this.fetchData();
    },

    // --- 1. 載入單位下拉選單 ---
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        
        if(!selectFilter || !selectInput) return;

        selectFilter.innerHTML = '<option value="all">所有單位</option>';
        selectInput.innerHTML = '<option value="">請選擇單位</option>';
        this.unitCache = {}; 

        let query = db.collection('units');
        if(app.userRole === 'unit_manager' && app.userUnitId) {
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            snapshot.forEach(doc => {
                const unit = doc.data();
                this.unitCache[doc.id] = {
                    name: unit.name,
                    groups: unit.groups || [] 
                };

                const option = `<option value="${doc.id}">${unit.name}</option>`;
                selectFilter.innerHTML += option;
                selectInput.innerHTML += option;
            });
        } catch (e) {
            console.error("載入單位失敗:", e);
        }

        selectFilter.onchange = () => this.renderTable();
    },

    // --- 2. 單位與組別連動 ---
    onUnitChange: function() {
        const unitId = document.getElementById('inputUnit').value;
        const groupSelect = document.getElementById('inputGroup');
        
        groupSelect.innerHTML = '<option value="">(無)</option>';

        if (!unitId || !this.unitCache[unitId]) return;

        const groups = this.unitCache[unitId].groups;
        if (groups && groups.length > 0) {
            groupSelect.innerHTML = '<option value="">請選擇組別</option>';
            groups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g;
                opt.textContent = g;
                groupSelect.appendChild(opt);
            });
        } else {
            groupSelect.innerHTML = '<option value="">(此單位未設定組別)</option>';
        }
    },

    // --- 3. 讀取人員資料 ---
    fetchData: async function() {
        const tbody = document.getElementById('staffTableBody');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">資料載入中...</td></tr>';

        let query = db.collection('users').where('isActive', '==', true);
        if(app.userRole === 'unit_manager' && app.userUnitId) {
            query = query.where('unitId', '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            this.allData = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
            this.renderTable();
        } catch (error) {
            console.error("Fetch Data Error:", error);
            tbody.innerHTML = '<tr><td colspan="7" style="color:red;">載入失敗: ' + error.message + '</td></tr>';
        }
    },

    // --- 4. 渲染表格 ---
    renderTable: function() {
        const tbody = document.getElementById('staffTableBody');
        tbody.innerHTML = '';

        const filterUnit = document.getElementById('filterUnitSelect').value;
        const searchTerm = document.getElementById('searchStaffInput').value.toLowerCase();

        const filtered = this.allData.filter(u => {
            const matchUnit = filterUnit === 'all' || u.unitId === filterUnit;
            const matchSearch = (u.employeeId||'').toLowerCase().includes(searchTerm) || 
                                (u.displayName||'').toLowerCase().includes(searchTerm);
            return matchUnit && matchSearch;
        });

        if(filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">無符合資料</td></tr>';
            return;
        }

        filtered.forEach(u => {
            const unitName = (this.unitCache[u.unitId] && this.unitCache[u.unitId].name) || u.unitId;
            const roleName = app.translateRole(u.role);
            
            let deleteBtn = `<button class="btn btn-delete" onclick="staffManager.deleteUser('${u.id}')">刪除</button>`;
            if (u.role === 'system_admin') {
                deleteBtn = `<button class="btn btn-delete" disabled style="opacity:0.5; cursor:not-allowed;">刪除</button>`;
            }

            let statusTag = u.isRegistered ? 
                '<span style="color:green; font-size:0.8rem;">(已開通)</span>' : 
                '<span style="color:red; font-size:0.8rem;">(未開通)</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${u.employeeId || ''}</td>
                <td>${u.displayName || ''} <br>${statusTag}</td>
                <td>${u.level || ''}</td>
                <td>${u.groupId || ''}</td>
                <td><span class="role-badge" style="background:${this.getRoleColor(u.role)}">${roleName}</span></td>
                <td>
                    <button class="btn btn-edit" onclick="staffManager.openModal('${u.id}')">編輯</button>
                    ${deleteBtn}
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    getRoleColor: function(role) {
        if(role === 'system_admin') return '#2c3e50';
        if(role === 'unit_manager') return '#e67e22';
        if(role === 'unit_scheduler') return '#27ae60';
        return '#95a5a6';
    },

    // --- 5. Modal 操作 ---
    openModal: function(docId = null) {
        const modal = document.getElementById('staffModal');
        modal.classList.add('show');
        document.getElementById('staffDocId').value = docId || '';
        
        if(docId) {
            const u = this.allData.find(d => d.id === docId);
            if(u) {
                document.getElementById('inputEmpId').value = u.employeeId || '';
                document.getElementById('inputName').value = u.displayName || '';
                document.getElementById('inputEmail').value = u.email || '';
                document.getElementById('inputLevel').value = u.level || 'N';
                document.getElementById('inputHireDate').value = u.hireDate || '';
                
                const roleInput = document.getElementById('inputRole');
                roleInput.value = u.role || 'user';
                roleInput.disabled = (u.role === 'system_admin');

                document.getElementById('inputUnit').value = u.unitId || '';
                this.onUnitChange(); 
                document.getElementById('inputGroup').value = u.groupId || '';

                const params = u.schedulingParams || {};
                document.getElementById('checkPregnant').checked = params.isPregnant || false;
                document.getElementById('checkBreastfeeding').checked = params.isBreastfeeding || false;
                document.getElementById('checkBundle').checked = params.canBundleShifts || false;
                
                const statusField = document.getElementById('accountStatus');
                if(statusField) statusField.value = u.isRegistered ? "已開通" : "等待員工自行開通";
            }
        } else {
            document.querySelectorAll('#staffModal input, #staffModal select').forEach(i => {
                if(i.type !== 'checkbox' && i.type !== 'hidden' && i.id !== 'accountStatus') i.value = '';
                if(i.type === 'checkbox') i.checked = false;
            });
            document.getElementById('inputRole').value = 'user';
            document.getElementById('inputRole').disabled = false;
            document.getElementById('inputGroup').innerHTML = '<option value="">(請先選擇單位)</option>';
            
            const statusField = document.getElementById('accountStatus');
            if(statusField) statusField.value = "新建立 (未開通)";
        }
    },

    closeModal: function() {
        document.getElementById('staffModal').classList.remove('show');
    },

    // --- 6. 儲存資料 (含連動 Unit) ---
    saveData: async function() {
        const docId = document.getElementById('staffDocId').value;
        const empId = document.getElementById('inputEmpId').value;
        const email = document.getElementById('inputEmail').value;
        const selectedRole = document.getElementById('inputRole').value;
        const selectedUnitId = document.getElementById('inputUnit').value;

        if(!empId || !email) { alert("員編與Email為必填"); return; }
        if(!selectedUnitId) { alert("請選擇所屬單位"); return; }

        const data = {
            employeeId: empId,
            displayName: document.getElementById('inputName').value,
            email: email,
            unitId: selectedUnitId,
            level: document.getElementById('inputLevel').value,
            groupId: document.getElementById('inputGroup').value,
            hireDate: document.getElementById('inputHireDate').value,
            role: selectedRole,
            isActive: true,
            schedulingParams: {
                isPregnant: document.getElementById('checkPregnant').checked,
                isBreastfeeding: document.getElementById('checkBreastfeeding').checked,
                canBundleShifts: document.getElementById('checkBundle').checked
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const batch = db.batch();

            // 1. 處理人員資料
            let userRef;
            if(docId) {
                userRef = db.collection('users').doc(docId);
                batch.update(userRef, data);
            } else {
                userRef = db.collection('users').doc(); 
                data.isRegistered = false; 
                data.uid = null;
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                batch.set(userRef, data);
            }
            
            const targetUid = docId || userRef.id;

            // 2. [連動邏輯] 更新 Unit 的管理者/排班者清單
            if (selectedRole !== 'system_admin') {
                const unitRef = db.collection('units').doc(selectedUnitId);
                const unitDoc = await unitRef.get();
                
                if (unitDoc.exists) {
                    let { managers, schedulers } = unitDoc.data();
                    managers = managers || [];
                    schedulers = schedulers || [];

                    // 先從兩邊移除 (避免重複或殘留)
                    managers = managers.filter(id => id !== targetUid);
                    schedulers = schedulers.filter(id => id !== targetUid);

                    // 根據新 Role 加入對應陣列
                    if (selectedRole === 'unit_manager') {
                        managers.push(targetUid);
                    } else if (selectedRole === 'unit_scheduler') {
                        schedulers.push(targetUid);
                    }
                    // 如果是 'user'，上面已移除，這裡不需動作

                    batch.update(unitRef, { 
                        managers: managers,
                        schedulers: schedulers 
                    });
                }
            }

            // 3. 提交
            await batch.commit();

            alert("儲存成功");
            this.closeModal();
            this.fetchData();
        } catch (e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    deleteUser: async function(id) {
        const u = this.allData.find(d => d.id === id);
        if (u && u.role === 'system_admin') {
            alert("系統保護：無法刪除超級管理員帳號！");
            return;
        }
        if(confirm("確定要刪除此人員嗎？(標記為離職)")) {
            await db.collection('users').doc(id).update({ isActive: false });
            this.fetchData();
        }
    },

    openImportModal: function() {
        const modal = document.getElementById('importModal');
        modal.classList.add('show');
        document.getElementById('importResult').innerHTML = '';
        document.getElementById('csvFileInput').value = ''; 
    },

    closeImportModal: function() {
        document.getElementById('importModal').classList.remove('show');
    },

    downloadTemplate: function() {
        const headers = "單位代碼,員工編號,姓名,Email,層級,到職日(YYYY-MM-DD),組別";
        const demoUnitId = Object.keys(this.unitCache)[0] || "ICU01";
        const csvContent = `\uFEFF${headers}\n${demoUnitId},N1001,王小明,wang@test.com,N2,2023-01-01,A組`;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "人員匯入範例.csv";
        link.click();
    },

    processImport: async function() {
        const fileInput = document.getElementById('csvFileInput');
        const resultDiv = document.getElementById('importResult');
        const file = fileInput.files[0];

        if (!file) { alert("請選擇 CSV"); return; }

        resultDiv.innerHTML = "讀取中...";
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            const rows = e.target.result.split(/\r\n|\n/);
            const batch = db.batch();
            let count = 0;

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i].trim();
                if (!row) continue;
                const cols = row.split(',');
                if (cols.length < 4) continue;

                const docRef = db.collection('users').doc();
                batch.set(docRef, {
                    unitId: cols[0].trim(),
                    employeeId: cols[1].trim(),
                    displayName: cols[2].trim(),
                    email: cols[3].trim(),
                    level: cols[4] ? cols[4].trim() : 'N',
                    hireDate: cols[5] ? cols[5].trim() : '',
                    groupId: cols[6] ? cols[6].trim() : '',
                    role: 'user',
                    isActive: true,
                    isRegistered: false,
                    uid: null,
                    schedulingParams: { isPregnant:false, isBreastfeeding:false, canBundleShifts:false },
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                count++;
                if (count % 450 === 0) await batch.commit();
            }

            if(count > 0) {
                await batch.commit();
                alert(`匯入完成 ${count} 筆。`);
                this.closeImportModal();
                this.fetchData();
            } else {
                resultDiv.innerHTML = "無有效資料";
            }
        };
        reader.readAsText(file);
    }
};
