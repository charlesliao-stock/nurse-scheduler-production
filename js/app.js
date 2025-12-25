import { AuthService } from "./services/AuthService.js";
import { sysContext } from "./core/SystemContext.js";
import { StaffModule } from "./modules/StaffModule.js";
import { UnitSetupModule } from "./modules/UnitSetupModule.js";
import { ShiftModule } from "./modules/ShiftModule.js";
import { PreScheduleModule } from "./modules/PreScheduleModule.js";
import { ScheduleEditorModule } from "./modules/ScheduleEditorModule.js"; // 匯入排班大表模組

// DOM 元素快取
const views = {
    login: document.getElementById('login-view'),
    setup: document.getElementById('setup-view'),
    main: document.getElementById('main-view')
};
const loadingOverlay = document.getElementById('loading-overlay');

/**
 * 應用程式初始化入口
 */
function initApp() {
    console.log("[App] 應用程式啟動...");

    // 1. 綁定側邊欄箭頭 (Sidebar Toggle)
    const wrapper = document.getElementById("wrapper");
    const menuToggle = document.getElementById("menu-toggle");
    
    if(menuToggle && wrapper) {
        menuToggle.addEventListener("click", (e) => {
            e.preventDefault();
            wrapper.classList.toggle("toggled");
        });
    }

    // 2. 綁定側邊欄選單切換 (Navigation)
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
                
                // 依據切換的頁面，觸發對應模組的刷新或初始化
                if(targetId === '#shift-container') {
                    ShiftModule.render();
                }
                else if(targetId === '#pre-schedule-container') {
                    // 若需要切換時重新讀取預班，可在此呼叫 loadData，目前保留
                    // PreScheduleModule.loadData();
                }
                else if(targetId === '#schedule-container') {
                    // 🌟 關鍵：切換到排班作業時，初始化大表並載入最新資料
                    ScheduleEditorModule.init();
                }
            }
        });
    });

    // 3. 綁定登入/登出相關事件
    bindAuthEvents();
}

/**
 * 綁定身分驗證事件
 */
function bindAuthEvents() {
    // 監聽 Firebase Auth 狀態改變
    AuthService.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            await handleLoginSuccess(firebaseUser);
        } else {
            showView('login');
        }
    });

    // 登入表單提交
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            try {
                setLoading(true, "登入中...");
                await AuthService.login(email, password);
                // 成功後會觸發 onAuthStateChanged，不需要在此跳轉
            } catch (error) {
                setLoading(false);
                alert("登入失敗: " + error.message);
            }
        });
    }

    // 登出按鈕
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await AuthService.logout();
            window.location.reload(); // 重新整理以清除記憶體狀態
        });
    }
}

/**
 * 處理登入成功後的邏輯
 * 包含：載入設定、判斷是否需要初始設定、初始化各模組
 */
async function handleLoginSuccess(firebaseUser) {
    try {
        setLoading(true, "系統載入中...");
        
        // 1. 初始化系統環境變數 (讀取 User & Unit Config)
        await sysContext.init(firebaseUser);

        // 2. 判斷使用者狀態，決定導向哪個畫面
        if (!sysContext.getUnitId()) {
            // Case A: 全新帳號，無單位 ID -> 進入 Setup
            console.log("[App] 新帳號 -> 進入 Unit Setup");
            UnitSetupModule.init();
            showView('setup');

        } else if (!sysContext.hasUnitConfig()) {
            // Case B: 有單位 ID 但無設定檔 (資料缺失) -> 進入 Setup 重建
            console.warn("[App] 資料缺失，進入 Setup");
            alert("系統偵測到單位資料尚未建立，請完成設定。");
            
            // 預填 ID 欄位
            const idInput = document.getElementById('setup-unit-id');
            if(idInput) idInput.value = sysContext.getUnitId();
            
            UnitSetupModule.init();
            showView('setup');

        } else {
            // Case C: 正常登入 -> 進入 Main View
            console.log("[App] 設定完整 -> 進入 Main");
            renderDashboardInfo();
            
            // 初始化基礎模組
            await StaffModule.init();     // 人員列表
            ShiftModule.init();           // 班別設定
            PreScheduleModule.init();     // 預班月曆
            // ScheduleEditorModule 留待點擊分頁時再初始化，或可在此預先載入
            
            showView('main');
        }

    } catch (error) {
        console.error("[App Error]", error);
        alert("系統初始化錯誤: " + error.message);
        AuthService.logout();
    } finally {
        setLoading(false);
    }
}

/**
 * 渲染側邊欄的使用者與單位資訊
 */
function renderDashboardInfo() {
    setText('nav-unit-name', sysContext.getUnitName());
    setText('nav-user-name', sysContext.getUserName());
    
    // 單位資訊頁面的內容
    setText('info-unit-id', sysContext.getUnitId());
    setText('info-unit-name', sysContext.getUnitName());
    setText('info-admin-name', sysContext.getUserName());
}

/**
 * 設定文字內容 helper
 */
function setText(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerText = text;
}

/**
 * 切換主要視圖 (Login / Setup / Main)
 */
function showView(name) {
    Object.values(views).forEach(el => { 
        if(el) el.classList.add('d-none'); 
    });
    
    if(views[name]) {
        views[name].classList.remove('d-none');
    }
    
    // 隱藏 Loading
    loadingOverlay.classList.add('d-none');
}

/**
 * 顯示/隱藏 Loading 遮罩
 */
function setLoading(isLoading, text) {
    const txt = document.getElementById('loading-text');
    if(isLoading) {
        if(txt) txt.innerText = text;
        loadingOverlay.classList.remove('d-none');
    } else {
        loadingOverlay.classList.add('d-none');
    }
}

// 立即執行初始化
initApp();
