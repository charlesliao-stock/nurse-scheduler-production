import { FirestoreService } from "../services/FirestoreService.js";

// 🌟 定義角色與權限對照表 (權限常數保持不變)
const PERMISSIONS = {
    // 系統級權限
    MANAGE_ALL_UNITS: 'manage_all_units', 
    
    // 單位管理權限
    MANAGE_UNIT_SETTINGS: 'manage_unit_settings', 
    MANAGE_SHIFTS: 'manage_shifts', 
    
    // 人員管理權限
    MANAGE_STAFF: 'manage_staff', 
    
    // 排班權限
    EDIT_SCHEDULE: 'edit_schedule', 
    VIEW_SCHEDULE: 'view_schedule', 
    
    // 個人權限
    SUBMIT_WISHES: 'submit_wishes' 
};

// 🌟 角色對應權限表 (已更新代號)
const ROLE_MAP = {
    'system_admin': [ // 系統管理者
        PERMISSIONS.MANAGE_ALL_UNITS,
        PERMISSIONS.MANAGE_UNIT_SETTINGS,
        PERMISSIONS.MANAGE_SHIFTS,
        PERMISSIONS.MANAGE_STAFF,
        PERMISSIONS.EDIT_SCHEDULE,
        PERMISSIONS.VIEW_SCHEDULE,
        PERMISSIONS.SUBMIT_WISHES
    ],
    'unit_manager': [ // 單位管理者
        PERMISSIONS.MANAGE_UNIT_SETTINGS,
        PERMISSIONS.MANAGE_SHIFTS,
        PERMISSIONS.MANAGE_STAFF,
        PERMISSIONS.EDIT_SCHEDULE,
        PERMISSIONS.VIEW_SCHEDULE,
        PERMISSIONS.SUBMIT_WISHES
    ],
    'unit_scheduler': [ // 單位排班者
        PERMISSIONS.EDIT_SCHEDULE,
        PERMISSIONS.VIEW_SCHEDULE,
        PERMISSIONS.SUBMIT_WISHES
    ],
    'user': [ // 一般使用者
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
            
            // 預設角色處理 (修正為 user)
            if (!this.currentUser.role) this.currentUser.role = 'user';

            const role = this.currentUser.role;
            const homeUnitId = this.currentUser.unitId;

            // 系統管理員預設不選單位，其他人鎖定自己的單位 (修正為 system_admin)
            if (role === 'system_admin') {
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

    // 核心權限檢查方法
    hasPermission(permission) {
        const role = this.currentUser?.role || 'user'; // 預設改為 user
        const allowed = ROLE_MAP[role] || [];
        return allowed.includes(permission);
    }

    getRole() {
        return this.currentUser?.role || 'user';
    }

    // 取得當前角色中文名稱 (已更新鍵值)
    getRoleName() {
        const map = {
            'system_admin': '系統管理者',
            'unit_manager': '單位管理者',
            'unit_scheduler': '單位排班者',
            'user': '一般使用者'
        };
        return map[this.getRole()] || '未知角色';
    }

    // --- Getters ---
    getActiveUnitId() { return this.activeUnitId; }
    getUnitId() { return this.activeUnitId; }
    getHomeUnitId() { return this.currentUser?.unitId || null; }
    getUnitConfig() { return this.unitConfig; }
    hasUnitConfig() { return !!(this.unitConfig && this.unitConfig.name); }
    getShifts() { return this.unitConfig?.shifts || {}; }
    getUnitName() { return this.unitConfig?.name || ""; }
    getUserName() { return this.currentUser?.name || this.currentUser?.staffName || "Guest"; }
    getCurrentUserId() { return this.authUid || this.currentUser?.uid; }
    
    // 判斷是否為系統管理員 (修正判斷)
    isSystemAdmin() { return this.currentUser?.role === 'system_admin'; }

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

export const PERMISSIONS_OPTS = PERMISSIONS;
export const sysContext = new SystemContext();
