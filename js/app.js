import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { ViewLoader } from "./core/ViewLoader.js";
import { UnitService } from "./services/UnitService.js"; // 引入 UnitService

// 各功能模組
import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";
import { ShiftModule } from "./modules/ShiftModule.js";
import { PreScheduleModule } from "./modules/PreScheduleModule.js";
import { ScheduleEditorModule } from "./modules/ScheduleEditorModule.js";
import { SettingsModule } from "./modules/SettingsModule.js";

const loadingOverlay = document.getElementById('loading-overlay');

const routes = {
    'staff': { view: 'views/staff.html', module: StaffModule },
    'shift': { view: 'views/shift.html', module: ShiftModule },
    'pre-schedule': { view: 'views/pre-schedule.html', module: PreScheduleModule },
    'schedule-editor': { view: 'views/schedule-editor.html', module: ScheduleEditorModule },
    'settings': { view: 'views/settings.html', module: SettingsModule },
    'unit-info': { view: 'views/unit-info.html', module: null }
};

// 紀錄當前所在的分頁
let currentTargetKey = null;

function initApp() {
    console.log("[App] SPA 啟動中...");
    AuthService.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            await handleLoginSuccess(firebaseUser);
        } else {
            await loadView('app-root', 'views/login.html');
            bindLoginEvents();
        }
    });
}

async function loadView(containerId, filePath) {
    setLoading(true, "畫面載入中...");
    const success = await ViewLoader.load(containerId, filePath);
    setLoading(false);
    return success;
}

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

async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "系統初始化...");
        await sysContext.init(firebaseUser);

        // 如果是一般使用者且無單位 ID，進入 Setup
        if (!sysContext.isSystemAdmin() && (!sysContext.getHomeUnitId() || !sysContext.hasUnitConfig())) {
            await loadView('app-root', 'views/setup.html');
            UnitSetupModule.init(); 
            return;
        }

        // 正常登入 -> 載入主框架
        await loadView('app-root', 'views/layout.html');
        
        // 初始化側邊欄 (含單位選單邏輯)
        await initSidebar();

        // 預設載入人員管理
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
 * 🌟 初始化側邊欄與單位選單
 */
async function initSidebar() {
    // 顯示使用者資訊
    const roleText = sysContext.isSystemAdmin() ? "系統管理員 (Super Admin)" : "單位管理員";
    setText('nav-user-role', roleText);
    setText('nav-user-name', sysContext.getUserName());

    // 登出
    document.getElementById('logout-btn').onclick = async () => {
        await AuthService.logout();
        window.location.reload();
    };

    // Toggle
    const toggle = document.getElementById('menu-toggle');
    const wrapper = document.getElementById('wrapper');
    if(toggle) toggle.onclick = () => wrapper.classList.toggle('toggled');

    // 🌟 處理「單位選擇器」邏輯
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

        // 監聽選單改變
        unitSelect.onchange = async (e) => {
            const newUnitId = e.target.value;
            setLoading(true, "切換單位中...");
            await sysContext.switchUnit(newUnitId);
            
            // 重新載入當前模組
            if (currentTargetKey) {
                loadModuleContent(currentTargetKey, true); // true = force reload
            }
            setLoading(false);
        };
    }

    // 選單點擊
    const links = document.querySelectorAll('.list-group-item-action');
    links.forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            const target = link.getAttribute('data-target');
            
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            loadModuleContent(target);
        };
    });
}

/**
 * 載入模組內容
 */
async function loadModuleContent(targetKey, force = false) {
    if (!force && currentTargetKey === targetKey) return; // 避免重複點擊
    currentTargetKey = targetKey;

    const route = routes[targetKey];
    if (!route) return;

    // 檢查是否已選擇單位 (系統管理員若未選單位，顯示提示)
    if (sysContext.isSystemAdmin() && !sysContext.getActiveUnitId()) {
        document.getElementById('dynamic-content').innerHTML = `
            <div class="alert alert-info text-center mt-5">
                <h4><i class="bi bi-arrow-up-circle"></i> 請先選擇一個單位</h4>
                <p>系統管理員需在左上方選單選擇要管理的單位，才能檢視資料。</p>
            </div>`;
        return;
    }

    // 載入 HTML
    const success = await loadView('dynamic-content', route.view);
    if (!success) return;

    // 初始化模組
    if (route.module && typeof route.module.init === 'function') {
        try {
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
    setText('info-unit-id', sysContext.getActiveUnitId());
    setText('info-unit-name', sysContext.getUnitName());
    // 這裡的管理者姓名可能需要另外撈，暫時顯示當前操作者
    setText('info-admin-name', "單位管理者"); 
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

initApp();
