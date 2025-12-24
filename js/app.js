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

    // Login Form
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

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await AuthService.logout();
        window.location.reload();
    });
});

async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "系統載入中...");
        
        // 1. 初始化 Context
        await sysContext.init(firebaseUser);

        // 2. 狀態檢查
        const unitId = sysContext.getUnitId();
        const hasConfig = sysContext.hasUnitConfig();
        console.log(`[App] 狀態: UnitID=${unitId}, Config=${hasConfig}`);

        // 3. 路由判斷
        if (!unitId) {
            // Case A: 全新帳號
            console.log("[App] 新帳號 -> 進入單位建立流程");
            setupUnitCreation("歡迎使用！請先建立您的護理單位。");

        } else if (!hasConfig) {
            // Case B: 有 UnitID 但資料庫無資料 (尚未建立或已刪除)
            console.warn("[App] 資料庫無此單位設定 -> 進入重建流程");
            
            // 🌟 明確提示使用者
            alert(`提示：系統偵測到單位代號 (${unitId}) 尚未建立詳細資料，請填寫名稱以完成建立。`);
            
            // 預填 Unit ID 欄位，方便使用者
            const idInput = document.getElementById('setup-unit-id');
            if(idInput) {
                idInput.value = unitId;
                // idInput.disabled = true; // 可選擇是否鎖定 ID 不讓改
            }
            
            setupUnitCreation("尚未建立單位資料，請完成設定。");

        } else {
            // Case C: 正常登入
            console.log("[App] 登入成功 -> 進入主畫面");
            renderDashboardInfo();
            
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

// 輔助函式：切換到建立畫面並更新提示文字
function setupUnitCreation(message) {
    UnitSetupModule.init();
    
    // 更新設定畫面的說明文字 (如果有對應 DOM)
    const setupMsgEl = document.querySelector('#setup-view .text-muted');
    if(setupMsgEl) setupMsgEl.innerText = message;
    
    showView('setup');
}

function renderDashboardInfo() {
    setText('nav-unit-name', sysContext.getUnitName());
    setText('nav-user-name', sysContext.getUserName());
    setText('info-unit-id', sysContext.getUnitId());
    setText('info-unit-name', sysContext.getUnitName());
    setText('info-admin-name', sysContext.getUserName());
}

function setText(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerText = text;
}

function showView(name) {
    Object.values(views).forEach(el => {
        if(el) el.classList.add('d-none');
    });
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
