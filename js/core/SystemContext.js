import { FirestoreService } from "../services/FirestoreService.js";

// 🌟 定義角色與權限對照表
const PERMISSIONS = {
    // 系統級權限
    MANAGE_ALL_UNITS: 'manage_all_units', // 跨單位切換/新增單位
    
    // 單位管理權限
    MANAGE_UNIT_SETTINGS: 'manage_unit_settings', // 修改職稱/組別/單位名稱
    MANAGE_SHIFTS: 'manage_shifts', // 修改班別設定
    
    // 人員管理權限
    MANAGE_STAFF: 'manage_staff', // 新增/編輯/刪除人員
    
    // 排班權限
    EDIT_SCHEDULE: 'edit_schedule', // 進入排班大表編輯、執行AI
    VIEW_SCHEDULE: 'view_schedule', // 查看排班表
    
    // 個人權限
    SUBMIT_WISHES: 'submit_wishes' // 填寫預班
};

// 角色對應權限表
const ROLE_MAP = {
    'SystemAdmin': [ // 系統管理者: 全能
        PERMISSIONS.MANAGE_ALL_UNITS,
        PERMISSIONS.MANAGE_UNIT_SETTINGS,
        PERMISSIONS.MANAGE_SHIFTS,
        PERMISSIONS.MANAGE_STAFF,
        PERMISSIONS.EDIT_SCHEDULE,
        PERMISSIONS.VIEW_SCHEDULE,
        PERMISSIONS.SUBMIT_WISHES
    ],
    'UnitAdmin': [ // 單位管理者: 鎖定單位，但該單位內全能
        PERMISSIONS.MANAGE_UNIT_SETTINGS,
        PERMISSIONS.MANAGE_SHIFTS,
        PERMISSIONS.MANAGE_STAFF,
        PERMISSIONS.EDIT_SCHEDULE,
        PERMISSIONS.VIEW_SCHEDULE,
        PERMISSIONS.SUBMIT_WISHES
    ],
    'Scheduler': [ // 單位排班者: 只能排班，不能動人事與設定
        PERMISSIONS.EDIT_SCHEDULE,
        PERMISSIONS.VIEW_SCHEDULE,
        PERMISSIONS.SUBMIT_WISHES
    ],
    'User': [ // 一般使用者: 只能看與提需求
        PERMISSIONS.VIEW_SCHEDULE,
        PERMISSIONS.SUBMIT_WISHES
    ]
};

class SystemContext {
    constructor() {
        this.currentUser = null;
        this.unitConfig = null;
        this.isReady = false;
        this.authUid = null;
        this.activeUnitId = null;
    }

    async init(user) {
        try {
            this.authUid = user.uid;
            console.log("[System] 初始化使用者 UID:", this.authUid);

            this.currentUser = await FirestoreService.getUserProfile(this.authUid);
            
            // 預設角色處理
            if (!this.currentUser.role) this.currentUser.role = 'User';

            const role = this.currentUser.role;
            const homeUnitId = this.currentUser.unitId;

            // 系統管理員預設不選單位，其他人鎖定自己的單位
            if (role === 'SystemAdmin') {
                this.activeUnitId = null;
            } else {
                this.activeUnitId = homeUnitId;
            }

            if (this.activeUnitId) {
                try {
                    this.unitConfig = await FirestoreService.getUnitConfig(this.activeUnitId);
                } catch (err) {
                    console.warn(`[System] 無法讀取單位設定: ${this.activeUnitId}`);
                    this.unitConfig = null; 
                }
            }
            this.isReady = true;
        } catch (error) {
            console.error("[System Error] 初始化過程異常:", error);
            if(this.authUid) this.isReady = true;
            else throw error;
        }
    }

    async switchUnit(unitId) {
        // 只有具備跨單位權限者才能切換
        if (!this.hasPermission(PERMISSIONS.MANAGE_ALL_UNITS) && unitId !== this.currentUser.unitId) {
            console.error("無權限切換單位");
            return;
        }

        this.activeUnitId = unitId;
        if (unitId && unitId !== 'ALL' && unitId !== 'UNASSIGNED') {
            try {
                this.unitConfig = await FirestoreService.getUnitConfig(unitId);
                console.log(`[System] 已切換至單位: ${unitId}`);
            } catch (error) {
                console.error("[System] 切換單位失敗:", error);
                this.unitConfig = null;
            }
        } else {
            this.unitConfig = null;
        }
    }

    // 🌟 核心權限檢查方法
    hasPermission(permission) {
        const role = this.currentUser?.role || 'User';
        const allowed = ROLE_MAP[role] || [];
        return allowed.includes(permission);
    }

    // 取得當前角色 (用於 UI 顯示)
    getRole() {
        return this.currentUser?.role || 'User';
    }

    // 取得當前角色中文名稱
    getRoleName() {
        const map = {
            'SystemAdmin': '系統管理者',
            'UnitAdmin': '單位管理者',
            'Scheduler': '單位排班者',
            'User': '一般使用者'
        };
        return map[this.getRole()] || '未知';
    }

    // --- 原有 Getters ---
    getActiveUnitId() { return this.activeUnitId; }
    getUnitId() { return this.activeUnitId; }
    getHomeUnitId() { return this.currentUser?.unitId || null; }
    getUnitConfig() { return this.unitConfig; }
    hasUnitConfig() { return !!(this.unitConfig && this.unitConfig.name); }
    getShifts() { return this.unitConfig?.shifts || {}; }
    getUnitName() { return this.unitConfig?.name || ""; }
    getUserName() { return this.currentUser?.name || this.currentUser?.staffName || "Guest"; }
    getCurrentUserId() { return this.authUid || this.currentUser?.uid; }
    isSystemAdmin() { return this.currentUser?.role === 'SystemAdmin'; }

    updateLocalSettings(settings) {
        if (this.unitConfig) {
            if(settings.groups) this.unitConfig.groups = settings.groups;
            if(settings.titles) this.unitConfig.titles = settings.titles;
        }
    }
    updateLocalShifts(shifts) {
        if(this.unitConfig) this.unitConfig.shifts = shifts;
    }
}

// 匯出常數供模組使用
export const PERMISSIONS_OPTS = PERMISSIONS;
export const sysContext = new SystemContext();
