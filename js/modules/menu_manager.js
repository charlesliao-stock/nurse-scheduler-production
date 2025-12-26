// js/modules/menu_manager.js

const menuManager = {
    allMenus: [],

    // --- 初始化 ---
    init: async function() {
        console.log("Menu Manager Loaded.");
        
        // 權限保護：只有系統管理員能進來
        if (app.userRole !== 'system_admin') {
            document.getElementById('content-area').innerHTML = '<h3 style="color:red; padding:20px;">權限不足：僅系統管理員可存取選單設定</h3>';
            return;
        }

        await this.fetchData();
    },

    // --- 1. 讀取資料 ---
    fetchData: async function() {
        const tbody = document.getElementById('menuTableBody');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">載入中...</td></tr>';

        try {
            // 依照 order 排序
            const snapshot = await db.collection('system_menus').orderBy('order').get();
            this.allMenus = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            this.renderTable();
        } catch (e) {
            console.error("Fetch Menus Error:", e);
            tbody.innerHTML = '<tr><td colspan="7" style="color:red;">載入失敗</td></tr>';
        }
    },

    // --- 2. 渲染表格 ---
    renderTable: function() {
        const tbody = document.getElementById('menuTableBody');
        tbody.innerHTML = '';

        if (this.allMenus.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">無選單資料</td></tr>';
            return;
        }

        this.allMenus.forEach(m => {
            const statusBadge = m.isActive ? 
                '<span style="color:green; font-weight:bold;">啟用</span>' : 
                '<span style="color:#999;">停用</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${m.order}</td>
                <td style="text-align:center; font-size:1.2rem;"><i class="${m.icon}"></i></td>
                <td>${m.label}</td>
                <td>${m.path}</td>
                <td><span style="font-size:0.85rem; background:#eee; padding:2px 5px; border-radius:3px;">${m.requiredPermission || '無限制'}</span></td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-edit" onclick="menuManager.openModal('${m.id}')">編輯</button>
                    <button class="btn btn-delete" onclick="menuManager.deleteMenu('${m.id}')">刪除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // --- 3. Modal 操作 ---
    openModal: function(menuId = null) {
        const modal = document.getElementById('menuModal');
        modal.classList.add('show');
        
        document.getElementById('menuDocId').value = menuId || '';
        document.getElementById('currentMode').value = menuId ? 'edit' : 'add';

        if (menuId) {
            const m = this.allMenus.find(x => x.id === menuId);
            if (m) {
                document.getElementById('inputMenuLabel').value = m.label;
                document.getElementById('inputMenuOrder').value = m.order;
                document.getElementById('inputMenuPath').value = m.path;
                document.getElementById('inputMenuIcon').value = m.icon;
                document.getElementById('inputMenuPerm').value = m.requiredPermission || '';
                document.getElementById('checkMenuActive').checked = m.isActive;
                this.previewIcon();
            }
        } else {
            // 新增預設值
            document.getElementById('inputMenuLabel').value = '';
            document.getElementById('inputMenuOrder').value = this.allMenus.length + 1;
            document.getElementById('inputMenuPath').value = '';
            document.getElementById('inputMenuIcon').value = 'fas fa-circle';
            document.getElementById('inputMenuPerm').value = '';
            document.getElementById('checkMenuActive').checked = true;
            this.previewIcon();
        }
    },

    closeModal: function() {
        document.getElementById('menuModal').classList.remove('show');
    },

    previewIcon: function() {
        const iconClass = document.getElementById('inputMenuIcon').value;
        document.getElementById('iconPreview').innerHTML = `<i class="${iconClass}"></i>`;
    },

    // --- 4. 儲存資料 ---
    saveData: async function() {
        const docId = document.getElementById('menuDocId').value;
        const label = document.getElementById('inputMenuLabel').value.trim();
        const order = parseInt(document.getElementById('inputMenuOrder').value) || 0;
        const path = document.getElementById('inputMenuPath').value.trim();
        const icon = document.getElementById('inputMenuIcon').value.trim();
        const perm = document.getElementById('inputMenuPerm').value.trim();
        const isActive = document.getElementById('checkMenuActive').checked;

        if (!label || !path) {
            alert("名稱與路徑為必填！"); return;
        }

        const data = {
            label: label,
            order: order,
            path: path,
            icon: icon,
            requiredPermission: perm,
            isActive: isActive
        };

        try {
            if (docId) {
                await db.collection('system_menus').doc(docId).update(data);
            } else {
                await db.collection('system_menus').add(data);
            }
            
            alert("儲存成功！請重新整理網頁以更新左側選單。");
            this.closeModal();
            // 重新讀取表格
            await this.fetchData();
            // [選擇性] 即時更新左側選單 (呼叫 app.js 的方法)
            if(typeof app !== 'undefined' && app.renderMenu) {
                app.renderMenu(); 
            }

        } catch (e) {
            alert("儲存失敗: " + e.message);
        }
    },

    deleteMenu: async function(id) {
        if(confirm("確定要刪除此選單嗎？")) {
            try {
                await db.collection('system_menus').doc(id).delete();
                await this.fetchData();
                if(typeof app !== 'undefined' && app.renderMenu) app.renderMenu();
            } catch(e) {
                alert("刪除失敗: " + e.message);
            }
        }
    }
};
