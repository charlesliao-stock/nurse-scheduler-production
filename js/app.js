// js/app.js
// 🔧 最終完整修正版：包含模擬功能、選單修復與啟動檢查

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],
    authStateInitialized: false,
    
    // 模擬狀態 (Impersonation)
    impersonatedRole: null, 
    impersonatedUid: null,  
    impersonatedUnitId: null, 
    
    // 原始狀態 (用於還原)
    originalRole: null,    
    originalUid: null,     

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
                } catch (error) {
                    console.error("Auth State Change Error:", error);
                    if(user) auth.signOut(); // 若載入失敗則強制登出避免卡住
                    alert(`初始化失敗: ${error.message}`);
                }
            });
        }
    },

    setupGlobalErrorHandling: function() {
        window.addEventListener('error', (event) => { console.error("全域錯誤:", event.error); });
        window.addEventListener('unhandledrejection', (event) => { console.error("未處理的 Promise 錯誤:", event.reason); });
    },

    setupEventListeners: function() {
        window.addEventListener('hashchange', () => {
            const path = window.location.hash.slice(1);
            if (path && typeof router !== 'undefined') router.load(path);
            
            // 更新選單高亮
            document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            const activeLink = document.querySelector(`.menu-item[href="#${path}"]`);
            if(activeLink) activeLink.classList.add('active');
        });
    },

    // --- 2. 登入 ---
    login: async function() {
        const email = document.getElementById('loginEmail')?.value.trim();
        const pass = document.getElementById('loginPassword')?.value;
        const errorMsg = document.getElementById('loginError');
        
        if(!errorMsg) return;
        if(!email || !pass) { 
            errorMsg.textContent = "請輸入帳號與密碼"; 
            return; 
        }

        const loginBtn = event.target;
        loginBtn.disabled = true;
        loginBtn.textContent = "登入中...";
        errorMsg.textContent = "";

        try {
            await auth.signInWithEmailAndPassword(email, pass);
        } catch (e) {
            console.error("Login Error:", e);
            let errorMessage = "登入失敗";
            if(e.code === 'auth/user-not-found') errorMessage = "帳號不存在";
            else if(e.code === 'auth/wrong-password') errorMessage = "密碼錯誤";
            else if(e.code === 'auth/invalid-email') errorMessage = "電子郵件格式不正確";
            else if(e.code === 'auth/user-disabled') errorMessage = "此帳號已被停用";
            else if(e.code === 'auth/too-many-requests') errorMessage = "嘗試次數過多,請稍後再試";
            
            errorMsg.textContent = errorMessage;
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = "登入";
        }
    },

    logout: function() {
        if(confirm("確定要登出嗎?")) {
            auth.signOut().catch((error) => {
                console.error("Logout Error:", error);
                alert("登出失敗: " + error.message);
            });
        }
    },

    handleLogout: function() {
        this.currentUser = null;
        this.userRole = null;
        this.userUnitId = null;
        this.permissions = [];
        this.clearImpersonation(); // 登出時一併清除模擬
        
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('app-view').style.display = 'none';
        
        // 清空輸入框
        const emailInput = document.getElementById('loginEmail');
        const passInput = document.getElementById('loginPassword');
        if(emailInput) emailInput.value = '';
        if(passInput) passInput.value = '';
        
        window.location.hash = '';
    },

    // --- 3. 載入使用者情境 ---
    loadUserContext: async function(uid) {
        try {
            console.log('📂 正在載入使用者資料:', uid);
            this.originalUid = uid;
            
            let userDoc = await db.collection('users').doc(uid).get();
            
            if(!userDoc.exists) {
                console.warn('⚠️ 使用者文件不存在, 建立預設文件');
                // 若是剛註冊的使用者，可能還沒有 Firestore 文件，這裡做自動補建
                await db.collection('users').doc(uid).set({
                    email: this.currentUser.email,
                    displayName: this.currentUser.email.split('@')[0],
                    role: 'user',
                    unitId: null,
                    isActive: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                userDoc = await db.collection('users').doc(uid).get();
            }
            
            const data = userDoc.data();
            if(data.isActive === false) throw new Error("此帳號已被停用");

            // 設定基本資訊
            this.userRole = data.role || 'user'; 
            this.originalRole = this.userRole;
            this.userUnitId = data.unitId;

            // 更新 UI 顯示 (初始)
            this.updateUIByRole();
            
            // 載入權限
            // const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
            // this.permissions = roleDoc.exists ? (roleDoc.data().permissions || []) : [];

            // 只有系統管理員才顯示模擬工具列
            if (this.originalRole === 'system_admin') {
                this.renderAdminToolbar();
            }
            
            // 首次載入選單
            await this.renderMenu();

            // 更新最後登入時間
            db.collection('users').doc(uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.warn(e));

        } catch (error) {
            console.error("❌ Load Context Error:", error);
            throw error;
        }
    },

    // --- 4. [核心] Helper Methods (支援模擬) ---
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
    
    translateRole: function(role) {
        const map = {
            'system_admin': '系統管理員',
            'unit_manager': '單位護理長',
            'unit_scheduler': '排班人員',
            'user': '護理師'
        };
        return map[role] || role;
    },

    // --- 5. 選單渲染 (修復版：自動偵測 ID) ---
    renderMenu: async function() {
        // 嘗試尋找兩種常見的選單容器 ID
        const menuContainer = document.getElementById('sidebar-menu') || document.getElementById('dynamicMenu');
        
        if (!menuContainer) {
            console.error("❌ 錯誤：找不到選單容器 (ID 應為 'sidebar-menu' 或 'dynamicMenu')，無法顯示選單。");
            return;
        }
        
        menuContainer.innerHTML = '<li style="padding:10px; text-align:center;"><i class="fas fa-spinner fa-spin"></i></li>';

        try {
            const activeRole = this.getRole(); // 使用 Helper 取得當前角色 (含模擬)

            const snapshot = await db.collection('system_menus')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();

            menuContainer.innerHTML = ''; 
            let menuCount = 0;

            snapshot.forEach(doc => {
                const item = doc.data();
                // 權限過濾
                const allowedRoles = item.allowedRoles || [];
                const hasAccess = allowedRoles.length === 0 || allowedRoles.includes(activeRole);

                if (hasAccess) {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <a href="#${item.path}" class="menu-item" onclick="app.setActiveMenu(this)">
                            <i class="${item.icon}" style="width:20px; text-align:center;"></i>
                            <span style="margin-left:10px;">${item.label}</span>
                        </a>
                    `;
                    menuContainer.appendChild(li);
                    menuCount++;
                }
            });

            // 高亮當前選單
            const currentHash = window.location.hash.slice(1);
            if(currentHash) {
                const activeLink = menuContainer.querySelector(`.menu-item[href="#${currentHash}"]`);
                if(activeLink) activeLink.classList.add('active');
            }
            
            console.log(`✅ 選單載入完成：共 ${menuCount} 個項目 (角色: ${activeRole})`);

        } catch(e) {
            console.error("Render Menu Error:", e);
            menuContainer.innerHTML = '<li style="padding:10px; text-align:center; color:red;"><i class="fas fa-exclamation-triangle"></i> 選單載入失敗</li>';
        }
    },

    setActiveMenu: function(el) {
        document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
    },

    // --- 6. 模擬使用者功能 ---
    renderAdminToolbar: function() {
        const toolId = 'admin-impersonation-tool';
        let tool = document.getElementById(toolId);
        
        if (!tool) {
            tool = document.createElement('div');
            tool.id = toolId;
            document.body.appendChild(tool);
        }
        
        tool.style.cssText = `
            position: fixed; bottom: 10px; right: 10px;
            background: rgba(44, 62, 80, 0.95); color: white;
            padding: 10px; border-radius: 8px; z-index: 9999;
            box-shadow: 0 0 10px rgba(0,0,0,0.3); min-width: 200px;
        `;

        // 如果正在模擬，顯示「還原」按鈕
        if (this.impersonatedRole) {
            tool.innerHTML = `
                <div style="font-size:0.9rem; margin-bottom:5px;">
                    <i class="fas fa-user-secret"></i> 模擬中: ${this.impersonatedUid}<br>
                    角色: ${this.translateRole(this.impersonatedRole)}
                </div>
                <button class="btn btn-sm" onclick="app.clearImpersonation()" style="width:100%; background:#e74c3c; border:none; color:white; padding:5px; border-radius:4px; cursor:pointer;">
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
            try {
                const uSnap = await db.collection('units').get();
                this._allUnitsForImp = uSnap.docs.map(d => ({id:d.id, name:d.data().name}));
                const userSnap = await db.collection('users').get();
                this._allUsersForImp = userSnap.docs.map(d => ({uid:d.id, ...d.data()}));
            } catch(e) { console.error(e); }
        }

        if(this._allUnitsForImp) {
            sel.innerHTML = '<option value="">--- 選擇單位 ---</option>';
            this._allUnitsForImp.forEach(u => {
                sel.innerHTML += `<option value="${u.id}">${u.name}</option>`;
            });
        }
    },

    updateImpUserList: function(unitId) {
        const userSelect = document.getElementById('impUserSelect');
        if (!userSelect) return;

        userSelect.innerHTML = '<option value="">--- 選擇人員 ---</option>';
        
        const filteredUsers = unitId && this._allUsersForImp
            ? this._allUsersForImp.filter(u => u.unitId === unitId)
            : (this._allUsersForImp || []);

        filteredUsers.forEach(u => {
            const roleName = this.translateRole(u.role);
            const val = JSON.stringify({
                uid: u.uid, 
                name: u.displayName || u.name, 
                role: u.role, 
                unitId: u.unitId
            });
            // 處理單引號避免 JSON 解析錯誤
            const safeVal = val.replace(/'/g, "&#39;");
            userSelect.innerHTML += `<option value='${safeVal}'>${u.displayName || u.name} (${roleName})</option>`;
        });
    },

    impersonateUser: function(jsonStr) {
        if (!jsonStr) return;
        localStorage.setItem('impersonatedUser', jsonStr);
        window.location.reload();
    },

    restoreImpersonation: function() {
        const stored = localStorage.getItem('impersonatedUser');
        if (stored) {
            try {
                const data = JSON.parse(stored);
                this.impersonatedUid = data.uid;
                this.impersonatedRole = data.role;
                this.impersonatedUnitId = data.unitId;
                
                console.log("🕵️‍♂️ 進入模擬模式:", data.name);
                
                // 強制覆蓋 UI 與工具列
                this.updateUIByRole(); 
                this.renderAdminToolbar(); 
                // 重新載入選單以套用新權限
                this.renderMenu();
            } catch (e) {
                console.error("Restore Impersonation Failed:", e);
                localStorage.removeItem('impersonatedUser');
            }
        }
    },

    clearImpersonation: function() {
        localStorage.removeItem('impersonatedUser');
        window.location.reload();
    },

    updateUIByRole: function() {
        const role = this.getRole();
        document.body.setAttribute('data-role', role);
        
        const displayRole = this.translateRole(role);
        const userName = (this.impersonatedUid ? '[模] ' : '') + 
                         (this.currentUser ? (this.currentUser.displayName || this.currentUser.email) : '訪客');

        const profileEl = document.getElementById('user-profile-info');
        if(profileEl) {
            profileEl.innerHTML = `
                <div style="font-weight:bold;">${userName}</div>
                <div style="font-size:0.8rem; opacity:0.8;">${displayRole}</div>
            `;
        }
    }
};

// 啟動應用 (修正版：檢查 firebase 而非 config)
document.addEventListener('DOMContentLoaded', () => {
    if(typeof firebase !== 'undefined') {
        app.init();
    } else {
        console.error("Firebase SDK 未載入，無法啟動 App");
        alert("系統錯誤：Firebase SDK 未正確載入，請檢查網路連線或聯繫管理員。");
    }
});
