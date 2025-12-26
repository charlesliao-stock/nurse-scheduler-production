// js/modules/unit_manager.js

const unitManager = {
    allUnits: [],
    allUsers: [],
    currentUnitId: null,      // 當前編輯的 Unit ID
    currentUnitGroups: [],    // 當前單位的組別列表 (暫存)
    currentUnitStaff: [],     // 當前單位的人員列表

    // --- 初始化 ---
    init: async function() {
        console.log("Unit Manager Module Loaded.");
        const searchInput = document.getElementById('searchUnitInput');
        if(searchInput) searchInput.oninput = () => this.renderTable();

        // 權限按鈕控制
        const btnAdd = document.getElementById('btnAddUnit');
        const btnImport = document.getElementById('btnImportUnit');
        if (app.userRole !== 'system_admin') {
            if(btnAdd) btnAdd.style.display = 'none';
            if(btnImport) btnImport.style.display = 'none';
        }

        await this.fetchAllUsers(); 
        await this.fetchUnits();    
    },

    // --- 1. 取得人員與單位 ---
    fetchAllUsers: async function() {
        try {
            // 需要 groupId 欄位來顯示目前的組別
            const snapshot = await db.collection('users').where('isActive', '==', true).get();
            this.allUsers = snapshot.docs.map(doc => ({
                uid: doc.id, 
                name: doc.data().displayName || '未命名',
                empId: doc.data().employeeId || '',
                unitId: doc.data().unitId || '',
                groupId: doc.data().groupId || '' // [新增]
            }));
        } catch (e) {
            console.error("User fetch error:", e);
        }
    },

    fetchUnits: async function() {
        try {
            const snapshot = await db.collection('units').get();
            this.allUnits = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                groups: doc.data().groups || [] // 確保有 groups 陣列
            }));
            this.renderTable();
        } catch (e) {
            console.error("Unit fetch error:", e);
        }
    },

    // --- 2. 渲染主列表 ---
    renderTable: function() {
        const tbody = document.getElementById('unitTableBody');
        tbody.innerHTML = '';
        const searchTerm = (document.getElementById('searchUnitInput').value || '').toLowerCase();
        
        const filtered = this.allUnits.filter(u => 
            u.id.toLowerCase().includes(searchTerm) || (u.name && u.name.toLowerCase().includes(searchTerm))
        );

        if(filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">無符合資料</td></tr>';
            return;
        }

        filtered.forEach(u => {
            const managerNames = this.getNamesFromIds(u.managers);
            const schedulerNames = this.getNamesFromIds(u.schedulers);
            
            let deleteBtn = app.userRole === 'system_admin' ? 
                `<button class="btn btn-delete" onclick="unitManager.deleteUnit('${u.id}')">刪除</button>` : 
                `<button class="btn btn-delete" disabled style="opacity:0.3; cursor:not-allowed;">刪除</button>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.id}</td>
                <td>${u.name}</td>
                <td>${managerNames}</td>
                <td>${schedulerNames}</td>
                <td>
                    <button class="btn btn-edit" onclick="unitManager.openModal('${u.id}')">編輯</button>
                    ${deleteBtn}
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    getNamesFromIds: function(idArray) {
        if (!idArray || !Array.isArray(idArray) || idArray.length === 0) return '<span style="color:#ccc;">(未設定)</span>';
        return idArray.map(uid => {
            const user = this.allUsers.find(p => p.uid === uid);
            return user ? `<span class="badge" style="background:#eee; color:#333; margin-right:3px;">${user.name}</span>` : '';
        }).join(' ');
    },

    // --- 3. Modal 操作與頁籤 ---
    
    switchTab: function(tabName) {
        // 切換按鈕樣式
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        event.currentTarget.classList.add('active');

        // 切換內容顯示
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');

        // 控制底部儲存按鈕顯示 (只有 Info 分頁需要底部的儲存，Group 分頁有自己的儲存)
        const mainSaveBtn = document.getElementById('btnSaveUnitInfo');
        if (tabName === 'info') {
            mainSaveBtn.style.display = 'inline-block';
        } else {
            mainSaveBtn.style.display = 'none';
            // 切換到 Group 頁籤時，重新渲染一次右側人員列表(確保組別下拉選單是最新的)
            this.renderGroupStaffList();
        }
    },

    openModal: function(unitId = null) {
        const modal = document.getElementById('unitModal');
        modal.classList.add('show');
        this.currentUnitId = unitId;

        // 重置頁籤到第一頁
        document.querySelector('.tab-btn').click(); // 模擬點擊第一個 tab

        const isAdmin = (app.userRole === 'system_admin');
        const inputId = document.getElementById('inputUnitId');
        const inputName = document.getElementById('inputUnitName');
        const managerContainer = document.getElementById('containerManagerAuth'); // 單位管理者區塊
        const schedulerContainer = document.getElementById('containerSchedulerAuth'); // 排班人員區塊

        // 權限控制：鎖定與隱藏
        if (isAdmin) {
            managerContainer.style.pointerEvents = 'auto';
            managerContainer.style.opacity = '1';
        } else {
            // 非 Admin (即 Unit Manager) 不能改單位管理者，只能看
            managerContainer.style.pointerEvents = 'none'; // 禁止點擊 Checkbox
            managerContainer.style.opacity = '0.6';
        }
        // 排班人員大家都能改 (Admin & Unit Manager)
        schedulerContainer.style.pointerEvents = 'auto';
        schedulerContainer.style.opacity = '1';

        if(unitId) {
            // [編輯模式]
            document.getElementById('currentMode').value = 'edit';
            const unit = this.allUnits.find(u => u.id === unitId);
            
            if(unit) {
                document.getElementById('originalUnitId').value = unit.id;
                
                // Info Tab
                inputId.value = unit.id;
                inputId.disabled = true; // ID 永遠不能改
                
                inputName.value = unit.name;
                inputName.disabled = !isAdmin; // 只有 Admin 能改名

                // 渲染人員勾選
                this.renderUserCheckboxes('managerListContainer', 'chk_mgr_', unit.id);
                this.renderUserCheckboxes('schedulerListContainer', 'chk_sch_', unit.id);
                this.checkUsers('chk_mgr_', unit.managers);
                this.checkUsers('chk_sch_', unit.schedulers);

                // Group Tab 初始化
                this.currentUnitGroups = [...(unit.groups || [])]; // 複製一份
                this.renderGroupList();
                this.renderGroupStaffList();
            }
        } else {
            // [新增模式] (限 Admin)
            document.getElementById('currentMode').value = 'add';
            document.getElementById('originalUnitId').value = '';
            
            inputId.value = '';
            inputId.disabled = false;
            
            inputName.value = '';
            inputName.disabled = false;

            this.renderUserCheckboxes('managerListContainer', 'chk_mgr_', 'NEW_UNIT');
            this.renderUserCheckboxes('schedulerListContainer', 'chk_sch_', 'NEW_UNIT');

            this.currentUnitGroups = [];
            this.renderGroupList();
            document.getElementById('groupStaffListArea').innerHTML = '<div style="padding:10px; color:#666;">請先儲存單位後，再進行人員分組。</div>';
        }
    },

    closeModal: function() {
        document.getElementById('unitModal').classList.remove('show');
    },

    // --- Tab 1 邏輯: 渲染勾選清單 (修正為靠左、一人一行) ---
    renderUserCheckboxes: function(containerId, prefix, targetUnitId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        const validUsers = this.allUsers.filter(u => u.unitId === targetUnitId);

        if (validUsers.length === 0) {
            const msg = targetUnitId === 'NEW_UNIT' ? "請先建立單位" : "此單位尚無人員";
            container.innerHTML = `<div style="color:#666; padding:10px; text-align:center;">${msg}</div>`;
            return;
        }

        validUsers.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-checkbox-item'; // 使用 CSS class
            
            div.innerHTML = `
                <label>
                    <input type="checkbox" id="${prefix}${user.uid}" value="${user.uid}">
                    <div>
                        <span style="font-weight:bold; color:#333;">${user.name}</span> 
                        <span style="color:#888; font-size:0.85rem; margin-left:5px;">(${user.empId})</span>
                    </div>
                </label>
            `;
            container.appendChild(div);
        });
    },

    checkUsers: function(prefix, idArray) {
        if(!idArray) return;
        idArray.forEach(uid => {
            const el = document.getElementById(prefix + uid);
            if(el) el.checked = true;
        });
    },

    filterUserList: function(type) {
        const inputId = type === 'manager' ? 'searchManagerInput' : 'searchSchedulerInput';
        const containerId = type === 'manager' ? 'managerListContainer' : 'schedulerListContainer';
        const keyword = document.getElementById(inputId).value.toLowerCase();
        const container = document.getElementById(containerId);
        const items = container.querySelectorAll('.user-checkbox-item');
        items.forEach(item => {
            const text = item.innerText.toLowerCase();
            item.style.display = text.includes(keyword) ? 'flex' : 'none'; // 保持 flex 佈局
        });
    },

    // --- Tab 1 儲存邏輯 ---
    saveUnitInfo: async function() {
        const mode = document.getElementById('currentMode').value;
        const inputId = document.getElementById('inputUnitId');
        const inputName = document.getElementById('inputUnitName');
        const unitId = inputId.value.trim();
        const unitName = inputName.value.trim();

        if(!unitId || !unitName) { alert("代碼與名稱為必填"); return; }

        const managers = this.getCheckedValues('managerListContainer');
        const schedulers = this.getCheckedValues('schedulerListContainer');

        const data = {
            name: unitName,
            // 如果是非 Admin，managers 不會被修改 (disabled)，但為了安全，後端會擋，前端這裡
            // 如果是 Admin，直接存；如果不是 Admin，應該保留原來的 managers
            // 簡化做法：因為非 Admin 的 checkbox 被 pointer-events: none，所以讀取到的還是原來的值(如果 openModal 有勾的話)
            // 但如果 openModal 沒渲染出來(例如 new unit)，就會是空。
            // 這裡直接存即可，因為我們在 UI 層擋住了操作。
            managers: managers,
            schedulers: schedulers,
            // groups 這裡不更新，由 Tab 2 專門處理，但為了怕覆蓋，應該 merge
            // 使用 { merge: true } 或只 update 指定欄位
        };
        
        // 為了避免覆蓋 groups，我們分開處理
        // 但這裡我們使用 set(data, {merge:true}) 或是 update
        
        try {
            if (mode === 'edit') {
                // 編輯模式：只更新基本資料與權限
                await db.collection('units').doc(unitId).update(data);
            } else {
                // 新增模式
                if (app.userRole !== 'system_admin') { alert("權限不足"); return; }
                const check = await db.collection('units').doc(unitId).get();
                if(check.exists) { alert("代碼重複"); return; }
                
                // 新增時初始化 groups 為空
                data.groups = [];
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('units').doc(unitId).set(data);
            }
            alert("單位資訊儲存成功！");
            if(mode === 'add') { this.closeModal(); } // 新增完關閉，編輯則停留
            this.fetchUnits();
        } catch (e) {
            alert("儲存失敗: " + e.message);
        }
    },

    getCheckedValues: function(containerId) {
        const container = document.getElementById(containerId);
        const checked = container.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checked).map(cb => cb.value);
    },

    // --- Tab 2 邏輯: 組別管理 ---

    renderGroupList: function() {
        const container = document.getElementById('groupListArea');
        container.innerHTML = '';
        
        this.currentUnitGroups.forEach((groupName, index) => {
            const div = document.createElement('div');
            div.className = 'group-list-item';
            div.innerHTML = `
                <span style="font-weight:bold;">${groupName}</span>
                <div>
                    <button class="btn btn-edit" style="padding:2px 5px; font-size:0.8rem;" onclick="unitManager.editGroup(${index})">編輯</button>
                    <button class="btn btn-delete" style="padding:2px 5px; font-size:0.8rem;" onclick="unitManager.deleteGroup(${index})">刪除</button>
                </div>
            `;
            container.appendChild(div);
        });
    },

    addGroup: async function() {
        if(!this.currentUnitId) return;
        const input = document.getElementById('inputNewGroup');
        const name = input.value.trim();
        if(!name) return;
        
        if(this.currentUnitGroups.includes(name)) {
            alert("組別名稱重複"); return;
        }

        this.currentUnitGroups.push(name);
        input.value = ''; // 清空輸入框
        this.renderGroupList();
        this.renderGroupStaffList(); // 更新下拉選單

        // 即時儲存組別設定到 Units 集合
        await this.updateUnitGroupsDB();
    },

    editGroup: async function(index) {
        const oldName = this.currentUnitGroups[index];
        const newName = prompt("請輸入新組別名稱:", oldName);
        if(newName && newName.trim() !== "" && newName !== oldName) {
            this.currentUnitGroups[index] = newName.trim();
            this.renderGroupList();
            this.renderGroupStaffList();
            await this.updateUnitGroupsDB();
        }
    },

    deleteGroup: async function(index) {
        if(confirm("確定刪除此組別？")) {
            this.currentUnitGroups.splice(index, 1);
            this.renderGroupList();
            this.renderGroupStaffList();
            await this.updateUnitGroupsDB();
        }
    },

    updateUnitGroupsDB: async function() {
        try {
            await db.collection('units').doc(this.currentUnitId).update({
                groups: this.currentUnitGroups
            });
            // 不用 alert，默默存就好，體驗較好
        } catch(e) {
            alert("組別設定儲存失敗: " + e.message);
        }
    },

    // --- Tab 2 邏輯: 人員組別指派 ---

    renderGroupStaffList: function() {
        const container = document.getElementById('tableGroupStaff');
        container.innerHTML = '';
        
        // 找出屬於該單位的人員
        const unitStaff = this.allUsers.filter(u => u.unitId === this.currentUnitId);
        
        if(unitStaff.length === 0) {
            container.innerHTML = '<tr><td colspan="2" style="padding:10px; text-align:center; color:#999;">此單位尚無人員</td></tr>';
            return;
        }

        // 產生組別下拉選單的 HTML 字串
        let optionsHtml = '<option value="">(未分組)</option>';
        this.currentUnitGroups.forEach(g => {
            optionsHtml += `<option value="${g}">${g}</option>`;
        });

        unitStaff.forEach(user => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #eee';
            
            // 下拉選單預設選中該人員目前的 groupId
            // 注意：這裡我們暫時用 "組別名稱" 當作 ID，如果系統複雜建議用 ID
            const selectedAttr = (gName) => (user.groupId === gName ? 'selected' : '');
            
            // 重新產生帶有 selected 的 options
            let rowOptions = '<option value="">(未分組)</option>';
            this.currentUnitGroups.forEach(g => {
                rowOptions += `<option value="${g}" ${selectedAttr(g)}>${g}</option>`;
            });

            tr.innerHTML = `
                <td style="padding:8px;">${user.name} <span style="color:#999; font-size:0.8rem;">(${user.empId})</span></td>
                <td style="padding:8px;">
                    <select class="group-select" data-uid="${user.uid}" style="width:100%; padding:5px; border-radius:4px; border:1px solid #ddd;">
                        ${rowOptions}
                    </select>
                </td>
            `;
            container.appendChild(tr);
        });
    },

    saveUserGroups: async function() {
        if(!confirm("確定要更新所有人員的組別設定嗎？")) return;

        const selects = document.querySelectorAll('.group-select');
        const batch = db.batch();
        let updateCount = 0;

        selects.forEach(select => {
            const uid = select.getAttribute('data-uid');
            const newGroup = select.value;
            
            // 找出該 user 目前的 group，如果不同才更新
            const user = this.allUsers.find(u => u.uid === uid);
            if(user && user.groupId !== newGroup) {
                const ref = db.collection('users').doc(uid);
                batch.update(ref, { groupId: newGroup });
                // 同步更新本地快取，以免沒重整頁面前顯示舊的
                user.groupId = newGroup; 
                updateCount++;
            }
        });

        if(updateCount > 0) {
            try {
                await batch.commit();
                alert(`成功更新 ${updateCount} 位人員的組別！`);
            } catch(e) {
                alert("更新失敗: " + e.message);
            }
        } else {
            alert("沒有變更需要儲存。");
        }
    },

    // --- 其他 ---
    deleteUnit: async function(id) {
        if(app.userRole !== 'system_admin') { alert("權限不足"); return; }
        if(confirm(`確定刪除單位 ${id}？`)) {
            await db.collection('units').doc(id).delete();
            this.fetchUnits();
        }
    },
    
    // 匯入相關維持不變
    openImportModal: function() { unitManager.openImportModal_impl(); }, // 轉送
    openImportModal_impl: function() {
        if (app.userRole !== 'system_admin') return;
        document.getElementById('unitImportModal').classList.add('show');
        document.getElementById('csvUnitFile').value = '';
        document.getElementById('unitImportResult').innerHTML = '';
    },
    closeImportModal: function() { document.getElementById('unitImportModal').classList.remove('show'); },
    downloadTemplate: function() {
        const content = "\uFEFF單位代碼,單位名稱\nICU01,內科加護病房";
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], {type:'text/csv;charset=utf-8;'}));
        link.download = "單位匯入範例.csv";
        link.click();
    },
    processImport: function() {
        // ... (內容與之前相同，略以節省篇幅) ...
        const file = document.getElementById('csvUnitFile').files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async(e) => {
            const rows = e.target.result.split(/\r\n|\n/);
            const batch = db.batch();
            let c=0;
            for(let i=1; i<rows.length; i++){
                const cols = rows[i].split(',');
                if(cols.length>=2 && cols[0].trim()){
                    batch.set(db.collection('units').doc(cols[0].trim()), {
                        name: cols[1].trim(), managers:[], schedulers:[], groups:[],
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    c++;
                }
            }
            if(c>0) { await batch.commit(); alert("匯入成功"); this.closeImportModal(); this.fetchUnits(); }
        };
        reader.readAsText(file);
    }
};
