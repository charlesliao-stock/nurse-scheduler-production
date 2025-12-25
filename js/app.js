// js/app.js

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],

    // --- 1. 系統初始化 ---
    init: function() {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log("User logged in:", user.uid);
                this.currentUser = user;
                await this.loadUserContext(user.uid);
                
                document.getElementById('login-view').style.display = 'none';
                document.getElementById('app-view').style.display = 'flex';
                
                if(typeof router !== 'undefined') {
                    // 登入後預設導向儀表板
                    router.load('/admin/dashboard');
                }
            } else {
                console.log("User logged out");
                this.currentUser = null;
                document.getElementById('login-view').style.display = 'flex';
                document.getElementById('app-view').style.display = 'none';
            }
        });
    },

    // --- 2. 登入功能 ---
    login: async function() {
        const email = document.getElementById('loginEmail').value;
        const pass = document.getElementById('loginPassword').value;
        const errorMsg = document.getElementById('loginError');
        
        if(!email || !pass) { 
            errorMsg.textContent = "請輸入帳號與密碼"; 
            return; 
        }
        
        errorMsg.textContent = "驗證中...";
        errorMsg.style.color = "#555";

        try {
            await auth.signInWithEmailAndPassword(email, pass);
        } catch (e) {
            console.error("Login Error Code:", e.code);

            // 攔截「帳號不存在」或「憑證錯誤」，檢查是否為未開通帳號
            if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-login-credentials') {
                errorMsg.textContent = "登入失敗，正在檢查帳號狀態...";
                try {
                    const snapshot = await db.collection('users')
                        .where('email', '==', email)
                        .get();

                    if (!snapshot.empty) {
                        const userData = snapshot.docs[0].data();
                        // 如果資料存在但未註冊
                        if (!userData.isRegistered || !userData.uid) {
                            alert("👋 歡迎！\n系統偵測到您的帳號尚未開通。\n\n將自動轉跳至開通頁面，請驗證員編並設定密碼。");
                            window.location.href = 'signup.html';
                            return;
                        }
                    }
                } catch (checkErr) {
                    console.error("Check user status failed:", checkErr);
                }
            }

            let msg = "登入失敗: " + e.message;
            if(e.code === 'auth/user-not-found' || e.code === 'auth/invalid-login-credentials') {
                msg = "帳號不存在，或密碼錯誤。";
            } else if(e.code === 'auth/wrong-password') {
                msg = "密碼錯誤。";
            } else if(e.code === 'auth/too-many-requests') {
                msg = "登入失敗次數過多，請稍後再試。";
            }
            
            errorMsg.style.color = "red";
            errorMsg.textContent = msg;
        }
    },

    // --- 3. 登出 ---
    logout: function() {
        if(confirm("確定要登出嗎？")) {
            auth.signOut();
        }
    },

    // --- 4. 載入使用者權限資料 (修正重點) ---
    loadUserContext: async function(uid) {
        try {
            const userDoc = await db.collection('users').doc(uid).get();
            if(!userDoc.exists) {
                // 如果 Auth 有登入，但資料庫沒資料 (極端情況)
                console.error("Database record missing for UID:", uid);
                alert("異常：找不到使用者資料庫紀錄，將強制登出。");
                auth.signOut(); 
                return;
            }
            
            const data = userDoc.data();
            
            // [修正] 加上預設值保護，防止 role 為空導致 crash
            this.userRole = data.role || 'user'; 
            this.userUnitId = data.unitId;

            document.getElementById('displayUserName').textContent = data.displayName || '使用者';
            document.getElementById('displayUserRole').textContent = this.translateRole(this.userRole);

            // 根據 Role 抓取權限
            // 因為上面加了預設值，這裡的 doc() 就不會再是空的了
            const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
            this.permissions = roleDoc.exists ? roleDoc.data().permissions : [];

            // 渲染選單
            await this.renderMenu();

        } catch (error) {
            console.error("Load Context Error:", error);
            // 避免卡在載入畫面，顯示錯誤
            document.getElementById('login-view').style.display = 'flex';
            document.getElementById('app-view').style.display = 'none';
            document.getElementById('loginError').textContent = "系統載入失敗：" + error.message;
        }
    },

    // --- 5. 渲染選單 ---
    renderMenu: async function() {
        const menuList = document.getElementById('dynamicMenu');
        menuList.innerHTML = '';

        try {
            const snapshot = await db.collection('system_menus')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();

            snapshot.forEach(doc => {
                const menu = doc.data();
                if(this.checkPermission(menu.requiredPermission)) {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <a class="menu-link" onclick="app.loadPage('${menu.path}')">
                            <i class="${menu.icon}"></i> ${menu.label}
                        </a>
                    `;
                    menuList.appendChild(li);
                }
            });
        } catch (e) {
            console.error("Menu Render Error:", e);
        }
    },

    // --- 6. 頁面路由 ---
    loadPage: function(path) {
        if(typeof router !== 'undefined') {
            router.load(path);
        }
        if(window.innerWidth < 768) {
            const sidebar = document.getElementById('sidebar');
            if(sidebar && !sidebar.classList.contains('collapsed')) {
                this.toggleSidebar();
            }
        }
    },

    toggleSidebar: function() {
        document.getElementById('sidebar').classList.toggle('collapsed');
    },

    // --- 工具 ---
    checkPermission: function(reqPerm) {
        if(this.permissions.includes('*')) return true;
        return !reqPerm || this.permissions.includes(reqPerm);
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

// 啟動 App
app.init();
