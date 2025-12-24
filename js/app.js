import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";
import { ShiftModule } from "./modules/ShiftModule.js";
import { PreScheduleModule } from "./modules/PreScheduleModule.js"; // 🌟 新增

// ... (其他 DOM 宣告、Auth 監聽、Login/Logout 邏輯保持不變) ...
const views = {
    login: document.getElementById('login-view'),
    setup: document.getElementById('setup-view'),
    main: document.getElementById('main-view')
};
const loadingOverlay = document.getElementById('loading-overlay');

document.addEventListener('DOMContentLoaded', () => {
    // Auth Listener
    AuthService.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            await handleLoginSuccess(firebaseUser);
        } else {
            showView('login');
        }
    });

    // Login Form logic ... (保持不變)
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            try {
                setLoading(true, "登入中...");
                await AuthService.login(email, password);
            } catch (error) {
                setLoading(false);
                alert("登入失敗: " + error.message);
            }
        });
    }

    // Logout logic ... (保持不變)
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await AuthService.logout();
        window.location.reload();
    });
});


async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "系統載入中...");
        
        await sysContext.init(firebaseUser);

        if (!sysContext.getUnitId()) {
            UnitSetupModule.init();
            showView('setup');
        } else if (!sysContext.hasUnitConfig()) {
            console.warn("[App] 資料缺失，進入 Setup");
            alert("請完成單位設定");
            UnitSetupModule.init();
            showView('setup');
        } else {
            console.log("[App] 進入 Main");
            renderDashboardInfo();
            
            // 初始化各模組
            await StaffModule.init();
            ShiftModule.init();
            PreScheduleModule.init(); // 🌟 啟動預班模組
            
            showView('main');
        }

    } catch (error) {
        console.error(error);
        alert("錯誤: " + error.message);
        AuthService.logout();
    } finally {
        setLoading(false);
    }
}

// ... (renderDashboardInfo, showView, setLoading 保持不變) ...
function renderDashboardInfo() {
    const el = document.getElementById('nav-unit-name');
    if(el) el.innerText = sysContext.getUnitName();
    
    const el2 = document.getElementById('nav-user-name');
    if(el2) el2.innerText = sysContext.getUserName();
}

function showView(name) {
    Object.values(views).forEach(el => { if(el) el.classList.add('d-none'); });
    if(views[name]) views[name].classList.remove('d-none');
    loadingOverlay.classList.add('d-none');
}

function setLoading(isLoading, text) {
    if(isLoading) {
        document.getElementById('loading-text').innerText = text;
        loadingOverlay.classList.remove('d-none');
    } else {
        loadingOverlay.classList.add('d-none');
    }
}
