// js/app.js

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],
    authStateInitialized: false,
    impersonatedRole: null, // 模擬的角色
    originalRole: null,    // 原始角色 (用於權限檢查)

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
                    alert(`初始化失敗: ${error.message}\n請聯繫系統管理員或重新登入。`);
                    if (user) auth.signOut();
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
        });
        window.addEventListener('popstate', () => {
            const path = window.location.hash.slice(1);
            if (path && typeof router !== 'undefined') router.load(path);
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
            errorMsg.style.color = "red";
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
            else if(e.code === 'auth/invalid-credential') errorMessage = "帳號或密碼錯誤";
            
            errorMsg.textContent = errorMessage;
            errorMsg.style.color = "red";
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
        this.impersonatedRole = null;
        this.originalRole = null;
        localStorage.removeItem('impersonatedRole');
        
        const emailInput = document.getElementById('loginEmail');
        const passInput = document.getElementById('loginPassword');
        const errorMsg = document.getElementById('loginError');
        if(emailInput) emailInput.value = '';
        if(passInput) passInput.value = '';
        if(errorMsg) errorMsg.textContent = '';
        
        if(typeof router !== 'undefined') {
            if (typeof router.reset === 'function') {
                router.reset();
            } else {
                if (router.currentView) router.currentView = null;
                if (router.isLoading) router.isLoading = false;
            }
        }
        
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('app-view').style.display = 'none';
        
        if (window.location.hash) {
            history.pushState("", document.title, window.location.pathname + window.location.search);
        }
    },

    // --- 4. 載入使用者 ---
    loadUserContext: async function(uid) {
        try {
            console.log('📂 正在載入使用者資料:', uid);
            let userDoc = await db.collection('users').doc(uid).get();
            
            if(!userDoc.exists) {
                console.warn('⚠️ 使用者文件不存在,正在建立預設文件');
                await db.collection('users').doc(uid).set({
                    email: this.currentUser.email,
                    displayName: this.currentUser.email.split('@')[0],
                    role: 'user',
                    unitId: null,
                    isActive: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                });
                userDoc = await db.collection('users').doc(uid).get();
            }
            
            const data = userDoc.data();
            if(data.isActive === false) throw new Error("此帳號已被停用,請聯繫系統管理員");

            // 設定基本資訊
            this.userRole = data.role || 'user'; 
            this.originalRole = this.userRole;
            this.userUnitId = data.unitId;

            // 處理身分模擬
            const savedImpersonation = localStorage.getItem('impersonatedRole');
            if (this.userRole === 'system_admin' && savedImpersonation) {
                this.impersonatedRole = savedImpersonation;
                console.log(`🎭 偵測到模擬身分: ${this.impersonatedRole}`);
            }

            // 更新 UI 顯示
            const nameEl = document.getElementById('displayUserName');
            const roleEl = document.getElementById('displayUserRole');
            if(nameEl) nameEl.textContent = data.displayName || '使用者';
            
            const activeRole = this.impersonatedRole || this.userRole;
            if(roleEl) {
                roleEl.textContent = this.translateRole(activeRole);
                if (this.impersonatedRole) {
                    roleEl.innerHTML += ' <span style="font-size:0.7rem; color:#e74c3c;">(模擬)</span>';
                }
            }

            // 載入權限
            const roleDoc = await db.collection('system_roles').doc(activeRole).get();
            this.permissions = roleDoc.exists ? (roleDoc.data().permissions || []) : [];

            // 管理員專屬工具
            if (this.userRole === 'system_admin') {
                this.renderImpersonationTool();
            }

            await this.renderMenu();
            
            // 非同步更新最後登入時間
            db.collection('users').doc(uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.warn('更新登入時間失敗:', err));

        } catch (error) {
            console.error("❌ Load Context Error:", error);
            throw error;
        }
    },

    // --- 5. 選單 ---
    renderMenu: async function() {
        const menuList = document.getElementById('dynamicMenu');
        if(!menuList) return;
        
        menuList.innerHTML = '<li style="padding:10px; text-align:center;"><i class="fas fa-spinner fa-spin"></i></li>';

        try {
            const snapshot = await db.collection('system_menus').where('isActive', '==', true).orderBy('order').get();
            menuList.innerHTML = '';
            let menuCount = 0;
            snapshot.forEach(doc => {
                const menu = doc.data();
                if(this.checkPermission(menu.requiredPermission)) {
                    const li = document.createElement('li');
                    li.innerHTML = `<a class="menu-link" href="#${menu.path}"><i class="${menu.icon}"></i> ${menu.label}</a>`;
                    menuList.appendChild(li);
                    menuCount++;
                }
            });
            console.log(`✅ 載入 ${menuCount} 個選單項目`);
        } catch (e) {
            console.error("Menu Render Error:", e);
            menuList.innerHTML = '<li style="padding:10px; text-align:center; color:red;">選單載入失敗</li>';
        }
    },

    toggleSidebar: function() {
        const sidebar = document.getElementById('sidebar');
        if(sidebar) sidebar.classList.toggle('collapsed');
    },

    checkPermission: function(reqPerm) {
        if(this.permissions.includes('*')) return true;
        if(!reqPerm) return true;
        return this.permissions.includes(reqPerm);
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

    // --- 6. 身分模擬工具 ---
    renderImpersonationTool: function() {
        let tool = document.getElementById('impersonation-tool');
        if (!tool) {
            tool = document.createElement('div');
            tool.id = 'impersonation-tool';
            tool.style.cssText = 'padding: 15px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2); font-size: 0.85rem; color: white;';
            
            const sidebar = document.getElementById('sidebar');
            // 尋找登出按鈕的容器
            const logoutContainer = sidebar?.querySelector('div[style*="padding:20px"]');
            
            if (logoutContainer) {
                sidebar.insertBefore(tool, logoutContainer);
            } else if (sidebar) {
                sidebar.appendChild(tool);
            }
        }

        const roles = [
            { id: null, name: '原始身分' },
            { id: 'unit_manager', name: '護理長' },
            { id: 'unit_scheduler', name: '排班人員' },
            { id: 'user', name: '護理師' }
        ];

        let html = '<div style="color:rgba(255,255,255,0.7); margin-bottom:8px; font-weight:bold;"><i class="fas fa-user-secret"></i> 身分模擬視角</div>';
        html += '<select onchange="app.impersonate(this.value)" style="width:100%; padding:6px; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:#2c3e50; color:white; cursor:pointer;">';
        roles.forEach(r => {
            const selected = (this.impersonatedRole === r.id || (this.impersonatedRole === null && r.id === null)) ? 'selected' : '';
            html += `<option value="${r.id || ''}" ${selected} style="background:#2c3e50;">${r.name}</option>`;
        });
        html += '</select>';
        tool.innerHTML = html;
    },

    impersonate: function(roleId) {
        if (!roleId || roleId === '') {
            localStorage.removeItem('impersonatedRole');
        } else {
            localStorage.setItem('impersonatedRole', roleId);
        }
        window.location.reload();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
