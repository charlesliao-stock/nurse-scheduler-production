// js/app.js
// 🔧 完整修正版：新增 Helper Methods 與模擬狀態持久化

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    
    // 模擬狀態
    impersonatedRole: null, 
    impersonatedUid: null,  
    impersonatedUnitId: null, 
    
    // 原始狀態 (用於還原)
    originalRole: null,    
    originalUid: null,     
    
    authStateInitialized: false,

    // --- 1. 系統初始化 ---
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
                        
                        // [新增] 檢查並還原模擬狀態
                        this.restoreImpersonation();

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
                } catch (e) {
                    console.error("Auth State Change Error:", e);
                }
            });
        }
    },

    // --- 2. 載入使用者情境 ---
    loadUserContext: async function(uid) {
        try {
            const doc = await db.collection('users').doc(uid).get();
            if (doc.exists) {
                const data = doc.data();
                this.userRole = data.role || 'user';
                this.userUnitId = data.unitId || null;
                
                // 保存原始資料，作為還原基準
                this.originalRole = this.userRole;
                this.originalUid = uid;

                this.updateUIByRole();
                this.renderMenu();
                
                // 只有系統管理員才顯示模擬工具列
                if (this.originalRole === 'system_admin') {
                    this.renderAdminToolbar();
                }
            } else {
                console.warn("User document not found.");
                this.userRole = 'guest';
            }
        } catch (e) {
            console.error("Load Context Error:", e);
        }
    },

    // --- 3. [新增] 核心 Helper Methods (支援模擬) ---
    // 取得當前視角的 UID
    getUid: function() {
        return this.impersonatedUid || (this.currentUser ? this.currentUser.uid : null);
    },

    // 取得當前視角的 Unit ID
    getUnitId: function() {
        return this.impersonatedUnitId || this.userUnitId;
    },

    // 取得當前視角的角色
    getRole: function() {
        return this.impersonatedRole || this.userRole;
    },

    // --- 4. 模擬使用者功能 ---
    renderAdminToolbar: function() {
        const tool = document.getElementById('admin-impersonation-tool');
        if (!tool) return; // index.html 需預留此 div
        
        tool.style.display = 'block';
        tool.style.position = 'fixed';
        tool.style.bottom = '10px';
        tool.style.right = '10px';
        tool.style.background = 'rgba(44, 62, 80, 0.9)';
        tool.style.padding = '10px';
        tool.style.borderRadius = '8px';
        tool.style.zIndex = '9999';
        tool.style.color = 'white';
        tool.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';

        // 如果正在模擬，顯示「還原」按鈕
        if (this.impersonatedRole) {
            tool.innerHTML = `
                <div style="font-size:0.9rem; margin-bottom:5px;">
                    <i class="fas fa-user-secret"></i> 模擬中: ${this.impersonatedUid}<br>
                    角色: ${this.impersonatedRole}
                </div>
                <button class="btn btn-sm btn-danger" onclick="app.clearImpersonation()" style="width:100%;">
                    恢復原始身分
                </button>
            `;
        } else {
            // 選擇單位與人員進行模擬
            tool.innerHTML = `
                <div style="font-size:0.9rem; margin-bottom:5px;"><i class="fas fa-tools"></i> 管理員工具</div>
                <select id="impUnitSelect" onchange="app.updateImpUserList(this.value)" style="width:100%; margin-bottom:5px; padding:4px; font-size:0.8rem; background:#34495e; color:white; border:none;">
                    <option value="">載入單位...</option>
                </select>
                <select id="impUserSelect" onchange="app.impersonateUser(this.value)" style="width:100%; padding:4px; font-size:0.8rem; background:#34495e; color:white; border:none;">
                    <option value="">請先選單位</option>
                </select>
            `;
            this.loadImpUnits();
        }
    },

    loadImpUnits: async function() {
        const sel = document.getElementById('impUnitSelect');
        if(!sel) return;
        
        // 取得所有單位與人員 (簡單快取)
        if(!this._allUnitsForImp) {
            const uSnap = await db.collection('units').get();
            this._allUnitsForImp = uSnap.docs.map(d => ({id:d.id, name:d.data().name}));
            const userSnap = await db.collection('users').get();
            this._allUsersForImp = userSnap.docs.map(d => ({uid:d.id, ...d.data()}));
        }

        sel.innerHTML = '<option value="">--- 選擇單位 ---</option>';
        this._allUnitsForImp.forEach(u => {
            sel.innerHTML += `<option value="${u.id}">${u.name}</option>`;
        });
    },

    updateImpUserList: function(unitId) {
        const userSelect = document.getElementById('impUserSelect');
        if (!userSelect) return;

        userSelect.innerHTML = '<option value="">--- 選擇人員 ---</option>';
        
        const filteredUsers = unitId 
            ? this._allUsersForImp.filter(u => u.unitId === unitId)
            : this._allUsersForImp;

        filteredUsers.forEach(u => {
            const roleName = this.translateRole(u.role);
            // 存入完整的模擬資訊
            const val = JSON.stringify({
                uid: u.uid, 
                name: u.displayName || u.name, 
                role: u.role, 
                unitId: u.unitId
            });
            userSelect.innerHTML += `<option value='${val}'>${u.displayName || u.name} (${roleName})</option>`;
        });
    },

    // 執行模擬
    impersonateUser: function(jsonStr) {
        if (!jsonStr) return;
        // 存入 localStorage 以便重整後持續
        localStorage.setItem('impersonatedUser', jsonStr);
        window.location.reload();
    },

    // [新增] 還原模擬狀態 (Init 時呼叫)
    restoreImpersonation: function() {
        const stored = localStorage.getItem('impersonatedUser');
        if (stored) {
            try {
                const data = JSON.parse(stored);
                this.impersonatedUid = data.uid;
                this.impersonatedRole = data.role;
                this.impersonatedUnitId = data.unitId;
                
                console.log("🕵️‍♂️ 進入模擬模式:", data.name);
                
                // 強制覆蓋 UI 顯示 (選單等)
                this.updateUIByRole(); 
                this.renderMenu();
                this.renderAdminToolbar(); // 更新工具列狀態
            } catch (e) {
                console.error("Restore Impersonation Failed:", e);
                localStorage.removeItem('impersonatedUser');
            }
        }
    },

    // 清除模擬
    clearImpersonation: function() {
        localStorage.removeItem('impersonatedUser');
        window.location.reload();
    },

    // --- 5. UI 更新 ---
    updateUIByRole: function() {
        const role = this.getRole(); // 使用 Helper
        document.body.setAttribute('data-role', role);
        
        const displayRole = role === 'system_admin' ? '系統管理員' : 
                          role === 'unit_manager' ? '單位護理長' :
                          role === 'unit_scheduler' ? '排班人員' : '護理師';
                          
        const userName = (this.impersonatedUid ? '[模] ' : '') + 
                         (this.currentUser ? (this.currentUser.displayName || this.currentUser.email) : '訪客');

        const profileEl = document.getElementById('user-profile-info');
        if(profileEl) {
            profileEl.innerHTML = `
                <div style="font-weight:bold;">${userName}</div>
                <div style="font-size:0.8rem; opacity:0.8;">${displayRole}</div>
            `;
        }
    },

    // 渲染選單
    renderMenu: async function() {
        const menuContainer = document.getElementById('sidebar-menu');
        if (!menuContainer) return;
        
        menuContainer.innerHTML = ''; 
        const activeRole = this.getRole();

        try {
            const snapshot = await db.collection('system_menus')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();

            snapshot.forEach(doc => {
                const item = doc.data();
                // 權限過濾
                if (!item.allowedRoles || item.allowedRoles.length === 0 || item.allowedRoles.includes(activeRole)) {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <a href="#${item.path}" class="menu-item" onclick="app.setActiveMenu(this)">
                            <i class="${item.icon}" style="width:20px; text-align:center;"></i>
                            <span style="margin-left:10px;">${item.label}</span>
                        </a>
                    `;
                    menuContainer.appendChild(li);
                }
            });

            // 高亮當前選單
            const currentHash = window.location.hash.slice(1);
            const links = document.querySelectorAll('.menu-item');
            links.forEach(l => {
                if(l.getAttribute('href') === '#' + currentHash) l.classList.add('active');
            });

        } catch(e) {
            console.error("Render Menu Error:", e);
        }
    },

    setActiveMenu: function(el) {
        document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
    },

    handleLogout: function() {
        this.currentUser = null;
        this.userRole = null;
        this.clearImpersonation(); // 登出時一併清除模擬
        document.getElementById('app-view').style.display = 'none';
        document.getElementById('login-view').style.display = 'flex';
        window.location.hash = '';
    },

    login: async function() {
        const email = document.getElementById('loginEmail').value;
        const pwd = document.getElementById('loginPassword').value;
        const errEl = document.getElementById('loginError');
        errEl.innerText = '';

        try {
            await auth.signInWithEmailAndPassword(email, pwd);
        } catch (error) {
            errEl.innerText = "登入失敗: " + error.message;
        }
    },

    logout: function() {
        auth.signOut();
    },

    setupGlobalErrorHandling: function() {
        window.onerror = function(msg, url, line) {
            console.error(`Global Error: ${msg} (${url}:${line})`);
        };
    },
    
    setupEventListeners: function() {
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1);
            if(typeof router !== 'undefined') router.load(hash);
            
            // 更新選單高亮
            document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            const activeLink = document.querySelector(`.menu-item[href="#${hash}"]`);
            if(activeLink) activeLink.classList.add('active');
        });
    },

    translateRole: function(role) {
        const map = {
            'system_admin': '系統管理員',
            'unit_manager': '單位護理長',
            'unit_scheduler': '排班人員',
            'user': '護理師'
        };
        return map[role] || role;
    }
};

// js/app.js 最底部

// 啟動應用
document.addEventListener('DOMContentLoaded', () => {
    // 只要 Firebase 有載入成功，就啟動 App
    if(typeof firebase !== 'undefined') {
        app.init();
    } else {
        console.error("Firebase SDK 未載入，無法啟動 App");
    }
});
