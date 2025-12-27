// js/app.js

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],

    // --- 1. 系統初始化 ---
    init: function() {
        console.log("App initializing...");
        
        // [關鍵修正] 加入事件監聽，才能處理網址跳轉
        this.setupEventListeners();

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log("User logged in:", user.uid);
                this.currentUser = user;
                await this.loadUserContext(user.uid);
                
                document.getElementById('login-view').style.display = 'none';
                document.getElementById('app-view').style.display = 'flex';
                
                // 登入後，讀取當前網址 Hash 並載入對應頁面
                // 如果沒有 Hash，才預設導向 Dashboard
                const currentHash = window.location.hash.slice(1);
                if(typeof router !== 'undefined') {
                    router.load(currentHash || '/admin/dashboard');
                }
            } else {
                console.log("User logged out");
                this.currentUser = null;
                document.getElementById('login-view').style.display = 'flex';
                document.getElementById('app-view').style.display = 'none';
            }
        });
    },

    // --- [新增] 設定事件監聽 (路由) ---
    setupEventListeners: function() {
        // 當網址 # 改變時 (例如由 pre_schedule_manager 觸發)，通知 router 載入新頁面
        window.addEventListener('hashchange', () => {
            const path = window.location.hash.slice(1); // 去掉 #
            if (path && typeof router !== 'undefined') {
                router.load(path);
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
            console.error("Login Error:", e);
            errorMsg.style.color = "red";
            errorMsg.textContent = "登入失敗：" + e.message;
        }
    },

    // --- 3. 登出 ---
    logout: function() {
        if(confirm("確定要登出嗎？")) {
            auth.signOut().then(() => {
                // 清除 Hash 並重整
                window.location.hash = '';
                location.reload();
            });
        }
    },

    // --- 4. 載入使用者權限資料 ---
    loadUserContext: async function(uid) {
        try {
            const userDoc = await db.collection('users').doc(uid).get();
            if(!userDoc.exists) {
                console.error("No DB record for UID:", uid);
                auth.signOut(); 
                return;
            }
            
            const data = userDoc.data();
            this.userRole = data.role || 'user'; 
            this.userUnitId = data.unitId;

            document.getElementById('displayUserName').textContent = data.displayName || '使用者';
            document.getElementById('displayUserRole').textContent = this.translateRole(this.userRole);

            const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
            this.permissions = roleDoc.exists ? roleDoc.data().permissions : [];

            await this.renderMenu();

        } catch (error) {
            console.error("Load Context Error:", error);
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
            // [修正] 改為修改 Hash，統一由 hashchange 監聽器處理
            // 這樣可以保持瀏覽器上一頁/下一頁功能的正常
            window.location.hash = path;
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
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
