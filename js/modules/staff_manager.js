const StaffManager = {
    db: null,
    currentEditId: null,
    unitsCache: [],
    rolesCache: [],

    init: async function() {
        this.db = firebase.firestore();
        await this.loadUnits();
        await this.loadRoles();
        await this.loadData();
        this.bindEvents();
    },

    bindEvents: function() {
        document.getElementById('addStaffBtn').addEventListener('click', () => this.showModal());
        document.getElementById('saveStaffBtn').addEventListener('click', () => this.saveData());
        document.getElementById('cancelStaffBtn').addEventListener('click', () => this.hideModal());
        
        const searchInput = document.getElementById('searchStaff');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterTable(e.target.value));
        }
    },

    loadUnits: async function() {
        try {
            const snapshot = await this.db.collection('units').orderBy('name').get();
            this.unitsCache = [];
            snapshot.forEach(doc => {
                this.unitsCache.push({ id: doc.id, ...doc.data() });
            });
            this.renderUnitOptions();
        } catch (error) {
            console.error('載入單位失敗:', error);
            alert('載入單位資料失敗，請重新整理頁面');
        }
    },

    loadRoles: async function() {
        try {
            const snapshot = await this.db.collection('system_roles').orderBy('name').get();
            this.rolesCache = [];
            snapshot.forEach(doc => {
                this.rolesCache.push({ id: doc.id, ...doc.data() });
            });
            this.renderRoleOptions();
        } catch (error) {
            console.error('載入角色失敗:', error);
            alert('載入角色資料失敗，請重新整理頁面');
        }
    },

    renderUnitOptions: function() {
        const select = document.getElementById('staffUnit');
        if (!select) return;
        
        select.innerHTML = '<option value="">請選擇單位</option>';
        this.unitsCache.forEach(unit => {
            const option = document.createElement('option');
            option.value = unit.id;
            option.textContent = unit.name;
            select.appendChild(option);
        });
    },

    renderRoleOptions: function() {
        const select = document.getElementById('staffRole');
        if (!select) return;
        
        select.innerHTML = '<option value="">請選擇角色</option>';
        this.rolesCache.forEach(role => {
            const option = document.createElement('option');
            option.value = role.id;
            option.textContent = role.name;
            select.appendChild(option);
        });
    },

    loadData: async function() {
        try {
            const snapshot = await this.db.collection('users').orderBy('displayName').get();
            const tbody = document.getElementById('staffTableBody');
            tbody.innerHTML = '';

            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">尚無員工資料</td></tr>';
                return;
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                const row = tbody.insertRow();
                
                const unitName = this.unitsCache.find(u => u.id === data.unitId)?.name || '-';
                const roleName = this.rolesCache.find(r => r.id === data.role)?.name || '-';
                const statusText = data.isRegistered ? 
                    '<span style="color: green;">✓ 已開通</span>' : 
                    '<span style="color: orange;">⏳ 待開通</span>';
                const activeText = data.isActive ? 
                    '<span style="color: green;">●</span>' : 
                    '<span style="color: red;">●</span>';

                row.innerHTML = `
                    <td>${data.employeeId || '-'}</td>
                    <td>${data.displayName || '-'}</td>
                    <td>${data.email || '-'}</td>
                    <td>${unitName}</td>
                    <td>${roleName}</td>
                    <td style="text-align:center;">${statusText}</td>
                    <td style="text-align:center;">${activeText}</td>
                    <td>
                        <button class="btn-edit" onclick="StaffManager.editData('${doc.id}')">編輯</button>
                        <button class="btn-delete" onclick="StaffManager.deleteData('${doc.id}')">刪除</button>
                        ${!data.isRegistered ? 
                            `<button class="btn-fix" onclick="StaffManager.fixAuthFirestoreSync('${data.email}')">修復同步</button>` : 
                            ''}
                    </td>
                `;
            });
        } catch (error) {
            console.error('載入員工資料失敗:', error);
            alert('載入員工資料失敗');
        }
    },

    showModal: function(data = null) {
        this.currentEditId = data ? data.id : null;
        
        document.getElementById('staffEmployeeId').value = data?.employeeId || '';
        document.getElementById('staffName').value = data?.displayName || '';
        document.getElementById('staffEmail').value = data?.email || '';
        document.getElementById('staffUnit').value = data?.unitId || '';
        document.getElementById('staffRole').value = data?.role || '';
        document.getElementById('staffActive').checked = data?.isActive !== false;
        
        document.getElementById('staffModal').style.display = 'block';
        document.getElementById('modalTitle').textContent = data ? '編輯員工' : '新增員工';
    },

    hideModal: function() {
        document.getElementById('staffModal').style.display = 'none';
        this.currentEditId = null;
    },

    saveData: async function() {
        const empId = document.getElementById('staffEmployeeId').value.trim();
        const name = document.getElementById('staffName').value.trim();
        const email = document.getElementById('staffEmail').value.trim();
        const selectedUnitId = document.getElementById('staffUnit').value;
        const selectedRole = document.getElementById('staffRole').value;
        const isActive = document.getElementById('staffActive').checked;

        // 驗證必填欄位
        if (!empId || !name || !email || !selectedUnitId || !selectedRole) {
            alert('請填寫所有必填欄位');
            return;
        }

        // 驗證 Email 格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            alert('Email 格式不正確');
            return;
        }

        try {
            const batch = this.db.batch();
            const docId = this.currentEditId;

            // === 修復 1：新增時檢查員工編號唯一性 ===
            if (!docId) {
                const empIdCheck = await this.db.collection('users')
                    .where('employeeId', '==', empId)
                    .get();
                
                if (!empIdCheck.empty) {
                    alert(`員工編號「${empId}」已存在，請使用其他編號`);
                    return;
                }
            }

            // === 修復 2：新增時檢查 Email 唯一性 ===
            if (!docId) {
                const emailCheck = await this.db.collection('users')
                    .where('email', '==', email)
                    .get();
                
                if (!emailCheck.empty) {
                    alert(`Email「${email}」已被使用，請使用其他 Email`);
                    return;
                }
            }

            const data = {
                employeeId: empId,
                displayName: name,
                email: email,
                unitId: selectedUnitId,
                role: selectedRole,
                isActive: isActive,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (docId) {
                // 編輯模式：更新現有文件
                const userRef = this.db.collection('users').doc(docId);
                batch.update(userRef, data);
            } else {
                // 新增模式：建立待開通帳號
                const userRef = this.db.collection('users').doc();
                batch.set(userRef, {
                    ...data,
                    isRegistered: false,  // 標記為未開通
                    uid: null,            // 尚無 Firebase Auth UID
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            await batch.commit();
            
            alert(docId ? '員工資料更新成功' : '員工帳號建立成功，請通知該員工前往開通頁面完成帳號開通');
            this.hideModal();
            await this.loadData();
        } catch (error) {
            console.error('儲存失敗:', error);
            
            // === 修復 3：優化錯誤訊息 ===
            if (error.code === 'permission-denied') {
                alert('權限不足：您沒有權限執行此操作');
            } else if (error.code === 'unavailable') {
                alert('網路連線異常，請檢查網路後重試');
            } else {
                alert(`儲存失敗：${error.message}`);
            }
        }
    },

    editData: async function(docId) {
        try {
            const doc = await this.db.collection('users').doc(docId).get();
            if (!doc.exists) {
                alert('找不到該員工資料');
                return;
            }
            this.showModal({ id: docId, ...doc.data() });
        } catch (error) {
            console.error('載入編輯資料失敗:', error);
            alert('載入編輯資料失敗');
        }
    },

    deleteData: async function(docId) {
        if (!confirm('確定要刪除此員工嗎？此操作無法復原。')) {
            return;
        }

        try {
            await this.db.collection('users').doc(docId).delete();
            alert('刪除成功');
            await this.loadData();
        } catch (error) {
            console.error('刪除失敗:', error);
            alert('刪除失敗：' + error.message);
        }
    },

    filterTable: function(keyword) {
        const tbody = document.getElementById('staffTableBody');
        const rows = tbody.getElementsByTagName('tr');
        const lowerKeyword = keyword.toLowerCase();

        for (let row of rows) {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(lowerKeyword) ? '' : 'none';
        }
    },

    // === 故障排查工具：修復 Auth 與 Firestore 不同步 ===
    fixAuthFirestoreSync: async function(email) {
        if (!confirm(`確定要修復 Email「${email}」的帳號同步問題嗎？\n\n此操作將：\n1. 檢查該 Email 的所有記錄\n2. 保留最新的已開通記錄\n3. 刪除重複或未開通的舊記錄`)) {
            return;
        }

        try {
            // 1. 查詢所有相同 Email 的 Firestore 記錄
            const firestoreSnapshot = await this.db.collection('users')
                .where('email', '==', email)
                .get();

            if (firestoreSnapshot.empty) {
                alert('找不到該 Email 的任何記錄');
                return;
            }

            // 2. 檢查 Firebase Auth 是否有該帳號
            let authUid = null;
            try {
                const authUser = await firebase.auth().fetchSignInMethodsForEmail(email);
                if (authUser && authUser.length > 0) {
                    // Email 已在 Auth 中註冊，取得 UID
                    const currentUser = firebase.auth().currentUser;
                    if (currentUser && currentUser.email === email) {
                        authUid = currentUser.uid;
                    }
                }
            } catch (authError) {
                console.log('Auth 查詢結果：該 Email 尚未在 Firebase Auth 註冊');
            }

            // 3. 整理所有記錄
            const allRecords = [];
            firestoreSnapshot.forEach(doc => {
                allRecords.push({
                    id: doc.id,
                    data: doc.data()
                });
            });

            console.log(`找到 ${allRecords.length} 筆記錄：`, allRecords);

            // 4. 尋找正確的記錄（已開通且 UID 匹配）
            let correctRecord = null;
            if (authUid) {
                correctRecord = allRecords.find(r => 
                    r.data.isRegistered && r.data.uid === authUid
                );
            }

            // 5. 如果沒有正確記錄，選擇最新的已開通記錄
            if (!correctRecord) {
                const registeredRecords = allRecords
                    .filter(r => r.data.isRegistered)
                    .sort((a, b) => {
                        const timeA = a.data.activatedAt?.toMillis() || 0;
                        const timeB = b.data.activatedAt?.toMillis() || 0;
                        return timeB - timeA;
                    });
                
                correctRecord = registeredRecords[0];
            }

            // 6. 刪除重複記錄
            const batch = this.db.batch();
            let deletedCount = 0;

            for (const record of allRecords) {
                if (record.id !== correctRecord?.id) {
                    batch.delete(this.db.collection('users').doc(record.id));
                    deletedCount++;
                    console.log(`準備刪除記錄：${record.id}`, record.data);
                }
            }

            if (deletedCount > 0) {
                await batch.commit();
                alert(`修復完成！\n- 保留記錄：${correctRecord?.id}\n- 刪除記錄：${deletedCount} 筆`);
            } else {
                alert('該帳號沒有需要修復的問題');
            }

            await this.loadData();
        } catch (error) {
            console.error('修復同步失敗:', error);
            alert(`修復失敗：${error.message}`);
        }
    }
};

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', () => {
    StaffManager.init();
});
