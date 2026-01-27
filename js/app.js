// js/app.js (修正模擬角色退出問題)

const app = {
    currentUser: null,
    userRole: null,
    userUnitId: null,
    permissions: [],
    authStateInitialized: false,
    impersonatedRole: null, // 模擬的角色
    impersonatedUid: null,  // 模擬的使用者 UID
    impersonatedUnitId: null, // 模擬的單位 ID
    originalRole: null,    // 原始角色 (用於權限檢查)
    originalUid: null,     // 原始 UID
    _allUsersForImp: null, // 快取所有使用者資料供模擬工具使用

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
        // 清理所有狀態
        this.currentUser = null;
        this.userRole = null;
        this.userUnitId = null;
        this.permissions = [];
        this.impersonatedRole = null;
        this.impersonatedUid = null;
        this.impersonatedUnitId = null;
        this.originalRole = null;
        this.originalUid = null;
        this._allUsersForImp = null;
        
        // 清理 localStorage
        localStorage.removeItem('impersonatedUser');
        
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
            this.originalUid = uid;
            
            // 先清理之前的模擬狀態
            this.impersonatedRole = null;
            this.impersonatedUid = null;
            this.impersonatedUnitId = null;
            
            let userDoc = await db.collection('users').doc(uid).get();
            
            if(!userDoc.exists) {
                console.warn('⚠️ 使用者文件不存在,正在建立預設文件');
                await db.collection('users').doc(uid).set({
                    email: this.currentUser.email,
                    displayName: this.currentUser.email.split('@')[0],
                    role: 'user',
                    unitId: null,
                    isActive: true,
                    isRegistered: true,
                    uid: uid,
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

            // 處理身分模擬 (Impersonation)
            const savedImpersonation = localStorage.getItem('impersonatedUser');
            if (this.userRole === 'system_admin' && savedImpersonation) {
                try {
                    const impData = JSON.parse(savedImpersonation);
                    
                    // 驗證模擬資料的完整性
                    if (impData.uid && impData.role && impData.unitId) {
                        this.impersonatedUid = impData.uid;
                        this.impersonatedRole = impData.role;
                        this.impersonatedUnitId = impData.unitId;
                        this.userUnitId = impData.unitId; // 覆蓋單位 ID
                        
                        console.log(`🎭 啟用身分模擬: ${impData.name} (${this.impersonatedRole})`);
                    } else {
                        console.warn('⚠️ 模擬資料不完整，已清除');
                        localStorage.removeItem('impersonatedUser');
                    }
                } catch (parseError) {
                    console.error('❌ 解析模擬資料失敗:', parseError);
                    localStorage.removeItem('impersonatedUser');
                }
            }

            // 更新 UI 顯示
            await this.updateUserDisplay(data, savedImpersonation);

            // 載入權限
            const activeRole = this.impersonatedRole || this.userRole;
            const roleDoc = await db.collection('system_roles').doc(activeRole).get();
            this.permissions = roleDoc.exists ? (roleDoc.data().permissions || []) : [];

            // 管理員專屬工具
            if (this.userRole === 'system_admin') {
                await this.renderImpersonationTool();
            }

            await this.renderMenu();
            
            // [新增] 檢查是否需要修改密碼
            await this.checkPasswordChange();
            
            // 非同步更新最後登入時間
            db.collection('users').doc(uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.warn('更新登入時間失敗:', err));

        } catch (error) {
            console.error("❌ Load Context Error:", error);
            throw error;
        }
    },

    // --- 更新使用者顯示 ---
    updateUserDisplay: async function(userData, savedImpersonation) {
        const nameEl = document.getElementById('displayUserName');
        const roleEl = document.getElementById('displayUserRole');
        
        let activeName = userData.displayName || '使用者';
        let activeRole = this.userRole;
        
        if (this.impersonatedRole && savedImpersonation) {
            try {
                const impData = JSON.parse(savedImpersonation);
                activeName = impData.name || activeName;
                activeRole = this.impersonatedRole;
            } catch (e) {
                console.error('解析模擬資料失敗:', e);
            }
        }

        if(nameEl) nameEl.textContent = activeName;
        if(roleEl) {
            roleEl.textContent = this.translateRole(activeRole);
            if (this.impersonatedRole) {
                roleEl.innerHTML += ' <span style="font-size:0.7rem; color:#e74c3c; font-weight:bold;">(模擬中)</span>';
            }
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
            
            const activeRole = this.impersonatedRole || this.userRole;

            snapshot.forEach(doc => {
                const menu = doc.data();
                
                // 權限檢查邏輯：
                // 1. 如果 allowedRoles 為空或不存在，則所有人可見
                // 2. 如果有設定 allowedRoles，則檢查當前角色是否在清單中
                const allowedRoles = menu.allowedRoles || [];
                const hasRoleAccess = allowedRoles.length === 0 || allowedRoles.includes(activeRole);
                
                if(hasRoleAccess) {
                    const li = document.createElement('li');
                    li.innerHTML = `<a class="menu-link" href="#${menu.path}"><i class="${menu.icon}"></i> ${menu.label}</a>`;
                    menuList.appendChild(li);
                    menuCount++;
                }
            });
            console.log(`✅ 載入 ${menuCount} 個選單項目 (角色: ${activeRole})`);
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

    getUid: function() {
        return this.impersonatedUid || (this.currentUser ? this.currentUser.uid : null);
    },

    getUnitId: function() {
        return this.userUnitId; // 已經在 loadUserContext 中被模擬值覆蓋
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

    // --- 6. 身分模擬工具 (修正版) ---
    renderImpersonationTool: async function() {
        let tool = document.getElementById('impersonation-tool');
        if (!tool) {
            tool = document.createElement('div');
            tool.id = 'impersonation-tool';
            tool.style.cssText = 'padding: 15px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2); font-size: 0.85rem; color: white;';
            const sidebar = document.getElementById('sidebar');
            const logoutContainer = sidebar?.querySelector('div[style*="padding:20px"]');
            if (logoutContainer) sidebar.insertBefore(tool, logoutContainer);
            else if (sidebar) sidebar.appendChild(tool);
        }

        // 1. 取得所有單位
        let units = [];
        try {
            const unitSnap = await db.collection('units').get();
            unitSnap.forEach(doc => units.push({ id: doc.id, ...doc.data() }));
        } catch (e) { 
            console.error("取得單位失敗:", e); 
        }

        // 2. 取得所有使用者 (快取在 app 物件中供聯動使用)
        if (!this._allUsersForImp) {
            this._allUsersForImp = [];
            try {
                const userSnap = await db.collection('users').where('isActive', '==', true).get();
                userSnap.forEach(doc => this._allUsersForImp.push({ uid: doc.id, ...doc.data() }));
                console.log(`📋 載入 ${this._allUsersForImp.length} 位使用者供模擬選擇`);
            } catch (e) { 
                console.error("取得使用者失敗:", e); 
            }
        }

        let html = '<div style="color:rgba(255,255,255,0.7); margin-bottom:8px; font-weight:bold;"><i class="fas fa-user-secret"></i> 深度身分模擬</div>';
        
        // 單位選擇器
        html += '<select id="impUnitSelect" onchange="app.updateImpUserList(this.value)" style="width:100%; padding:6px; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:#2c3e50; color:white; cursor:pointer; margin-bottom:5px;">';
        html += '<option value="">--- 選擇單位 ---</option>';
        units.forEach(u => {
            const selected = (this.impersonatedUnitId === u.id) ? 'selected' : '';
            html += `<option value="${u.id}" ${selected} style="background:#2c3e50;">${u.name}</option>`;
        });
        html += '</select>';

        // 人員選擇器 (初始為空或根據當前模擬單位過濾)
        html += '<select id="impUserSelect" onchange="app.impersonateUser(this.value)" style="width:100%; padding:6px; border-radius:4px; border:1px solid rgba(255,255,255,0.2); background:#2c3e50; color:white; cursor:pointer; margin-bottom:5px;">';
        html += '<option value="">--- 選擇人員 ---</option>';
        html += '</select>';

        // 快速恢復按鈕
        if (this.impersonatedUid) {
            html += `<button onclick="app.clearImpersonation()" style="width:100%; padding:6px; background:#e74c3c; color:white; border:none; border-radius:4px; font-size:0.8rem; cursor:pointer; margin-top:5px; font-weight:bold;">
                <i class="fas fa-undo"></i> 恢復原始身分
            </button>`;
        }

        tool.innerHTML = html;

        // 如果已有模擬單位，初始化人員選單
        const currentUnitId = this.impersonatedUnitId || document.getElementById('impUnitSelect')?.value;
        if (currentUnitId) {
            this.updateImpUserList(currentUnitId);
        }
    },

    updateImpUserList: function(unitId) {
        const userSelect = document.getElementById('impUserSelect');
        if (!userSelect) {
            console.warn('找不到人員選擇器元素');
            return;
        }

        userSelect.innerHTML = '<option value="">--- 選擇人員 ---</option>';
        
        if (!this._allUsersForImp || this._allUsersForImp.length === 0) {
            userSelect.innerHTML += '<option value="" disabled>無可用人員</option>';
            return;
        }

        const filteredUsers = unitId 
            ? this._allUsersForImp.filter(u => u.unitId === unitId)
            : this._allUsersForImp;

        if (filteredUsers.length === 0) {
            userSelect.innerHTML += '<option value="" disabled>此單位無人員</option>';
            return;
        }

        filteredUsers.forEach(u => {
            const selected = this.impersonatedUid === u.uid ? 'selected' : '';
            const roleName = this.translateRole(u.role);
            const userData = {
                uid: u.uid,
                name: u.displayName || u.name || u.email,
                role: u.role,
                unitId: u.unitId
            };
            userSelect.innerHTML += `<option value='${JSON.stringify(userData)}' ${selected} style="background:#2c3e50;">${userData.name} (${roleName})</option>`;
        });

        console.log(`📋 更新人員清單: ${filteredUsers.length} 位人員`);
    },

    impersonateUser: function(jsonStr) {
        if (!jsonStr) {
            console.log('取消模擬');
            return;
        }

        try {
            const userData = JSON.parse(jsonStr);
            console.log('🎭 開始模擬:', userData);
            
            // 驗證資料完整性
            if (!userData.uid || !userData.role || !userData.unitId) {
                alert('模擬資料不完整，請重新選擇');
                return;
            }

            localStorage.setItem('impersonatedUser', jsonStr);
            console.log('✅ 模擬資料已儲存，準備重新載入頁面');
            
            // 延遲一點時間確保 localStorage 寫入完成
            setTimeout(() => {
                window.location.reload();
            }, 100);
            
        } catch (error) {
            console.error('❌ 模擬失敗:', error);
            alert('模擬失敗: ' + error.message);
        }
    },

    clearImpersonation: function() {
        console.log('🔄 清除模擬狀態');
        
        // 顯示確認對話框
        if (!confirm('確定要恢復為原始身分嗎？')) {
            return;
        }

        try {
            // 清除 localStorage
            localStorage.removeItem('impersonatedUser');
            console.log('✅ 已清除 localStorage 中的模擬資料');

            // 清除記憶體中的模擬狀態
            this.impersonatedRole = null;
            this.impersonatedUid = null;
            this.impersonatedUnitId = null;
            
            console.log('✅ 已清除記憶體中的模擬狀態');

            // 重新載入頁面以恢復原始狀態
            setTimeout(() => {
                console.log('🔄 重新載入頁面...');
                window.location.reload();
            }, 100);

        } catch (error) {
            console.error('❌ 清除模擬狀態失敗:', error);
            alert('清除失敗: ' + error.message);
        }
    },

    // --- 7. 首次登入檢查密碼 ---
    checkPasswordChange: async function() {
        try {
            const userDoc = await db.collection('users').doc(this.currentUser.uid).get();
            if (!userDoc.exists) return;
            
            const userData = userDoc.data();
            
            // 檢查是否使用預設密碼（從未修改過）
            if (!userData.passwordChanged) {
                this.showPasswordChangePrompt();
            }
        } catch (error) {
            console.error('檢查密碼狀態失敗:', error);
        }
    },

    // 顯示修改密碼提示
    showPasswordChangePrompt: function() {
        const modal = document.createElement('div');
        modal.id = 'passwordChangeModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';
        modal.innerHTML = `
            <div style="background:white;padding:40px;border-radius:12px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                <div style="text-align:center;margin-bottom:25px;">
                    <i class="fas fa-exclamation-triangle" style="font-size:48px;color:#ffc107;margin-bottom:15px;"></i>
                    <h2 style="margin:0 0 10px 0;color:#2c3e50;">⚠️ 首次登入提醒</h2>
                    <p style="margin:0;color:#666;line-height:1.6;">
                        為了您的帳號安全，建議您修改預設密碼。<br>
                        預設密碼為您的員工編號，容易被猜測。
                    </p>
                </div>
                
                <div style="background:#fff3cd;padding:15px;border-radius:8px;margin-bottom:20px;border-left:4px solid #ffc107;">
                    <p style="margin:0;color:#856404;font-size:0.95rem;">
                        <strong>密碼安全建議：</strong><br>
                        • 長度至少 8 個字元<br>
                        • 包含英文大小寫、數字<br>
                        • 避免使用生日、電話等個人資訊
                    </p>
                </div>
                
                <div style="display:flex;gap:15px;margin-top:25px;">
                    <button onclick="app.goToChangePassword()" 
                            style="flex:1;padding:15px;background:#e74c3c;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:16px;">
                        <i class="fas fa-key"></i> 立即修改密碼
                    </button>
                    <button onclick="app.dismissPasswordPrompt()" 
                            style="flex:1;padding:15px;background:#95a5a6;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:16px;">
                        <i class="fas fa-times"></i> 稍後再說
                    </button>
                </div>
                
                <p style="margin:20px 0 0 0;text-align:center;color:#999;font-size:0.85rem;">
                    您可以隨時在「個人設定」中修改密碼
                </p>
            </div>
        `;
        document.body.appendChild(modal);
    },

    // 前往修改密碼頁面
    goToChangePassword: function() {
        this.dismissPasswordPrompt();
        window.location.href = 'change_password.html';
    },

    // 關閉密碼提示
    dismissPasswordPrompt: function() {
        const modal = document.getElementById('passwordChangeModal');
        if (modal) modal.remove();
    }
};

// 確保 DOM 載入完成後初始化
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
