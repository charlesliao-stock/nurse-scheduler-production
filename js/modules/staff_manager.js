// js/modules/staff_manager.js

const staffManager = {
    allData: [],

    // 模組初始化 (由 Router 呼叫)
    init: async function() {
        console.log("Staff Manager Module Loaded.");
        
        // 1. 綁定 UI 事件 (因為 HTML 剛被 Router 塞進去)
        const searchInput = document.getElementById('searchStaffInput');
        if(searchInput) {
            searchInput.oninput = () => this.renderTable();
        }

        // 2. 載入資料
        await this.loadUnitDropdown();
        await this.fetchData();
    },

    // 載入單位下拉選單
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        
        if(!selectFilter || !selectInput) return;

        selectFilter.innerHTML = '<option value="all">所有單位</option>';
        selectInput.innerHTML = '';

        let query = db.collection('units');
        
        // 如果是單位管理者，只能看到自己的單位
        if(app.userRole === 'unit_manager' && app.userUnitId) {
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
        }

        const snapshot = await query.get();
        snapshot.forEach(doc => {
            const unit = doc.data();
            const option = `<option value="${doc.id}">${unit.name}</option>`;
            selectFilter.innerHTML += option;
            selectInput.innerHTML += option;
        });

        // 單位篩選器變更事件
        selectFilter.onchange = () => this.renderTable();
    },

    // 從資料庫讀取人員
    fetchData: async function() {
        const tbody = document.getElementById('staffTableBody');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">資料載入中...</td></tr>';

        let query = db.collection('users').where('isActive', '==', true);

        // 資料庫層級過濾 (安全與效能)
        if(app.userRole === 'unit_manager' && app.userUnitId) {
            query = query.where('unitId', '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            this.allData = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
            this.renderTable();
        } catch (error) {
            console.error("Fetch Data Error:", error);
            tbody.innerHTML = '<tr><td colspan="7" style="color:red;">載入失敗</td></tr>';
        }
    },

    // 渲染表格
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
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.unitId}</td>
                <td>${u.employeeId || ''}</td>
                <td>${u.displayName || ''}</td>
                <td>${u.level || ''}</td>
                <td>${u.groupId || ''}</td>
                <td>${app.translateRole(u.role)}</td>
                <td>
                    <button class="btn btn-edit" onclick="staffManager.openModal('${u.id}')">編輯</button>
                    <button class="btn btn-delete" onclick="staffManager.deleteUser('${u.id}')">刪除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // --- Modal 操作 ---
    openModal: function(docId = null) {
        const modal = document.getElementById('staffModal');
        modal.classList.add('show');
        document.getElementById('staffDocId').value = docId || '';
        
        if(docId) {
            // 編輯: 填入舊資料
            const u = this.allData.find(d => d.id === docId);
            if(u) {
                document.getElementById('inputEmpId').value = u.employeeId || '';
                document.getElementById('inputName').value = u.displayName || '';
                document.getElementById('inputEmail').value = u.email || '';
                document.getElementById('inputUnit').value = u.unitId || '';
                document.getElementById('inputLevel').value = u.level || 'N';
                document.getElementById('inputGroup').value = u.groupId || '';
                document.getElementById('inputHireDate').value = u.hireDate || '';

                // 排班參數
                const params = u.schedulingParams || {};
                document.getElementById('checkPregnant').checked = params.isPregnant || false;
                document.getElementById('checkBreastfeeding').checked = params.isBreastfeeding || false;
                document.getElementById('checkBundle').checked = params.canBundleShifts || false;
            }
        } else {
            // 新增: 清空表單
            document.querySelectorAll('#staffModal input').forEach(i => {
                if(i.type !== 'checkbox' && i.type !== 'hidden' && i.id !== 'defaultPwd') i.value = '';
                if(i.type === 'checkbox') i.checked = false;
            });
            // 預設密碼欄位不需清空
        }
    },

    closeModal: function() {
        document.getElementById('staffModal').classList.remove('show');
    },

    // --- 儲存與刪除 ---
    saveData: async function() {
        const docId = document.getElementById('staffDocId').value;
        const empId = document.getElementById('inputEmpId').value;
        const email = document.getElementById('inputEmail').value;

        if(!empId || !email) { alert("員編與Email為必填"); return; }

        const data = {
            employeeId: empId,
            displayName: document.getElementById('inputName').value,
            email: email,
            unitId: document.getElementById('inputUnit').value,
            level: document.getElementById('inputLevel').value,
            groupId: document.getElementById('inputGroup').value,
            hireDate: document.getElementById('inputHireDate').value,
            role: 'user', // 預設新增的都是 user，需 Admin 另外改
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
                alert("已新增人員資料 (注意: 登入帳號需透過後台另行建立)");
            }
            this.closeModal();
            this.fetchData(); // 重新整理表格
        } catch (e) {
            alert("儲存失敗: " + e.message);
        }
    },

    deleteUser: async function(id) {
        if(confirm("確定要刪除此人員嗎？(系統將標記為離職)")) {
            try {
                await db.collection('users').doc(id).update({ isActive: false });
                this.fetchData();
            } catch(e) {
                alert("刪除失敗: " + e.message);
            }
        }
    },

    downloadTemplate: function() {
        const csvContent = "\uFEFF單位代碼,員工編號,姓名,Email,層級(N/N1...),到職日(YYYY-MM-DD)\nICU01,N1001,測試員,test@h.com,N2,2023-01-01";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "人員匯入範例.csv";
        link.click();
    }
};
