// js/app.js
import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";

// DOM Elements
const loginView = document.getElementById('login-view');
const mainView = document.getElementById('main-view');
const loginForm = document.getElementById('login-form');
const loadingOverlay = document.getElementById('loading-overlay');

// 初始化監聽
document.addEventListener('DOMContentLoaded', () => {
    
    // 監聽 Auth 狀態
    AuthService.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            // 已登入 Firebase Auth，開始載入系統資料
            await handleLoginSuccess(firebaseUser);
        } else {
            // 未登入
            showLogin();
        }
    });

    // 監聽登入表單
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        try {
            setLoading(true);
            await AuthService.login(email, password);
            // login 成功會觸發 onAuthStateChanged，所以這裡不用做跳轉
        } catch (error) {
            setLoading(false);
            alert(`登入失敗: ${error.message}`);
        }
    });

    // 登出按鈕
    document.getElementById('logout-btn').addEventListener('click', () => {
        AuthService.logout();
        window.location.reload();
    });
});

async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "正在載入您的單位設定...");
        
        // 🌟 關鍵：初始化 Context，去 DB 拉資料
        await sysContext.init(firebaseUser);
        
        // 渲染 UI (使用剛拉回來的動態設定)
        renderDashboard();
        
        showMain();
    } catch (error) {
        console.error(error);
        alert(`系統初始化失敗: ${error.message}\n請檢查資料庫是否有您的使用者資料 (users collection) 與單位資料 (units collection)。`);
        AuthService.logout(); // 強制登出
    } finally {
        setLoading(false);
    }
}

function renderDashboard() {
    const unitName = sysContext.unitConfig.name;
    const userName = sysContext.currentUser.name;
    const shifts = Object.values(sysContext.getShifts()).map(s => s.name).join(', ');

    document.getElementById('unit-name').innerText = unitName;
    document.getElementById('user-name').innerText = userName;
    document.getElementById('shift-config-info').innerText = `已載入班別: ${shifts}`;
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
