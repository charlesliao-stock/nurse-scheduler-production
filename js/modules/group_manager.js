// js/modules/group_manager.js

const groupManager = {
    currentUnitId: null,
    currentGroups: [],   // 該單位的組別列表 (Array of Strings)
    unitStaff: [],       // 該單位的人員列表

    // --- 初始化 ---
    init: async function() {
        console.log("Group Manager Loaded.");
        
        // 權限檢查
        if (app.userRole === 'user') {
            document.getElementById('content-area').innerHTML = '<h3 style="color:red; padding:20px;">權限不足</h3>';
            return;
        }

        await this.loadUnitDropdown();
    },

    // --- 1. 載入單位下拉選單 ---
    loadUnitDropdown: async function() {
        const select = document.getElementById('filterGroupUnit');
        select.innerHTML = '<option value="">(無)</option>'; // 預設無

        try {
            let query = db.collection('units');
            
            // 權限過濾：如果是單位管理者，只能看到自己的單位
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

            // 如果只有一個單位，自動選中並觸發載入
            if (snapshot.size === 1) {
                select.selectedIndex = 1;
                this.loadData();
            }

            // 綁定變更事件
            select.onchange = () => this.loadData();

        } catch (e) {
            console.error("Load Units Error:", e);
        }
    },

    // --- 2. 載入資料 (組別 + 人員) ---
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

        // 顯示介面
        mainArea.style.display = 'flex';
        emptyState.style.display = 'none';

        // 顯示載入中
        document.getElementById('groupListBody').innerHTML = '<tr><td colspan="2">載入中...</td></tr>';
        document.getElementById('staffListBody').innerHTML = '<tr><td colspan="4">載入中...</td></tr>';

        try {
            // A. 載入單位資料 (取得組別)
            const unitDoc = await db.collection('units').doc(unitId).get();
            if (unitDoc.exists) {
                this.currentGroups = unitDoc.data().groups || [];
            } else {
                this.currentGroups = [];
            }

            // B. 載入該單位人員
            const userSnapshot = await db.collection('users')
                .where('unitId', '==', unitId)
                .where('isActive', '==', true)
                .get();
            
            this.unitStaff = userSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // 預設依員編排序
            this.sortStaff('id');

            // 渲染畫面
            this.renderGroupList();
            this.renderStaffList();

        } catch (e) {
            console.error("Load Data Error:", e);
            alert("資料載入失敗: " + e.message);
        }
    },

    // --- 3. 左側：組別管理邏輯 ---
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

    addGroup: async function() {
        const input = document.getElementById('inputNewGroupCode');
        const code = input.value.trim();
        
        if (!code) return;
        if (this.currentGroups.includes(code)) {
            alert("組別代號重複"); return;
        }

        this.currentGroups.push(code);
        
        // 更新資料庫
        await this.updateUnitGroupsDB();
        
        input.value = ''; // 清空
        this.renderGroupList();
        this.renderStaffList(); // 右側下拉選單也要更新
    },

    editGroup: async function(index) {
        const oldCode = this.currentGroups[index];
        const newCode = prompt("修改組別代號:", oldCode);
        
        if (newCode && newCode.trim() !== "" && newCode !== oldCode) {
            if (this.currentGroups.includes(newCode)) {
                alert("代號已存在"); return;
            }
            this.currentGroups[index] = newCode.trim();
            await this.updateUnitGroupsDB();
            
            this.renderGroupList();
            this.renderStaffList();
        }
    },

    deleteGroup: async function(index) {
        if (confirm(`確定刪除組別 [${this.currentGroups[index]}]？`)) {
            this.currentGroups.splice(index, 1);
            await this.updateUnitGroupsDB();
            
            this.renderGroupList();
            this.renderStaffList();
        }
    },

    updateUnitGroupsDB: async function() {
        try {
            await db.collection('units').doc(this.currentUnitId).update({
                groups: this.currentGroups
            });
        } catch (e) {
            alert("更新組別失敗: " + e.message);
        }
    },

    // --- 4. 右側：人員列表邏輯 ---
    renderStaffList: function() {
        const tbody = document.getElementById('staffListBody');
        tbody.innerHTML = '';

        if (this.unitStaff.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">此單位尚無人員</td></tr>';
            return;
        }

        // 產生組別下拉選單的 HTML 選項
        let optionsHtml = '<option value="">(未分組)</option>';
        this.currentGroups.forEach(g => {
            optionsHtml += `<option value="${g}">${g}</option>`;
        });

        this.unitStaff.forEach(u => {
            // 找出該 User 目前的組別，產生 selected
            const currentGroup = u.groupId || '';
            
            // 這裡動態產生 select，並預選 currentGroup
            // 注意：我們需要重新組合 optionsHtml 把 selected 加進去
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

    // 排序功能
    sortStaff: function(key) {
        this.unitStaff.sort((a, b) => {
            if (key === 'id') {
                const idA = a.employeeId || '';
                const idB = b.employeeId || '';
                return idA.localeCompare(idB);
            }
            return 0;
        });
        this.renderStaffList();
    },

    // 儲存分組變更
    saveStaffAssignments: async function() {
        if (!confirm("確定要儲存所有人員的分組變更嗎？")) return;

        const selects = document.querySelectorAll('.staff-group-select');
        const batch = db.batch();
        let changeCount = 0;

        selects.forEach(sel => {
            const uid = sel.getAttribute('data-uid');
            const newGroupId = sel.value;
            
            // 比對原始資料，有變更才更新
            const user = this.unitStaff.find(u => u.id === uid);
            if (user && user.groupId !== newGroupId) {
                const ref = db.collection('users').doc(uid);
                batch.update(ref, { groupId: newGroupId });
                
                // 更新本地快取，避免重複儲存
                user.groupId = newGroupId;
                changeCount++;
            }
        });

        if (changeCount > 0) {
            try {
                await batch.commit();
                alert(`成功更新 ${changeCount} 位人員的分組！`);
            } catch (e) {
                alert("儲存失敗: " + e.message);
            }
        } else {
            alert("沒有變更需要儲存。");
        }
    }
};
