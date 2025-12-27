// js/modules/group_manager.js (完整版)

const groupManager = {
    currentUnitId: null,
    currentUnitData: null,
    staffList: [],
    staffSortState: { field: 'employeeId', order: 'asc' },
    groupSortOrder: 'asc',
    isLoading: false,

    // --- 初始化 ---
    init: async function() {
        console.log("Group Manager Loaded.");
        
        // 權限檢查
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>權限不足</h3>
                    <p>一般使用者無法管理組別設定</p>
                </div>
            `;
            return;
        }

        await this.loadUnitDropdown();
    },

    // --- 1. 載入單位下拉選單 ---
    loadUnitDropdown: async function() {
        const select = document.getElementById('filterGroupUnit');
        if(!select) return;

        select.innerHTML = '<option value="">載入中...</option>';

        try {
            let query = db.collection('units');
            
            // 權限過濾
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }

            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            
            snapshot.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = doc.data().name;
                select.appendChild(option);
            });

            // 如果只有一個單位,自動選擇
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.onUnitChange();
            }

            select.onchange = () => this.onUnitChange();
            
        } catch (e) {
            console.error("Load Units Error:", e);
            select.innerHTML = '<option value="">載入失敗</option>';
        }
    },

    // --- 2. 單位切換 ---
    onUnitChange: async function() {
        const unitId = document.getElementById('filterGroupUnit').value;
        
        if (!unitId) {
            this.showEmptyState();
            return;
        }

        this.currentUnitId = unitId;
        document.getElementById('groupEmptyState').style.display = 'none';
        document.getElementById('groupMainArea').style.display = 'flex';

        await this.loadUnitData();
        await this.loadStaffList();
    },

    showEmptyState: function() {
        this.currentUnitId = null;
        document.getElementById('groupMainArea').style.display = 'none';
        document.getElementById('groupEmptyState').style.display = 'block';
    },

    // --- 3. 載入單位資料 ---
    loadUnitData: async function() {
        try {
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            if (!doc.exists) {
                alert("找不到單位資料");
                this.showEmptyState();
                return;
            }

            this.currentUnitData = doc.data();
            this.renderGroupList();
            
        } catch (e) {
            console.error("Load Unit Data Error:", e);
            alert("載入單位資料失敗: " + e.message);
        }
    },

    // --- 4. 渲染組別列表 ---
    renderGroupList: function() {
        const tbody = document.getElementById('groupListBody');
        if(!tbody) return;

        tbody.innerHTML = '';

        const groups = this.currentUnitData.groups || [];

        if (groups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:20px; color:#999;">尚無組別,請在上方輸入框新增</td></tr>';
            return;
        }

        // 排序
        const sortedGroups = [...groups].sort((a, b) => {
            if (this.groupSortOrder === 'asc') {
                return a.localeCompare(b);
            } else {
                return b.localeCompare(a);
            }
        });

        // 更新圖示
        const icon = document.getElementById('sort_icon_group_list');
        if(icon) {
            icon.className = this.groupSortOrder === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        }

        sortedGroups.forEach(g => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${g}</strong></td>
                <td style="text-align:center;">
                    <button class="btn btn-delete" style="padding:3px 8px; font-size:12px;" onclick="groupManager.deleteGroup('${g}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    sortGroups: function() {
        this.groupSortOrder = this.groupSortOrder === 'asc' ? 'desc' : 'asc';
        this.renderGroupList();
    },

    // --- 5. 新增組別 ---
    addGroup: async function() {
        const input = document.getElementById('inputNewGroupCode');
        if(!input) return;

        const newGroup = input.value.trim().toUpperCase();

        if (!newGroup) {
            alert("請輸入組別代號");
            input.focus();
            return;
        }

        // 檢查長度
        if (newGroup.length > 10) {
            alert("組別代號不可超過10個字元");
            input.focus();
            return;
        }

        const groups = this.currentUnitData.groups || [];

        // 檢查重複
        if (groups.includes(newGroup)) {
            alert("此組別已存在！");
            input.focus();
            return;
        }

        try {
            groups.push(newGroup);
            
            await db.collection('units').doc(this.currentUnitId).update({
                groups: groups,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            input.value = '';
            this.currentUnitData.groups = groups;
            this.renderGroupList();
            
            console.log(`新增組別: ${newGroup}`);
            
        } catch (e) {
            console.error("Add Group Error:", e);
            alert("新增失敗: " + e.message);
        }
    },

    // --- 6. 刪除組別 ---
    deleteGroup: async function(groupName) {
        // 檢查是否有人員使用此組別
        const usedCount = this.staffList.filter(s => s.groupId === groupName).length;
        
        let confirmMsg = `確定要刪除組別「${groupName}」嗎？`;
        if (usedCount > 0) {
            confirmMsg += `\n\n注意：目前有 ${usedCount} 位人員屬於此組別,刪除後他們將失去組別歸屬。`;
        }

        if (!confirm(confirmMsg)) return;

        try {
            let groups = this.currentUnitData.groups || [];
            groups = groups.filter(g => g !== groupName);

            await db.collection('units').doc(this.currentUnitId).update({
                groups: groups,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            this.currentUnitData.groups = groups;
            this.renderGroupList();
            
            // 如果有人員使用此組別,清空他們的組別
            if (usedCount > 0) {
                await this.loadStaffList(); // 重新載入人員列表
            }
            
            console.log(`刪除組別: ${groupName}`);
            
        } catch (e) {
            console.error("Delete Group Error:", e);
            alert("刪除失敗: " + e.message);
        }
    },

    // --- 7. 載入人員列表 ---
    loadStaffList: async function() {
        if(this.isLoading) return;
        this.isLoading = true;

        try {
            const snapshot = await db.collection('users')
                .where('unitId', '==', this.currentUnitId)
                .where('isActive', '==', true)
                .get();

            this.staffList = snapshot.docs.map(doc => ({
                uid: doc.id,
                ...doc.data()
            }));

            console.log(`載入 ${this.staffList.length} 位人員`);
            this.renderStaffList();
            
        } catch (e) {
            console.error("Load Staff Error:", e);
            alert("載入人員失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    // --- 8. 渲染人員列表 ---
    renderStaffList: function() {
        const tbody = document.getElementById('staffListBody');
        if(!tbody) return;

        tbody.innerHTML = '';

        if (this.staffList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:#999;">此單位目前沒有人員<br>請至「人員管理」新增</td></tr>';
            return;
        }

        // 更新排序圖示
        document.querySelectorAll('th i[id^="sort_icon_group_staff_"]').forEach(i => {
            i.className = 'fas fa-sort';
        });
        const activeIcon = document.getElementById(`sort_icon_group_staff_${this.staffSortState.field}`);
        if(activeIcon) {
            activeIcon.className = this.staffSortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        }

        // 排序
        const { field, order } = this.staffSortState;
        const sorted = [...this.staffList].sort((a, b) => {
            let valA = a[field] || '';
            let valB = b[field] || '';

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        // 渲染
        const groups = this.currentUnitData.groups || [];
        
        sorted.forEach(staff => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${staff.employeeId || '-'}</td>
                <td>${staff.displayName || '-'}</td>
                <td>${staff.level || '-'}</td>
                <td>
                    <select class="form-control" style="padding:4px 8px; border:1px solid #ccc; border-radius:3px;" 
                            onchange="groupManager.updateStaffGroup('${staff.uid}', this.value)">
                        <option value="">(未分組)</option>
                        ${groups.map(g => `<option value="${g}" ${staff.groupId === g ? 'selected' : ''}>${g}</option>`).join('')}
                    </select>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    sortStaff: function(field) {
        if (this.staffSortState.field === field) {
            this.staffSortState.order = this.staffSortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.staffSortState.field = field;
            this.staffSortState.order = 'asc';
        }
        this.renderStaffList();
    },

    // --- 9. 更新人員組別 (即時儲存) ---
    updateStaffGroup: async function(uid, groupId) {
        try {
            await db.collection('users').doc(uid).update({
                groupId: groupId || '',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // 更新本地資料
            const staff = this.staffList.find(s => s.uid === uid);
            if(staff) {
                staff.groupId = groupId;
            }

            console.log(`更新人員 ${uid} 組別: ${groupId || '(空)'}`);
            
        } catch (e) {
            console.error("Update Staff Group Error:", e);
            alert("更新失敗: " + e.message);
            await this.loadStaffList(); // 重新載入
        }
    },

    // --- 10. 批次儲存 (備用方案) ---
    saveStaffAssignments: async function() {
        if(!confirm("確定要儲存所有人員的組別設定嗎？")) {
            return;
        }

        try {
            const batch = db.batch();
            let count = 0;

            this.staffList.forEach(staff => {
                const userRef = db.collection('users').doc(staff.uid);
                batch.update(userRef, {
                    groupId: staff.groupId || '',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                count++;
            });

            await batch.commit();
            alert(`成功儲存 ${count} 位人員的組別設定！`);
            
        } catch (e) {
            console.error("Save Assignments Error:", e);
            alert("儲存失敗: " + e.message);
        }
    }
};
