import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";
import { ShiftModule } from "./modules/ShiftModule.js";

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

    // Login
    document.getElementById('login-form').addEventListener('submit', async (e) => {
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

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await AuthService.logout();
        window.location.reload();
    });
});

async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "系統載入中...");
        
        // 1. 初始化環境變數 (讀取 User & Unit Config)
        await sysContext.init(firebaseUser);

        // 2. 判斷是否需要建立單位
        if (!sysContext.getUnitId()) {
            console.log("[App] 無單位，進入 Unit Setup");
            UnitSetupModule.init();
            showView('setup');
        } else {
            console.log("[App] 進入 Main View");
            renderDashboardInfo();
            
            // 初始化各分頁模組
            await StaffModule.init();
            ShiftModule.init();
            
            showView('main');
        }

    } catch (error) {
        console.error(error);
        alert("初始化失敗: " + error.message);
        AuthService.logout();
    } finally {
        setLoading(false);
    }
}

function renderDashboardInfo() {
    document.getElementById('nav-unit-name').innerText = sysContext.getUnitName();
    document.getElementById('nav-user-name').innerText = sysContext.getUserName();
    
    // 單位資訊分頁
    document.getElementById('info-unit-id').innerText = sysContext.getUnitId();
    document.getElementById('info-unit-name').innerText = sysContext.getUnitName();
    document.getElementById('info-admin-name').innerText = sysContext.getUserName();
}

function showView(name) {
    Object.values(views).forEach(el => el.classList.add('d-none'));
    views[name].classList.remove('d-none');
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
