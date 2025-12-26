// js/modules/unit_manager.js

const unitManager = {
    allUnits: [],
    allUsers: [], // 快取所有人員，用於顯示名稱與勾選清單

    // --- 初始化 ---
    init: async function() {
        console.log("Unit Manager Module Loaded.");
        
        // 綁定搜尋事件
        const searchInput = document.getElementById('searchUnitInput');
        if(searchInput) searchInput.oninput = () => this.renderTable();

        await this.fetchAllUsers(); // 先載入人名對照表
        await this.fetchUnits();    // 再載入單位
    },

    // --- 1. 取得所有人員 (作為選項與名稱顯示) ---
    fetchAllUsers: async function() {
        try {
            // 只撈取需要的欄位以節省流量
            const snapshot = await db.collection('users').where('isActive', '==', true).get();
            this.allUsers = snapshot.docs.map(doc => ({
                uid: doc.id, // 使用文件ID (通常是 Auth UID)
                name: doc.data().displayName || '未命名',
                empId: doc.data().employeeId || ''
            }));
        } catch (e) {
            console.error("User fetch error:", e);
        }
    },

    // --- 2. 取得所有單位 ---
    fetchUnits: async function() {
        const tbody = document.getElementById('unitTableBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">資料載入中...</td></tr>';

        try {
            const snapshot = await db.collection('units').get();
            this.allUnits = snapshot.docs.map(doc => ({
                id: doc.id, // 單位代碼
                ...doc.data()
            }));
            this.renderTable();
        } catch (e) {
            console.error("Unit fetch error:", e);
            tbody.innerHTML = '<tr><td colspan="5" style="color:red;">載入失敗</td></tr>';
        }
    },

    // --- 3. 渲染表格 ---
    renderTable: function() {
        const tbody = document.getElementById('unitTableBody');
        tbody.innerHTML = '';

        const searchTerm = (document.getElementById('searchUnitInput').value || '').toLowerCase();

        const filtered = this.allUnits.filter(u => {
            return u.id.toLowerCase().includes(searchTerm) || 
                   (u.name && u.name.toLowerCase().includes(searchTerm));
        });

        if(filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">無符合資料</td></tr>';
            return;
        }

        filtered.forEach(u => {
            // 將 ID 陣列轉換為人名陣列
            const managerNames = this.getNamesFromIds(u.managers);
            const schedulerNames = this.getNamesFromIds(u.schedulers);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.id}</td>
                <td>${u.name}</td>
                <td>${managerNames}</td>
                <td>${schedulerNames}</td>
                <td>
                    <button class="btn btn-edit" onclick="unitManager.openModal('${u.id}')">編輯</button>
                    <button class="btn btn-delete" onclick="unitManager.deleteUnit('${u.id}')">刪除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // 工具：ID 轉人名 (顯示用)
    getNamesFromIds: function(idArray) {
        if (!idArray || !Array.isArray(idArray) || idArray.length === 0) return '<span style="color:#ccc;">(未設定)</span>';
        
        return idArray.map(uid => {
            const user = this.allUsers.find(p => p.uid === uid);
            // 顯示格式: 王小明
            return user ? `<span class="badge" style="background:#eee; color:#333; margin-right:3px;">${user.name}</span>` : '未知人員';
        }).join(' ');
    },

    // --- 4. Modal 操作 ---
    openModal: function(unitId = null) {
        const modal = document.getElementById('unitModal');
        modal.classList.add('show');
        
        // 渲染人員勾選清單
        this.renderUserCheckboxes('managerListContainer', 'chk_mgr_');
        this.renderUserCheckboxes('schedulerListContainer', 'chk_sch_');

        if(unitId) {
            // 編輯模式
            const unit = this.allUnits.find(u => u.id === unitId);
            if(unit) {
                document.getElementById('originalUnitId').value = unit.id;
                document.getElementById('inputUnitId').value = unit.id;
                document.getElementById('inputUnitId').disabled = true; // 編輯時鎖定 ID (因為它是 Doc Key)
                document.getElementById('inputUnitName').value = unit.name;

                // 勾選既有的人員
                this.checkUsers('chk_mgr_', unit.managers);
                this.checkUsers('chk_sch_', unit.schedulers);
            }
        } else {
            // 新增模式
            document.getElementById('originalUnitId').value = '';
            document.getElementById('inputUnitId').value = '';
            document.getElementById('inputUnitId').disabled = false;
            document.getElementById('inputUnitName').value = '';
            
            // 清空搜尋框
            document.getElementById('searchManagerInput').value = '';
            document.getElementById('searchSchedulerInput').value = '';
            this.filterUserList('manager'); // 重置清單顯示
            this.filterUserList('scheduler');

            // 取消所有勾選
            document.querySelectorAll('#unitModal input[type="checkbox"]').forEach(c => c.checked = false);
        }
    },

    closeModal: function() {
        document.getElementById('unitModal').classList.remove('show');
    },

    // 渲染勾選清單 (生成 HTML)
    renderUserCheckboxes: function(containerId, prefix) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        this.allUsers.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-checkbox-item'; // 可以加 CSS 樣式
            div.style.padding = '3px 0';
            
            // 格式: [ ] 王小明 (N1001)
            div.innerHTML = `
                <label style="cursor:pointer; display:block;">
                    <input type="checkbox" id="${prefix}${user.uid}" value="${user.uid}">
                    <span class="u-name">${user.name}</span> 
                    <span style="color:#888; font-size:0.8rem;">(${user.empId})</span>
                </label>
            `;
            container.appendChild(div);
        });
    },

    // 自動勾選已存在的人員
    checkUsers: function(prefix, idArray) {
        if(!idArray) return;
        idArray.forEach(uid => {
            const el = document.getElementById(prefix + uid);
            if(el) el.checked = true;
        });
    },

    // Modal 內的搜尋過濾功能
    filterUserList: function(type) {
        const inputId = type === 'manager' ? 'searchManagerInput' : 'searchSchedulerInput';
        const containerId = type === 'manager' ? 'managerListContainer' : 'schedulerListContainer';
        
        const keyword = document.getElementById(inputId).value.toLowerCase();
        const container = document.getElementById(containerId);
        const items = container.querySelectorAll('.user-checkbox-item'); // 需要在 render 時加上 class

        items.forEach(item => {
            const text = item.innerText.toLowerCase();
            item.style.display = text.includes(keyword) ? 'block' : 'none';
        });
    },

    // --- 5. 儲存資料 ---
    saveData: async function() {
        const originalId = document.getElementById('originalUnitId').value;
        const unitId = document.getElementById('inputUnitId').value.trim();
        const unitName = document.getElementById('inputUnitName').value.trim();

        if(!unitId || !unitName) { alert("代碼與名稱為必填"); return; }

        // 收集勾選的人員 ID
        const managers = this.getCheckedValues('managerListContainer');
        const schedulers = this.getCheckedValues('schedulerListContainer');

        const data = {
            name: unitName,
            managers: managers,
            schedulers: schedulers,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            // 判斷是編輯還是新增
            if (originalId) {
                // 編輯模式 (因為 ID 是 Key，若不允許改 ID，直接 update)
                await db.collection('units').doc(originalId).update(data);
            } else {
                // 新增模式
                // 檢查 ID 是否重複
                const docCheck = await db.collection('units').doc(unitId).get();
                if(docCheck.exists) {
                    alert("此單位代碼已存在！"); return;
                }
                
                // 單位代碼作為 Document ID
                await db.collection('units').doc(unitId).set(data);
            }
            alert("儲存成功");
            this.closeModal();
            this.fetchUnits();
        } catch (e) {
            alert("儲存失敗: " + e.message);
        }
    },

    // 取得勾選的值
    getCheckedValues: function(containerId) {
        const container = document.getElementById(containerId);
        const checked = container.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checked).map(cb => cb.value);
    },

    deleteUnit: async function(id) {
        if(confirm(`確定要刪除單位 [${id}] 嗎？\n注意：這不會刪除該單位的員工，但可能會影響排班顯示。`)) {
            try {
                await db.collection('units').doc(id).delete();
                this.fetchUnits();
            } catch(e) {
                alert("刪除失敗: " + e.message);
            }
        }
    },

    // --- 6. 匯入功能 ---
    openImportModal: function() {
        document.getElementById('unitImportModal').classList.add('show');
        document.getElementById('unitImportResult').innerHTML = '';
        document.getElementById('csvUnitFile').value = '';
    },

    closeImportModal: function() {
        document.getElementById('unitImportModal').classList.remove('show');
    },

    downloadTemplate: function() {
        // CSV 簡單格式: 單位代碼,單位名稱
        // 匯入不支援直接指派複雜的管理者(因為要對應UID)，建議只匯入基本資料，權限手動設
        const content = "\uFEFF單位代碼,單位名稱\nICU01,內科加護病房\nICU02,外科加護病房\n9B,9B病房";
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

        const reader = new FileReader();
        reader.onload = async (e) => {
            const rows = e.target.result.split(/\r\n|\n/);
            const batch = db.batch();
            let count = 0;

            for(let i=1; i<rows.length; i++) {
                const row = rows[i].trim();
                if(!row) continue;
                const cols = row.split(',');
                if(cols.length < 2) continue;

                const unitId = cols[0].trim();
                const unitName = cols[1].trim();

                if(unitId && unitName) {
                    const docRef = db.collection('units').doc(unitId);
                    batch.set(docRef, {
                        name: unitName,
                        managers: [],   // 匯入預設為空
                        schedulers: [],
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                }
            }

            if(count > 0) {
                try {
                    await batch.commit();
                    alert(`成功匯入 ${count} 個單位！`);
                    this.closeImportModal();
                    this.fetchUnits();
                } catch(err) {
                    resultDiv.innerHTML = `<span style="color:red">匯入錯誤: ${err.message}</span>`;
                }
            } else {
                resultDiv.innerHTML = "無有效資料";
            }
        };
        reader.readAsText(file);
    }
};
