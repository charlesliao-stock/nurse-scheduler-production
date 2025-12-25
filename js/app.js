import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { ViewLoader } from "./core/ViewLoader.js";
import { UnitService } from "./services/UnitService.js";

// 各功能模組
import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";
import { ShiftModule } from "./modules/ShiftModule.js";
import { PreScheduleModule } from "./modules/PreScheduleModule.js";
import { ScheduleEditorModule } from "./modules/ScheduleEditorModule.js";
import { UnitManagementModule } from "./modules/UnitManagementModule.js"; // 🌟 新增：整合管理模組

const loadingOverlay = document.getElementById('loading-overlay');

// 路由設定：定義 data-target 對應的 HTML 路徑與模組
const routes = {
    'staff': { view: 'views/staff.html', module: StaffModule },
    'shift': { view: 'views/shift.html', module: ShiftModule },
    'pre-schedule': { view: 'views/pre-schedule.html', module: PreScheduleModule },
    'schedule-editor': { view: 'views/schedule-editor.html', module: ScheduleEditorModule },
    
    // 🌟 修改：統一使用「單位管理」取代原本的 settings 與 unit-info
    'unit-management': { view: 'views/unit-management.html', module: UnitManagementModule }
};

// 紀錄當前所在的分頁，避免重複點擊重整
let currentTargetKey = null;

/**
 * 應用程式啟動入口
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
 * 通用：載入 View 到指定容器
 */
async function loadView(containerId, filePath) {
    setLoading(true, "畫面載入中...");
    const success = await ViewLoader.load(containerId, filePath);
    setLoading(false);
    return success;
}

/**
 * 綁定登入頁面事件
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
 * 登入成功後處理邏輯
 */
async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "系統初始化...");
        await sysContext.init(firebaseUser);

        // 判斷是否需要進入初始設定 (Setup)
        // 條件：非系統管理員 且 (無單位ID 或 無設定檔)
        if (!sysContext.isSystemAdmin() && (!sysContext.getHomeUnitId() || !sysContext.hasUnitConfig())) {
            await loadView('app-root', 'views/setup.html');
            UnitSetupModule.init(); 
            return;
        }

        // 正常登入 -> 載入主框架 (Layout)
        await loadView('app-root', 'views/layout.html');
        
        // 初始化側邊欄 (含單位選單邏輯)
        await initSidebar();

        // 預設載入「人員管理」
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
 * 初始化側邊欄與單位選單
 */
async function initSidebar() {
    // 顯示使用者資訊
    const roleText = sysContext.isSystemAdmin() ? "系統管理員 (Super Admin)" : "單位管理員";
    setText('nav-user-role', roleText);
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

    // 🌟 處理「全域單位選擇器」邏輯
    const unitSelect = document.getElementById('global-unit-select');
    if (unitSelect) {
        unitSelect.innerHTML = '<option value="">讀取中...</option>';

        if (sysContext.isSystemAdmin()) {
            // 系統管理員：載入所有單位
            const units = await UnitService.getAllUnits();
            let html = '<option value="">-- 請選擇單位 --</option>';
            units.forEach(u => {
                html += `<option value="${u.id}">${u.name} (${u.id})</option>`;
            });
            unitSelect.innerHTML = html;
            unitSelect.disabled = false;
        } else {
            // 一般使用者：鎖定自己的單位
            const myUnitId = sysContext.getHomeUnitId();
            const myUnitName = sysContext.getUnitName();
            unitSelect.innerHTML = `<option value="${myUnitId}" selected>${myUnitName}</option>`;
            unitSelect.disabled = true;
        }

        // 監聽選單改變 (系統管理員切換單位)
        unitSelect.onchange = async (e) => {
            const newUnitId = e.target.value;
            setLoading(true, "切換單位中...");
            await sysContext.switchUnit(newUnitId);
            
            // 如果當前有顯示某個模組，強制重新載入以刷新資料
            if (currentTargetKey) {
                loadModuleContent(currentTargetKey, true); // true = force reload
            }
            setLoading(false);
        };
    }

    // 綁定側邊選單點擊事件
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
 * 載入模組內容到右側區域
 * @param {string} targetKey - 路由 Key (如 'staff', 'shift')
 * @param {boolean} force - 是否強制重新載入 (用於切換單位時)
 */
async function loadModuleContent(targetKey, force = false) {
    if (!force && currentTargetKey === targetKey) return; // 避免重複點擊
    currentTargetKey = targetKey;

    const route = routes[targetKey];
    if (!route) return;

    // 檢查是否已選擇單位 (系統管理員若未選單位，顯示提示)
    // 但若是 unit-management 這種管理介面，可能允許未選單位時進入(視模組內部實作而定)，這裡統一先載入 View
    // 讓各個 Module 內部自己去檢查 sysContext.getActiveUnitId() 並顯示提示
    
    // 特別處理：如果系統管理員未選單位，且進入的是需要資料的頁面，可以在這裡擋，
    // 但目前策略是讓 Module init 自己去判斷並顯示 "請選擇單位"。

    // 載入 HTML
    const success = await loadView('dynamic-content', route.view);
    if (!success) return;

    // 初始化模組
    if (route.module && typeof route.module.init === 'function') {
        try {
            await route.module.init(); 
        } catch (e) {
            console.error(`模組 ${targetKey} 初始化失敗:`, e);
            document.getElementById('dynamic-content').innerHTML = `
                <div class="alert alert-danger">
                    模組載入錯誤: ${e.message}
                </div>`;
        }
    }
}

/**
 * 設定文字 Helper
 */
function setText(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerText = text;
}

/**
 * Loading 遮罩控制
 */
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
