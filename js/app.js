import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";
import { ShiftModule } from "./modules/ShiftModule.js";
import { PreScheduleModule } from "./modules/PreScheduleModule.js";

const views = {
    login: document.getElementById('login-view'),
    setup: document.getElementById('setup-view'),
    main: document.getElementById('main-view')
};
const loadingOverlay = document.getElementById('loading-overlay');

// 🌟 修改點：定義初始化邏輯，不依賴 DOMContentLoaded 事件
function initApp() {
    console.log("[App] 應用程式啟動...");

    // 1. 綁定側邊欄箭頭切換
    const wrapper = document.getElementById("wrapper");
    const menuToggle = document.getElementById("menu-toggle");
    
    if(menuToggle && wrapper) {
        console.log("[App] 側邊欄元件已鎖定");
        menuToggle.addEventListener("click", (e) => {
            e.preventDefault();
            wrapper.classList.toggle("toggled");
            console.log("[App] 側邊欄切換");
        });
    } else {
        console.warn("[App] 找不到側邊欄元件 (wrapper 或 menu-toggle)");
    }

    // 2. 綁定側邊欄選單點擊切換頁面
    const links = document.querySelectorAll('.list-group-item-action');
    const sections = document.querySelectorAll('.content-section');

    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            // UI 切換：移除所有 active，設定當前 active
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // 區塊切換：隱藏所有區塊
            sections.forEach(s => s.classList.add('d-none'));
            
            // 顯示目標區塊
            const targetId = link.getAttribute('data-target');
            const targetSection = document.querySelector(targetId);
            
            if(targetSection) {
                targetSection.classList.remove('d-none');
                console.log(`[App] 切換至分頁: ${targetId}`);
                
                // 若是特定模組，可能需要刷新資料 (Optional)
                if(targetId === '#shift-container') ShiftModule.render();
                // if(targetId === '#pre-schedule-container') PreScheduleModule.loadData();
            }
        });
    });

    // 3. 綁定登入與登出
    bindAuthEvents();
}

function bindAuthEvents() {
    // 監聽 Auth 狀態改變
    AuthService.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            await handleLoginSuccess(firebaseUser);
        } else {
            showView('login');
        }
    });

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

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await AuthService.logout();
            window.location.reload();
        });
    }
}

// 🌟 修改點：直接執行初始化
initApp();


// --- 核心邏輯 ---

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
            PreScheduleModule.init();
            
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
