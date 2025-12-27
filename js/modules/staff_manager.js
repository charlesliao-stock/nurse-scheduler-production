// js/modules/staff_manager.js (優化版)

const staffManager = {
    allData: [],
    unitCache: {}, 
    sortState: { field: 'employeeId', order: 'asc' },
    isLoading: false, // 防止重複載入

    // --- 模組初始化 ---
    init: async function() {
        console.log("Staff Manager Module Loaded.");
        
        const searchInput = document.getElementById('searchStaffInput');
        if(searchInput) {
            // 優化：使用 debounce 減少頻繁搜尋
            searchInput.oninput = this.debounce(() => this.renderTable(), 300);
        }

        await this.loadUnitDropdown();
        await this.fetchData();
    },

    // 工具函數：防抖
    debounce: function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // --- 1. 載入單位下拉選單 ---
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        
        if(!selectFilter || !selectInput) {
            console.error("找不到下拉選單元素");
            return;
        }

        selectFilter.innerHTML = '<option value="all">載入中...</option>';
        selectInput.innerHTML = '<option value="">請選擇單位</option>';
        this.unitCache = {}; 

        let query = db.collection('units');
        if(app.userRole === 'unit_manager' && app.userUnitId) {
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            
            selectFilter.innerHTML = '<option value="all">所有單位</option>';
            
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

            selectFilter.onchange = () => this.renderTable();
            
        } catch (e) {
            console.error("載入單位失敗:", e);
            selectFilter.innerHTML = '<option value="all">載入失敗</option>';
        }
    },

    // --- 2. 單位與組別連動 ---
    onUnitChange: function() {
        const unitId = document.getElementById('inputUnit').value;
        const groupSelect = document.getElementById('inputGroup');
        
        if(!groupSelect) return;
        
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

    // --- 3. 讀取人員資料 (加入錯誤處理) ---
    fetchData: async function() {
        if(this.isLoading) {
            console.log("資料載入中，請稍候...");
            return;
        }

        const tbody = document.getElementById('staffTableBody');
        if(!tbody) {
            console.error("找不到表格 tbody");
            return;
        }

        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">資料載入中...</td></tr>';
        this.isLoading = true;

        let query = db.collection('users').where('isActive', '==', true);
        if(app.userRole === 'unit_manager' && app.userUnitId) {
            query = query.where('unitId', '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            this.allData = snapshot.docs.map(doc => ({
                id: doc.id, 
                ...doc.data()
            }));
            
            console.log(`成功載入 ${this.allData.length} 筆人員資料`);
            this.renderTable();
            
        } catch (error) {
            console.error("Fetch Data Error:", error);
            tbody.innerHTML = `<tr><td colspan="7" style="color:red;">載入失敗: ${error.message}</td></tr>`;
        } finally {
            this.isLoading = false;
        }
    },

    // --- 4. 排序功能 ---
    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    // --- 5. 渲染表格 (優化版) ---
    renderTable: function() {
        const tbody = document.getElementById('staffTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '';

        // 更新表頭圖示
        document.querySelectorAll('th i[id^="sort_icon_staff_"]').forEach(i => {
            i.className = 'fas fa-sort';
        });
        const activeIcon = document.getElementById(`sort_icon_staff_${this.sortState.field}`);
        if(activeIcon) {
            activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        }

        const filterUnit = document.getElementById('filterUnitSelect')?.value || 'all';
        const searchTerm = (document.getElementById('searchStaffInput')?.value || '').toLowerCase().trim();

        // 1. 篩選
        let filtered = this.allData.filter(u => {
            const matchUnit = filterUnit === 'all' || u.unitId === filterUnit;
            const matchSearch = !searchTerm || 
                                (u.employeeId && u.employeeId.toLowerCase().includes(searchTerm)) || 
                                (u.displayName && u.displayName.toLowerCase().includes(searchTerm));
            return matchUnit && matchSearch;
        });

        // 2. 排序
        const { field, order } = this.sortState;
        filtered.sort((a, b) => {
            let valA, valB;
            
            if (field === 'unitName') {
                valA = (this.unitCache[a.unitId]?.name) || a.unitId || '';
                valB = (this.unitCache[b.unitId]?.name) || b.unitId || '';
            } else if (field === 'role') {
                const roleScore = { 'system_admin':4, 'unit_manager':3, 'unit_scheduler':2, 'user':1 };
                valA = roleScore[a.role] || 0;
                valB = roleScore[b.role] || 0;
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
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">無符合資料</td></tr>';
            return;
        }

        // 3. 渲染
        const fragment = document.createDocumentFragment(); // 優化 DOM 操作
        
        filtered.forEach(u => {
            const unitName = (this.unitCache[u.unitId]?.name) || u.unitId || '未知單位';
            const roleName = app.translateRole(u.role);
            
            let deleteBtn = `<button class="btn btn-delete" onclick="staffManager.deleteUser('${u.id}')">刪除</button>`;
            if (u.role === 'system_admin') {
                deleteBtn = `<button class="btn btn-delete" disabled style="opacity:0.5; cursor:not-allowed;" title="系統管理員無法刪除">刪除</button>`;
            }

            let statusTag = u.isRegistered ? 
                '<span style="color:green; font-size:0.8rem;">(已開通)</span>' : 
                '<span style="color:red; font-size:0.8rem;">(未開通)</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${u.employeeId || '-'}</td>
                <td>${u.displayName || '-'} <br>${statusTag}</td>
                <td>${u.level || '-'}</td>
                <td>${u.groupId || '-'}</td>
                <td><span class="role-badge" style="background:${this.getRoleColor(u.role)}">${roleName}</span></td>
                <td>
                    <button class="btn btn-edit" onclick="staffManager.openModal('${u.id}')">編輯</button>
                    ${deleteBtn}
                </td>
            `;
            fragment.appendChild(tr);
        });
        
        tbody.appendChild(fragment);
    },

    getRoleColor: function(role) {
        const colors = {
            'system_admin': '#2c3e50',
            'unit_manager': '#e67e22',
            'unit_scheduler': '#27ae60',
            'user': '#95a5a6'
        };
        return colors[role] || '#95a5a6';
    },

    // --- 6. Modal 操作 (加入驗證) ---
    openModal: function(docId = null) {
        const modal = document.getElementById('staffModal');
        if(!modal) {
            console.error("找不到 Modal");
            return;
        }
        
        modal.classList.add('show');
        document.getElementById('staffDocId').value = docId || '';
        
        if(docId) {
            // 編輯模式
            const u = this.allData.find(d => d.id === docId);
            if(!u) {
                alert("找不到該人員資料");
                this.closeModal();
                return;
            }
            
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
            
        } else {
            // 新增模式
            document.querySelectorAll('#staffModal input:not([type="hidden"]), #staffModal select').forEach(i => {
                if(i.type !== 'checkbox' && i.id !== 'accountStatus') i.value = '';
                if(i.type === 'checkbox') i.checked = false;
            });
            document.getElementById('inputRole').value = 'user';
            document.getElementById('inputRole').disabled = false;
            document.getElementById('inputLevel').value = 'N';
            document.getElementById('inputGroup').innerHTML = '<option value="">(請先選擇單位)</option>';
            
            const statusField = document.getElementById('accountStatus');
            if(statusField) statusField.value = "新建立 (未開通)";
        }
    },

    closeModal: function() {
        const modal = document.getElementById('staffModal');
        if(modal) modal.classList.remove('show');
    },

    // --- 7. 儲存資料 (加強驗證) ---
    saveData: async function() {
        const docId = document.getElementById('staffDocId').value;
        const empId = document.getElementById('inputEmpId').value.trim();
        const email = document.getElementById('inputEmail').value.trim();
        const name = document.getElementById('inputName').value.trim();
        const selectedRole = document.getElementById('inputRole').value;
        const selectedUnitId = document.getElementById('inputUnit').value;

        // 驗證必填欄位
        if(!empId) { 
            alert("請輸入員工編號"); 
            document.getElementById('inputEmpId').focus();
            return; 
        }
        if(!email) { 
            alert("請輸入電子郵件"); 
            document.getElementById('inputEmail').focus();
            return; 
        }
        if(!name) { 
            alert("請輸入姓名"); 
            document.getElementById('inputName').focus();
            return; 
        }
        if(!selectedUnitId) { 
            alert("請選擇所屬單位"); 
            document.getElementById('inputUnit').focus();
            return; 
        }

        // Email 格式驗證
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if(!emailRegex.test(email)) {
            alert("請輸入有效的電子郵件格式");
            document.getElementById('inputEmail').focus();
            return;
        }

        const data = {
            employeeId: empId,
            displayName: name,
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
            let userRef;

            if(docId) {
                // 更新現有資料
                userRef = db.collection('users').doc(docId);
                batch.update(userRef, data);
            } else {
                // 新增資料
                userRef = db.collection('users').doc(); 
                data.isRegistered = false; 
                data.uid = null;
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                batch.set(userRef, data);
            }
            
            const targetUid = docId || userRef.id;

            // 連動 Unit 管理者/排班者名單
            if (selectedRole !== 'system_admin') {
                const unitRef = db.collection('units').doc(selectedUnitId);
                const unitDoc = await unitRef.get();
                
                if (unitDoc.exists) {
                    let { managers, schedulers } = unitDoc.data();
                    managers = managers || [];
                    schedulers = schedulers || [];

                    // 移除舊的設定
                    managers = managers.filter(id => id !== targetUid);
                    schedulers = schedulers.filter(id => id !== targetUid);

                    // 加入新的設定
                    if (selectedRole === 'unit_manager') managers.push(targetUid);
                    else if (selectedRole === 'unit_scheduler') schedulers.push(targetUid);

                    batch.update(unitRef, { managers, schedulers });
                }
            }

            await batch.commit();
            alert("儲存成功！");
            this.closeModal();
            await this.fetchData();
            
        } catch (e) {
            console.error("Save Error:", e);
            alert("儲存失敗: " + e.message);
        }
    },

    // --- 8. 刪除人員 ---
    deleteUser: async function(id) {
        const u = this.allData.find(d => d.id === id);
        if (u && u.role === 'system_admin') {
            alert("系統保護：無法刪除超級管理員帳號！");
            return;
        }
        
        if(!confirm(`確定要刪除 ${u?.displayName || '此人員'} 嗎？\n(標記為離職，不會真正刪除資料)`)) {
            return;
        }

        try {
            await db.collection('users').doc(id).update({ 
                isActive: false,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await this.fetchData();
            alert("已標記為離職");
        } catch(e) {
            console.error(e);
            alert("操作失敗: " + e.message);
        }
    },

    // --- 9. 批次匯入 ---
    openImportModal: function() {
        const modal = document.getElementById('importModal');
        if(!modal) return;
        
        modal.classList.add('show');
        document.getElementById('importResult').innerHTML = '';
        const fileInput = document.getElementById('csvFileInput');
        if(fileInput) fileInput.value = ''; 
    },

    closeImportModal: function() {
        const modal = document.getElementById('importModal');
        if(modal) modal.classList.remove('show');
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
        const file = fileInput?.files[0];

        if (!file) { 
            alert("請選擇 CSV 檔案"); 
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

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i].trim();
                    if (!row) continue;
                    
                    const cols = row.split(',');
                    if (cols.length < 4) {
                        errors.push(`第 ${i+1} 行：欄位不足`);
                        continue;
                    }

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
                        schedulingParams: { 
                            isPregnant: false, 
                            isBreastfeeding: false, 
                            canBundleShifts: false 
                        },
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    
                    count++;
                    
                    // Firestore 批次寫入限制：500 筆
                    if (count % 450 === 0) {
                        await batch.commit();
                        console.log(`已匯入 ${count} 筆`);
                    }
                }

                if(count > 0) {
                    await batch.commit();
                    alert(`匯入完成！共 ${count} 筆資料\n${errors.length > 0 ? '\n錯誤：\n' + errors.join('\n') : ''}`);
                    this.closeImportModal();
                    await this.fetchData();
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
