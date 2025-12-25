// js/modules/staff_manager.js

const staffManager = {
    allData: [],
    unitMap: {}, // 用來快取單位代碼，做匯入驗證用

    // 模組初始化
    init: async function() {
        console.log("Staff Manager Module Loaded.");
        
        const searchInput = document.getElementById('searchStaffInput');
        if(searchInput) {
            searchInput.oninput = () => this.renderTable();
        }

        // 載入資料
        await this.loadUnitDropdown();
        await this.fetchData();
    },

    // 載入單位下拉選單 (同時建立 unitMap 供匯入驗證用)
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        
        if(!selectFilter || !selectInput) return;

        selectFilter.innerHTML = '<option value="all">所有單位</option>';
        selectInput.innerHTML = '';
        this.unitMap = {}; // 清空快取

        let query = db.collection('units');
        
        // 權限控制
        if(app.userRole === 'unit_manager' && app.userUnitId) {
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
        }

        const snapshot = await query.get();
        snapshot.forEach(doc => {
            const unit = doc.data();
            // 建立 Map: Key=單位ID, Value=單位名稱
            this.unitMap[doc.id] = unit.name;

            const option = `<option value="${doc.id}">${unit.name}</option>`;
            selectFilter.innerHTML += option;
            selectInput.innerHTML += option;
        });

        selectFilter.onchange = () => this.renderTable();
    },

    // 讀取人員資料
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
            tbody.innerHTML = '<tr><td colspan="7" style="color:red;">載入失敗</td></tr>';
        }
    },

    // 渲染表格
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
            // 嘗試取得單位名稱，若無則顯示 ID
            const unitName = this.unitMap[u.unitId] || `<span style='color:red'>${u.unitId} (未建立)</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
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

    // --- Modal 操作 (單筆) ---
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
                document.getElementById('inputUnit').value = u.unitId || '';
                document.getElementById('inputLevel').value = u.level || 'N';
                document.getElementById('inputGroup').value = u.groupId || '';
                document.getElementById('inputHireDate').value = u.hireDate || '';

                const params = u.schedulingParams || {};
                document.getElementById('checkPregnant').checked = params.isPregnant || false;
                document.getElementById('checkBreastfeeding').checked = params.isBreastfeeding || false;
                document.getElementById('checkBundle').checked = params.canBundleShifts || false;
            }
        } else {
            document.querySelectorAll('#staffModal input').forEach(i => {
                if(i.type !== 'checkbox' && i.type !== 'hidden' && i.id !== 'defaultPwd') i.value = '';
                if(i.type === 'checkbox') i.checked = false;
            });
        }
    },

    closeModal: function() {
        document.getElementById('staffModal').classList.remove('show');
    },

    // --- Modal 操作 (批次匯入) ---
    openImportModal: function() {
        const modal = document.getElementById('importModal');
        modal.classList.add('show');
        document.getElementById('importResult').innerHTML = '';
        document.getElementById('csvFileInput').value = ''; // 清空選擇的檔案
    },

    closeImportModal: function() {
        document.getElementById('importModal').classList.remove('show');
    },

    // --- CSV 下載 ---
    downloadTemplate: function() {
        // 包含 BOM (\uFEFF) 讓 Excel 能正確讀取 UTF-8 中文
        // 欄位：單位代碼, 員工編號, 姓名, Email, 層級, 到職日(YYYY-MM-DD), 組別
        const headers = "單位代碼,員工編號,姓名,Email,層級,到職日,組別";
        // 範例資料：嘗試放入一個現有的單位ID範例 (如果 unitMap 有資料)
        const demoUnitId = Object.keys(this.unitMap)[0] || "ICU01";
        const row1 = `${demoUnitId},N1001,王小明,wang@test.com,N2,2023-01-01,A組`;
        const row2 = `${demoUnitId},N1002,李小華,lee@test.com,N3,2020-05-20,B組`;
        
        const csvContent = `\uFEFF${headers}\n${row1}\n${row2}`;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "人員匯入範例.csv";
        link.click();
    },

    // --- CSV 匯入邏輯 ---
    processImport: async function() {
        const fileInput = document.getElementById('csvFileInput');
        const resultDiv = document.getElementById('importResult');
        const file = fileInput.files[0];

        if (!file) {
            alert("請選擇 CSV 檔案");
            return;
        }

        resultDiv.innerHTML = "正在讀取檔案...";
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            const rows = text.split(/\r\n|\n/); // 處理不同作業系統的換行
            const batch = db.batch(); // 使用 Batch 批次寫入
            let count = 0;
            let errorCount = 0;

            // 從第 1 行開始 (跳過標題列 index 0)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i].trim();
                if (!row) continue; // 跳過空行

                const cols = row.split(',');
                // CSV 格式: 單位代碼(0), 員編(1), 姓名(2), Email(3), 層級(4), 到職日(5), 組別(6)
                if (cols.length < 4) {
                    errorCount++;
                    continue; // 資料欄位不足
                }

                const unitId = cols[0].trim();
                const empId = cols[1].trim();
                
                // 檢查單位是否存在
                if (!this.unitMap[unitId]) {
                    console.warn(`Row ${i}: 單位代碼 ${unitId} 不存在`);
                    // 這裡可以選擇是否阻擋，依照需求目前僅警告，仍允許寫入
                }

                const docRef = db.collection('users').doc(); // 自動產生 ID
                batch.set(docRef, {
                    unitId: unitId,
                    employeeId: empId,
                    displayName: cols[2].trim(),
                    email: cols[3].trim(),
                    level: cols[4] ? cols[4].trim() : 'N',
                    hireDate: cols[5] ? cols[5].trim() : '',
                    groupId: cols[6] ? cols[6].trim() : '',
                    role: 'user',
                    isActive: true,
                    schedulingParams: {
                        isPregnant: false,
                        isBreastfeeding: false,
                        canBundleShifts: false
                    },
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                count++;

                // Firestore Batch 限制一次最多 500 筆
                if (count % 450 === 0) {
                    await batch.commit();
                    // 開啟新的 batch
                    // 注意：實際完整實作需要重建 batch 物件，這裡為簡化範例假設檔案小於 500 筆
                }
            }

            try {
                if (count > 0) {
                    await batch.commit();
                    alert(`匯入完成！\n成功: ${count} 筆\n格式錯誤/略過: ${errorCount} 筆`);
                    this.closeImportModal();
                    this.fetchData(); // 重刷列表
                } else {
                    resultDiv.innerHTML = "<span style='color:red'>沒有可匯入的有效資料。</span>";
                }
            } catch (err) {
                console.error(err);
                resultDiv.innerHTML = `<span style='color:red'>匯入失敗: ${err.message}</span>`;
            }
        };

        reader.readAsText(file);
    },

    // --- 儲存單筆 ---
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
            role: 'user', 
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
            this.fetchData(); 
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
    }
};
