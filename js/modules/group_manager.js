// js/modules/group_manager.js

const groupManager = {
    currentUnitId: null,
    currentUnitData: null,
    staffList: [],
    isLoading: false,

    // 預設設定
    defaultConfig: {
        settings: {
            useClusters: true,  // 預設開啟 Cluster
            useGroups: true,    // 預設開啟 Group
            useTiers: true      // 預設開啟 Tier
        },
        clusters: [], // { id, name, swapRule: 'any'|'same_tier' }
        groups: [],   // { id, name, clusterId }
        tiers: []     // string[]
    },

    // --- 初始化 ---
    init: async function() {
        console.log("Group Manager Loaded (Kanban + Swap Rules).");
        
        // 權限檢查
        const activeRole = app.impersonatedRole || app.userRole;
        if (activeRole === 'user') {
            document.getElementById('content-area').innerHTML = `<div class="empty-state">權限不足</div>`;
            return;
        }

        this.addStyles();
        await this.loadUnitDropdown();
    },

    // --- 1. CSS 樣式 ---
    addStyles: function() {
        const style = document.createElement('style');
        style.textContent = `
            /* 設定面板 */
            .settings-panel { background: #f8f9fa; padding: 10px 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e9ecef; display: flex; justify-content: space-between; align-items: center; }
            .toggle-wrapper { display: flex; gap: 15px; }
            .custom-switch { display: flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; font-size: 0.9em; }
            
            /* 看板容器 */
            .kanban-container { overflow-x: auto; padding-bottom: 10px; margin-bottom: 20px; }
            .kanban-board { display: flex; gap: 15px; align-items: flex-start; min-width: 100%; }

            /* 看板欄位 (Cluster) */
            .cluster-column {
                background: #f4f5f7; border-radius: 8px; width: 300px; min-width: 300px;
                display: flex; flex-direction: column; max-height: 75vh;
                border: 1px solid #dfe1e6;
            }
            .cluster-column.unassigned { border-top: 3px solid #6c757d; }
            .cluster-column.assigned { border-top: 3px solid #007bff; }

            /* 欄位標題區 */
            .cluster-header {
                padding: 10px 12px; font-weight: bold; color: #172b4d;
                display: flex; justify-content: space-between; align-items: center;
                border-bottom: 1px solid #ddd; cursor: default;
            }
            .cluster-title { cursor: pointer; flex-grow: 1; margin-right: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } 
            
            /* 標題右側動作區 (下拉選單 + 刪除鈕) */
            .cluster-actions { display: flex; align-items: center; gap: 5px; }
            .cluster-rule-select {
                font-size: 0.8em; padding: 2px 4px; border: 1px solid #ced4da;
                border-radius: 4px; background-color: #fff; color: #495057;
                cursor: pointer; max-width: 100px;
            }

            /* 卡片列表區 (可拖放) */
            .group-list-area { padding: 8px; flex-grow: 1; min-height: 50px; overflow-y: auto; }

            /* Group 卡片 */
            .group-card {
                background: white; border-radius: 4px; padding: 8px 10px; margin-bottom: 8px;
                box-shadow: 0 1px 2px rgba(9,30,66,.25); cursor: grab;
                display: flex; justify-content: space-between; align-items: center;
                transition: transform 0.1s, box-shadow 0.1s;
            }
            .group-card:hover { background: #fafbfc; }
            .group-card:active { cursor: grabbing; }
            .group-name { cursor: pointer; flex-grow: 1; }

            /* 底部新增按鈕 */
            .add-card-btn {
                background: transparent; border: none; width: 100%; padding: 8px;
                text-align: left; color: #5e6c84; cursor: pointer; border-top: 1px solid #ddd;
                font-size: 0.9em;
            }
            .add-card-btn:hover { background: #ebecf0; color: #172b4d; }

            /* Tier 標籤 */
            .tier-tag { 
                background: #e9ecef; border: 1px solid #ced4da; border-radius: 15px; 
                padding: 4px 12px; display: inline-flex; align-items: center; gap: 8px; margin-right: 8px; margin-bottom: 8px;
            }
            
            /* 通用介面元件 */
            .btn-icon { border: none; background: none; color: #6c757d; cursor: pointer; padding: 2px; font-size: 0.9em; }
            .btn-icon:hover { color: #dc3545; }
            .edit-input { border: 1px solid #007bff; border-radius: 3px; padding: 2px 4px; width: 80%; font-size: inherit; }
            .staff-select { padding: 4px; border: 1px solid #ddd; border-radius: 4px; width: 100%; }
        `;
        document.head.appendChild(style);
    },

    // --- 2. 載入單位 ---
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

    // --- 3. 載入資料 ---
    loadUnitData: async function() {
        try {
            const doc = await db.collection('units').doc(this.currentUnitId).get();
            if (!doc.exists) return;

            const data = doc.data();
            
            // 合併預設值 (確保 swapRule 存在)
            this.currentUnitData = {
                ...data,
                config: {
                    settings: { ...this.defaultConfig.settings, ...(data.config?.settings || {}) },
                    clusters: (data.config?.clusters || []).map(c => ({
                        ...c,
                        swapRule: c.swapRule || 'any' // 舊資料預設為無限制
                    })),
                    groups: data.config?.groups || [],
                    tiers: data.config?.tiers || []
                }
            };

            // 舊資料相容 (如果 groups 是字串陣列)
            if (Array.isArray(data.groups) && this.currentUnitData.config.groups.length === 0) {
                this.currentUnitData.config.groups = data.groups.map(g => ({ id: g, name: g, clusterId: '' }));
            }

            this.renderMainInterface();
            
        } catch (e) {
            console.error("Load Data Error:", e);
        }
    },

    // --- 4. 渲染主介面框架 ---
    renderMainInterface: function() {
        const mainArea = document.getElementById('groupMainArea');
        const settings = this.currentUnitData.config.settings;

        mainArea.innerHTML = `
            <div class="settings-panel">
                <div style="font-weight:bold; color:#555;"><i class="fas fa-cogs"></i> 分組設定</div>
                <div class="toggle-wrapper">
                    <label class="custom-switch">
                        <input type="checkbox" ${settings.useClusters ? 'checked' : ''} onchange="groupManager.toggleSetting('useClusters', this.checked)">
                        <span>啟用 Cluster</span>
                    </label>
                    <label class="custom-switch">
                        <input type="checkbox" ${settings.useGroups ? 'checked' : ''} onchange="groupManager.toggleSetting('useGroups', this.checked)">
                        <span>啟用 Group</span>
                    </label>
                    <label class="custom-switch">
                        <input type="checkbox" ${settings.useTiers ? 'checked' : ''} onchange="groupManager.toggleSetting('useTiers', this.checked)">
                        <span>啟用 Tier</span>
                    </label>
                </div>
            </div>

            ${(settings.useClusters || settings.useGroups) ? `
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <h5 class="mb-0"><i class="fas fa-columns"></i> 分組看板</h5>
                    ${settings.useClusters ? `<button class="btn btn-sm btn-success" onclick="groupManager.addCluster()"><i class="fas fa-plus"></i> 新增 Cluster</button>` : ''}
                </div>
                <div id="kanbanBoard" class="kanban-container">
                    <div class="kanban-board"></div>
                </div>
            ` : ''}

            ${settings.useTiers ? `
                <hr>
                <h5 class="mb-3"><i class="fas fa-layer-group"></i> 小組/階級 (Tiers)</h5>
                <div id="tierArea">
                    <div id="tierList" style="margin-bottom:10px;"></div>
                    <div class="input-group input-group-sm" style="width: 250px;">
                        <input type="text" id="newTierInput" class="form-control" placeholder="新增 Tier (如: N1)">
                        <div class="input-group-append">
                            <button class="btn btn-primary" onclick="groupManager.addTier()">新增</button>
                        </div>
                    </div>
                </div>
            ` : ''}

            <hr>
            <h5 class="mb-3"><i class="fas fa-user-nurse"></i> 人員分組設定</h5>
            <div class="table-responsive">
                <table class="table table-bordered table-hover table-sm">
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

        if (settings.useClusters || settings.useGroups) this.renderKanban();
        if (settings.useTiers) this.renderTiers();
        this.renderStaffList();
    },

    // --- 5. 渲染看板核心 (Kanban) ---
    renderKanban: function() {
        const board = document.querySelector('.kanban-board');
        if(!board) return;
        board.innerHTML = '';

        const config = this.currentUnitData.config;
        const groups = config.groups || [];
        const clusters = config.clusters || [];
        const useClusters = config.settings.useClusters;

        // 5.1 未分類區 (或所有組別區)
        const unassignedGroups = useClusters 
            ? groups.filter(g => !g.clusterId || !clusters.find(c => c.id === g.clusterId))
            : groups;

        const unassignedTitle = useClusters ? '未分類 (No Cluster)' : '所有功能組';
        
        // 未分類區不傳入規則 (null)
        board.appendChild(this.createColumnHTML('unassigned', unassignedTitle, unassignedGroups, true, null));

        // 5.2 渲染 Cluster 區
        if (useClusters) {
            clusters.forEach(c => {
                const clusterGroups = groups.filter(g => g.clusterId === c.id);
                // 傳入 Cluster 的互換規則
                board.appendChild(this.createColumnHTML(c.id, c.name, clusterGroups, false, c.swapRule));
            });
        }

        // 5.3 啟用 SortableJS
        this.initSortable();
    },

    // 建立單一欄位 HTML (含下拉選單)
    createColumnHTML: function(clusterId, clusterName, groupList, isUnassigned, swapRule) {
        const colDiv = document.createElement('div');
        colDiv.className = `cluster-column ${isUnassigned ? 'unassigned' : 'assigned'}`;
        colDiv.dataset.clusterId = clusterId;

        // --- 建立標題右側動作區 ---
        let actionsHtml = '';
        if (!isUnassigned) {
            // 如果是 Cluster，顯示「規則下拉選單」與「刪除按鈕」
            actionsHtml = `
                <div class="cluster-actions">
                    <select class="cluster-rule-select" 
                            onchange="groupManager.updateClusterRule('${clusterId}', this.value)"
                            title="設定換班限制"
                            onclick="event.stopPropagation()"> <option value="any" ${swapRule === 'any' ? 'selected' : ''}>無限制</option>
                        <option value="same_tier" ${swapRule === 'same_tier' ? 'selected' : ''}>限同階級</option>
                    </select>
                    <button class="btn-icon" onclick="groupManager.deleteCluster('${clusterId}')"><i class="fas fa-trash-alt"></i></button>
                </div>
            `;
        }

        // --- 標題區 (雙擊改名) ---
        // 注意：標題本身只有文字部分可以點擊改名
        const titleHtml = isUnassigned ? 
            `<span class="cluster-title" style="cursor:default;">${clusterName}</span>` : 
            `<span class="cluster-title" onclick="groupManager.editName(this, 'cluster', '${clusterId}')" title="雙擊改名">${clusterName}</span>`;

        // --- 卡片區 ---
        let cardsHtml = '';
        groupList.forEach(g => {
            cardsHtml += `
                <div class="group-card" data-id="${g.id}">
                    <span class="group-name" onclick="groupManager.editName(this, 'group', '${g.id}')" title="雙擊改名">${g.name}</span>
                    <button class="btn-icon" onclick="groupManager.deleteGroup('${g.id}')"><i class="fas fa-times"></i></button>
                </div>`;
        });

        // --- 底部新增按鈕 ---
        const addBtnHtml = `
            <button class="add-card-btn" onclick="groupManager.quickAddGroup('${clusterId}')">
                <i class="fas fa-plus"></i> 新增功能組...
            </button>`;

        colDiv.innerHTML = `
            <div class="cluster-header">
                ${titleHtml}
                ${actionsHtml}
            </div>
            <div class="group-list-area" id="list-${clusterId}">
                ${cardsHtml}
            </div>
            ${addBtnHtml}
        `;
        return colDiv;
    },

    // --- 6. 拖拉功能初始化 ---
    initSortable: function() {
        const containers = document.querySelectorAll('.group-list-area');
        containers.forEach(container => {
            new Sortable(container, {
                group: 'shared-groups', // 允許跨欄拖曳
                animation: 150,
                ghostClass: 'bg-light',
                onEnd: async (evt) => {
                    const itemEl = evt.item;
                    const newClusterId = evt.to.parentElement.dataset.clusterId;
                    const oldClusterId = evt.from.parentElement.dataset.clusterId;
                    const groupId = itemEl.dataset.id;

                    if (newClusterId !== oldClusterId) {
                        await this.moveGroupToCluster(groupId, newClusterId);
                    }
                }
            });
        });
    },

    // --- 7. Tier 渲染 ---
    renderTiers: function() {
        const list = document.getElementById('tierList');
        if(!list) return;
        list.innerHTML = '';
        this.currentUnitData.config.tiers.forEach(t => {
            const tag = document.createElement('span');
            tag.className = 'tier-tag';
            tag.innerHTML = `
                <span onclick="groupManager.editName(this, 'tier', '${t}')" style="cursor:pointer;" title="雙擊改名">${t}</span>
                <i class="fas fa-times btn-icon" onclick="groupManager.deleteTier('${t}')"></i>
            `;
            list.appendChild(tag);
        });
    },

    // --- 8. 人員列表渲染 ---
    renderStaffList: function() {
        const tbody = document.getElementById('staffListBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        const settings = this.currentUnitData.config.settings;
        const groups = this.currentUnitData.config.groups || [];
        const tiers = this.currentUnitData.config.tiers || [];

        const sorted = [...this.staffList].sort((a,b) => (a.employeeId || '').localeCompare(b.employeeId || ''));

        sorted.forEach(staff => {
            const tr = document.createElement('tr');
            let html = `
                <td>${staff.employeeId || '-'}</td>
                <td>${staff.displayName || '-'}</td>
                <td>${staff.level || '-'}</td>
            `;

            if (settings.useGroups) {
                const options = groups.map(g => 
                    `<option value="${g.id}" ${staff.groupId === g.id ? 'selected' : ''}>${g.name}</option>`
                ).join('');
                html += `<td><select class="staff-select" onchange="groupManager.updateStaffField('${staff.uid}', 'groupId', this.value)"><option value="">(未指定)</option>${options}</select></td>`;
            }

            if (settings.useTiers) {
                const options = tiers.map(t => 
                    `<option value="${t}" ${staff.tier === t ? 'selected' : ''}>${t}</option>`
                ).join('');
                html += `<td><select class="staff-select" onchange="groupManager.updateStaffField('${staff.uid}', 'tier', this.value)"><option value="">(未指定)</option>${options}</select></td>`;
            }

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    },

    // --- 9. 動作邏輯 (Actions) ---

    // 開關切換
    toggleSetting: async function(key, checked) {
        this.currentUnitData.config.settings[key] = checked;
        await this.saveConfig();
        this.renderMainInterface();
    },

    // 更新 Cluster 規則 (下拉選單觸發)
    updateClusterRule: async function(clusterId, newRule) {
        const cluster = this.currentUnitData.config.clusters.find(c => c.id === clusterId);
        if (cluster) {
            cluster.swapRule = newRule;
            console.log(`Cluster ${cluster.name} rule updated to: ${newRule}`);
            await this.saveConfig(false); // 靜默儲存，不需重刷介面
        }
    },

    // 拖拉移動 Group
    moveGroupToCluster: async function(groupId, targetClusterId) {
        const group = this.currentUnitData.config.groups.find(g => g.id === groupId);
        if (group) {
            group.clusterId = (targetClusterId === 'unassigned') ? '' : targetClusterId;
            console.log(`Moved ${group.name} to ${targetClusterId}`);
            await this.saveConfig(false);
        }
    },

    // 通用改名 (雙擊)
    editName: function(el, type, id) {
        const currentText = el.innerText;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.className = 'edit-input';
        
        // 暫時替換成 Input
        el.replaceWith(input);
        input.focus();

        const save = async () => {
            const newName = input.value.trim();
            if (newName && newName !== currentText) {
                if (type === 'cluster') {
                    const t = this.currentUnitData.config.clusters.find(c => c.id === id);
                    if(t) t.name = newName;
                } else if (type === 'group') {
                    const t = this.currentUnitData.config.groups.find(g => g.id === id);
                    if(t) t.name = newName;
                } else if (type === 'tier') {
                    const idx = this.currentUnitData.config.tiers.indexOf(id);
                    if(idx !== -1) this.currentUnitData.config.tiers[idx] = newName;
                }
                await this.saveConfig();
            }
            
            // 重繪介面恢復文字
            if (type === 'tier') this.renderTiers(); 
            else this.renderKanban(); 
            
            // 改名可能影響下方表格選項，刷新之
            if (type !== 'cluster') this.renderStaffList();
        };

        input.onblur = save;
        input.onkeydown = (e) => { if(e.key === 'Enter') save(); };
    },

    // 新增 Cluster (預設無限制)
    addCluster: async function() {
        const name = prompt("請輸入 Cluster 名稱:");
        if (!name) return;
        const newId = 'c_' + Date.now();
        this.currentUnitData.config.clusters.push({ 
            id: newId, 
            name: name, 
            swapRule: 'any' // 預設: 無限制
        });
        await this.saveConfig();
        this.renderKanban();
    },

    // 快速新增 Group
    quickAddGroup: async function(clusterId) {
        const name = prompt("請輸入 Group 名稱:");
        if (!name) return;
        if (this.currentUnitData.config.groups.find(g => g.name === name)) { alert("名稱重複"); return; }

        const realClusterId = (clusterId === 'unassigned') ? '' : clusterId;
        this.currentUnitData.config.groups.push({ id: name, name: name, clusterId: realClusterId });
        await this.saveConfig();
        this.renderKanban();
        this.renderStaffList();
    },

    // 新增 Tier
    addTier: async function() {
        const input = document.getElementById('newTierInput');
        const val = input.value.trim();
        if(!val) return;
        if(this.currentUnitData.config.tiers.includes(val)) return;
        
        this.currentUnitData.config.tiers.push(val);
        await this.saveConfig();
        this.renderTiers();
        this.renderStaffList();
        input.value = '';
    },

    // 刪除 Cluster
    deleteCluster: async function(id) {
        if(!confirm("刪除此 Cluster？底下的 Group 會變為未分類。")) return;
        this.currentUnitData.config.clusters = this.currentUnitData.config.clusters.filter(c => c.id !== id);
        this.currentUnitData.config.groups.forEach(g => { if(g.clusterId === id) g.clusterId = ''; });
        await this.saveConfig();
        this.renderKanban();
    },

    deleteGroup: async function(id) {
        if(!confirm("刪除此 Group？")) return;
        this.currentUnitData.config.groups = this.currentUnitData.config.groups.filter(g => g.id !== id);
        await this.saveConfig();
        this.renderKanban();
        this.renderStaffList();
    },

    deleteTier: async function(val) {
        if(!confirm("刪除此 Tier？")) return;
        this.currentUnitData.config.tiers = this.currentUnitData.config.tiers.filter(t => t !== val);
        await this.saveConfig();
        this.renderTiers();
        this.renderStaffList();
    },

    // --- 資料庫儲存 ---
    saveConfig: async function(showLoading = true) {
        try {
            if(showLoading) this.isLoading = true;
            await db.collection('units').doc(this.currentUnitId).update({
                config: this.currentUnitData.config,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch(e) {
            console.error(e);
            alert("儲存失敗");
        } finally {
            this.isLoading = false;
        }
    },

    // --- 人員資料載入與更新 ---
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

    updateStaffField: async function(uid, field, value) {
        try {
            const updateData = {};
            updateData[field] = value;
            updateData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('users').doc(uid).update(updateData);
            
            const staff = this.staffList.find(s => s.uid === uid);
            if(staff) staff[field] = value;
            console.log(`Updated ${uid}: ${field} = ${value}`);
        } catch (e) { console.error(e); }
    }
};
