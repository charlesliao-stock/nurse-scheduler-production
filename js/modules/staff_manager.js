// js/modules/staff_manager.js
// 🔧 完整修正版：支援模擬身分過濾

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

    debounce: function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout); timeout = setTimeout(later, wait);
        };
    },

    // --- 1. 載入單位下拉選單 ---
    loadUnitDropdown: async function() {
        const selectFilter = document.getElementById('filterUnitSelect');
        const selectInput = document.getElementById('inputUnit');
        if(!selectFilter || !selectInput) return;

        selectFilter.innerHTML = '<option value="all">載入中...</option>';
        selectInput.innerHTML = '<option value="">請選擇單位</option>';
        this.unitCache = {}; 

        let query = db.collection('units');
        
        // [修正] 權限過濾：優先使用模擬身分
        const activeRole = app.impersonatedRole || app.userRole;
        const activeUnitId = app.impersonatedUnitId || app.userUnitId;

        // 如果是單位管理者，強制鎖定只能看自己的單位
        if((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && activeUnitId) {
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', activeUnitId);
        }

        try {
            const snapshot = await query.get();
            
            // 重置選項
            selectFilter.innerHTML = '<option value="all">全部單位</option>';
            
            snapshot.forEach(doc => {
                const u = doc.data();
                this.unitCache[doc.id] = u.name;

                // 篩選用的下拉選單
                const opt1 = document.createElement('option');
                opt1.value = doc.id;
                opt1.textContent = u.name;
                selectFilter.appendChild(opt1);

                // 編輯/新增用的下拉選單
                const opt2 = document.createElement('option');
                opt2.value = doc.id;
                opt2.textContent = u.name;
                selectInput.appendChild(opt2);
            });

            // 若只有一個單位 (例如護理長)，自動選取並隱藏 "全部"
            if(snapshot.size === 1) {
                selectFilter.selectedIndex = 1;
                // 觸發 change 事件以重新載入資料
                selectFilter.onchange = () => this.fetchData();
            } else {
                selectFilter.onchange = () => this.fetchData();
            }

        } catch(e) {
            console.error("Load Units Error:", e);
        }
    },

    // --- 2. 讀取人員資料 ---
    fetchData: async function() {
        const tbody = document.getElementById('staffTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">載入中...</td></tr>';
        this.isLoading = true;

        try {
            let query = db.collection('users').where('isActive', '==', true);
            
            // [修正] 取得當前活動的身分與單位
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            const filterUnit = document.getElementById('filterUnitSelect');

            // 邏輯判斷：
            // 1. 如果是單位管理者，強制鎖定該單位
            // 2. 如果是系統管理員，則看下拉選單選了什麼
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) {
                    query = query.where('unitId', '==', activeUnitId);
                }
            } else {
                // 系統管理員視角
                if (filterUnit && filterUnit.value && filterUnit.value !== 'all') {
                    query = query.where('unitId', '==', filterUnit.value);
                }
            }

            const snapshot = await query.get();
            this.allData = snapshot.docs.map(doc => ({
                uid: doc.id,
                ...doc.data()
            }));
            
            this.renderTable();

        } catch (e) {
            console.error("Fetch Staff Error:", e);
            tbody.innerHTML = `<tr><td colspan="7" style="color:red;">載入失敗: ${e.message}</td></tr>`;
        } finally {
            this.isLoading = false;
        }
    },

    // --- 3. 渲染表格 ---
    renderTable: function() {
        const tbody = document.getElementById('staffTableBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        // 搜尋過濾
        const term = document.getElementById('searchStaffInput')?.value.toLowerCase() || '';
        let displayData = this.allData.filter(d => {
            const txt = (d.employeeId + d.displayName + (this.unitCache[d.unitId]||'')).toLowerCase();
            return txt.includes(term);
        });

        // 排序
        const { field, order } = this.sortState;
        displayData.sort((a,b) => {
            let va = a[field] || '';
            let vb = b[field] || '';
            // 特別處理單位名稱
            if(field === 'unitName') {
                va = this.unitCache[a.unitId] || '';
                vb = this.unitCache[b.unitId] || '';
            }
            if(va < vb) return order === 'asc' ? -1 : 1;
            if(va > vb) return order === 'asc' ? 1 : -1;
            return 0;
        });

        displayData.forEach(user => {
            const unitName = this.unitCache[user.unitId] || user.unitId;
            const roleMap = { 'system_admin':'系統管理員', 'unit_manager':'單位護理長', 'unit_scheduler':'排班人員', 'user':'護理師' };
            const roleName = roleMap[user.role] || user.role;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${user.employeeId}</td>
                <td><span style="font-weight:bold; color:#2c3e50;">${user.displayName}</span></td>
                <td>${user.level || '-'}</td>
                <td>${user.groupId || '-'}</td>
                <td><span class="badge badge-role">${roleName}</span></td>
                <td>
                    <button class="btn btn-sm btn-edit" onclick='staffManager.openModal(${JSON.stringify(user).replace(/'/g, "&#39;")})'>
                        <i class="fas fa-edit"></i> 編輯
                    </button>
                    <button class="btn btn-sm btn-delete" onclick="staffManager.resetPassword('${user.uid}')" style="background-color:#f39c12;">
                        <i class="fas fa-key"></i> 重置密碼
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if(displayData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">沒有符合的資料</td></tr>';
        }
    },

    // --- 4. 排序 ---
    sortData: function(field) {
        if(this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        
        // 更新圖示
        document.querySelectorAll('i[id^="sort_icon_"]').forEach(i => i.className = 'fas fa-sort');
        const icon = document.getElementById(`sort_icon_staff_${field}`);
        if(icon) icon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

        this.renderTable();
    },

    // --- 5. Modal 操作 ---
    openModal: function(user = null) {
        const modal = document.getElementById('staffModal');
        const title = document.getElementById('staffModalTitle');
        const form = document.getElementById('staffForm');
        
        // 確保單位下拉選單已填入
        if(document.getElementById('inputUnit').options.length <= 1) {
             // 若尚未載入，嘗試重新載入 (通常 init 已載入)
        }

        if (user) {
            title.textContent = "編輯人員";
            document.getElementById('editStaffUid').value = user.uid;
            document.getElementById('inputUnit').value = user.unitId;
            document.getElementById('inputEmpId').value = user.employeeId;
            document.getElementById('inputName').value = user.displayName;
            document.getElementById('inputEmail').value = user.email;
            document.getElementById('inputLevel').value = user.level || 'N';
            document.getElementById('inputRole').value = user.role;
            
            // 排班參數
            if(user.schedulingParams) {
                document.getElementById('checkPregnant').checked = user.schedulingParams.isPregnant || false;
                document.getElementById('checkBreastfeeding').checked = user.schedulingParams.isBreastfeeding || false;
                document.getElementById('checkBundle').checked = user.schedulingParams.canBundleShifts || false;
            }
        } else {
            title.textContent = "新增人員";
            form.reset();
            document.getElementById('editStaffUid').value = "";
            // 預設選取當前過濾的單位
            const filterVal = document.getElementById('filterUnitSelect').value;
            if(filterVal && filterVal !== 'all') {
                document.getElementById('inputUnit').value = filterVal;
            }
        }
        modal.classList.add('show');
    },

    closeModal: function() {
        document.getElementById('staffModal').classList.remove('show');
    },

    // --- 6. 儲存資料 ---
    saveData: async function() {
        const uid = document.getElementById('editStaffUid').value;
        const unitId = document.getElementById('inputUnit').value;
        const empId = document.getElementById('inputEmpId').value;
        const name = document.getElementById('inputName').value;
        const email = document.getElementById('inputEmail').value;
        const role = document.getElementById('inputRole').value;

        if(!unitId || !empId || !name || !email) {
            alert("請填寫必填欄位");
            return;
        }

        const data = {
            unitId, employeeId: empId, displayName: name, email, role,
            level: document.getElementById('inputLevel').value,
            schedulingParams: {
                isPregnant: document.getElementById('checkPregnant').checked,
                isBreastfeeding: document.getElementById('checkBreastfeeding').checked,
                canBundleShifts: document.getElementById('checkBundle').checked
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (uid) {
                // 更新
                await db.collection('users').doc(uid).update(data);
            } else {
                // 新增
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.isActive = true;
                data.isRegistered = false; // 需等待使用者自行註冊開通
                await db.collection('users').add(data);
            }
            alert("儲存成功");
            this.closeModal();
            await this.fetchData();
        } catch (e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
        }
    },

    // --- 7. 匯入功能 ---
    openImportModal: function() {
        document.getElementById('importModal').classList.add('show');
    },
    closeImportModal: function() {
        document.getElementById('importModal').classList.remove('show');
    },
    downloadTemplate: function() {
        const csvContent = "\uFEFFUnitID,EmployeeID,Name,Email,Level,HireDate,Group\nunit_a,N001,王小明,wang@example.com,N3,2020-01-01,A";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "staff_import_template.csv";
        link.click();
    },
    
    processImport: function() {
        const file = document.getElementById('csvFileInput')?.files[0];
        if (!file) { alert("請選擇 CSV 檔案"); return; }
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const rows = e.target.result.split(/\r\n|\n/);
                const batch = db.batch();
                let count = 0;
                
                for (let i = 1; i < rows.length; i++) {
                    const cols = rows[i].trim().split(',');
                    if (cols.length < 4) continue;
                    
                    const docRef = db.collection('users').doc();
                    batch.set(docRef, {
                        unitId: cols[0].trim(), 
                        employeeId: cols[1].trim(), 
                        displayName: cols[2].trim(), 
                        email: cols[3].trim(),
                        level: cols[4]||'N', 
                        hireDate: cols[5]||'', 
                        groupId: cols[6]||'', 
                        role: 'user', 
                        isActive: true, 
                        isRegistered: false, 
                        uid: null, // 尚未綁定 Auth
                        schedulingParams: { isPregnant: false, isBreastfeeding: false, canBundleShifts: false },
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                    
                    // Firestore batch limit is 500
                    if (count % 450 === 0) {
                        await batch.commit();
                        // Reset batch logic if needed, but simple loop assumes < 500 for now or needs new batch
                    }
                }
                
                if(count > 0) await batch.commit();
                
                alert(`匯入完成！共 ${count} 筆`);
                this.closeImportModal(); 
                await this.fetchData();
                
            } catch(error) { 
                alert("匯入失敗: " + error.message); 
            }
        };
        reader.readAsText(file);
    },

// --- 8. 重置密碼 (實作版) ---
    resetPassword: async function(uid) {
        // 1. 從本地快取中查找使用者資料
        const user = this.allData.find(u => u.uid === uid);
        
        if (!user) {
            alert("系統錯誤：找不到該使用者資料 (UID 失效)。");
            return;
        }

        // 2. 檢查使用者狀態
        // 如果使用者還沒 "isRegistered" (未開通)，代表他在 Firebase Auth 還沒有帳號，無法重置
        if (!user.isRegistered) {
            alert(`無法重置：\n${user.displayName} 尚未完成「帳號開通」。\n\n請通知該同仁使用登入頁面的「帳號開通」功能來設定初始密碼。`);
            return;
        }

        if (!user.email) {
            alert("無法重置：該使用者資料中沒有 Email，無法寄送重置信。");
            return;
        }

        // 3. 顯示確認對話框
        const confirmMsg = `您確定要發送「密碼重置信」給 ${user.displayName} 嗎？\n\n` +
                           `Email: ${user.email}\n\n` +
                           `系統將發送一封電子郵件，使用者點擊信中連結即可重新設定密碼。`;

        if (!confirm(confirmMsg)) {
            return;
        }

        // 4. 呼叫 Firebase Auth 發送重置信
        try {
            // 設定信件語言為繁體中文 (依專案設定而定，也可強制指定)
            auth.languageCode = 'zh-TW'; 
            
            await auth.sendPasswordResetEmail(user.email);
            
            alert(`✅ 發送成功！\n\n重置信已寄至 ${user.email}。\n請通知 ${user.displayName} 收信並設定新密碼。`);
            
        } catch (e) {
            console.error("Reset Password Error:", e);
            let msg = e.message;
            
            // 常見錯誤代碼轉換
            if (e.code === 'auth/user-not-found') {
                msg = "找不到此 Email 對應的帳號 (可能使用者已被刪除或尚未在 Auth 註冊)。";
            } else if (e.code === 'auth/invalid-email') {
                msg = "使用者的 Email 格式不正確。";
            } else if (e.code === 'auth/too-many-requests') {
                msg = "請求過於頻繁，請稍後再試。";
            }

            alert("❌ 發送失敗: " + msg);
        }
    }
};
