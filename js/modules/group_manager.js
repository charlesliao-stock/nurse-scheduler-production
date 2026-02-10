// js/modules/group_manager.js

const groupManager = {
    currentUnitId: null,
    currentUnitData: null,
    staffList: [],
    staffSortState: { field: 'employeeId', order: 'asc' },
    isLoading: false,

    // 預設資料結構 (避免 undefined 錯誤)
    defaultConfig: {
        clusters: [], // { id, name }
        groups: [],   // { id, name, clusterId }
        tiers: []     // string (e.g., "N0", "N1")
    },

    // --- 初始化 ---
    init: async function() {
        console.log("Group Manager Loaded (Tier/Cluster Support).");
        
        const activeRole = app.impersonatedRole || app.userRole;
        if (activeRole === 'user') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state"><i class="fas fa-lock"></i><h3>權限不足</h3></div>`;
            return;
        }

        // 注入 CSS 樣式
        this.addStyles();
        await this.loadUnitDropdown();
    },

    // --- CSS 樣式 ---
    addStyles: function() {
        const style = document.createElement('style');
        style.textContent = `
            .config-container { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
            .config-card { flex: 1; min-width: 300px; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
            .config-header { font-weight: bold; font-size: 1.1em; margin-bottom: 10px; border-bottom: 2px solid #eee; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
            .list-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #f0f0f0; }
            .list-item:last-child { border-bottom: none; }
            .cluster-tag { font-size: 0.8em; padding: 2px 6px; border-radius: 4px; background: #e3f2fd; color: #0d47a1; margin-left: 5px; }
            .cluster-tag.none { background: #eee; color: #666; }
            .form-inline-add { display: flex; gap: 5px; margin-top: 10px; }
            .staff-select { padding: 4px; border: 1px solid #ddd; border-radius: 4px; width: 100%; }
        `;
        document.head.appendChild(style);
    },

    // --- 1. 載入單位下拉選單 (維持原樣) ---
    loadUnitDropdown: async function() {
        const select = document.getElementById('filterGroupUnit');
        if(!select) return;

        select.innerHTML = '<option value="">載入中...</option>';
        try {
            let query = db.collection('units');
            const activeRole = app.impersonatedRole || app.userRole;
            const activeUnitId = app.impersonatedUnitId || app.userUnitId;
            
            if (activeRole === 'unit_manager' || activeRole === 'unit_scheduler') {
                if(activeUnitId) query = query.where(firebase.firestore.FieldPath.documentId(), '==', activeUnitId);
            }

            const snapshot = await query.get();
            select.innerHTML = '<option value="">請選擇單位</option>';
            snapshot.forEach(doc => {
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.textContent = doc.data().name;
                select.appendChild(opt);
            });

            if (snapshot.size === 1) { select.selectedIndex = 1; this.onUnitChange(); }
            select.onchange = () => this.onUnitChange();
        } catch (e) { console.error(e); }
    },

    // --- 2. 單位切換 ---
    onUnitChange: async function() {
        const unitId = document.getElementById('filterGroupUnit').value;
        if (!unitId) { this.showEmptyState(); return; }

        this.currentUnitId = unitId;
        document.getElementById('groupEmptyState').style.display = 'none';
        document.getElementById('groupMainArea').style.display = 'block'; // 改為 block 以容納新佈局

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
            if (!doc.exists) return;

            const data = doc.data();
            // 初始化 config 結構 (若舊資料沒有 config 欄位)
            this.currentUnitData = {
                ...data,
                config: {
                    clusters: data.config?.clusters || [],
                    groups: data.config?.groups || [],
                    tiers: data.config?.tiers || []
                }
            };
            
            // 如果是舊資料格式 (groups 是字串陣列)，進行簡單遷移顯示 (不寫入DB，僅記憶體轉換)
            if (Array.isArray(data.groups) && this.currentUnitData.config.groups.length === 0) {
                this.currentUnitData.config.groups = data.groups.map(g => ({
                    id: g, name: g, clusterId: '' 
                }));
            }

            this.renderConfigArea();
            
        } catch (e) {
            console.error("Load Unit Error:", e);
            alert("資料載入失敗");
        }
    },

    // --- 4. 渲染設定區 (核心 UI 更新) ---
    renderConfigArea: function() {
        const container = document.getElementById('groupListBody').parentElement; 
        // 替換原本的 groupListBody 區域，改用新的 Config 介面
        // 注意：HTML 結構需要配合。假設 groupMainArea 內是空的或可覆蓋。
        
        const mainArea = document.getElementById('groupMainArea');
        mainArea.innerHTML = `
            <div class="config-container">
                <div class="config-card">
                    <div class="config-header">
                        <span><i class="fas fa-project-diagram"></i> 可換班組 (Clusters)</span>
                    </div>
                    <div id="clusterList"></div>
                    <div class="form-inline-add">
                        <input type="text" id="newClusterName" class="form-control" placeholder="新增 Cluster (如: 重症區)">
                        <button class="btn btn-primary btn-sm" onclick="groupManager.addCluster()">新增</button>
                    </div>
                </div>

                <div class="config-card">
                    <div class="config-header">
                        <span><i class="fas fa-users"></i> 功能組 (Groups)</span>
                    </div>
                    <div id="groupList"></div>
                    <div class="form-inline-add">
                        <input type="text" id="newGroupName" class="form-control" placeholder="組別名稱">
                        <select id="newGroupCluster" class="form-control" style="width: 100px;">
                            <option value="">(無)</option>
                        </select>
                        <button class="btn btn-primary btn-sm" onclick="groupManager.addGroup()">新增</button>
                    </div>
                </div>

                <div class="config-card">
                    <div class="config-header">
                        <span><i class="fas fa-layer-group"></i> 小組/階級 (Tiers)</span>
                    </div>
                    <div id="tierList"></div>
                    <div class="form-inline-add">
                        <input type="text" id="newTierName" class="form-control" placeholder="新增階級 (如: N1, 資深)">
                        <button class="btn btn-primary btn-sm" onclick="groupManager.addTier()">新增</button>
                    </div>
                </div>
            </div>

            <hr>
            <h4><i class="fas fa-user-nurse"></i> 人員分組設定</h4>
            <div class="table-responsive">
                <table class="table table-bordered table-hover">
                    <thead>
                        <tr>
                            <th>工號</th>
                            <th>姓名</th>
                            <th>職級</th>
                            <th>所屬 Cluster (唯讀)</th>
                            <th>功能組 (Group)</th>
                            <th>小組/階級 (Tier)</th>
                        </tr>
                    </thead>
                    <tbody id="staffListBody"></tbody>
                </table>
            </div>
        `;

        this.renderClusters();
        this.renderGroups();
        this.renderTiers();
    },

    // --- 4a. 渲染 Clusters ---
    renderClusters: function() {
        const list = document.getElementById('clusterList');
        const select = document.getElementById('newGroupCluster');
        
        list.innerHTML = '';
        select.innerHTML = '<option value="">Cluster 0 (無)</option>';

        this.currentUnitData.config.clusters.forEach(c => {
            // 列表
            list.innerHTML += `
                <div class="list-item">
                    <span>${c.name}</span>
                    <button class="btn btn-delete btn-sm" onclick="groupManager.deleteConfig('clusters', '${c.id}')"><i class="fas fa-trash"></i></button>
                </div>`;
            // 下拉選單
            select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
        });
    },

    // --- 4b. 渲染 Groups ---
    renderGroups: function() {
        const list = document.getElementById('groupList');
        list.innerHTML = '';

        this.currentUnitData.config.groups.forEach(g => {
            const cluster = this.currentUnitData.config.clusters.find(c => c.id === g.clusterId);
            const clusterName = cluster ? cluster.name : '未指定';
            const badgeClass = cluster ? '' : 'none';

            list.innerHTML += `
                <div class="list-item">
                    <div>
                        <strong>${g.name}</strong>
                        <span class="cluster-tag ${badgeClass}">${clusterName}</span>
                    </div>
                    <button class="btn btn-delete btn-sm" onclick="groupManager.deleteConfig('groups', '${g.id}')"><i class="fas fa-trash"></i></button>
                </div>`;
        });
    },

    // --- 4c. 渲染 Tiers ---
    renderTiers: function() {
        const list = document.getElementById('tierList');
        list.innerHTML = '';

        this.currentUnitData.config.tiers.forEach(t => {
            list.innerHTML += `
                <div class="list-item">
                    <span>${t}</span>
                    <button class="btn btn-delete btn-sm" onclick="groupManager.deleteConfig('tiers', '${t}')"><i class="fas fa-trash"></i></button>
                </div>`;
        });
    },

    // --- 5. 新增/刪除邏輯 (通用或分別) ---
    
    // 新增 Cluster
    addCluster: async function() {
        const input = document.getElementById('newClusterName');
        const name = input.value.trim();
        if(!name) return;

        const newId = 'c_' + Date.now(); // 簡單 ID 生成
        this.currentUnitData.config.clusters.push({ id: newId, name: name });
        
        await this.saveConfig();
        input.value = '';
        this.renderClusters();
        this.renderGroups(); // 更新 Group 列表中的 cluster 名稱
    },

    // 新增 Group
    addGroup: async function() {
        const input = document.getElementById('newGroupName');
        const select = document.getElementById('newGroupCluster');
        const name = input.value.trim();
        if(!name) return;

        // 檢查重複
        if (this.currentUnitData.config.groups.find(g => g.name === name)) {
            alert('組別名稱已存在'); return;
        }

        const newId = name; // 使用名稱當 ID 或產生新 ID 皆可，此處用名稱方便閱讀
        this.currentUnitData.config.groups.push({
            id: newId,
            name: name,
            clusterId: select.value
        });

        await this.saveConfig();
        input.value = '';
        this.renderGroups();
        this.loadStaffList(); // 因為下拉選單選項變了
    },

    // 新增 Tier
    addTier: async function() {
        const input = document.getElementById('newTierName');
        const name = input.value.trim();
        if(!name) return;

        if (this.currentUnitData.config.tiers.includes(name)) {
            alert('階級已存在'); return;
        }

        this.currentUnitData.config.tiers.push(name);
        await this.saveConfig();
        input.value = '';
        this.renderTiers();
        this.loadStaffList(); // 因為下拉選單選項變了
    },

    // 通用刪除
    deleteConfig: async function(type, id) {
        if(!confirm(`確定要刪除嗎？這可能會影響現有人員設定。`)) return;

        if (type === 'clusters') {
            this.currentUnitData.config.clusters = this.currentUnitData.config.clusters.filter(c => c.id !== id);
            // 同步移除 group 中的 clusterId 參照
            this.currentUnitData.config.groups.forEach(g => {
                if(g.clusterId === id) g.clusterId = '';
            });
        } else if (type === 'groups') {
            this.currentUnitData.config.groups = this.currentUnitData.config.groups.filter(g => g.id !== id);
        } else if (type === 'tiers') {
            this.currentUnitData.config.tiers = this.currentUnitData.config.tiers.filter(t => t !== id);
        }

        await this.saveConfig();
        this.renderConfigArea();
        this.loadStaffList();
    },

    // 儲存至 Firestore
    saveConfig: async function() {
        try {
            await db.collection('units').doc(this.currentUnitId).update({
                config: this.currentUnitData.config,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch(e) {
            console.error("Save Config Error:", e);
            alert("儲存設定失敗");
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

            this.renderStaffList();
        } catch (e) {
            console.error("Load Staff Error:", e);
        } finally {
            this.isLoading = false;
        }
    },

    // --- 8. 渲染人員列表 (含雙下拉選單) ---
    renderStaffList: function() {
        const tbody = document.getElementById('staffListBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        const groups = this.currentUnitData.config.groups || [];
        const tiers = this.currentUnitData.config.tiers || [];
        const clusters = this.currentUnitData.config.clusters || [];

        // 排序 (簡單版)
        const sorted = [...this.staffList].sort((a,b) => (a.employeeId || '').localeCompare(b.employeeId || ''));

        sorted.forEach(staff => {
            // 找出目前 Group 對應的 Cluster
            const currentGroup = groups.find(g => g.id === (staff.groupId || staff.group)); // 相容舊欄位 group
            const currentClusterId = currentGroup ? currentGroup.clusterId : '';
            const currentCluster = clusters.find(c => c.id === currentClusterId);
            const clusterDisplayName = currentCluster ? currentCluster.name : '<span style="color:#ccc">Cluster 0</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${staff.employeeId || '-'}</td>
                <td>${staff.displayName || '-'}</td>
                <td>${staff.level || '-'}</td>
                <td style="background:#f9f9f9;" id="cluster-display-${staff.uid}">
                    ${clusterDisplayName}
                </td>
                <td>
                    <select class="staff-select" onchange="groupManager.updateStaffField('${staff.uid}', 'groupId', this.value)">
                        <option value="">(未指定)</option>
                        ${groups.map(g => `<option value="${g.id}" ${staff.groupId === g.id ? 'selected' : ''}>${g.name}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="staff-select" onchange="groupManager.updateStaffField('${staff.uid}', 'tier', this.value)">
                        <option value="">(未指定)</option>
                        ${tiers.map(t => `<option value="${t}" ${staff.tier === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // --- 9. 更新人員資料 ---
    updateStaffField: async function(uid, field, value) {
        try {
            const updateData = {};
            updateData[field] = value;
            updateData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

            await db.collection('users').doc(uid).update(updateData);

            // 更新本地資料
            const staff = this.staffList.find(s => s.uid === uid);
            if(staff) staff[field] = value;

            // 如果更新的是 Group，需要連動更新畫面上的 Cluster 顯示
            if (field === 'groupId') {
                const groups = this.currentUnitData.config.groups || [];
                const clusters = this.currentUnitData.config.clusters || [];
                const newGroup = groups.find(g => g.id === value);
                const newCluster = newGroup ? clusters.find(c => c.id === newGroup.clusterId) : null;
                
                const displayCell = document.getElementById(`cluster-display-${uid}`);
                if(displayCell) {
                    displayCell.innerHTML = newCluster ? newCluster.name : '<span style="color:#ccc">Cluster 0</span>';
                }
            }

            console.log(`User ${uid} updated: ${field} = ${value}`);
        } catch (e) {
            console.error("Update Staff Error:", e);
            alert("更新失敗");
        }
    }
};
