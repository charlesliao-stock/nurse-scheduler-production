import { AuthService } from "./services/AuthService.js";
import { sysContext, PERMISSIONS_OPTS } from "./core/SystemContext.js"; // 引入權限常數
import { ViewLoader } from "./core/ViewLoader.js";
import { UnitService } from "./services/UnitService.js";

import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";
import { ShiftModule } from "./modules/ShiftModule.js";
import { PreScheduleModule } from "./modules/PreScheduleModule.js";
import { ScheduleEditorModule } from "./modules/ScheduleEditorModule.js";
import { UnitManagementModule } from "./modules/UnitManagementModule.js"; 

const loadingOverlay = document.getElementById('loading-overlay');

const routes = {
    'staff': { view: 'views/staff.html', module: StaffModule },
    'shift': { view: 'views/shift.html', module: ShiftModule },
    'pre-schedule': { view: 'views/pre-schedule.html', module: PreScheduleModule },
    'schedule-editor': { view: 'views/schedule-editor.html', module: ScheduleEditorModule },
    'unit-management': { view: 'views/unit-management.html', module: UnitManagementModule }
};

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

        if (!sysContext.isSystemAdmin() && (!sysContext.getHomeUnitId() || !sysContext.hasUnitConfig())) {
            await loadView('app-root', 'views/setup.html');
            UnitSetupModule.init(); 
            return;
        }

        await loadView('app-root', 'views/layout.html');
        await initSidebar();
        
        // 預設首頁邏輯：有管理權限去人員管理，否則去預班
        if (sysContext.hasPermission(PERMISSIONS_OPTS.MANAGE_STAFF)) {
            loadModuleContent('staff');
        } else {
            loadModuleContent('pre-schedule');
        }

    } catch (error) {
        console.error(error);
        alert("系統錯誤: " + error.message);
        AuthService.logout();
    } finally {
        setLoading(false);
    }
}

async function initSidebar() {
    const roleName = sysContext.getRoleName();
    setText('nav-user-role', roleName);
    setText('nav-user-name', sysContext.getUserName());

    document.getElementById('logout-btn').onclick = async () => {
        await AuthService.logout();
        window.location.reload();
    };

    const toggle = document.getElementById('menu-toggle');
    const wrapper = document.getElementById('wrapper');
    if(toggle) toggle.onclick = () => wrapper.classList.toggle('toggled');

    // --- 單位選擇器 ---
    const unitSelect = document.getElementById('global-unit-select');
    if (unitSelect) {
        unitSelect.innerHTML = '<option value="">讀取中...</option>';

        // 只有具備 MANAGE_ALL_UNITS 權限者可切換
        if (sysContext.hasPermission(PERMISSIONS_OPTS.MANAGE_ALL_UNITS)) {
            const units = await UnitService.getAllUnits();
            let html = '<option value="">-- 請選擇單位 --</option>';
            html += '<option value="ALL" class="fw-bold">🌐 所有單位人員</option>';
            html += '<option value="UNASSIGNED" class="text-warning">⚠️ 未分發人員</option>';
            html += '<option disabled>----------------</option>';
            units.forEach(u => html += `<option value="${u.id}">${u.name} (${u.id})</option>`);
            unitSelect.innerHTML = html;
            unitSelect.disabled = false;
        } else {
            const myUnitId = sysContext.getHomeUnitId();
            const myUnitName = sysContext.getUnitName();
            unitSelect.innerHTML = `<option value="${myUnitId}" selected>${myUnitName}</option>`;
            unitSelect.disabled = true;
        }

        unitSelect.onchange = async (e) => {
            const newUnitId = e.target.value;
            setLoading(true, "切換單位中...");
            await sysContext.switchUnit(newUnitId);
            if (currentTargetKey) loadModuleContent(currentTargetKey, true);
            setLoading(false);
        };
    }

    // --- 🌟 選單權限過濾 (核心邏輯) ---
    // 定義每個選單項目需要的權限
    const menuItems = [
        { id: 'nav-pre', perm: PERMISSIONS_OPTS.SUBMIT_WISHES, target: 'pre-schedule' },
        { id: 'nav-staff', perm: PERMISSIONS_OPTS.MANAGE_STAFF, target: 'staff' },
        { id: 'nav-settings', perm: PERMISSIONS_OPTS.MANAGE_UNIT_SETTINGS, target: 'unit-management' },
        { id: 'nav-shift', perm: PERMISSIONS_OPTS.MANAGE_SHIFTS, target: 'shift' },
        { id: 'nav-schedule', perm: PERMISSIONS_OPTS.VIEW_SCHEDULE, target: 'schedule-editor' }
    ];

    // 先隱藏所有選單
    const allLinks = document.querySelectorAll('.list-group-item-action');
    allLinks.forEach(el => el.classList.add('d-none'));

    // 再依權限顯示
    menuItems.forEach(item => {
        if (sysContext.hasPermission(item.perm)) {
            const el = document.querySelector(`[data-target="${item.target}"]`);
            if(el) {
                el.classList.remove('d-none');
                // 重新綁定點擊事件
                el.onclick = (e) => {
                    e.preventDefault();
                    allLinks.forEach(l => l.classList.remove('active'));
                    el.classList.add('active');
                    loadModuleContent(item.target);
                };
            }
        }
    });
}

async function loadModuleContent(targetKey, force = false) {
    if (!force && currentTargetKey === targetKey) return;
    currentTargetKey = targetKey;

    const route = routes[targetKey];
    if (!route) return;

    const success = await loadView('dynamic-content', route.view);
    if (!success) return;

    if (route.module && typeof route.module.init === 'function') {
        try {
            await route.module.init(); 
        } catch (e) {
            console.error(e);
            document.getElementById('dynamic-content').innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
        }
    }
}

function setText(id, text) { const el = document.getElementById(id); if(el) el.innerText = text; }
function setLoading(isLoading, text) {
    if(isLoading) { document.getElementById('loading-text').innerText = text; loadingOverlay.classList.remove('d-none'); }
    else { loadingOverlay.classList.add('d-none'); }
}

initApp();
