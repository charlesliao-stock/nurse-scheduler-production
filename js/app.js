// js/app.js
import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { ViewLoader } from "./core/ViewLoader.js";

// 各功能模組
import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";
import { ShiftModule } from "./modules/ShiftModule.js";
import { PreScheduleModule } from "./modules/PreScheduleModule.js";
import { ScheduleEditorModule } from "./modules/ScheduleEditorModule.js";
import { SettingsModule } from "./modules/SettingsModule.js";

const loadingOverlay = document.getElementById('loading-overlay');

// 路由設定：定義 data-target 對應的 HTML 路徑與模組
const routes = {
    'staff': { view: 'views/staff.html', module: StaffModule },
    'shift': { view: 'views/shift.html', module: ShiftModule },
    'pre-schedule': { view: 'views/pre-schedule.html', module: PreScheduleModule },
    'schedule-editor': { view: 'views/schedule-editor.html', module: ScheduleEditorModule },
    'settings': { view: 'views/settings.html', module: SettingsModule },
    'unit-info': { view: 'views/unit-info.html', module: null } // 單純顯示，無模組
};

/**
 * 應用程式啟動
 */
function initApp() {
    console.log("[App] SPA 啟動中...");

    // 監聽 Auth
    AuthService.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            await handleLoginSuccess(firebaseUser);
        } else {
            // 未登入 -> 載入登入畫面
            await loadView('app-root', 'views/login.html');
            bindLoginEvents();
        }
    });
}

/**
 * 載入指定 View 並掛載到容器
 */
async function loadView(containerId, filePath) {
    setLoading(true, "畫面載入中...");
    const success = await ViewLoader.load(containerId, filePath);
    setLoading(false);
    return success;
}

/**
 * 綁定登入畫面事件
 */
function bindLoginEvents() {
    const form = document.getElementById('login-form');
    if (form) {
        form.onsubmit = async (e) => {
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
        };
    }
}

/**
 * 登入成功後處理
 */
async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "系統初始化...");
        await sysContext.init(firebaseUser);

        // 1. 判斷是否需要 Setup
        if (!sysContext.getUnitId() || !sysContext.hasUnitConfig()) {
            await loadView('app-root', 'views/setup.html');
            UnitSetupModule.init(); // Setup 比較單純，直接綁定即可
            return;
        }

        // 2. 正常登入 -> 載入主框架 (Layout)
        await loadView('app-root', 'views/layout.html');
        
        // 3. 初始化側邊欄功能
        initSidebar();

        // 4. 預設載入「人員管理」 (或其他首頁)
        loadModuleContent('staff');

    } catch (error) {
        console.error(error);
        alert("系統錯誤: " + error.message);
        AuthService.logout();
    } finally {
        setLoading(false);
    }
}

/**
 * 初始化側邊欄邏輯
 */
function initSidebar() {
    // 顯示使用者資訊
    setText('nav-unit-name', sysContext.getUnitName());
    setText('nav-user-name', sysContext.getUserName());

    // 登出按鈕
    document.getElementById('logout-btn').onclick = async () => {
        await AuthService.logout();
        window.location.reload();
    };

    // 側邊欄縮放 Toggle
    const toggle = document.getElementById('menu-toggle');
    const wrapper = document.getElementById('wrapper');
    if(toggle) toggle.onclick = () => wrapper.classList.toggle('toggled');

    // 選單點擊事件
    const links = document.querySelectorAll('.list-group-item-action');
    links.forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            const target = link.getAttribute('data-target');
            
            // UI Active 狀態切換
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // 載入右側內容
            loadModuleContent(target);
        };
    });
}

/**
 * 核心：載入右側模組內容
 */
async function loadModuleContent(targetKey) {
    const route = routes[targetKey];
    if (!route) return;

    // 1. 載入 HTML 到 dynamic-content
    const success = await loadView('dynamic-content', route.view);
    if (!success) return;

    // 2. 若有模組，執行初始化
    // 注意：所有 Module 的 init 現在不需要參數，因為 HTML 已經在 DOM 裡了
    // 或者是：我們可以統一傳入 containerId (雖然大部分 Module 習慣直接用 getElementById)
    if (route.module && typeof route.module.init === 'function') {
        try {
            // 對於 unit-info 這種靜態的，我們可以在這裡手動補值，或寫個簡單的 module
            if (targetKey === 'unit-info') {
                renderUnitInfo();
            } else {
                await route.module.init(); 
            }
        } catch (e) {
            console.error(`模組 ${targetKey} 初始化失敗:`, e);
        }
    }
}

function renderUnitInfo() {
    setText('info-unit-id', sysContext.getUnitId());
    setText('info-unit-name', sysContext.getUnitName());
    setText('info-admin-name', sysContext.getUserName());
}

function setText(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerText = text;
}

function setLoading(isLoading, text) {
    if(isLoading) {
        document.getElementById('loading-text').innerText = text;
        loadingOverlay.classList.remove('d-none');
    } else {
        loadingOverlay.classList.add('d-none');
    }
}

// 啟動 App
initApp();
