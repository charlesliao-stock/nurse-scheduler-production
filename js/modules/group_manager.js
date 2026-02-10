// js/modules/group_manager.js

const groupManager = {
    currentUnitId: null,
    currentUnitData: null,
    staffList: [],
    staffSortState: { field: 'employeeId', order: 'asc' },
    isLoading: false,

    // 預設設定
    defaultConfig: {
        settings: {
            useClusters: false,
            useGroups: true,
            useTiers: false
        },
        clusters: [],
        groups: [],
        tiers: []
    },

    // --- 初始化 ---
    init: async function() {
        console.log("Group Manager Loaded (Clean View).");
        const activeRole = app.impersonatedRole || app.userRole;
        if (activeRole === 'user') {
            document.getElementById('content-area').innerHTML = `<div class="empty-state">權限不足</div>`;
            return;
        }
        this.addStyles();
        await this.loadUnitDropdown();
    },

    // --- CSS ---
    addStyles: function() {
        const style = document.createElement('style');
        style.textContent = `
            .settings-panel { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e9ecef; }
            .settings-panel h5 { margin-bottom: 15px; color: #495057; font-weight: bold; }
            .toggle-wrapper { display: flex; gap: 20px; align-items: center; }
            .custom-switch { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
            
            .config-container { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
            .config-card { flex: 1; min-width: 300px; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
            .config-header { font-weight: bold; font-size: 1.1em; margin-bottom: 10px; border-bottom: 2px solid #eee; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
            .list-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #f0f0f0; }
            .cluster-tag { font-size: 0.8em; padding: 2px 6px; border-radius: 4px; background: #e3f2fd; color: #0d47a1; margin-left: 5px; }
            .form-inline-add { display: flex; gap: 5px; margin-top: 10px; }
            .staff-select { padding: 4px; border: 1px solid #ddd; border-radius: 4px; width: 100%; }
        `;
        document.head.appendChild(style);
    },

    // --- 載入單位下拉選單 ---
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

    // --- 單位切換 ---
    onUnitChange: async function() {
        const unitId = document.getElementById('filterGroupUnit').value;
        if (!unitId) { this.showEmptyState(); return; }
        this.currentUnitId = unitId;
        document.getElementById('groupEmptyState').style.display = 'none';
        document.getElementById('groupMainArea').style.display = 'block';
        await this.loadUnitData();
        await this.loadStaffList();
    },

    showEmptyState: function() {
        this.currentUnitId = null;
        document.getElementById('groupMainArea').style.display = 'none';
        document.getElementById('groupEmptyState').style.display = 'block';
    },

    // --- 載入資料 ---
    loadUnitData: async function() {
        try {
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            if (!doc.exists) return;
            const data = doc.data();
            
            this.currentUnitData = {
                ...data,
                config: {
                    settings: { ...this.defaultConfig.settings, ...(data.config?.settings || {}) },
                    clusters: data.config?.clusters || [],
                    groups: data.config?.groups || [],
                    tiers: data.config?.tiers || []
                }
            };
            
            // 舊資料相容
            if (Array.isArray(data.groups) && this.currentUnitData.config.groups.length === 0) {
                this.currentUnitData.config.groups = data.groups.map(g => ({ id: g, name: g, clusterId: '' }));
            }
            this.renderConfigArea();
        } catch (e) { console.error(e); }
    },

    // --- 切換開關 ---
    toggleSetting: async function(key, checked) {
        this.currentUnitData.config.settings[key] = checked;
        await this.saveConfig();
        this.renderConfigArea();
        this.renderStaffList();
    },

    // --- 渲染主要區域 ---
    renderConfigArea: function() {
        const mainArea = document.getElementById('groupMainArea');
        const settings = this.currentUnitData.config.settings;

        mainArea.innerHTML = `
            <div class="settings-panel">
                <h5><i class="fas fa-cogs"></i> 分組層級設定</h5>
                <div class="toggle-wrapper">
                    <label class="custom-switch">
                        <input type="checkbox" ${settings.useClusters ? 'checked' : ''} onchange="groupManager.toggleSetting('useClusters', this.checked)">
                        <span>啟用 Cluster (互換大組)</span>
                    </label>
                    <label class="custom-switch">
                        <input type="checkbox" ${settings.useGroups ? 'checked' : ''} onchange="groupManager.toggleSetting('useGroups', this.checked)">
                        <span>啟用 Group (功能組)</span>
                    </label>
                    <label class="custom-switch">
                        <input type="checkbox" ${settings.useTiers ? 'checked' : ''} onchange="groupManager.toggleSetting('useTiers', this.checked)">
                        <span>啟用 Tier (能力階級)</span>
                    </label>
                </div>
            </div>

            <div class="config-container">
                ${settings.useClusters ? this.getClusterCardHTML() : ''}
                ${settings.useGroups ? this.getGroupCardHTML(settings.useClusters) : ''}
                ${settings.useTiers ? this.getTierCardHTML() : ''}
            </div>
            
            ${(!settings.useClusters && !settings.useGroups && !settings.useTiers) ? 
                '<div class="alert alert-info">目前未啟用任何分組層級。</div>' : ''}

            <hr>
            <h4><i class="fas fa-user-nurse"></i> 人員分組設定</h4>
            <div class="table-responsive">
                <table class="table table-bordered table-hover">
                    <thead>
                        <tr>
                            <th>工號</th>
                            <th>姓名</th>
                            <th>職級</th>
                            ${settings.useGroups ? '<th>功能組 (Group)</th>' : ''}
                            ${settings.useTiers ? '<th>小組/階級 (Tier)</th>' : ''}
                        </tr>
                    </thead>
                    <tbody id="staffListBody"></tbody>
                </table>
            </div>
        `;

        if (settings.useClusters) this.renderClusters();
        if (settings.useGroups) this.renderGroups();
        if (settings.useTiers) this.renderTiers();
    },

    // --- HTML Template Helpers ---
    getClusterCardHTML: function() {
        return `
            <div class="config-card">
                <div class="config-header">
                    <span><i class="fas fa-project-diagram"></i> 可換班組 (Clusters)</span>
                </div>
                <div id="clusterList"></div>
                <div class="form-inline-add">
                    <input type="text" id="newClusterName" class="form-control" placeholder="名稱 (如:重症區)">
                    <button class="btn btn-primary btn-sm" onclick="groupManager.addCluster()">新增</button>
                </div>
            </div>`;
    },

    getGroupCardHTML: function(showClusterSelect) {
        // 如果有啟用 Cluster，這裡會顯示下拉選單讓 User 綁定 Group -> Cluster
        const clusterSelectHTML = showClusterSelect ? 
            `<select id="newGroupCluster" class="form-control" style="width: 120px;"><option value="">(無Cluster)</option></select>` : 
            `<input type="hidden" id="newGroupCluster" value="">`;

        return `
            <div class="config-card">
                <div class="config-header">
                    <span><i class="fas fa-users"></i> 功能組 (Groups)</span>
                </div>
                <div id="groupList"></div>
                <div class="form-inline-add">
                    <input type="text" id="newGroupName" class="form-control" placeholder="組別名稱">
                    ${clusterSelectHTML}
                    <button class="btn btn-primary btn-sm" onclick="groupManager.addGroup()">新增</button>
                </div>
            </div>`;
    },

    getTierCardHTML: function() {
        return `
            <div class="config-card">
                <div class="config-header">
                    <span><i class="fas fa-layer-group"></i> 小組/階級 (Tiers)</span>
                </div>
                <div id="tierList"></div>
                <div class="form-inline-add">
                    <input type="text" id="newTierName" class="form-control" placeholder="階級名稱">
                    <button class="btn btn-primary btn-sm" onclick="groupManager.addTier()">新增</button>
                </div>
            </div>`;
    },

    // --- 渲染各個列表 ---
    renderClusters: function() {
        const list = document.getElementById('clusterList');
        const select = document.getElementById('newGroupCluster');
        
        if(list) {
            list.innerHTML = '';
            this.currentUnitData.config.clusters.forEach(c => {
                list.innerHTML += `
                    <div class="list-item">
                        <span>${c.name}</span>
                        <button class="btn btn-delete btn-sm" onclick="groupManager.deleteConfig('clusters', '${c.id}')"><i class="fas fa-trash"></i></button>
                    </div>`;
            });
        }
        if(select && select.type !== 'hidden') {
            select.innerHTML = '<option value="">(無Cluster)</option>';
            this.currentUnitData.config.clusters.forEach(c => {
                select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
            });
        }
    },

    renderGroups: function() {
        const list = document.getElementById('groupList');
        if(!list) return;
        list.innerHTML = '';
        
        const showClusterTag = this.currentUnitData.config.settings.useClusters;

        this.currentUnitData.config.groups.forEach(g => {
            let clusterBadge = '';
            // 只有在上方管理卡片顯示 Cluster 標籤，方便管理者知道歸屬
            if (showClusterTag) {
                const cluster = this.currentUnitData.config.clusters.find(c => c.id === g.clusterId);
                const clusterName = cluster ? cluster.name : '未指定';
                clusterBadge = `<span class="cluster-tag ${cluster ? '' : 'none'}">${clusterName}</span>`;
            }

            list.innerHTML += `
                <div class="list-item">
                    <div><strong>${g.name}</strong>${clusterBadge}</div>
                    <button class="btn btn-delete btn-sm" onclick="groupManager.deleteConfig('groups', '${g.id}')"><i class="fas fa-trash"></i></button>
                </div>`;
        });
    },

    renderTiers: function() {
        const list = document.getElementById('tierList');
        if(!list) return;
        list.innerHTML = '';
        this.currentUnitData.config.tiers.forEach(t => {
            list.innerHTML += `
                <div class="list-item">
                    <span>${t}</span>
                    <button class="btn btn-delete btn-sm" onclick="groupManager.deleteConfig('tiers', '${t}')"><i class="fas fa-trash"></i></button>
                </div>`;
        });
    },

    // --- 資料操作 ---
    addCluster: async function() {
        const name = document.getElementById('newClusterName').value.trim();
        if(!name) return;
        const newId = 'c_' + Date.now();
        this.currentUnitData.config.clusters.push({ id: newId, name: name });
        await this.saveConfig();
        this.renderConfigArea();
    },

    addGroup: async function() {
        const name = document.getElementById('newGroupName').value.trim();
        if(!name) return;
        const clusterSelect = document.getElementById('newGroupCluster');
        const clusterId = clusterSelect ? clusterSelect.value : '';

        if (this.currentUnitData.config.groups.find(g => g.name === name)) {
            alert('名稱重複'); return;
        }

        this.currentUnitData.config.groups.push({ id: name, name: name, clusterId: clusterId });
        await this.saveConfig();
        this.renderConfigArea();
    },

    addTier: async function() {
        const name = document.getElementById('newTierName').value.trim();
        if(!name) return;
        if (this.currentUnitData.config.tiers.includes(name)) return;
        this.currentUnitData.config.tiers.push(name);
        await this.saveConfig();
        this.renderConfigArea();
    },

    deleteConfig: async function(type, id) {
        if(!confirm('確定刪除？')) return;
        if(type === 'clusters') {
            this.currentUnitData.config.clusters = this.currentUnitData.config.clusters.filter(c => c.id !== id);
            // 清除 Group 裡的關聯
            this.currentUnitData.config.groups.forEach(g => { if(g.clusterId === id) g.clusterId = ''; });
        } else if(type === 'groups') {
            this.currentUnitData.config.groups = this.currentUnitData.config.groups.filter(g => g.id !== id);
        } else if(type === 'tiers') {
            this.currentUnitData.config.tiers = this.currentUnitData.config.tiers.filter(t => t !== id);
        }
        await this.saveConfig();
        this.renderConfigArea();
        this.loadStaffList();
    },

    saveConfig: async function() {
        try {
            await db.collection('units').doc(this.currentUnitId).update({
                config: this.currentUnitData.config,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch(e) { console.error(e); alert("儲存失敗"); }
    },

    loadStaffList: async function() {
        if(this.isLoading) return;
        this.isLoading = true;
        try {
            const snapshot = await db.collection('users')
                .where('unitId', '==', this.currentUnitId).where('isActive', '==', true).get();
            this.staffList = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
            this.renderStaffList();
        } catch (e) { console.error(e); } 
        finally { this.isLoading = false; }
    },

    // --- 渲染人員列表 (無 Cluster 欄位版) ---
    renderStaffList: function() {
        const tbody = document.getElementById('staffListBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        const settings = this.currentUnitData.config.settings;
        const groups = this.currentUnitData.config.groups || [];
        const tiers = this.currentUnitData.config.tiers || [];

        // 排序
        const sorted = [...this.staffList].sort((a,b) => (a.employeeId || '').localeCompare(b.employeeId || ''));

        sorted.forEach(staff => {
            const tr = document.createElement('tr');
            
            // 基礎資訊
            let html = `
                <td>${staff.employeeId || '-'}</td>
                <td>${staff.displayName || '-'}</td>
                <td>${staff.level || '-'}</td>
            `;

            // 動態欄位: Group (可選)
            if (settings.useGroups) {
                const options = groups.map(g => 
                    `<option value="${g.id}" ${staff.groupId === g.id ? 'selected' : ''}>${g.name}</option>`
                ).join('');
                html += `
                    <td>
                        <select class="staff-select" onchange="groupManager.updateStaffField('${staff.uid}', 'groupId', this.value)">
                            <option value="">(未指定)</option>
                            ${options}
                        </select>
                    </td>`;
            }

            // 動態欄位: Tier (可選)
            if (settings.useTiers) {
                const options = tiers.map(t => 
                    `<option value="${t}" ${staff.tier === t ? 'selected' : ''}>${t}</option>`
                ).join('');
                html += `
                    <td>
                        <select class="staff-select" onchange="groupManager.updateStaffField('${staff.uid}', 'tier', this.value)">
                            <option value="">(未指定)</option>
                            ${options}
                        </select>
                    </td>`;
            }

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    },

    // --- 更新人員欄位 ---
    updateStaffField: async function(uid, field, value) {
        try {
            const updateData = {};
            updateData[field] = value;
            updateData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('users').doc(uid).update(updateData);
            
            // 更新本地資料
            const staff = this.staffList.find(s => s.uid === uid);
            if(staff) staff[field] = value;

            // 因為 Cluster 欄位已移除，這裡不需要再呼叫 renderStaffList 刷新畫面
            console.log(`Updated ${uid}: ${field} = ${value}`);
        } catch (e) { console.error(e); }
    }
};
