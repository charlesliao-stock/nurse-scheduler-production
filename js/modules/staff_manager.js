// js/modules/staff_manager.js

const staffManager = {
    allData: [],

    // 模組初始化
    init: async function() {
        console.log("Init Staff Manager...");
        await this.loadUnitDropdown();
        await this.fetchData();
    },

    // 1. 載入單位下拉選單
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        
        selectFilter.innerHTML = '<option value="all">所有單位</option>';
        selectInput.innerHTML = '';

        let query = db.collection('units');
        // 權限判斷：若不是 Admin，只能看自己的單位
        if(app.userRole === 'unit_manager') {
            // 前端過濾顯示，實際資料庫權限應由 Firestore Rules 進一步把關
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
        }

        const snapshot = await query.get();
        snapshot.forEach(doc => {
            const unit = doc.data();
            const option = `<option value="${doc.id}">${unit.name}</option>`;
            selectFilter.innerHTML += option;
            selectInput.innerHTML += option;
        });

        // 監聽篩選變更
        selectFilter.onchange = () => this.renderTable();
    },

    // 2. 讀取資料
    fetchData: async function() {
        const tbody = document.getElementById('staffTableBody');
        tbody.innerHTML = '<tr><td colspan="7">載入中...</td></tr>';

        let query = db.collection('users').where('isActive', '==', true);
        if(app.userRole === 'unit_manager') {
            query = query.where('unitId', '==', app.userUnitId);
        }

        const snapshot = await query.get();
        this.allData = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
        this.renderTable();
    },

    // 3. 渲染表格
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

        filtered.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.unitId}</td>
                <td>${u.employeeId}</td>
                <td>${u.displayName}</td>
                <td>${u.level}</td>
                <td>${u.groupId || ''}</td>
                <td>${u.role}</td>
                <td>
                    <button class="btn btn-edit" onclick="staffManager.openModal('${u.id}')">編輯</button>
                    <button class="btn btn-delete" onclick="staffManager.deleteUser('${u.id}')">刪除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // 4. Modal 操作
    openModal: function(docId = null) {
        document.getElementById('staffModal').classList.add('show');
        document.getElementById('staffDocId').value = docId || '';
        
        if(docId) {
            // 編輯模式：填入資料
            const u = this.allData.find(d => d.id === docId);
            document.getElementById('inputEmpId').value = u.employeeId;
            document.getElementById('inputName').value = u.displayName;
            document.getElementById('inputEmail').value = u.email;
            document.getElementById('inputUnit').value = u.unitId;
            document.getElementById('inputLevel').value = u.level;
            document.getElementById('inputGroup').value = u.groupId || '';
            document.getElementById('inputHireDate').value = u.hireDate || '';
            
            // 排班參數
            const params = u.schedulingParams || {};
            document.getElementById('checkPregnant').checked = params.isPregnant || false;
            document.getElementById('checkBreastfeeding').checked = params.isBreastfeeding || false;
            document.getElementById('checkBundle').checked = params.canBundleShifts || false;
        } else {
            // 新增模式：清空
            document.querySelectorAll('#staffModal input').forEach(i => {
                if(i.type !== 'checkbox' && i.type !== 'hidden') i.value = '';
                if(i.type === 'checkbox') i.checked = false;
            });
        }
    },

    closeModal: function() {
        document.getElementById('staffModal').classList.remove('show');
    },

    // 5. 儲存資料
    saveData: async function() {
        const docId = document.getElementById('staffDocId').value;
        const data = {
            employeeId: document.getElementById('inputEmpId').value,
            displayName: document.getElementById('inputName').value,
            email: document.getElementById('inputEmail').value,
            unitId: document.getElementById('inputUnit').value,
            level: document.getElementById('inputLevel').value,
            groupId: document.getElementById('inputGroup').value,
            hireDate: document.getElementById('inputHireDate').value,
            role: 'user', // 預設新增都是一般user
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
                await db.collection('users').doc(docId).update(data);
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('users').add(data);
                alert("已新增人員資料 (請注意：登入帳號需另行建立)");
            }
            this.closeModal();
            this.fetchData(); // 重刷列表
        } catch (e) {
            alert("儲存失敗: " + e.message);
        }
    },
    
    deleteUser: async function(id) {
        if(confirm("確定要刪除此人員嗎？(僅標記為離職)")) {
            await db.collection('users').doc(id).update({ isActive: false });
            this.fetchData();
        }
    },

    downloadTemplate: function() {
        alert("功能開發中：下載 CSV 範例");
    }
};

// 綁定搜尋輸入框事件
document.getElementById('searchStaffInput').addEventListener('input', () => staffManager.renderTable());
