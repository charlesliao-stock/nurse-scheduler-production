// js/app.js (優化版)

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],
    authStateInitialized: false, // 防止重複初始化

    // --- 1. 系統初始化 ---
    init: function() {
        console.log("🚀 App initializing...");
        
        // 設定全域錯誤處理
        this.setupGlobalErrorHandling();
        
        // 啟動路由監聽
        this.setupEventListeners();

        // Firebase Auth 狀態監聽（只設定一次）
        if(!this.authStateInitialized) {
            this.authStateInitialized = true;
            
            auth.onAuthStateChanged(async (user) => {
                try {
                    if (user) {
                        console.log("✅ User logged in:", user.uid);
                        this.currentUser = user;
                        await this.loadUserContext(user.uid);
                        
                        // 切換到應用視圖
                        document.getElementById('login-view').style.display = 'none';
                        document.getElementById('app-view').style.display = 'flex';
                        
                        // 載入頁面
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
                    alert("系統錯誤：" + error.message);
                    auth.signOut();
                }
            });
        }
    },

    // --- 全域錯誤處理 ---
    setupGlobalErrorHandling: function() {
        window.addEventListener('error', (event) => {
            console.error("全域錯誤:", event.error);
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error("未處理的 Promise 錯誤:", event.reason);
        });
    },

    // --- 設定事件監聽 (路由) ---
    setupEventListeners: function() {
        // 當網址 # 改變時觸發 Router
        window.addEventListener('hashchange', () => {
            const path = window.location.hash.slice(1);
            if (path && typeof router !== 'undefined') {
                router.load(path);
            }
        });

        // 處理瀏覽器返回按鈕
        window.addEventListener('popstate', () => {
            const path = window.location.hash.slice(1);
            if (path && typeof router !== 'undefined') {
                router.load(path);
            }
        });
    },

    // --- 2. 登入功能 (加強驗證) ---
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

        // Email 格式驗證
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if(!emailRegex.test(email)) {
            errorMsg.textContent = "請輸入有效的電子郵件格式";
            errorMsg.style.color = "red";
            return;
        }
        
        errorMsg.textContent = "驗證中...";
        errorMsg.style.color = "#555";

        // 停用登入按鈕防止重複點擊
        const loginBtn = event.target;
        loginBtn.disabled = true;
        loginBtn.textContent = "登入中...";

        try {
            await auth.signInWithEmailAndPassword(email, pass);
            // 登入成功由 onAuthStateChanged 處理
        } catch (e) {
            console.error("Login Error:", e);
            errorMsg.style.color = "red";
            
            // 友善的錯誤訊息
            let errorMessage = "登入失敗";
            if(e.code === 'auth/user-not-found') {
                errorMessage = "帳號不存在";
            } else if(e.code === 'auth/wrong-password') {
                errorMessage = "密碼錯誤";
            } else if(e.code === 'auth/invalid-email') {
                errorMessage = "電子郵件格式不正確";
            } else if(e.code === 'auth/user-disabled') {
                errorMessage = "此帳號已被停用";
            } else if(e.code === 'auth/too-many-requests') {
                errorMessage = "嘗試次數過多，請稍後再試";
            } else {
                errorMessage = e.message;
            }
            
            errorMsg.textContent = errorMessage;
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = "登入";
        }
    },

    // --- 3. 登出 ---
    logout: function() {
        if(confirm("確定要登出嗎？")) {
            auth.signOut().then(() => {
                this.handleLogout();
            }).catch((error) => {
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
        
        // 清空表單
        const emailInput = document.getElementById('loginEmail');
        const passInput = document.getElementById('loginPassword');
        const errorMsg = document.getElementById('loginError');
        if(emailInput) emailInput.value = '';
        if(passInput) passInput.value = '';
        if(errorMsg) errorMsg.textContent = '';
        
        // 重置路由
        if(typeof router !== 'undefined') {
            router.reset();
        }
        
        // 切換視圖
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('app-view').style.display = 'none';
        
        // 清空 hash
        window.location.hash = '';
    },

    // --- 4. 載入使用者權限資料 ---
    loadUserContext: async function(uid) {
        try {
            const userDoc = await db.collection('users').doc(uid).get();
            
            if(!userDoc.exists) {
                throw new Error("找不到使用者資料，請聯繫系統管理員");
            }
            
            const data = userDoc.data();
            
            // 檢查帳號是否啟用
            if(data.isActive === false) {
                throw new Error("此帳號已被停用，請聯繫管理員");
            }

            this.userRole = data.role || 'user'; 
            this.userUnitId = data.unitId;

            // 更新顯示
            const nameEl = document.getElementById('displayUserName');
            const roleEl = document.getElementById('displayUserRole');
            if(nameEl) nameEl.textContent = data.displayName || '使用者';
            if(roleEl) roleEl.textContent = this.translateRole(this.userRole);

            // 載入角色權限
            const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
            this.permissions = roleDoc.exists ? (roleDoc.data().permissions || []) : [];

            console.log(`👤 使用者: ${data.displayName} | 角色: ${this.userRole} | 權限:`, this.permissions);

            // 渲染選單
            await this.renderMenu();

        } catch (error) {
            console.error("Load Context Error:", error);
            throw error; // 讓上層處理
        }
    },

    // --- 5. 渲染選單 ---
    renderMenu: async function() {
        const menuList = document.getElementById('dynamicMenu');
        if(!menuList) {
            console.error("找不到選單容器");
            return;
        }

        menuList.innerHTML = '<li style="padding:10px; text-align:center; color:#999;">載入選單中...</li>';

        try {
            const snapshot = await db.collection('system_menus')
                .where('isActive', '==', true)
                .orderBy('order')
                .get();

            menuList.innerHTML = ''; // 清空

            if(snapshot.empty) {
                menuList.innerHTML = '<li style="padding:10px; text-align:center; color:#999;">無可用選單</li>';
                return;
            }

            let menuCount = 0;
            snapshot.forEach(doc => {
                const menu = doc.data();
                if(this.checkPermission(menu.requiredPermission)) {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <a class="menu-link" href="#${menu.path}">
                            <i class="${menu.icon}"></i> ${menu.label}
                        </a>
                    `;
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

    // --- 6. 頁面路由 ---
    loadPage: function(path) {
        if(typeof router !== 'undefined') {
            window.location.hash = path;
        }
        
        // 手機版自動收合側邊欄
        if(window.innerWidth < 768) {
            const sidebar = document.getElementById('sidebar');
            if(sidebar && !sidebar.classList.contains('collapsed')) {
                this.toggleSidebar();
            }
        }
    },

    toggleSidebar: function() {
        const sidebar = document.getElementById('sidebar');
        if(sidebar) {
            sidebar.classList.toggle('collapsed');
        }
    },

    // --- 工具函數 ---
    checkPermission: function(reqPerm) {
        // 超級管理員擁有所有權限
        if(this.permissions.includes('*')) return true;
        
        // 沒有權限要求的項目，所有人都可見
        if(!reqPerm) return true;
        
        // 檢查是否有該權限
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

    // --- 輔助函數：顯示載入中 ---
    showLoading: function(message = "處理中...") {
        // 可以在這裡實作全域 loading overlay
        console.log(message);
    },

    hideLoading: function() {
        // 隱藏 loading overlay
    }
};

// 啟動 App (DOMContentLoaded 確保 DOM 已載入)
document.addEventListener('DOMContentLoaded', () => {
    console.log("📄 DOM Content Loaded");
    app.init();
});

// 防止意外關閉（可選）
window.addEventListener('beforeunload', (event) => {
    // 如果有未儲存的變更，可以在這裡提示
    // event.preventDefault();
    // event.returnValue = '';
});
