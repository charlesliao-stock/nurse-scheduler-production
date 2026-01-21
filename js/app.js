// js/app.js

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],
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
                    // 顯示錯誤訊息給使用者
                    alert(`初始化失敗: ${error.message}\n請聯繫系統管理員或重新登入。`);
                    // 發生錯誤時強制登出,避免卡在錯誤狀態
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

    // --- 3. 登出 ---
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
        
        const emailInput = document.getElementById('loginEmail');
        const passInput = document.getElementById('loginPassword');
        const errorMsg = document.getElementById('loginError');
        if(emailInput) emailInput.value = '';
        if(passInput) passInput.value = '';
        if(errorMsg) errorMsg.textContent = '';
        
        // [關鍵修正] 加入安全檢查,防止 router.reset 不存在時報錯
        if(typeof router !== 'undefined') {
            if (typeof router.reset === 'function') {
                router.reset();
            } else {
                console.warn("router.reset is not defined. Skipping router reset.");
                // 手動重置基本狀態
                if (router.currentView) router.currentView = null;
                if (router.isLoading) router.isLoading = false;
            }
        }
        
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('app-view').style.display = 'none';
        
        // 只有當 hash 不為空時才清除,避免無窮迴圈
        if (window.location.hash) {
            history.pushState("", document.title, window.location.pathname + window.location.search);
        }
    },

    // --- 4. 載入使用者 [關鍵改善] ---
    loadUserContext: async function(uid) {
        try {
            console.log('📂 正在載入使用者資料:', uid);
            
            const userDoc = await db.collection('users').doc(uid).get();
            
            // 如果使用者文件不存在,建立預設文件
            if(!userDoc.exists) {
                console.warn('⚠️ 使用者文件不存在,正在建立預設文件');
                
                // 建立基本使用者文件
                await db.collection('users').doc(uid).set({
                    email: this.currentUser.email,
                    displayName: this.currentUser.email.split('@')[0], // 使用 email 前綴作為預設名稱
                    role: 'user', // 預設角色
                    unitId: null, // 需要管理員後續設定
                    isActive: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                console.log('✅ 已建立新使用者文件');
                
                // 重新讀取剛建立的文件
                const newUserDoc = await db.collection('users').doc(uid).get();
                const data = newUserDoc.data();
                
                this.userRole = data.role || 'user';
                this.userUnitId = data.unitId;
                
                const nameEl = document.getElementById('displayUserName');
                const roleEl = document.getElementById('displayUserRole');
                if(nameEl) nameEl.textContent = data.displayName || '使用者';
                if(roleEl) roleEl.textContent = this.translateRole(this.userRole);
                
                // 載入角色權限
                const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
                this.permissions = roleDoc.exists ? (roleDoc.data().permissions || []) : [];
                
                console.log(`👤 新使用者已建立: ${data.displayName} | 角色: ${this.userRole}`);
                await this.renderMenu();
                return;
            }
            
            // 正常流程:使用者文件已存在
            const data = userDoc.data();
            
            // 檢查帳號是否被停用
            if(data.isActive === false) {
                throw new Error("此帳號已被停用,請聯繫系統管理員");
            }

            this.userRole = data.role || 'user'; 
            this.userUnitId = data.unitId;

            const nameEl = document.getElementById('displayUserName');
            const roleEl = document.getElementById('displayUserRole');
            if(nameEl) nameEl.textContent = data.displayName || '使用者';
            if(roleEl) roleEl.textContent = this.translateRole(this.userRole);

            // 更新最後登入時間
            db.collection('users').doc(uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.warn('更新登入時間失敗:', err));

            // 載入角色權限
            const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
            this.permissions = roleDoc.exists ? (roleDoc.data().permissions || []) : [];

            console.log(`👤 使用者: ${data.displayName} | 角色: ${this.userRole} | 單位: ${this.userUnitId || '未設定'}`);
            await this.renderMenu();

        } catch (error) {
            console.error("❌ Load Context Error:", error);
            
            // 提供更友善的錯誤訊息
            if (error.code === 'permission-denied') {
                throw new Error("權限不足,無法讀取使用者資料。請檢查 Firestore 安全規則。");
            } else if (error.message.includes('停用')) {
                throw error; // 直接拋出帳號停用的錯誤
            } else {
                throw new Error(`載入使用者資料失敗: ${error.message}`);
            }
        }
    },

    // --- 5. 選單 ---
    renderMenu: async function() {
        const menuList = document.getElementById('dynamicMenu');
        if(!menuList) return;

        menuList.innerHTML = '<li style="padding:10px; text-align:center; color:#999;">載入選單中...</li>';

        try {
            const snapshot = await db.collection('system_menus')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();

            menuList.innerHTML = '';
            if(snapshot.empty) {
                menuList.innerHTML = '<li style="padding:10px; text-align:center; color:#999;">無可用選單</li>';
                return;
            }

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
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log("📄 DOM Content Loaded");
    app.init();
});
