// js/app.js

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],

    // 系統初始化
    init: function() {
        // 監聽登入狀態
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log("User logged in:", user.uid);
                this.currentUser = user;
                await this.loadUserContext(user.uid);
                
                // 切換顯示
                document.getElementById('login-view').style.display = 'none';
                document.getElementById('app-view').style.display = 'flex';
                
                // 登入後預設載入儀表板
                router.load('/admin/dashboard');

            } else {
                console.log("User logged out");
                this.currentUser = null;
                document.getElementById('login-view').style.display = 'flex';
                document.getElementById('app-view').style.display = 'none';
            }
        });
    },

    // 登入
    login: async function() {
        const email = document.getElementById('loginEmail').value;
        const pass = document.getElementById('loginPassword').value;
        const errorMsg = document.getElementById('loginError');
        
        if(!email || !pass) { errorMsg.textContent = "請輸入帳號密碼"; return; }
        errorMsg.textContent = "登入中...";

        try {
            await auth.signInWithEmailAndPassword(email, pass);
        } catch (e) {
            errorMsg.textContent = "登入失敗: " + e.message;
        }
    },

    // 登出
    logout: function() {
        if(confirm("確定要登出嗎？")) {
            auth.signOut();
        }
    },

    // 載入使用者權限與資料
    loadUserContext: async function(uid) {
        try {
            const userDoc = await db.collection('users').doc(uid).get();
            if(!userDoc.exists) {
                alert("找不到使用者資料庫紀錄！");
                return;
            }
            
            const data = userDoc.data();
            this.userRole = data.role;
            this.userUnitId = data.unitId;

            // 更新 UI
            document.getElementById('displayUserName').textContent = data.displayName || '使用者';
            document.getElementById('displayUserRole').textContent = this.translateRole(data.role);

            // 讀取權限表
            const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
            this.permissions = roleDoc.exists ? roleDoc.data().permissions : [];

            // 渲染選單
            await this.renderMenu();

        } catch (error) {
            console.error("Load Context Error:", error);
        }
    },

    // 渲染左側選單
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
                // 權限檢查
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

    // 頁面跳轉 (透過 Router)
    loadPage: function(path) {
        router.load(path);
        
        // 手機版點擊後收合選單
        if(window.innerWidth < 768) {
            this.toggleSidebar();
        }
    },

    toggleSidebar: function() {
        document.getElementById('sidebar').classList.toggle('collapsed');
    },

    // 工具: 檢查權限
    checkPermission: function(reqPerm) {
        if(this.permissions.includes('*')) return true;
        return !reqPerm || this.permissions.includes(reqPerm);
    },

    // 工具: 翻譯角色
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
