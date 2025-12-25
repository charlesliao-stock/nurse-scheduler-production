// js/app.js

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],

    // --- 1. 系統初始化 ---
    init: function() {
        // 監聽登入狀態改變
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log("User logged in:", user.uid);
                this.currentUser = user;
                await this.loadUserContext(user.uid);
                
                // 切換畫面
                document.getElementById('login-view').style.display = 'none';
                document.getElementById('app-view').style.display = 'flex';
                
                // 進入後預設載入儀表板
                if(typeof router !== 'undefined') {
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

    // --- 2. 登入功能 (含自動跳轉檢測) ---
    login: async function() {
        const email = document.getElementById('loginEmail').value;
        const pass = document.getElementById('loginPassword').value;
        const errorMsg = document.getElementById('loginError');
        
        // 基本檢查
        if(!email || !pass) { 
            errorMsg.textContent = "請輸入帳號與密碼"; 
            return; 
        }
        
        // 顯示載入中
        errorMsg.textContent = "驗證中...";
        errorMsg.style.color = "#555";

        try {
            // 嘗試登入 Firebase Auth
            await auth.signInWithEmailAndPassword(email, pass);
            // 若成功，onAuthStateChanged 會自動處理後續，這裡不用做動作
        } catch (e) {
            console.error("Login Error Code:", e.code);

            // [關鍵邏輯] 攔截「帳號不存在」或「憑證錯誤」
            // 某些新版 Firebase 會回傳 invalid-login-credentials 以防列舉攻擊
            if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-login-credentials') {
                
                errorMsg.textContent = "登入失敗，正在檢查帳號狀態...";
                
                try {
                    // 去 Firestore 查詢：這個 Email 是否在員工名單內？
                    // (這需要 Firestore Rules 允許未登入讀取 users)
                    const snapshot = await db.collection('users')
                        .where('email', '==', email)
                        .get();

                    if (!snapshot.empty) {
                        const userData = snapshot.docs[0].data();
                        
                        // 如果資料存在，但是標記為「未註冊」或沒有 UID
                        if (!userData.isRegistered || !userData.uid) {
                            alert("👋 歡迎！\n系統偵測到您的帳號尚未開通。\n\n將自動轉跳至開通頁面，請驗證員編並設定密碼。");
                            window.location.href = 'signup.html';
                            return; // 中斷後續錯誤顯示
                        }
                    }
                } catch (checkErr) {
                    console.error("Check user status failed:", checkErr);
                    // 查詢失敗不阻擋，繼續顯示原本的錯誤訊息
                }
            }

            // 顯示一般錯誤訊息
            let msg = "登入失敗: " + e.message;
            if(e.code === 'auth/user-not-found' || e.code === 'auth/invalid-login-credentials') {
                msg = "帳號不存在，或密碼錯誤。";
            }
            else if(e.code === 'auth/wrong-password') {
                msg = "密碼錯誤。";
            }
            else if(e.code === 'auth/too-many-requests') {
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

    // --- 4. 載入使用者權限資料 ---
    loadUserContext: async function(uid) {
        try {
            const userDoc = await db.collection('users').doc(uid).get();
            if(!userDoc.exists) {
                alert("異常：找不到使用者資料庫紀錄！");
                auth.signOut(); 
                return;
            }
            
            const data = userDoc.data();
            this.userRole = data.role;
            this.userUnitId = data.unitId;

            // 更新 UI
            document.getElementById('displayUserName').textContent = data.displayName || '使用者';
            document.getElementById('displayUserRole').textContent = this.translateRole(data.role);

            // 讀取角色權限表
            const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
            this.permissions = roleDoc.exists ? roleDoc.data().permissions : [];

            // 渲染選單
            await this.renderMenu();

        } catch (error) {
            console.error("Load Context Error:", error);
            document.getElementById('loginError').textContent = "載入使用者資料失敗";
        }
    },

    // --- 5. 渲染左側選單 ---
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

    // --- 6. 頁面路由切換 ---
    loadPage: function(path) {
        if(typeof router !== 'undefined') {
            router.load(path);
        }
        
        // 手機版自動收合
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

    // --- 工具函式 ---
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

// 啟動應用程式
app.init();
