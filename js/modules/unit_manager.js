// js/modules/unit_manager.js

const unitManager = {
    allUnits: [],
    allUsers: [],
    
    // --- 初始化 ---
    init: async function() {
        console.log("Unit Manager Loaded.");
        
        // 綁定搜尋
        const searchInput = document.getElementById('searchUnitInput');
        if(searchInput) searchInput.oninput = () => this.renderTable();

        // 權限控制：隱藏新增/匯入按鈕
        const btnAdd = document.getElementById('btnAddUnit');
        const btnImport = document.getElementById('btnImportUnit');
        if (app.userRole !== 'system_admin') {
            if(btnAdd) btnAdd.style.display = 'none';
            if(btnImport) btnImport.style.display = 'none';
        }

        await this.fetchAllUsers(); // 先載入人員(為了顯示名字)
        await this.fetchUnits();    // 再載入單位
    },

    // --- 1. 取得資料 ---
    fetchAllUsers: async function() {
        try {
            // 需要 unitId 才能過濾
            const snapshot = await db.collection('users').where('isActive', '==', true).get();
            this.allUsers = snapshot.docs.map(doc => ({
                uid: doc.id,
                name: doc.data().displayName || '未命名',
                empId: doc.data().employeeId || '',
                unitId: doc.data().unitId || ''
            }));
        } catch (e) {
            console.error("Fetch Users Error:", e);
        }
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

    // --- 2. 渲染列表 ---
    renderTable: function() {
        const tbody = document.getElementById('unitTableBody');
        tbody.innerHTML = '';

        const searchTerm = (document.getElementById('searchUnitInput').value || '').toLowerCase();
        
        const filtered = this.allUnits.filter(u => 
            u.id.toLowerCase().includes(searchTerm)
        );

        if(filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">無符合資料</td></tr>';
            return;
        }

        filtered.forEach(u => {
            const managerNames = this.getNames(u.managers);
            const schedulerNames = this.getNames(u.schedulers);
            
            // 權限：刪除按鈕
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

    // ID 轉 名字字串
    getNames: function(uidArray) {
        if(!uidArray || !Array.isArray(uidArray) || uidArray.length === 0) return '<span style="color:#ccc;">(未設定)</span>';
        return uidArray.map(uid => {
            const user = this.allUsers.find(p => p.uid === uid);
            return user ? user.name : '';
        }).join(', '); // 用逗號分隔
    },

    // --- 3. Modal 操作 (新增/編輯) ---
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
                // 填入基本資料
                inputId.value = unit.id;
                inputId.disabled = true; // ID 鎖定
                
                inputName.value = unit.name;
                inputName.disabled = !isAdmin; // 只有管理員能改名

                // [關鍵] 渲染該單位的人員供勾選
                // 1. 找出該單位所有員工
                const unitStaff = this.allUsers.filter(u => u.unitId === unit.id);
                
                // 2. 渲染兩個列表
                this.renderCheckboxList('managerList', 'mgr_', unitStaff, unit.managers);
                this.renderCheckboxList('schedulerList', 'sch_', unitStaff, unit.schedulers);
            }
        } else {
            // [新增模式]
            document.getElementById('currentMode').value = 'add';
            
            inputId.value = '';
            inputId.disabled = false; // 開放輸入
            
            inputName.value = '';
            inputName.disabled = false;

            // 新增時，單位還不存在，所以沒有員工
            document.getElementById('managerList').innerHTML = 
                '<div class="empty-tip">請先儲存建立單位，<br>再至「人員管理」指派人員。</div>';
            document.getElementById('schedulerList').innerHTML = 
                '<div class="empty-tip">請先儲存建立單位，<br>再至「人員管理」指派人員。</div>';
        }
    },

    closeModal: function() {
        document.getElementById('unitModal').classList.remove('show');
    },

    // --- 4. 渲染勾選清單 ---
    renderCheckboxList: function(containerId, prefix, staffList, checkedUids) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        if (!staffList || staffList.length === 0) {
            container.innerHTML = '<div class="empty-tip">此單位目前尚無人員。<br>請至「人員管理」新增。</div>';
            return;
        }

        staffList.forEach(user => {
            // 檢查是否已勾選
            const isChecked = (checkedUids && checkedUids.includes(user.uid)) ? 'checked' : '';
            
            const label = document.createElement('label');
            label.className = 'staff-item'; // 使用 CSS 定義的樣式
            label.innerHTML = `
                <input type="checkbox" id="${prefix}${user.uid}" value="${user.uid}" ${isChecked}>
                <span class="staff-name">${user.name}</span>
                <span class="staff-id">(${user.empId})</span>
            `;
            container.appendChild(label);
        });
    },

    // --- 5. 儲存資料 ---
    saveData: async function() {
        const mode = document.getElementById('currentMode').value;
        const unitId = document.getElementById('inputUnitId').value.trim();
        const unitName = document.getElementById('inputUnitName').value.trim();

        if (!unitId || !unitName) { alert("代碼與名稱為必填"); return; }

        // 收集勾選結果
        const managers = this.getCheckedValues('managerList');
        const schedulers = this.getCheckedValues('schedulerList');

        const data = {
            name: unitName,
            managers: managers,
            schedulers: schedulers,
            // 如果是新增，groups 預設空；如果是編輯，不該覆蓋 groups (這裡 update 會保留原欄位，set 要小心)
        };

        try {
            if (mode === 'edit') {
                // 編輯: update (不影響 groups)
                await db.collection('units').doc(unitId).update(data);
            } else {
                // 新增: set
                // 檢查重複
                const check = await db.collection('units').doc(unitId).get();
                if (check.exists) { alert("單位代碼已存在"); return; }
                
                data.groups = []; // 新增時初始化組別
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
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
        // 只有在編輯模式且有列表時才會有 input
        const container = document.getElementById(containerId);
        const inputs = container.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(inputs).map(cb => cb.value);
    },

    deleteUnit: async function(id) {
        if (confirm(`確定要刪除單位 ${id} 嗎？`)) {
            try {
                await db.collection('units').doc(id).delete();
                this.fetchUnits();
            } catch (e) { alert("刪除失敗: " + e.message); }
        }
    },

    // --- 6. 匯入功能 ---
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
