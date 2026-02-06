// js/modules/menu_manager.js (優化版)

const menuManager = {
    allMenus: [],
    sortState: { field: 'order', order: 'asc' },
    isLoading: false,

    // --- 初始化 ---
    init: async function() {
        console.log("Menu Manager Loaded.");
        
        // 權限保護：只有系統管理員能進來
        if (app.userRole !== 'system_admin') {
            document.getElementById('content-area').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-shield-alt"></i>
                    <h3>權限不足</h3>
                    <p>僅系統管理員可存取選單設定</p>
                </div>
            `;
            return;
        }

        await this.fetchData();
    },

    // --- 1. 讀取資料 ---
    fetchData: async function() {
        if(this.isLoading) {
            console.log("資料載入中...");
            return;
        }

        const tbody = document.getElementById('menuTableBody');
        if(!tbody) {
            console.error("找不到表格 tbody");
            return;
        }

        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">載入中...</td></tr>';
        this.isLoading = true;

        try {
            const snapshot = await db.collection('system_menus').orderBy('order').get();
            this.allMenus = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            console.log(`成功載入 ${this.allMenus.length} 個選單項目`);
            this.renderTable();
            
        } catch (e) {
            console.error("Fetch Menus Error:", e);
            tbody.innerHTML = '<tr><td colspan="7" style="color:red;">載入失敗: ' + e.message + '</td></tr>';
        } finally {
            this.isLoading = false;
        }
    },

    // --- 2. 排序功能 ---
    sortData: function(field) {
        if (this.sortState.field === field) {
            this.sortState.order = this.sortState.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.field = field;
            this.sortState.order = 'asc';
        }
        this.renderTable();
    },

    // --- 3. 渲染表格 ---
    renderTable: function() {
        const tbody = document.getElementById('menuTableBody');
        if(!tbody) return;
        
        tbody.innerHTML = '';

        // 更新表頭圖示
        document.querySelectorAll('th i[id^="sort_icon_menu_"]').forEach(i => {
            i.className = 'fas fa-sort';
        });
        const activeIcon = document.getElementById(`sort_icon_menu_${this.sortState.field}`);
        if(activeIcon) {
            activeIcon.className = this.sortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
        }

        if (this.allMenus.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#999;">無選單資料<br><button class="btn btn-add" style="margin-top:10px;" onclick="menuManager.openModal()">立即新增</button></td></tr>';
            return;
        }

        // 排序
        const { field, order } = this.sortState;
        const sorted = [...this.allMenus].sort((a, b) => {
            let valA = a[field];
            let valB = b[field];

            // 特殊處理布林值
            if (field === 'isActive') {
                valA = valA ? 1 : 0;
                valB = valB ? 1 : 0;
            }

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        // 渲染
        const fragment = document.createDocumentFragment();

        sorted.forEach(m => {
            const statusBadge = m.isActive ? 
                '<span class="badge" style="background:#27ae60;">啟用</span>' : 
                '<span class="badge" style="background:#95a5a6;">停用</span>';

            const roles = m.allowedRoles || [];
            const roleLabels = roles.map(r => {
                const map = { 'system_admin': '管', 'unit_manager': '長', 'unit_scheduler': '排', 'user': '師' };
                return `<span class="badge" style="background:#3498db; margin-right:2px; padding:2px 4px;">${map[r] || r}</span>`;
            }).join('') || '<span style="color:#ccc;">無限制</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${m.order}</strong></td>
                <td style="text-align:center; font-size:1.2rem;"><i class="${m.icon}"></i></td>
                <td>${m.label}</td>
                <td><code style="font-size:0.85rem; background:#f8f9fa; padding:2px 6px; border-radius:3px;">${m.path}</code></td>
                <td>${roleLabels}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-edit" onclick="menuManager.openModal('${m.id}')">編輯</button>
                    <button class="btn btn-delete" onclick="menuManager.deleteMenu('${m.id}')">刪除</button>
                </td>
            `;
            fragment.appendChild(tr);
        });

        tbody.appendChild(fragment);
    },

    // --- 4. Modal 操作 ---
    openModal: function(menuId = null) {
        const modal = document.getElementById('menuModal');
        if(!modal) {
            console.error("找不到 Modal");
            return;
        }
        
        modal.classList.add('show');
        
        document.getElementById('menuDocId').value = menuId || '';
        document.getElementById('currentMode').value = menuId ? 'edit' : 'add';

        if (menuId) {
            // 編輯模式
            const m = this.allMenus.find(x => x.id === menuId);
            if (!m) {
                alert("找不到該選單資料");
                this.closeModal();
                return;
            }
            
            document.getElementById('inputMenuLabel').value = m.label;
            document.getElementById('inputMenuOrder').value = m.order;
            document.getElementById('inputMenuPath').value = m.path;
            document.getElementById('inputMenuIcon').value = m.icon;
            
            // 設定勾選框
            const allowedRoles = m.allowedRoles || [];
            document.querySelectorAll('input[name="allowedRoles"]').forEach(cb => {
                cb.checked = allowedRoles.includes(cb.value);
            });

            document.getElementById('checkMenuActive').checked = m.isActive !== false; // 預設 true
            this.previewIcon();
            
        } else {
            // 新增模式 - 預設值
            document.getElementById('inputMenuLabel').value = '';
            document.getElementById('inputMenuOrder').value = this.allMenus.length + 1;
            document.getElementById('inputMenuPath').value = '';
            document.getElementById('inputMenuIcon').value = 'fas fa-circle';
            
            // 清除勾選框
            document.querySelectorAll('input[name="allowedRoles"]').forEach(cb => cb.checked = false);

            document.getElementById('checkMenuActive').checked = true;
            this.previewIcon();
        }
    },

    closeModal: function() {
        const modal = document.getElementById('menuModal');
        if(modal) modal.classList.remove('show');
    },

    previewIcon: function() {
        const iconClass = document.getElementById('inputMenuIcon')?.value || 'fas fa-question';
        const preview = document.getElementById('iconPreview');
        if(preview) {
            preview.innerHTML = `<i class="${iconClass}"></i>`;
        }
    },

    // --- 5. 儲存資料 ---
    saveData: async function() {
        const docId = document.getElementById('menuDocId').value;
        const label = document.getElementById('inputMenuLabel').value.trim();
        const order = parseInt(document.getElementById('inputMenuOrder').value);
        const path = document.getElementById('inputMenuPath').value.trim();
        const icon = document.getElementById('inputMenuIcon').value.trim();
        
        // 取得勾選的角色
        const allowedRoles = [];
        document.querySelectorAll('input[name="allowedRoles"]:checked').forEach(cb => {
            allowedRoles.push(cb.value);
        });

        const isActive = document.getElementById('checkMenuActive').checked;

        // 驗證
        if (!label) { 
            alert("請輸入選單名稱"); 
            document.getElementById('inputMenuLabel').focus();
            return; 
        }
        if (!path) { 
            alert("請輸入路徑"); 
            document.getElementById('inputMenuPath').focus();
            return; 
        }
        if (isNaN(order)) { 
            alert("排序必須為數字"); 
            document.getElementById('inputMenuOrder').focus();
            return; 
        }

        // 路徑格式驗證
        if (!path.startsWith('/')) {
            alert("路徑必須以 / 開頭");
            document.getElementById('inputMenuPath').focus();
            return;
        }

        const data = {
            label: label,
            order: order,
            path: path,
            icon: icon || 'fas fa-circle',
            allowedRoles: allowedRoles,
            isActive: isActive,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (docId) {
                // 更新
                await db.collection('system_menus').doc(docId).update(data);
            } else {
                // 新增
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('system_menus').add(data);
            }
            
            alert("儲存成功！請重新整理網頁以更新左側選單。");
            this.closeModal();
            
            // 重新讀取表格
            await this.fetchData();
            
            // 即時更新左側選單
            if(typeof app !== 'undefined' && app.renderMenu) {
                await app.renderMenu(); 
            }

        } catch (e) {
            console.error("Save Error:", e);
            alert("儲存失敗: " + e.message);
        }
    },

    // --- 6. 刪除選單 ---
    deleteMenu: async function(id) {
        const menu = this.allMenus.find(m => m.id === id);
        
        if(!confirm(`確定要刪除選單「${menu?.label || ''}」嗎？\n\n刪除後將從系統中移除,所有使用者都無法看到此選單。`)) {
            return;
        }

        try {
            await db.collection('system_menus').doc(id).delete();
            alert("刪除成功");
            await this.fetchData();
            
            // 即時更新左側選單
            if(typeof app !== 'undefined' && app.renderMenu) {
                await app.renderMenu();
            }
            
        } catch(e) {
            console.error("Delete Error:", e);
            alert("刪除失敗: " + e.message);
        }
    }
};
