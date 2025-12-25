// js/modules/staff_manager.js

const staffManager = {
    allData: [],
    unitCache: {}, // 儲存單位資料 (含組別資訊) 用於連動與驗證

    // --- 模組初始化 ---
    init: async function() {
        console.log("Staff Manager Module Loaded.");
        
        // 綁定搜尋框事件
        const searchInput = document.getElementById('searchStaffInput');
        if(searchInput) {
            searchInput.oninput = () => this.renderTable();
        }

        // 載入資料
        await this.loadUnitDropdown();
        await this.fetchData();
    },

    // --- 1. 載入單位下拉選單 (建立快取) ---
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        
        if(!selectFilter || !selectInput) return;

        // 初始化選單
        selectFilter.innerHTML = '<option value="all">所有單位</option>';
        selectInput.innerHTML = '<option value="">請選擇單位</option>';
        
        // 清空並重建模組層級的單位快取
        this.unitCache = {}; 

        let query = db.collection('units');
        
        // 權限判斷：若為單位管理者，只能看到自己的單位
        if(app.userRole === 'unit_manager' && app.userUnitId) {
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            snapshot.forEach(doc => {
                const unit = doc.data();
                
                // 存入快取: Key=ID, Value={name, groups}
                this.unitCache[doc.id] = {
                    name: unit.name,
                    groups: unit.groups || [] // 確保有陣列，即使資料庫沒欄位
                };

                const option = `<option value="${doc.id}">${unit.name}</option>`;
                selectFilter.innerHTML += option;
                selectInput.innerHTML += option;
            });
        } catch (e) {
            console.error("載入單位失敗:", e);
        }

        // 綁定篩選器變更事件
        selectFilter.onchange = () => this.renderTable();
    },

    // --- 2. 單位與組別連動邏輯 ---
    onUnitChange: function() {
        const unitId = document.getElementById('inputUnit').value;
        const groupSelect = document.getElementById('inputGroup');
        
        // 清空舊選項
        groupSelect.innerHTML = '<option value="">(無)</option>';

        if (!unitId || !this.unitCache[unitId]) {
            return;
        }

        const groups = this.unitCache[unitId].groups;
        
        if (groups && groups.length > 0) {
            // 加入預設空白選項
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

        // 權限過濾
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

    // --- 4. 渲染表格 (含 Admin 保護) ---
    renderTable: function() {
        const tbody = document.getElementById('staffTableBody');
        tbody.innerHTML = '';

        const filterUnit = document.getElementById('filterUnitSelect').value;
        const searchTerm = document.getElementById('searchStaffInput').value.toLowerCase();

        // 前端過濾
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
            // 取得單位名稱 (若快取沒有則顯示 ID)
            const unitName = (this.unitCache[u.unitId] && this.unitCache[u.unitId].name) || u.unitId;
            const roleName = app.translateRole(u.role);
            
            // ADMIN 保護機制：如果是系統管理員，禁用刪除按鈕
            let deleteBtn = `<button class="btn btn-delete" onclick="staffManager.deleteUser('${u.id}')">刪除</button>`;
            if (u.role === 'system_admin') {
                deleteBtn = `<button class="btn btn-delete" disabled style="opacity:0.5; cursor:not-allowed;" title="無法刪除系統管理員">刪除</button>`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${u.employeeId || ''}</td>
                <td>${u.displayName || ''}</td>
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

    // 輔助顏色
    getRoleColor: function(role) {
        if(role === 'system_admin') return '#2c3e50'; // 深灰
        if(role === 'unit_manager') return '#e67e22'; // 橘色
        if(role === 'unit_scheduler') return '#27ae60'; // 綠色
        return '#95a5a6'; // 一般 user 灰色
    },

    // --- 5. Modal 操作 (新增/編輯) ---
    openModal: function(docId = null) {
        const modal = document.getElementById('staffModal');
        modal.classList.add('show');
        document.getElementById('staffDocId').value = docId || '';
        
        if(docId) {
            // --- 編輯模式 ---
            const u = this.allData.find(d => d.id === docId);
            if(u) {
                document.getElementById('inputEmpId').value = u.employeeId || '';
                document.getElementById('inputName').value = u.displayName || '';
                document.getElementById('inputEmail').value = u.email || '';
                document.getElementById('inputLevel').value = u.level || 'N';
                document.getElementById('inputHireDate').value = u.hireDate || '';
                
                // 設定權限角色
                const roleInput = document.getElementById('inputRole');
                roleInput.value = u.role || 'user';
                // 保護：如果是 Admin，鎖定不讓改角色 (避免誤降級)
                roleInput.disabled = (u.role === 'system_admin');

                // 設定單位 (注意：這不會自動觸發 onchange)
                document.getElementById('inputUnit').value = u.unitId || '';
                
                // 手動觸發連動，載入組別清單
                this.onUnitChange();
                
                // 載入清單後，才能設定組別的值
                document.getElementById('inputGroup').value = u.groupId || '';

                // 排班參數
                const params = u.schedulingParams || {};
                document.getElementById('checkPregnant').checked = params.isPregnant || false;
                document.getElementById('checkBreastfeeding').checked = params.isBreastfeeding || false;
                document.getElementById('checkBundle').checked = params.canBundleShifts || false;
            }
        } else {
            // --- 新增模式 ---
            // 清空所有輸入框
            document.querySelectorAll('#staffModal input, #staffModal select').forEach(i => {
                if(i.type !== 'checkbox' && i.type !== 'hidden' && i.id !== 'defaultPwd') i.value = '';
                if(i.type === 'checkbox') i.checked = false;
            });
            
            // 設定預設值
            document.getElementById('inputRole').value = 'user';
            document.getElementById('inputRole').disabled = false;
            
            // 重置組別選單
            document.getElementById('inputGroup').innerHTML = '<option value="">(請先選擇單位)</option>';
        }
    },

    closeModal: function() {
        document.getElementById('staffModal').classList.remove('show');
    },

    // --- 6. 儲存資料 ---
    saveData: async function() {
        const docId = document.getElementById('staffDocId').value;
        const empId = document.getElementById('inputEmpId').value;
        const email = document.getElementById('inputEmail').value;
        const selectedRole = document.getElementById('inputRole').value;

        if(!empId || !email) { alert("員編與Email為必填欄位"); return; }

        const data = {
            employeeId: empId,
            displayName: document.getElementById('inputName').value,
            email: email,
            unitId: document.getElementById('inputUnit').value,
            level: document.getElementById('inputLevel').value,
            groupId: document.getElementById('inputGroup').value, // 這是下拉選單的值
            hireDate: document.getElementById('inputHireDate').value,
            role: selectedRole, // 儲存使用者選擇的角色
            isActive: true,
            schedulingParams: {
                isPregnant: document.getElementById('checkPregnant').checked,
                isBreastfeeding: document.getElementById('checkBreastfeeding').checked,
                canBundleShifts: document.getElementById('checkBundle').checked
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if(docId) {
                // 編輯
                await db.collection('users').doc(docId).update(data);
            } else {
                // 新增
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('users').add(data);
                alert("已新增人員資料 (請注意：登入帳號需透過後端另行建立)");
            }
            this.closeModal();
            this.fetchData(); // 重刷列表
        } catch (e) {
            alert("儲存失敗: " + e.message);
        }
    },

    // --- 7. 刪除資料 ---
    deleteUser: async function(id) {
        // 二次檢查：後端保護
        const u = this.allData.find(d => d.id === id);
        if (u && u.role === 'system_admin') {
            alert("系統保護：無法刪除超級管理員帳號！");
            return;
        }

        if(confirm("確定要刪除此人員嗎？(系統將標記為離職)")) {
            try {
                await db.collection('users').doc(id).update({ isActive: false });
                this.fetchData();
            } catch(e) {
                alert("刪除失敗: " + e.message);
            }
        }
    },

    // --- 8. 匯入功能區 ---
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
        // CSV 包含 BOM 以支援 Excel 中文
        const headers = "單位代碼,員工編號,姓名,Email,層級,到職日(YYYY-MM-DD),組別";
        // 嘗試取得一個單位 ID 當範例
        const demoUnitId = Object.keys(this.unitCache)[0] || "ICU01";
        
        const row1 = `${demoUnitId},N1001,王小明,wang@test.com,N2,2023-01-01,A組`;
        const row2 = `${demoUnitId},N1002,李小華,lee@test.com,N3,2020-05-20,B組`;
        
        const csvContent = `\uFEFF${headers}\n${row1}\n${row2}`;
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

        if (!file) {
            alert("請選擇 CSV 檔案");
            return;
        }

        resultDiv.innerHTML = "正在讀取並處理檔案...";
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            const rows = text.split(/\r\n|\n/);
            const batch = db.batch();
            let count = 0;
            let errorCount = 0;

            // 跳過標題列，從 i=1 開始
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i].trim();
                if (!row) continue;

                const cols = row.split(',');
                // 簡單檢核欄位數量
                if (cols.length < 4) {
                    errorCount++;
                    continue; 
                }

                const unitId = cols[0].trim();
                
                // 驗證單位是否存在
                if (!this.unitCache[unitId]) {
                    console.warn(`Row ${i}: 單位 ${unitId} 不存在於系統中，可能導致資料異常`);
                    // 實務上可選擇 continue 跳過，這裡先允許寫入但紀錄警告
                }

                const docRef = db.collection('users').doc();
                batch.set(docRef, {
                    unitId: unitId,
                    employeeId: cols[1].trim(),
                    displayName: cols[2].trim(),
                    email: cols[3].trim(),
                    level: cols[4] ? cols[4].trim() : 'N',
                    hireDate: cols[5] ? cols[5].trim() : '',
                    groupId: cols[6] ? cols[6].trim() : '', // 匯入組別
                    role: 'user', // 批次匯入預設為一般使用者
                    isActive: true,
                    schedulingParams: {
                        isPregnant: false,
                        isBreastfeeding: false,
                        canBundleShifts: false
                    },
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                count++;

                // Firestore batch limit 500
                if (count % 450 === 0) {
                    await batch.commit();
                }
            }

            try {
                if (count > 0) {
                    await batch.commit();
                    alert(`匯入完成！\n成功: ${count} 筆\n格式錯誤: ${errorCount} 筆`);
                    this.closeImportModal();
                    this.fetchData();
                } else {
                    resultDiv.innerHTML = "<span style='color:red'>沒有有效資料可匯入。</span>";
                }
            } catch (err) {
                console.error(err);
                resultDiv.innerHTML = `<span style='color:red'>匯入失敗: ${err.message}</span>`;
            }
        };

        reader.readAsText(file);
    }
};
