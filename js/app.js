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
        loadModuleContent('staff');

    } catch (error) {
        console.error(error);
        alert("系統錯誤: " + error.message);
        AuthService.logout();
    } finally {
        setLoading(false);
    }
}

async function initSidebar() {
    const roleText = sysContext.isSystemAdmin() ? "系統管理員 (Super Admin)" : "單位管理員";
    setText('nav-user-role', roleText);
    setText('nav-user-name', sysContext.getUserName());

    document.getElementById('logout-btn').onclick = async () => {
        await AuthService.logout();
        window.location.reload();
    };

    const toggle = document.getElementById('menu-toggle');
    const wrapper = document.getElementById('wrapper');
    if(toggle) toggle.onclick = () => wrapper.classList.toggle('toggled');

    const unitSelect = document.getElementById('global-unit-select');
    if (unitSelect) {
        unitSelect.innerHTML = '<option value="">讀取中...</option>';

        if (sysContext.isSystemAdmin()) {
            const units = await UnitService.getAllUnits();
            
            let html = '<option value="">-- 請選擇單位 --</option>';
            
            // 🌟 關鍵：加入「所有單位」選項
            html += '<option value="ALL" class="fw-bold">🌐 所有單位人員 (All Staff)</option>';
            html += '<option value="UNASSIGNED" class="text-warning">⚠️ 未分發人員 (Unassigned)</option>';
            html += '<option disabled>----------------</option>';

            units.forEach(u => {
                html += `<option value="${u.id}">${u.name} (${u.id})</option>`;
            });
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
            // 如果是 ALL 或 UNASSIGNED，switchUnit 內部可能會找不到 config，這是預期行為
            await sysContext.switchUnit(newUnitId);
            
            if (currentTargetKey) {
                loadModuleContent(currentTargetKey, true);
            }
            setLoading(false);
        };
    }

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
            console.error(`模組 ${targetKey} 初始化失敗:`, e);
            document.getElementById('dynamic-content').innerHTML = `
                <div class="alert alert-danger">
                    模組載入錯誤: ${e.message}
                </div>`;
        }
    }
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
