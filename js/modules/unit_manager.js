// js/modules/unit_manager.js

const unitManager = {
    allUnits: [],
    allUsers: [], // 快取所有人員

    // --- 初始化 ---
    init: async function() {
        console.log("Unit Manager Module Loaded.");
        
        const searchInput = document.getElementById('searchUnitInput');
        if(searchInput) searchInput.oninput = () => this.renderTable();

        await this.fetchAllUsers(); 
        await this.fetchUnits();    
    },

    // --- 1. 取得所有人員 (修正：增加 unitId 欄位) ---
    fetchAllUsers: async function() {
        try {
            // 讀取 unitId 用於後續過濾
            const snapshot = await db.collection('users').where('isActive', '==', true).get();
            this.allUsers = snapshot.docs.map(doc => ({
                uid: doc.id, 
                name: doc.data().displayName || '未命名',
                empId: doc.data().employeeId || '',
                unitId: doc.data().unitId || '' // [新增] 用於過濾
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
                id: doc.id,
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

    getNamesFromIds: function(idArray) {
        if (!idArray || !Array.isArray(idArray) || idArray.length === 0) return '<span style="color:#ccc;">(未設定)</span>';
        return idArray.map(uid => {
            const user = this.allUsers.find(p => p.uid === uid);
            return user ? `<span class="badge" style="background:#eee; color:#333; margin-right:3px;">${user.name}</span>` : '';
        }).join(' ');
    },

    // --- 4. Modal 操作 ---
    openModal: function(unitId = null) {
        const modal = document.getElementById('unitModal');
        modal.classList.add('show');
        
        if(unitId) {
            // [編輯模式]
            const unit = this.allUnits.find(u => u.id === unitId);
            if(unit) {
                document.getElementById('originalUnitId').value = unit.id;
                document.getElementById('inputUnitId').value = unit.id;
                document.getElementById('inputUnitId').disabled = true; 
                document.getElementById('inputUnitName').value = unit.name;

                // [關鍵] 傳入目前的 unitId 進行過濾
                this.renderUserCheckboxes('managerListContainer', 'chk_mgr_', unit.id);
                this.renderUserCheckboxes('schedulerListContainer', 'chk_sch_', unit.id);

                // 勾選既有的人員
                this.checkUsers('chk_mgr_', unit.managers);
                this.checkUsers('chk_sch_', unit.schedulers);
            }
        } else {
            // [新增模式]
            document.getElementById('originalUnitId').value = '';
            document.getElementById('inputUnitId').value = '';
            document.getElementById('inputUnitId').disabled = false;
            document.getElementById('inputUnitName').value = '';
            
            // 新增時，因為單位還不存在，自然沒有歸屬該單位的員工
            // 顯示空狀態提示
            this.renderUserCheckboxes('managerListContainer', 'chk_mgr_', 'NEW_UNIT');
            this.renderUserCheckboxes('schedulerListContainer', 'chk_sch_', 'NEW_UNIT');

            document.getElementById('searchManagerInput').value = '';
            document.getElementById('searchSchedulerInput').value = '';
        }
    },

    closeModal: function() {
        document.getElementById('unitModal').classList.remove('show');
    },

    // --- [關鍵修正] 渲染勾選清單 ---
    // 增加 targetUnitId 參數，用來過濾人員
    renderUserCheckboxes: function(containerId, prefix, targetUnitId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        // 1. 過濾出屬於該單位的人員
        const validUsers = this.allUsers.filter(u => u.unitId === targetUnitId);

        // 2. 處理空狀態 (沒有人員時顯示提示)
        if (validUsers.length === 0) {
            if (targetUnitId === 'NEW_UNIT') {
                container.innerHTML = `
                    <div style="color:#666; font-size:0.9rem; padding:10px; text-align:center;">
                        請先儲存建立此單位，<br>再至「人員管理」將人員指派過來。
                    </div>`;
            } else {
                container.innerHTML = `
                    <div style="color:#e74c3c; font-size:0.9rem; padding:10px; text-align:center; line-height:1.5;">
                        <i class="fas fa-exclamation-circle"></i> 此單位目前尚無人員。<br>
                        請至「人員管理」建立帳號或指派人員至此單位後，再進行設定。
                    </div>`;
            }
            return;
        }

        // 3. 渲染人員列表 (樣式調整：Flexbox 對齊，一行一人)
        validUsers.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-checkbox-item'; 
            // 設定 margin 讓每一行分開
            div.style.marginBottom = '8px';
            div.style.borderBottom = '1px dashed #eee'; // 加個分隔線更清楚
            div.style.paddingBottom = '4px';
            
            // 使用 Flex 讓 checkbox 在左，名字在右，垂直置中
            div.innerHTML = `
                <label style="cursor:pointer; display:flex; align-items:center; width:100%;">
                    <input type="checkbox" id="${prefix}${user.uid}" value="${user.uid}" style="margin-right:10px; transform: scale(1.2);">
                    <div>
                        <span class="u-name" style="font-weight:bold; color:#333;">${user.name}</span> 
                        <span style="color:#888; font-size:0.85rem; margin-left:5px;">(${user.empId})</span>
                    </div>
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
        const items = container.querySelectorAll('.user-checkbox-item');

        items.forEach(item => {
            const text = item.innerText.toLowerCase();
            // Flex 佈局下，隱藏要用 'none'，顯示建議用 'block' 或 'flex'，這裡 div wrapper 用 block 即可
            item.style.display = text.includes(keyword) ? 'block' : 'none';
        });
    },

    // --- 5. 儲存資料 ---
    saveData: async function() {
        const originalId = document.getElementById('originalUnitId').value;
        const unitId = document.getElementById('inputUnitId').value.trim();
        const unitName = document.getElementById('inputUnitName').value.trim();

        if(!unitId || !unitName) { alert("代碼與名稱為必填"); return; }

        const managers = this.getCheckedValues('managerListContainer');
        const schedulers = this.getCheckedValues('schedulerListContainer');

        const data = {
            name: unitName,
            managers: managers,
            schedulers: schedulers,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (originalId) {
                await db.collection('units').doc(originalId).update(data);
            } else {
                const docCheck = await db.collection('units').doc(unitId).get();
                if(docCheck.exists) { alert("單位代碼已存在！"); return; }
                await db.collection('units').doc(unitId).set(data);
            }
            alert("儲存成功");
            this.closeModal();
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

    deleteUnit: async function(id) {
        if(confirm(`確定要刪除單位 [${id}] 嗎？`)) {
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
                        managers: [],
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
