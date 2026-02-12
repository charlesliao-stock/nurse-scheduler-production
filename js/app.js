// js/app.js

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],
    authStateInitialized: false,
    impersonatedRole: null,
    impersonatedUid: null,
    impersonatedUnitId: null,
    originalRole: null,
    originalUid: null,
    _allUsersForImp: null,

    init: function() {
        console.log("🚀 App initializing...");
        this.setupGlobalErrorHandling();
        this.setupEventListeners();

        if(!this.authStateInitialized) {
            this.authStateInitialized = true;
            auth.onAuthStateChanged(async (user) => {
                try {
                    if (user) {
                        console.log("✅ User logged in:", user.uid);
                        this.currentUser = user;
                        await this.loadUserContext(user.uid);
                        
                        document.getElementById('login-view').style.display = 'none';
                        document.getElementById('app-view').style.display = 'flex';
                        
                        const currentHash = window.location.hash.slice(1);
                        if(typeof router !== 'undefined') {
                            router.load(currentHash || '/admin/dashboard');
                        }
                    } else {
                        console.log("❌ User logged out");
                        this.handleLogout();
                    }
                } catch(error) {
                    console.error("Auth State Error:", error);
                    if (user) auth.signOut();
                }
            });
        }
    },

    getPreScheduleStatus: function(d) {
        const today = new Date().toISOString().split('T')[0];
        const s = d.settings || {};
        
        if (d.status === 'published') return { code: 'published', text: '已鎖定(班表公佈)', color: '#3498db', canEdit: false };
        if (d.status === 'closed') return { code: 'closed', text: '已鎖定(預班結束)', color: '#7f8c8d', canEdit: false };
        
        const openDate = s.openDate || '9999-12-31';
        const closeDate = s.closeDate || '1970-01-01';

        if (today < openDate) return { code: 'preparing', text: '準備中', color: '#f1c40f', canEdit: false };
        if (today > closeDate) return { code: 'expired', text: '已鎖定(預班結束)', color: '#e67e22', canEdit: false };
        
        let text = '開放中';
        if (d.isManualOpen) text = '開放中 (管理者開放)';
        return { code: 'open', text: text, color: '#2ecc71', canEdit: true };
    },

    getScheduleStatus: function(sch) {
        if (!sch) return { code: 'none', text: '準備中', color: '#ccc' };
        if (sch.status === 'published') return { code: 'published', text: '已發布', color: '#2ecc71' };
        return { code: 'draft', text: '排班中', color: '#f1c40f' };
    },

    setupGlobalErrorHandling: function() {
        window.addEventListener('error', (event) => { console.error("全域錯誤:", event.error); });
        window.addEventListener('unhandledrejection', (event) => { console.error("Promise 錯誤:", event.reason); });
    },

    setupEventListeners: function() {
        window.addEventListener('hashchange', () => {
            const path = window.location.hash.slice(1);
            if (path && typeof router !== 'undefined') router.load(path);
        });
    },

    login: async function() {
        const email = document.getElementById('loginEmail')?.value.trim();
        const pass = document.getElementById('loginPassword')?.value;
        const errorMsg = document.getElementById('loginError');
        if(!email || !pass) return;
        try {
            await auth.signInWithEmailAndPassword(email, pass);
        } catch (e) {
            if(errorMsg) errorMsg.textContent = "登入失敗: " + e.message;
        }
    },

    logout: function() {
        if(confirm("確定要登出嗎?")) {
            CacheManager.clear();
            auth.signOut();
        }
    },

    handleLogout: function() {
        this.currentUser = null;
        this.userRole = null;
        this.impersonatedRole = null;
        localStorage.removeItem('impersonatedUser');
        CacheManager.clear();
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('app-view').style.display = 'none';
        if(typeof router !== 'undefined') router.reset();
    },

    loadUserContext: async function(uid) {
        this.originalUid = uid;
        
        try {
            // 確保 DataLoader 已載入且 loadUser 存在
            if (typeof DataLoader === 'undefined' || typeof DataLoader.loadUser !== 'function') {
                throw new Error("DataLoader.loadUser is not available");
            }

            const userDoc = await DataLoader.loadUser(uid);
            if(!userDoc) {
                console.warn("User document not found for UID:", uid);
                return;
            }

            const data = userDoc;
            this.userRole = data.role || 'user';
            this.userUnitId = data.unitId;

            const savedImpersonation = localStorage.getItem('impersonatedUser');
            if (this.userRole === 'system_admin' && savedImpersonation) {
                try {
                    const impData = JSON.parse(savedImpersonation);
                    this.impersonatedUid = impData.uid;
                    this.impersonatedRole = impData.role;
                    this.impersonatedUnitId = impData.unitId;
                } catch (e) { localStorage.removeItem('impersonatedUser'); }
            }

            await this.renderMenu();
            if (this.userRole === 'system_admin') await this.renderImpersonationTool();
            
            const activeRole = this.impersonatedRole || this.userRole;
            if(document.getElementById('displayUserName')) 
                document.getElementById('displayUserName').textContent = data.displayName || '使用者';
            if(document.getElementById('displayUserRole')) {
                const roleText = this.translateRole(activeRole);
                document.getElementById('displayUserRole').innerHTML = this.impersonatedUid ? 
                    `${roleText} <span style="font-size:0.7rem; color:#e74c3c; font-weight:bold;">(模擬中)</span>` : roleText;
            }
        } catch(e) {
            console.error("Load User Context Error:", e);
            // 即使載入失敗，也嘗試渲染基本選單
            this.userRole = this.userRole || 'user';
            await this.renderMenu();
        }
    },

    renderMenu: async function() {
        const menuList = document.getElementById('dynamicMenu');
        if(!menuList) return;
        try {
            const activeUnitId = this.getUnitId();
            let hasPreScheduleShifts = false;
            
            // 1. 檢查該單位是否有開放預班功能 (使用快取)
            if (activeUnitId) {
                const shifts = await DataLoader.loadShifts(activeUnitId);
                hasPreScheduleShifts = shifts.some(s => s.isPreScheduleAvailable === true);
            }

            // 2. 載入選單資料 (使用持久化快取)
            const menus = await DataLoader.loadMenus();
            
            menuList.innerHTML = '';
            const activeRole = this.impersonatedRole || this.userRole;
            
            menus.forEach(menu => {
                const hasRolePermission = (menu.allowedRoles || []).length === 0 || (menu.allowedRoles || []).includes(activeRole);
                if (!hasRolePermission) return;

                const isPreScheduleMenu = menu.path.includes('pre_schedule');
                if (isPreScheduleMenu && !hasPreScheduleShifts && activeRole !== 'system_admin') {
                    return;
                }

                const li = document.createElement('li');
                li.innerHTML = `<a class="menu-link" href="#${menu.path}"><i class="${menu.icon}"></i> ${menu.label}</a>`;
                menuList.appendChild(li);
            });
        } catch (e) { console.error("Menu Error:", e); }
    },

    getUid: function() { return this.impersonatedUid || (this.currentUser ? this.currentUser.uid : null); },
    getUnitId: function() { return this.impersonatedUnitId || this.userUnitId; },
    
    translateRole: function(role) {
        const map = { 'system_admin': '系統管理員', 'unit_manager': '單位護理長', 'unit_scheduler': '排班人員', 'user': '護理同仁' };
        return map[role] || role;
    },

    renderImpersonationTool: async function() {
        let tool = document.getElementById('impersonation-tool');
        if (!tool) {
            tool = document.createElement('div');
            tool.id = 'impersonation-tool';
            tool.style.cssText = 'padding: 15px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2); font-size: 0.85rem; color: white;';
            const sidebar = document.getElementById('sidebar');
            const logoutBtnContainer = sidebar?.querySelector('div[style*="padding:20px"]');
            if (logoutBtnContainer) sidebar.insertBefore(tool, logoutBtnContainer);
            else if (sidebar) sidebar.appendChild(tool);
        }

        let units = [];
        try {
            units = await DataLoader.loadUnits();
        } catch(e) {
            console.error("Load Units Error:", e);
        }

        if (!this._allUsersForImp) {
            try {
                this._allUsersForImp = await DataLoader.loadAllUsers();
            } catch(e) {
                console.error("Load All Users Error:", e);
                this._allUsersForImp = [];
            }
        }

        let html = '<div style="color:rgba(255,255,255,0.7); margin-bottom:8px; font-weight:bold;"><i class="fas fa-user-secret"></i> 身分模擬系統</div>';
        
        html += '<select id="impUnitSelect" onchange="app.updateImpUserList(this.value)" style="width:100%; padding:6px; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:#2c3e50; color:white; margin-bottom:5px; cursor:pointer;">';
        html += '<option value="">--- 選擇單位 ---</option>';
        units.forEach(u => html += `<option value="${u.id}" ${this.impersonatedUnitId === u.id ? 'selected' : ''}>${u.name}</option>`);
        html += '</select>';

        html += '<select id="impUserSelect" onchange="app.impersonateUser(this.value)" style="width:100%; padding:6px; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:#2c3e50; color:white; margin-bottom:5px; cursor:pointer;">';
        html += '<option value="">--- 選擇人員 ---</option></select>';

        if (this.impersonatedUid) {
            html += `<button onclick="app.clearImpersonation()" style="width:100%; padding:6px; background:#e74c3c; color:white; border:none; border-radius:4px; font-size:0.8rem; cursor:pointer; margin-top:5px; font-weight:bold;"><i class="fas fa-undo"></i> 恢復原始身分</button>`;
        }

        tool.innerHTML = html;
        if (this.impersonatedUnitId) this.updateImpUserList(this.impersonatedUnitId);
    },

    updateImpUserList: function(unitId) {
        const select = document.getElementById('impUserSelect');
        if (!select) return;
        select.innerHTML = '<option value="">--- 選擇人員 ---</option>';
        
        const filtered = unitId ? this._allUsersForImp.filter(u => u.unitId === unitId) : this._allUsersForImp;
        filtered.forEach(u => {
            const data = { uid: u.uid, role: u.role, unitId: u.unitId, name: u.displayName };
            const selected = this.impersonatedUid === u.uid ? 'selected' : '';
            select.innerHTML += `<option value='${JSON.stringify(data)}' ${selected}>${u.displayName} (${this.translateRole(u.role)})</option>`;
        });
    },

    impersonateUser: function(jsonStr) {
        if (!jsonStr) return;
        localStorage.setItem('impersonatedUser', jsonStr);
        CacheManager.clear();
        location.reload();
    },

    clearImpersonation: function() {
        localStorage.removeItem('impersonatedUser');
        CacheManager.clear();
        location.reload();
    },

    toggleSidebar: function() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.toggle('collapsed');
        }
    }
};
