// js/app.js
import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { StaffModule } from "./modules/StaffModule.js";

// DOM Elements
const loginView = document.getElementById('login-view');
const mainView = document.getElementById('main-view');
const loginForm = document.getElementById('login-form');
const loadingOverlay = document.getElementById('loading-overlay');

document.addEventListener('DOMContentLoaded', () => {
    
    // 監聽 Auth 狀態
    AuthService.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            console.log("[App] 使用者已登入:", firebaseUser.email);
            await handleLoginSuccess(firebaseUser);
        } else {
            console.log("[App] 未登入");
            showLogin();
        }
    });

    // 監聽登入表單
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        try {
            setLoading(true, "驗證身分中...");
            await AuthService.login(email, password);
        } catch (error) {
            setLoading(false);
            alert(`登入失敗: ${error.message}`);
        }
    });

    // 登出按鈕
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
        
        // 2. 渲染主畫面文字 (這裡是關鍵修正點)
        renderDashboard();
        
        // 3. 切換顯示
        showMain();

        // 4. 啟動人員模組
        await StaffModule.init();

    } catch (error) {
        console.error("[App Init Error]", error);
        alert(`初始化失敗: ${error.message}`);
        AuthService.logout();
        showLogin();
    } finally {
        setLoading(false);
    }
}

/**
 * 渲染儀錶板資訊
 * 包含防呆與除錯訊息
 */
function renderDashboard() {
    // 取得資料
    const unitName = sysContext.getUnitName();
    const userName = sysContext.getUserName();
    const shiftsObj = sysContext.getShifts();

    console.log("=== Debug: Dashboard Data ===");
    console.log("Unit Name:", unitName);
    console.log("User Name:", userName);
    console.log("Shifts Object:", shiftsObj);

    // 轉換班別物件為字串
    // 檢查 shiftsObj 是否有內容
    let shiftsDisplay = "無班別設定";
    if (shiftsObj && Object.keys(shiftsObj).length > 0) {
        shiftsDisplay = Object.values(shiftsObj)
            .map(s => s.name || s.code) // 如果沒有 name 就顯示 code
            .join(', ');
    }

    // 更新 DOM
    const elUnit = document.getElementById('unit-name');
    const elUser = document.getElementById('user-name');
    const elShift = document.getElementById('shift-config-info');

    if(elUnit) elUnit.innerText = unitName;
    if(elUser) elUser.innerText = userName;
    if(elShift) elShift.innerText = `已載入班別: ${shiftsDisplay}`;
}

// --- UI Helpers ---

function showLogin() {
    loginView.classList.remove('d-none');
    mainView.classList.add('d-none');
    loadingOverlay.classList.add('d-none');
}

function showMain() {
    loginView.classList.add('d-none');
    mainView.classList.remove('d-none');
}

function setLoading(isLoading, text = "處理中...") {
    if(isLoading) {
        document.getElementById('loading-text').innerText = text;
        loadingOverlay.classList.remove('d-none');
    } else {
        loadingOverlay.classList.add('d-none');
    }
}
