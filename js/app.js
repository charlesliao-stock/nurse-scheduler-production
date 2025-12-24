// js/app.js
import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { StaffModule } from "./modules/StaffModule.js";

// DOM Elements
const loginView = document.getElementById('login-view');
const mainView = document.getElementById('main-view');
const loginForm = document.getElementById('login-form');
const loadingOverlay = document.getElementById('loading-overlay');

// 初始化監聽
document.addEventListener('DOMContentLoaded', () => {
    
    // 監聽 Auth 狀態 (這是系統的入口點)
    AuthService.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            // 已登入 Firebase Auth，開始載入系統資料
            console.log("[App] 偵測到使用者已登入:", firebaseUser.email);
            await handleLoginSuccess(firebaseUser);
        } else {
            // 未登入
            console.log("[App] 未登入，顯示登入畫面");
            showLogin();
        }
    });

    // 監聽登入表單提交
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        try {
            setLoading(true, "正在驗證身分...");
            await AuthService.login(email, password);
            // login 成功會觸發 onAuthStateChanged，這裡不需額外處理跳轉
        } catch (error) {
            setLoading(false);
            alert(`登入失敗: ${error.message}`);
        }
    });

    // 登出按鈕
    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            await AuthService.logout();
            window.location.reload(); // 重新整理以清除記憶體狀態
        } catch (error) {
            alert("登出發生錯誤");
        }
    });
});

/**
 * 處理登入成功後的流程
 * 1. 載入單位設定 (Context)
 * 2. 渲染主畫面
 * 3. 初始化各模組
 */
async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "正在載入您的單位設定...");
        
        // 1. 初始化 Context (去 DB 拉該單位的設定檔)
        await sysContext.init(firebaseUser);
        
        // 2. 渲染 Dashboard 基本資訊
        renderDashboard();
        
        // 3. 顯示主畫面
        showMain();

        // 4. 啟動人員管理模組 (載入員工列表)
        console.log("[App] 正在初始化人員模組...");
        await StaffModule.init();

    } catch (error) {
        console.error("[App Critical Error]", error);
        
        // 顯示具體錯誤給使用者
        alert(`系統初始化失敗: ${error.message}\n請確認您的帳號是否已指派正確的單位 (unitId)。`);
        
        // 若初始化失敗，強制登出避免卡在錯誤狀態
        AuthService.logout();
        showLogin();
    } finally {
        setLoading(false);
    }
}

function renderDashboard() {
    // 從 Context 取得資料並填入畫面
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
