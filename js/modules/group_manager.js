// js/modules/group_manager.js

const groupManager = {
    currentUnitId: null,
    currentGroups: [],   
    unitStaff: [],
    // [排序狀態]
    groupSortOrder: 'asc',
    staffSortState: { field: 'employeeId', order: 'asc' },

    // --- 初始化 ---
    init: async function() {
        console.log("Group Manager Loaded.");
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = '<h3 style="color:red; padding:20px;">權限不足</h3>';
            return;
        }
        await this.loadUnitDropdown();
    },

    // --- 1. 載入單位下拉選單 ---
    loadUnitDropdown: async function() {
        const select = document.getElementById('filterGroupUnit');
        select.innerHTML = '<option value="">(無)</option>';

        try {
            let query = db.collection('units');
            if (app.userRole === 'unit_manager' || app.userRole === 'unit_scheduler') {
                if(app.userUnitId) {
                    query = query.where(firebase.firestore.FieldPath.documentId(), '==', app.userUnitId);
                }
            }

            const snapshot = await query.get();
            snapshot.forEach(doc => {
                const u = doc.data();
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = u.name;
                select.appendChild(option);
            });

            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadData();
            }

            select.onchange = () => this.loadData();

        } catch (e) { console.error("Load Units Error:", e); }
    },

    // --- 2. 載入資料 ---
    loadData: async function() {
        const unitId = document.getElementById('filterGroupUnit').value;
        this.currentUnitId = unitId;

        const mainArea = document.getElementById('groupMainArea');
        const emptyState = document.getElementById('groupEmptyState');

        if (!unitId) {
            mainArea.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        mainArea.style.display = 'flex';
        emptyState.style.display = 'none';

        document.getElementById('groupListBody').innerHTML = '<tr><td colspan="2">載入中...</td></tr>';
        document.getElementById('staffListBody').innerHTML = '<tr><td colspan="4">載入中...</td></tr>';

        try {
            const unitDoc = await db.collection('units').doc(unitId).get();
            this.currentGroups = unitDoc.exists ? (unitDoc.data().groups || []) : [];

            const userSnapshot = await db.collection('users')
                .where('unitId', '==', unitId)
                .where('isActive', '==', true).get();
            
            this.unitStaff = userSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 初始排序渲染
            this.sortGroups(true);
            this.sortStaff('employeeId', true);

        } catch (e) {
            console.error("Load Data Error:", e);
            alert("資料載入失敗: " + e.message);
        }
    },

    // --- [新增] 左側組別排序 ---
    sortGroups: function(forceRender = false) {
        if (!forceRender) {
            this.groupSortOrder = this.groupSortOrder === 'asc' ? 'desc' : 'asc';
        }
        
        this.currentGroups.sort((a, b) => {
            return this.groupSortOrder === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
        });
        
        const icon = document.getElementById('sort_icon_group_list');
        if(icon) icon.className = this.groupSortOrder === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        
        this.renderGroupList();
    },

    renderGroupList: function() {
        const tbody = document.getElementById('groupListBody');
        tbody.innerHTML = '';

        if (this.currentGroups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#999; padding:20px;">尚無組別</td></tr>';
            return;
        }

        this.currentGroups.forEach((code, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:10px; font-weight:bold;">${code}</td>
                <td style="text-align:center;">
                    <button class="btn btn-edit" style="padding:2px 6px; font-size:0.8rem;" onclick="groupManager.editGroup(${index})">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-delete" style="padding:2px 6px; font-size:0.8rem;" onclick="groupManager.deleteGroup(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // --- [新增] 右側人員排序 ---
    sortStaff: function(field, forceRender = false) {
        if (!forceRender) {
            if (this.staffSortState.field === field) {
                this.staffSortState.order = this.staffSortState.order === 'asc' ? 'desc' : 'asc';
            } else {
                this.staffSortState.field = field;
                this.staffSortState.order = 'asc';
            }
        }

        const { field: f, order: o } = this.staffSortState;
        
        this.unitStaff.sort((a, b) => {
            let valA = a[f] || '';
            let valB = b[f] || '';
            if(typeof valA === 'string') valA = valA.toLowerCase();
            if(typeof valB === 'string') valB = valB.toLowerCase();
            if (valA < valB) return o === 'asc' ? -1 : 1;
            if (valA > valB) return o === 'asc' ? 1 : -1;
            return 0;
        });

        document.querySelectorAll('th i[id^="sort_icon_group_staff_"]').forEach(i => i.className = 'fas fa-sort');
        const icon = document.getElementById(`sort_icon_group_staff_${f}`);
        if(icon) icon.className = o === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';

        this.renderStaffList();
    },

    renderStaffList: function() {
        const tbody = document.getElementById('staffListBody');
        tbody.innerHTML = '';

        if (this.unitStaff.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">此單位尚無人員</td></tr>';
            return;
        }

        let optionsHtml = '<option value="">(未分組)</option>';
        this.currentGroups.forEach(g => {
            optionsHtml += `<option value="${g}">${g}</option>`;
        });

        this.unitStaff.forEach(u => {
            const currentGroup = u.groupId || '';
            let rowOptions = optionsHtml.replace(
                `value="${currentGroup}"`, 
                `value="${currentGroup}" selected`
            );

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:10px;">${u.employeeId || ''}</td>
                <td>${u.displayName || ''}</td>
                <td><span class="badge" style="background:#eee; color:#333;">${u.level || 'N'}</span></td>
                <td>
                    <select class="staff-group-select" data-uid="${u.id}" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px;">
                        ${rowOptions}
                    </select>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // --- 3. 組別操作邏輯 ---
    addGroup: async function() {
        const input = document.getElementById('inputNewGroupCode');
        const code = input.value.trim();
        if (!code) return;
        if (this.currentGroups.includes(code)) { alert("組別代號重複"); return; }

        this.currentGroups.push(code);
        await this.updateUnitGroupsDB();
        input.value = ''; 
        // 重新排序並渲染
        this.sortGroups(true);
        this.renderStaffList();
    },

    editGroup: async function(index) {
        const oldCode = this.currentGroups[index];
        const newCode = prompt("修改組別代號:", oldCode);
        if (newCode && newCode.trim() !== "" && newCode !== oldCode) {
            if (this.currentGroups.includes(newCode)) { alert("代號已存在"); return; }
            this.currentGroups[index] = newCode.trim();
            await this.updateUnitGroupsDB();
            this.sortGroups(true);
            this.renderStaffList();
        }
    },

    deleteGroup: async function(index) {
        if (confirm(`確定刪除組別 [${this.currentGroups[index]}]？`)) {
            this.currentGroups.splice(index, 1);
            await this.updateUnitGroupsDB();
            this.sortGroups(true);
            this.renderStaffList();
        }
    },

    updateUnitGroupsDB: async function() {
        try {
            await db.collection('units').doc(this.currentUnitId).update({
                groups: this.currentGroups
            });
        } catch (e) { alert("更新組別失敗: " + e.message); }
    },

    // --- 4. 儲存分組 ---
    saveStaffAssignments: async function() {
        if (!confirm("確定要儲存所有人員的分組變更嗎？")) return;
        const selects = document.querySelectorAll('.staff-group-select');
        const batch = db.batch();
        let changeCount = 0;

        selects.forEach(sel => {
            const uid = sel.getAttribute('data-uid');
            const newGroupId = sel.value;
            const user = this.unitStaff.find(u => u.id === uid);
            if (user && user.groupId !== newGroupId) {
                const ref = db.collection('users').doc(uid);
                batch.update(ref, { groupId: newGroupId });
                user.groupId = newGroupId;
                changeCount++;
            }
        });

        if (changeCount > 0) {
            try {
                await batch.commit();
                alert(`已更新 ${changeCount} 位人員分組！`);
            } catch (e) { alert("儲存失敗: " + e.message); }
        } else {
            alert("沒有變更需要儲存。");
        }
    }
};
