import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";

// DOM Elements
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

    // Login Form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        try {
            setLoading(true, "驗證身分...");
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
        setLoading(true, "載入系統設定...");
        
        // 1. 初始化 Context
        await sysContext.init(firebaseUser);

        // 2. 判斷狀態：是否需要初始設定
        if (!sysContext.hasUnitConfig()) {
            console.log("[App] 尚未設定單位，進入設定畫面");
            UnitSetupModule.init();
            showView('setup');
        } else {
            console.log("[App] 設定完整，進入主畫面");
            renderDashboard();
            await StaffModule.init();
            showView('main');
        }

    } catch (error) {
        console.error(error);
        alert("初始化錯誤: " + error.message);
        AuthService.logout();
    } finally {
        setLoading(false);
    }
}

function renderDashboard() {
    document.getElementById('nav-unit-name').innerText = sysContext.getUnitName();
    document.getElementById('nav-user-name').innerText = sysContext.getUserName();
}

function showView(viewName) {
    Object.values(views).forEach(el => el.classList.add('d-none'));
    views[viewName].classList.remove('d-none');
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
