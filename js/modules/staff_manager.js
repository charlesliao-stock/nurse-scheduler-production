// js/modules/staff_manager.js

const staffManager = {
    allData: [],
    unitCache: {}, 
    sortState: { field: 'employeeId', order: 'asc' },
    isLoading: false, 

    // --- 模組初始化 ---
    init: async function() {
        console.log("Staff Manager Module Loaded.");
        const searchInput = document.getElementById('searchStaffInput');
        if(searchInput) {
            searchInput.oninput = this.debounce(() => this.renderTable(), 300);
        }
        await this.loadUnitDropdown();
        await this.fetchData();
    },

    cleanup: function() {
        // 清理搜尋 debounce 可能留下的 timer (此範例簡單略過，若有複雜監聽需在此移除)
        console.log("StaffManager cleanup");
    },

    debounce: function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout); timeout = setTimeout(later, wait);
        };
    },

    // --- 下拉選單與資料讀取 (保持原樣或微調) ---
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        if(!selectFilter || !selectInput) return;

        selectFilter.innerHTML = '<option value="all">載入中...</option>';
        selectInput.innerHTML = '<option value="">請選擇單位</option>';
        this.unitCache = {}; 

        try {
            let query = db.collection('units');
            if(app.userRole === 'unit_manager' && app.userUnitId) {
                query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
            }
            const snapshot = await query.get();
            
            selectFilter.innerHTML = '<option value="all">全部單位</option>';
            snapshot.forEach(doc => {
                const u = doc.data();
                this.unitCache[doc.id] = u.name;
                
                const opt1 = document.createElement('option');
                opt1.value = doc.id; opt1.textContent = u.name;
                selectFilter.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = doc.id; opt2.textContent = u.name;
                selectInput.appendChild(opt2);
            });
        } catch(e) { console.error(e); }
    },

    fetchData: async function() {
        if(this.isLoading) return;
        this.isLoading = true;
        document.getElementById('staffTableBody').innerHTML = '<tr><td colspan="7">載入中...</td></tr>';
        
        try {
            let query = db.collection('users');
            if(app.userRole === 'unit_manager' && app.userUnitId) {
                query = query.where('unitId', '==', app.userUnitId);
            }
            const snapshot = await query.get();
            this.allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderTable();
        } catch(e) { console.error(e); }
        finally { this.isLoading = false; }
    },

    renderTable: function() {
        // ... (保持原有的 renderTable 邏輯，或根據需求優化) ...
        // 為節省篇幅，此處省略純 UI 渲染代碼，重點在 processImport
        const tbody = document.getElementById('staffTableBody');
        const filterUnit = document.getElementById('filterUnitSelect').value;
        const search = document.getElementById('searchStaffInput').value.toLowerCase();
        
        let data = this.allData.filter(d => {
            if(filterUnit !== 'all' && d.unitId !== filterUnit) return false;
            if(search && !d.employeeId.toLowerCase().includes(search) && !d.displayName.toLowerCase().includes(search)) return false;
            return true;
        });

        // Sort
        const { field, order } = this.sortState;
        data.sort((a, b) => {
            let va = a[field] || '', vb = b[field] || '';
            if (field === 'unitName') { va = this.unitCache[a.unitId] || ''; vb = this.unitCache[b.unitId] || ''; }
            return order === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        });

        tbody.innerHTML = '';
        data.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.unitCache[u.unitId] || u.unitId}</td>
                <td>${u.employeeId}</td>
                <td>${u.displayName}</td>
                <td>${u.level}</td>
                <td>${u.groupId || '-'}</td>
                <td>${app.translateRole(u.role)}</td>
                <td>
                    <button class="btn btn-edit" onclick="staffManager.openModal('${u.id}')"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-delete" onclick="staffManager.deleteStaff('${u.id}')"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },
    
    // --- [修正] 高效且安全的匯入邏輯 ---
    processImport: async function() {
        const fileInput = document.getElementById('csvFileInput');
        const resultDiv = document.getElementById('importResult');
        
        if (!fileInput.files.length) { alert("請選擇檔案"); return; }

        const file = fileInput.files[0];
        const reader = new FileReader();

        const btn = document.querySelector('#importModal .btn-add');
        const originalBtnText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "驗證中...";
        resultDiv.innerHTML = '<span style="color:blue;">正在讀取並驗證資料...</span>';

        reader.onload = async function(e) {
            try {
                const text = e.target.result;
                const rows = text.split(/\r\n|\n/);
                
                // 1. [優化] 預先載入對照表 (Set/Map)
                const unitSnapshot = await db.collection('units').get();
                const validUnitIds = new Set(unitSnapshot.docs.map(doc => doc.id));
                
                const userSnapshot = await db.collection('users').get();
                const existingEmpIds = new Set(userSnapshot.docs.map(doc => doc.data().employeeId));

                const batch = db.batch();
                let successCount = 0;
                let errors = [];
                const MAX_BATCH_SIZE = 450; 

                // 從 i=1 開始跳過標題
                for (let i = 1; i < rows.length; i++) {
                    if (!rows[i].trim()) continue;

                    const cols = rows[i].split(',').map(c => c.trim());
                    const lineNum = i + 1;
                    const [unitId, empId, name, email] = cols;

                    // 驗證邏輯
                    if (cols.length < 4) { errors.push(`第 ${lineNum} 行：欄位不足`); continue; }
                    if (!unitId || !empId || !name || !email) { errors.push(`第 ${lineNum} 行：必填欄位空白`); continue; }
                    if (!validUnitIds.has(unitId)) { errors.push(`第 ${lineNum} 行：單位代碼 "${unitId}" 不存在`); continue; }
                    if (existingEmpIds.has(empId)) { errors.push(`第 ${lineNum} 行：員編 "${empId}" 已存在`); continue; }
                    
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(email)) { errors.push(`第 ${lineNum} 行：Email 格式錯誤`); continue; }

                    if (successCount >= MAX_BATCH_SIZE) {
                        errors.push(`超過單次匯入上限 (${MAX_BATCH_SIZE} 筆)，其餘略過`);
                        break;
                    }

                    // 準備寫入
                    const newDocRef = db.collection('users').doc(); 
                    batch.set(newDocRef, {
                        unitId, employeeId: empId, displayName: name, email,
                        level: cols[4] || 'N', 
                        hireDate: cols[5] || '', 
                        groupId: '',
                        role: 'user', isActive: true, isRegistered: false, uid: null,
                        schedulingParams: { isPregnant: false, isBreastfeeding: false, canBundleShifts: false },
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    
                    existingEmpIds.add(empId); // 防止 CSV 內重複
                    successCount++;
                }

                if (successCount === 0 && errors.length === 0) {
                    resultDiv.innerHTML = "無有效資料";
                } else if (errors.length > 0) {
                    let msg = `<strong>🚫 驗證失敗，請修正：</strong><br><ul style="text-align:left;max-height:150px;overflow-y:auto;">`;
                    errors.slice(0,20).forEach(e => msg += `<li>${e}</li>`);
                    if(errors.length > 20) msg += `<li>...等 ${errors.length} 個錯誤</li>`;
                    msg += "</ul>";
                    resultDiv.innerHTML = msg;
                    resultDiv.style.color = "#c0392b";
                } else {
                    await batch.commit();
                    resultDiv.innerHTML = `<strong style="color:green;">✅ 成功匯入 ${successCount} 筆！</strong>`;
                    setTimeout(() => {
                        staffManager.closeImportModal();
                        staffManager.fetchData();
                    }, 1500);
                }

            } catch (err) {
                console.error("Import Error:", err);
                resultDiv.innerHTML = `<span style="color:red;">系統錯誤: ${err.message}</span>`;
            } finally {
                btn.disabled = false;
                btn.textContent = originalBtnText;
                fileInput.value = '';
            }
        };
        reader.readAsText(file);
    },

    // UI 開關 (保持原樣)
    openModal: function(id) { /* ... 略 ... */ },
    closeModal: function() { document.getElementById('staffModal').classList.remove('show'); },
    openImportModal: function() { document.getElementById('importModal').classList.add('show'); },
    closeImportModal: function() { document.getElementById('importModal').classList.remove('show'); document.getElementById('importResult').innerHTML=''; },
    downloadTemplate: function() {
        const csvContent = "單位ID,員工編號,姓名,Email,層級(選填),到職日(選填)\nICU01,N1001,王小明,wang@example.com,N1,2023-01-01";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "staff_import_template.csv";
        link.click();
    },
    
    // ... 其他 CRUD 方法保持原樣 ...
    // saveData, deleteStaff, sortData 等
};
