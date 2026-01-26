// js/modules/staff_manager.js (完整修正版)

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
        // 權限過濾：單位護理長與排班人員只能看到自己單位
        const activeRole = app.impersonatedRole || app.userRole;
        if((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && app.userUnitId) {
            query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            selectFilter.innerHTML = '<option value="all">所有單位</option>';
            snapshot.forEach(doc => {
                const unit = doc.data();
                this.unitCache[doc.id] = { name: unit.name, groups: unit.groups || [] };
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
                groupSelect.innerHTML += `<option value="${g}">${g}</option>`;
            });
        } else {
            groupSelect.innerHTML = '<option value="">(此單位未設定組別)</option>';
        }
    },

    // --- 3. 讀取人員資料 ---
    fetchData: async function() {
        if(this.isLoading) return;
        const tbody = document.getElementById('staffTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> 資料載入中...</td></tr>';
        this.isLoading = true;

        let query = db.collection('users').where('isActive', '==', true);
        // 權限過濾：單位護理長與排班人員只能看到自己單位的人員
        const activeRole = app.impersonatedRole || app.userRole;
        if((activeRole === 'unit_manager' || activeRole === 'unit_scheduler') && app.userUnitId) {
            query = query.where('unitId', '==', app.userUnitId);
        }

        try {
            const snapshot = await query.get();
            this.allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderTable();
        } catch (error) {
            console.error("Fetch Data Error:", error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align:center; padding:30px; color:#e74c3c;">
                        <i class="fas fa-exclamation-triangle" style="font-size:2rem; margin-bottom:10px;"></i><br>
                        <strong>資料載入失敗</strong><br>
                        <small>錯誤代碼: ${error.message}</small><br>
                        <button class="btn btn-sm" onclick="staffManager.fetchData()" style="margin-top:10px; background:#95a5a6; color:white;">
                            <i class="fas fa-sync"></i> 重試
                        </button>
                    </td>
                </tr>`;
        } finally { this.isLoading = false; }
    },

    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    renderTable: function() {
        const tbody = document.getElementById('staffTableBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        document.querySelectorAll('th i[id^="sort_icon_staff_"]').forEach(i => i.className = 'fas fa-sort');
        const activeIcon = document.getElementById(`sort_icon_staff_${this.sortState.field}`);
        if(activeIcon) activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

        const filterUnit = document.getElementById('filterUnitSelect')?.value || 'all';
        const searchTerm = (document.getElementById('searchStaffInput')?.value || '').toLowerCase().trim();

        let filtered = this.allData.filter(u => {
            const matchUnit = filterUnit === 'all' || u.unitId === filterUnit;
            const matchSearch = !searchTerm || 
                                (u.employeeId && u.employeeId.toLowerCase().includes(searchTerm)) || 
                                (u.displayName && u.displayName.toLowerCase().includes(searchTerm));
            return matchUnit && matchSearch;
        });

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
                valA = a[field] || ''; valB = b[field] || '';
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

        const fragment = document.createDocumentFragment();
        filtered.forEach(u => {
            const unitName = (this.unitCache[u.unitId]?.name) || u.unitId || '未知單位';
            const roleName = app.translateRole(u.role);
            let deleteBtn = `<button class="btn btn-delete" onclick="staffManager.deleteUser('${u.id}')">刪除</button>`;
            if (u.role === 'system_admin') deleteBtn = `<button class="btn btn-delete" disabled style="opacity:0.5; cursor:not-allowed;">刪除</button>`;
            let statusTag = u.isRegistered ? '<span style="color:green; font-size:0.8rem;">(已開通)</span>' : '<span style="color:red; font-size:0.8rem;">(未開通)</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${unitName}</td>
                <td>${u.employeeId || '-'}</td>
                <td>${u.displayName || '-'} <br>${statusTag}</td>
                <td>${u.level || '-'}</td>
                <td>${u.groupId || '-'}</td>
                <td><span class="role-badge" style="background:${this.getRoleColor(u.role)}">${roleName}</span></td>
                <td><button class="btn btn-edit" onclick="staffManager.openModal('${u.id}')">編輯</button> ${deleteBtn}</td>
            `;
            fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
    },

    getRoleColor: function(role) {
        const colors = { 'system_admin': '#2c3e50', 'unit_manager': '#e67e22', 'unit_scheduler': '#27ae60', 'user': '#95a5a6' };
        return colors[role] || '#95a5a6';
    },

    // --- 6. Modal 操作 ---
    openModal: function(docId = null) {
        const modal = document.getElementById('staffModal');
        if(!modal) return;
        modal.classList.add('show');
        document.getElementById('staffDocId').value = docId || '';
        
        if(docId) {
            const u = this.allData.find(d => d.id === docId);
            if(!u) { alert("找不到該人員資料"); this.closeModal(); return; }
            
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
            document.getElementById('datePregnant').value = params.pregnantExpiry || '';
            
            document.getElementById('checkBreastfeeding').checked = params.isBreastfeeding || false;
            document.getElementById('dateBreastfeeding').value = params.breastfeedingExpiry || '';
            
            document.getElementById('checkBundle').checked = params.canBundleShifts || false;
            
            const statusField = document.getElementById('accountStatus');
            if(statusField) statusField.value = u.isRegistered ? "已開通" : "等待員工自行開通";
        } else {
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
        document.getElementById('staffModal').classList.remove('show');
    },

    // --- 7. 儲存資料 ---
    saveData: async function() {
        const docId = document.getElementById('staffDocId').value;
        const empId = document.getElementById('inputEmpId').value.trim();
        const email = document.getElementById('inputEmail').value.trim();
        const name = document.getElementById('inputName').value.trim();
        const selectedRole = document.getElementById('inputRole').value;
        const selectedUnitId = document.getElementById('inputUnit').value;

        if(!empId || !email || !name || !selectedUnitId) { alert("請填寫所有必填欄位"); return; }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if(!emailRegex.test(email)) { alert("請輸入有效的電子郵件格式"); return; }

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
                pregnantExpiry: document.getElementById('datePregnant').value,
                isBreastfeeding: document.getElementById('checkBreastfeeding').checked,
                breastfeedingExpiry: document.getElementById('dateBreastfeeding').value,
                canBundleShifts: document.getElementById('checkBundle').checked
            },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const batch = db.batch();
            let userRef;
            if(docId) {
                userRef = db.collection('users').doc(docId);
                batch.update(userRef, data);
            } else {
                userRef = db.collection('users').doc(); 
                data.isRegistered = false; 
                data.uid = null;
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                batch.set(userRef, data);
            }
            const targetUid = docId || userRef.id;
            if (selectedRole !== 'system_admin') {
                const unitRef = db.collection('units').doc(selectedUnitId);
                const unitDoc = await unitRef.get();
                if (unitDoc.exists) {
                    let { managers, schedulers } = unitDoc.data();
                    managers = (managers || []).filter(id => id !== targetUid);
                    schedulers = (schedulers || []).filter(id => id !== targetUid);
                    if (selectedRole === 'unit_manager') managers.push(targetUid);
                    else if (selectedRole === 'unit_scheduler') schedulers.push(targetUid);
                    batch.update(unitRef, { managers, schedulers });
                }
            }
            await batch.commit();
            alert("儲存成功！");
            this.closeModal();
            await this.fetchData();
        } catch (e) { console.error("Save Error:", e); alert("儲存失敗: " + e.message); }
    },

    // --- 8. 刪除與匯入 ---
    deleteUser: async function(id) {
        const u = this.allData.find(d => d.id === id);
        if (u && u.role === 'system_admin') { alert("無法刪除超級管理員！"); return; }
        if(!confirm(`確定要將 ${u?.displayName || '此人員'} 標記為離職？`)) return;
        try {
            await db.collection('users').doc(id).update({ 
                isActive: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await this.fetchData(); alert("已標記為離職");
        } catch(e) { alert("操作失敗"); }
    },

    openImportModal: function() {
        document.getElementById('importModal').classList.add('show');
        document.getElementById('importResult').innerHTML = '';
        document.getElementById('csvFileInput').value = ''; 
    },
    closeImportModal: function() { document.getElementById('importModal').classList.remove('show'); },
    downloadTemplate: function() {
        const content = "\uFEFF單位代碼,員工編號,姓名,Email,層級,到職日(YYYY-MM-DD),組別";
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
        link.download = "人員匯入範例.csv";
        link.click();
    },
    processImport: async function() {
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
                        unitId: cols[0].trim(), employeeId: cols[1].trim(), displayName: cols[2].trim(), email: cols[3].trim(),
                        level: cols[4]||'N', hireDate: cols[5]||'', groupId: cols[6]||'', role: 'user', isActive: true, isRegistered: false, uid: null,
                        schedulingParams: { isPregnant: false, isBreastfeeding: false, canBundleShifts: false },
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                    if (count % 450 === 0) await batch.commit();
                }
                if(count > 0) await batch.commit();
                alert(`匯入完成！共 ${count} 筆`);
                this.closeImportModal(); await this.fetchData();
            } catch(error) { alert("匯入失敗: " + error.message); }
        };
        reader.readAsText(file);
    },

    // --- 9. 故障排查工具：修復資料不同步 (完整增強版) ---
    fixAuthFirestoreSync: async function(email) {
        if (!email) { 
            alert("請輸入 Email"); 
            return; 
        }
        
        try {
            console.log(`[修復] 開始檢查 Email: ${email}`);
            
            // ========================================
            // 步驟 1: 查詢 Firestore 中的所有相關記錄
            // ========================================
            const firestoreDocs = await db.collection('users')
                .where('email', '==', email)
                .get();
            
            console.log(`[修復] Firestore 中找到 ${firestoreDocs.size} 筆記錄`);
            
            if (firestoreDocs.empty) {
                alert("❌ Firestore 中找不到此 Email 的記錄\n\n請確認：\n1. Email 是否正確\n2. 是否已由管理員建立員工資料");
                return;
            }
            
            // ========================================
            // 步驟 2: 檢查 Auth 系統中的狀態
            // ========================================
            console.log(`[修復] 檢查 Auth 系統狀態...`);
            let authExists = false;
            let authUid = null;
            
            try {
                const signInMethods = await auth.fetchSignInMethodsForEmail(email);
                authExists = signInMethods.length > 0;
                console.log(`[修復] Auth 帳號存在: ${authExists}`);
            } catch (authError) {
                console.warn(`[修復] 無法檢查 Auth 狀態:`, authError);
            }
            
            // ========================================
            // 步驟 3: 分析並處理不同情況
            // ========================================
            
            // 情況 A: 有多筆 Firestore 記錄
            if (firestoreDocs.size > 1) {
                console.warn(`[修復] 警告：找到 ${firestoreDocs.size} 筆相同 Email 的記錄`);
                
                // 分類記錄
                const registeredDocs = [];
                const unregisteredDocs = [];
                
                firestoreDocs.forEach(doc => {
                    const data = doc.data();
                    const timestamp = data.activatedAt?.toMillis?.() || data.createdAt?.toMillis?.() || 0;
                    
                    if (data.isRegistered && data.uid) {
                        registeredDocs.push({ doc, data, timestamp });
                    } else {
                        unregisteredDocs.push({ doc, data, timestamp });
                    }
                });
                
                console.log(`[修復] 已開通: ${registeredDocs.length}, 未開通: ${unregisteredDocs.length}`);
                
                // 子情況 A1: 沒有已開通的記錄
                if (registeredDocs.length === 0) {
                    if (!authExists) {
                        // 所有記錄都未開通，且 Auth 也不存在 -> 清理舊記錄
                        const confirmCleanup = confirm(
                            `找到 ${firestoreDocs.size} 筆相同 Email 的重複記錄，但都未開通。\n\n` +
                            `建議刪除所有舊記錄，只保留一筆最新的。\n\n` +
                            `確定要繼續嗎？`
                        );
                        
                        if (!confirmCleanup) return;
                        
                        // 按時間排序，保留最新的
                        const sortedDocs = unregisteredDocs.sort((a, b) => b.timestamp - a.timestamp);
                        const keepDoc = sortedDocs[0];
                        const deleteDocs = sortedDocs.slice(1);
                        
                        const batch = db.batch();
                        deleteDocs.forEach(item => {
                            batch.delete(item.doc.ref);
                            console.log(`[修復] 刪除重複記錄: ${item.doc.id}`);
                        });
                        
                        // 確保保留的記錄狀態正確
                        batch.update(keepDoc.doc.ref, {
                            isActive: true,
                            isRegistered: false,
                            uid: null,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        
                        await batch.commit();
                        alert(`✅ 清理完成！\n\n保留記錄: ${keepDoc.doc.id}\n刪除記錄: ${deleteDocs.length} 筆\n\n員工現在可以重新開通帳號。`);
                        
                    } else {
                        // Auth 存在但 Firestore 都未開通 -> 嚴重錯誤
                        alert(
                            `❌ 檢測到資料嚴重不同步\n\n` +
                            `• Firestore: ${firestoreDocs.size} 筆記錄（都未開通）\n` +
                            `• Auth: 帳號已存在\n\n` +
                            `這種情況需要手動處理：\n` +
                            `1. 聯絡技術人員\n` +
                            `2. 或先刪除 Auth 帳號（需要 Admin SDK）\n` +
                            `3. 再清理 Firestore 重複記錄`
                        );
                    }
                    return;
                }
                
                // 子情況 A2: 有已開通的記錄
                // 找出最新的已開通記錄
                registeredDocs.sort((a, b) => b.timestamp - a.timestamp);
                const latestDoc = registeredDocs[0];
                
                // 要刪除的記錄
                const docsToDelete = [
                    ...registeredDocs.slice(1),
                    ...unregisteredDocs
                ];
                
                if (docsToDelete.length > 0) {
                    const deleteList = docsToDelete.map((item, idx) => {
                        return `${idx + 1}. ${item.doc.id} (${item.data.isRegistered ? '已開通' : '未開通'})`;
                    }).join('\n');
                    
                    const confirmDelete = confirm(
                        `找到 ${firestoreDocs.size} 筆相同 Email 的記錄。\n\n` +
                        `將保留最新的已開通記錄：\n${latestDoc.doc.id}\n\n` +
                        `將刪除以下 ${docsToDelete.length} 筆記錄：\n${deleteList}\n\n` +
                        `確定要繼續嗎？`
                    );
                    
                    if (!confirmDelete) return;
                    
                    const batch = db.batch();
                    docsToDelete.forEach(item => {
                        batch.delete(item.doc.ref);
                        console.log(`[修復] 刪除重複記錄: ${item.doc.id}`);
                    });
                    
                    // 確保保留的記錄狀態正確
                    batch.update(latestDoc.doc.ref, {
                        isActive: true,
                        isRegistered: true,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    
                    await batch.commit();
                    alert(`✅ 修復完成！\n\n保留記錄: ${latestDoc.doc.id}\n刪除記錄: ${docsToDelete.length} 筆`);
                } else {
                    alert(`✅ 資料狀態正常\n\n只有一筆已開通的記錄，無需修復。`);
                }
            }
            // 情況 B: 只有一筆 Firestore 記錄
            else {
                const doc = firestoreDocs.docs[0];
                const data = doc.data();
                
                console.log(`[修復] 記錄詳情:`, {
                    docId: doc.id,
                    isRegistered: data.isRegistered,
                    isActive: data.isActive,
                    uid: data.uid,
                    authExists: authExists
                });
                
                // 子情況 B1: 記錄未開通
                if (!data.isRegistered || !data.uid) {
                    if (!authExists) {
                        // Firestore 未開通，Auth 不存在 -> 正常狀態
                        alert(
                            `✅ 資料狀態正常\n\n` +
                            `此員工尚未開通帳號。\n` +
                            `請員工前往開通頁面完成開通流程。`
                        );
                    } else {
                        // Firestore 未開通，但 Auth 存在 -> 需要清理 Auth
                        alert(
                            `⚠️ 檢測到不一致狀態\n\n` +
                            `• Firestore: 未開通\n` +
                            `• Auth: 帳號已存在\n\n` +
                            `可能原因：之前開通失敗\n\n` +
                            `建議操作：\n` +
                            `1. 刪除 Auth 帳號（需要 Admin SDK 或 Firebase Console）\n` +
                            `2. 讓員工重新開通`
                        );
                    }
                    return;
                }
                
                // 子情況 B2: 記錄已開通
                if (!data.isActive) {
                    const confirmFix = confirm(
                        `此記錄已開通但狀態為「停用」。\n\n` +
                        `確定要將其恢復為「啟用」嗎？`
                    );
                    if (!confirmFix) return;
                    
                    await db.collection('users').doc(doc.id).update({
                        isActive: true,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    alert("✅ 修復完成！已將員工狀態恢復為啟用。");
                } else {
                    // 檢查文件 ID 是否等於 UID
                    if (doc.id !== data.uid) {
                        const confirmMigrate = confirm(
                            `⚠️ 檢測到文件 ID 與 UID 不一致\n\n` +
                            `文件 ID: ${doc.id}\n` +
                            `UID: ${data.uid}\n\n` +
                            `建議將資料遷移到正確的文件 ID。\n\n` +
                            `確定要進行遷移嗎？`
                        );
                        
                        if (!confirmMigrate) return;
                        
                        const batch = db.batch();
                        
                        // 建立新文件（使用 UID 作為 ID）
                        const newDocRef = db.collection('users').doc(data.uid);
                        batch.set(newDocRef, {
                            ...data,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        
                        // 刪除舊文件
                        batch.delete(doc.ref);
                        
                        await batch.commit();
                        alert(`✅ 遷移完成！\n\n新文件 ID: ${data.uid}\n已刪除舊文件: ${doc.id}`);
                    } else {
                        alert(
                            `✅ 資料狀態正常\n\n` +
                            `UID: ${data.uid}\n` +
                            `isRegistered: ${data.isRegistered}\n` +
                            `isActive: ${data.isActive}\n\n` +
                            `無需修復。`
                        );
                    }
                }
            }
            
            // 重新載入資料
            await this.fetchData();
            
        } catch (error) {
            console.error("[修復] 出錯:", error);
            alert(`❌ 修復失敗\n\n錯誤訊息: ${error.message}`);
        }
    },

    // --- 故障排查工具：UI 輔助函數 ---
    openTroubleshootModal: function() {
        const modal = document.getElementById('troubleshootModal');
        if(modal) {
            modal.classList.add('show');
            document.getElementById('troubleshootEmail').value = '';
            const resultDiv = document.getElementById('troubleshootResult');
            if(resultDiv) resultDiv.style.display = 'none';
        }
    },

    closeTroubleshootModal: function() {
        const modal = document.getElementById('troubleshootModal');
        if(modal) modal.classList.remove('show');
    },

    startTroubleshoot: async function() {
        const email = document.getElementById('troubleshootEmail').value.trim();
        const resultDiv = document.getElementById('troubleshootResult');
        
        if (!email) {
            if(resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.style.backgroundColor = '#f8d7da';
                resultDiv.style.color = '#721c24';
                resultDiv.style.padding = '15px';
                resultDiv.style.borderRadius = '4px';
                resultDiv.style.marginTop = '10px';
                resultDiv.textContent = '❌ 請輸入 Email';
            }
            return;
        }
        
        // 驗證 Email 格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            if(resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.style.backgroundColor = '#f8d7da';
                resultDiv.style.color = '#721c24';
                resultDiv.style.padding = '15px';
                resultDiv.style.borderRadius = '4px';
                resultDiv.style.marginTop = '10px';
                resultDiv.textContent = '❌ Email 格式不正確';
            }
            return;
        }
        
        if(resultDiv) {
            resultDiv.style.display = 'block';
            resultDiv.style.backgroundColor = '#d1ecf1';
            resultDiv.style.color = '#0c5460';
            resultDiv.style.padding = '15px';
            resultDiv.style.borderRadius = '4px';
            resultDiv.style.marginTop = '10px';
            resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在檢查並修復...';
        }
        
        try {
            await this.fixAuthFirestoreSync(email);
            if(resultDiv) resultDiv.style.display = 'none';
        } catch (error) {
            if(resultDiv) {
                resultDiv.style.backgroundColor = '#f8d7da';
                resultDiv.style.color = '#721c24';
                resultDiv.innerHTML = `❌ 修復失敗<br><small>${error.message}</small>`;
            }
        }
    }
};
