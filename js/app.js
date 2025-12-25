// js/app.js

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],

    // --- 登入流程 ---
    init: function() {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log("User logged in:", user.uid);
                this.currentUser = user;
                await this.loadUserContext(user.uid);
                document.getElementById('login-view').style.display = 'none';
                document.getElementById('app-view').style.display = 'flex';
                
                // 如果目前在人員頁面，載入資料
                if(document.getElementById('page-staff').classList.contains('active')){
                    staffManager.init();
                }
            } else {
                console.log("User logged out");
                this.currentUser = null;
                document.getElementById('login-view').style.display = 'flex';
                document.getElementById('app-view').style.display = 'none';
            }
        });
    },

    login: async function() {
        const email = document.getElementById('loginEmail').value;
        const pass = document.getElementById('loginPassword').value;
        try {
            await auth.signInWithEmailAndPassword(email, pass);
        } catch (e) {
            document.getElementById('loginError').textContent = e.message;
        }
    },

    logout: function() {
        auth.signOut();
    },

    // --- 系統資料載入 ---
    loadUserContext: async function(uid) {
        // 1. 取得人員資料
        const userDoc = await db.collection('users').doc(uid).get();
        if(!userDoc.exists) return alert("查無此帳號資料");
        
        const data = userDoc.data();
        this.userRole = data.role;
        this.userUnitId = data.unitId;

        document.getElementById('displayUserName').textContent = data.displayName || '使用者';
        document.getElementById('displayUserRole').textContent = this.translateRole(data.role);

        // 2. 取得權限
        const roleDoc = await db.collection('system_roles').doc(this.userRole).get();
        this.permissions = roleDoc.exists ? roleDoc.data().permissions : [];

        // 3. 渲染選單
        await this.renderMenu();
    },

    // --- 選單與路由 ---
    renderMenu: async function() {
        const menuList = document.getElementById('dynamicMenu');
        menuList.innerHTML = '';

        const snapshot = await db.collection('system_menus')
            .where('isActive', '==', true).orderBy('order').get();

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
    },

    loadPage: function(path) {
        // 隱藏所有頁面
        document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
        
        // 簡單路由判斷 (依據 path 決定開啟哪個 div)
        if(path === '/admin/dashboard') {
            document.getElementById('page-dashboard').classList.add('active');
        } else if (path === '/staff/list' || path === '/admin/users') {
            document.getElementById('page-staff').classList.add('active');
            staffManager.init(); // 呼叫模組的初始化
        }
        
        // 手機版點選後自動收合
        if(window.innerWidth < 768) this.toggleSidebar();
    },

    // --- 工具 ---
    toggleSidebar: function() {
        document.getElementById('sidebar').classList.toggle('collapsed');
    },

    checkPermission: function(reqPerm) {
        if(this.permissions.includes('*')) return true;
        return !reqPerm || this.permissions.includes(reqPerm);
    },

    translateRole: function(role) {
        const map = {'system_admin':'系統管理員', 'unit_manager':'單位主管', 'user':'護理師'};
        return map[role] || role;
    }
};

// 啟動應用程式
app.init();
