// js/app.js (統一狀態邏輯優化版)

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

    /**
     * 🟢 全域預班狀態判定引擎 (唯一權威來源)
     * @param {Object} d - 預班表文件的 data()
     * @returns {Object} { code: 狀態碼, text: 顯示文字, color: 代表顏色, canEdit: 是否可填寫 }
     */
    getPreScheduleStatus: function(d) {
        const today = new Date().toISOString().split('T')[0];
        const s = d.settings || {};
        
        // 1. 管理者手動狀態優先
        if (d.status === 'published') {
            return { code: 'published', text: '已公佈', color: '#3498db', canEdit: false };
        }
        if (d.status === 'closed') {
            return { code: 'closed', text: '已鎖定', color: '#7f8c8d', canEdit: false };
        }
        
        // 2. 自動日期判定
        const openDate = s.openDate || '9999-12-31';
        const closeDate = s.closeDate || '1970-01-01';

        if (today < openDate) {
            return { code: 'preparing', text: '準備中', color: '#f1c40f', canEdit: false };
        } else if (today > closeDate) {
            return { code: 'expired', text: '已截止', color: '#e67e22', canEdit: false };
        }
        
        // 3. 符合日期且未被鎖定
        return { code: 'open', text: '開放中', color: '#2ecc71', canEdit: true };
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
        if(confirm("確定要登出嗎?")) auth.signOut();
    },

    handleLogout: function() {
        this.currentUser = null;
        this.userRole = null;
        this.impersonatedRole = null;
        localStorage.removeItem('impersonatedUser');
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('app-view').style.display = 'none';
        if(typeof router !== 'undefined') router.reset();
    },

    loadUserContext: async function(uid) {
        this.originalUid = uid;
        let userDoc = await db.collection('users').doc(uid).get();
        if(!userDoc.exists) return;

        const data = userDoc.data();
        this.userRole = data.role || 'user';
        this.userUnitId = data.unitId;

        // 處理管理員模擬身分
        const savedImpersonation = localStorage.getItem('impersonatedUser');
        if (this.userRole === 'system_admin' && savedImpersonation) {
            const impData = JSON.parse(savedImpersonation);
            this.impersonatedUid = impData.uid;
            this.impersonatedRole = impData.role;
            this.impersonatedUnitId = impData.unitId;
        }

        await this.renderMenu();
        if (this.userRole === 'system_admin') await this.renderImpersonationTool();
        
        const activeRole = this.impersonatedRole || this.userRole;
        const displayRoleName = this.translateRole(activeRole);
        
        if(document.getElementById('displayUserName')) 
            document.getElementById('displayUserName').textContent = data.displayName || '使用者';
        if(document.getElementById('displayUserRole')) 
            document.getElementById('displayUserRole').textContent = displayRoleName;
    },

    renderMenu: async function() {
        const menuList = document.getElementById('dynamicMenu');
        if(!menuList) return;
        
        try {
            const snapshot = await db.collection('system_menus')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();
            
            menuList.innerHTML = '';
            const activeRole = this.impersonatedRole || this.userRole;

            snapshot.forEach(doc => {
                const menu = doc.data();
                const allowedRoles = menu.allowedRoles || [];
                if (allowedRoles.length === 0 || allowedRoles.includes(activeRole)) {
                    const li = document.createElement('li');
                    li.innerHTML = `<a class="menu-link" href="#${menu.path}"><i class="${menu.icon}"></i> ${menu.label}</a>`;
                    menuList.appendChild(li);
                }
            });
        } catch (e) { console.error("Menu Error:", e); }
    },

    getUid: function() { return this.impersonatedUid || (this.currentUser ? this.currentUser.uid : null); },
    getUnitId: function() { return this.impersonatedUnitId || this.userUnitId; },
    
    translateRole: function(role) {
        const map = { 
            'system_admin': '系統管理員', 
            'unit_manager': '單位護理長', 
            'unit_scheduler': '排班人員', 
            'user': '護理同仁' 
        };
        return map[role] || role;
    },

    // 模擬工具 (僅限管理員)
    renderImpersonationTool: async function() {
        const toolId = 'admin-imp-tool';
        let tool = document.getElementById(toolId);
        if(!tool) {
            tool = document.createElement('div');
            tool.id = toolId;
            tool.className = 'admin-only-tool';
            document.body.appendChild(tool);
        }

        const activeRole = this.impersonatedRole || this.userRole;
        const isImp = !!this.impersonatedUid;

        tool.innerHTML = `
            <div style="background:#2c3e50; color:white; padding:10px; font-size:12px; border-radius:8px 8px 0 0;">
                <i class="fas fa-user-secret"></i> 身分模擬系統
            </div>
            <div style="padding:10px; background:#f8f9fa; border:1px solid #ddd; border-top:none; border-radius:0 0 8px 8px;">
                ${isImp ? `<div style="color:#e74c3c; margin-bottom:8px; font-weight:bold;">目前模擬中: ${this.translateRole(activeRole)}</div>` : ''}
                <select id="impUserSelect" style="width:100%; margin-bottom:8px; padding:5px;"></select>
                <div style="display:flex; gap:5px;">
                    <button onclick="app.startImpersonation()" style="flex:1; padding:5px; background:#3498db; color:white; border:none; border-radius:4px;">模擬</button>
                    ${isImp ? `<button onclick="app.stopImpersonation()" style="flex:1; padding:5px; background:#95a5a6; color:white; border:none; border-radius:4px;">恢復</button>` : ''}
                </div>
            </div>
        `;

        if(!this._allUsersForImp) {
            const snap = await db.collection('users').get();
            this._allUsersForImp = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        }

        const select = document.getElementById('impUserSelect');
        select.innerHTML = '<option value="">請選擇對象...</option>';
        this._allUsersForImp.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.uid;
            opt.textContent = `${u.displayName} (${this.translateRole(u.role)})`;
            if(this.impersonatedUid === u.uid) opt.selected = true;
            select.appendChild(opt);
        });
    },

    startImpersonation: function() {
        const uid = document.getElementById('impUserSelect').value;
        if(!uid) return;
        const u = this._allUsersForImp.find(x => x.uid === uid);
        localStorage.setItem('impersonatedUser', JSON.stringify({ uid: u.uid, role: u.role, unitId: u.unitId }));
        location.reload();
    },

    stopImpersonation: function() {
        localStorage.removeItem('impersonatedUser');
        location.reload();
    }
};
