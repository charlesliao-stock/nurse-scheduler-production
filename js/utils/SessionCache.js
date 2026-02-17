// js/utils/SessionCache.js
/**
 * 會話級別快取管理器
 * 用途：在單次工作階段中保持資料，避免重複讀取 Firebase
 * 優勢：記憶體快取，讀取速度極快，適合頻繁存取的資料
 */
const SessionCache = {
    // 會話快取儲存區（記憶體中）
    sessionData: {},
    
    // 當前載入的排班表 ID
    currentScheduleId: null,
    
    // 當前載入的資料版本（用於追蹤變更）
    dataVersion: {
        shifts: 0,
        staff: 0,
        rules: 0,
        assignments: 0
    },
    
    // 統計資訊
    stats: {
        hits: 0,
        misses: 0,
        saves: 0
    },
    
    /**
     * 初始化會話快取
     * @param {string} scheduleId - 排班表 ID
     * @param {string} unitId - 單位 ID
     */
    init: function(scheduleId, unitId) {
        this.currentScheduleId = scheduleId;
        
        if (!this.sessionData[scheduleId]) {
            this.sessionData[scheduleId] = {
                unitId: unitId,
                shifts: null,
                staff: null,
                usersMap: null,
                rules: null,
                assignments: null,
                lastMonthData: null,
                statistics: null,
                scoreResult: null,
                loadedAt: Date.now(),
                lastUpdated: null
            };
            console.log('✅ SessionCache 已初始化:', scheduleId);
        }
    },
    
    /**
     * 儲存班別資料
     * @param {string} scheduleId - 排班表 ID
     * @param {Array} shifts - 班別陣列
     */
    setShifts: function(scheduleId, shifts) {
        if (!this.sessionData[scheduleId]) {
            this.init(scheduleId, null);
        }
        this.sessionData[scheduleId].shifts = shifts;
        this.dataVersion.shifts++;
        this.stats.saves++;
        console.log(`💾 SessionCache: 已儲存班別資料 (${shifts.length} 個班別)`);
    },
    
    /**
     * 取得班別資料
     * @param {string} scheduleId - 排班表 ID
     * @returns {Array|null} 班別陣列
     */
    getShifts: function(scheduleId) {
        const shifts = this.sessionData[scheduleId]?.shifts || null;
        if (shifts) {
            this.stats.hits++;
            console.log('⚡ SessionCache: 命中班別資料');
        } else {
            this.stats.misses++;
        }
        return shifts;
    },
    
    /**
     * 儲存人員資料
     * @param {string} scheduleId - 排班表 ID
     * @param {Array} staff - 人員陣列
     * @param {Object} usersMap - 使用者對照表
     */
    setStaff: function(scheduleId, staff, usersMap) {
        if (!this.sessionData[scheduleId]) {
            this.init(scheduleId, null);
        }
        this.sessionData[scheduleId].staff = staff;
        this.sessionData[scheduleId].usersMap = usersMap;
        this.dataVersion.staff++;
        this.stats.saves++;
        console.log(`💾 SessionCache: 已儲存人員資料 (${Object.keys(usersMap).length} 位人員)`);
    },
    
    /**
     * 取得人員資料
     * @param {string} scheduleId - 排班表 ID
     * @returns {Object|null} 包含 staff 和 usersMap 的物件
     */
    getStaff: function(scheduleId) {
        const session = this.sessionData[scheduleId];
        if (!session || !session.usersMap) {
            this.stats.misses++;
            return null;
        }
        this.stats.hits++;
        console.log('⚡ SessionCache: 命中人員資料');
        return {
            staff: session.staff,
            usersMap: session.usersMap
        };
    },
    
    /**
     * 儲存排班規則
     * @param {string} scheduleId - 排班表 ID
     * @param {Object} rules - 排班規則
     */
    setRules: function(scheduleId, rules) {
        if (!this.sessionData[scheduleId]) {
            this.init(scheduleId, null);
        }
        this.sessionData[scheduleId].rules = rules;
        this.dataVersion.rules++;
        this.stats.saves++;
        console.log('💾 SessionCache: 已儲存排班規則');
    },
    
    /**
     * 取得排班規則
     * @param {string} scheduleId - 排班表 ID
     * @returns {Object|null} 排班規則
     */
    getRules: function(scheduleId) {
        const rules = this.sessionData[scheduleId]?.rules || null;
        if (rules) {
            this.stats.hits++;
            console.log('⚡ SessionCache: 命中排班規則');
        } else {
            this.stats.misses++;
        }
        return rules;
    },
    
    /**
     * 儲存排班資料（本地運算的核心）
     * @param {string} scheduleId - 排班表 ID
     * @param {Object} assignments - 排班資料
     */
    setAssignments: function(scheduleId, assignments) {
        if (!this.sessionData[scheduleId]) {
            this.init(scheduleId, null);
        }
        // 深拷貝避免引用問題
        this.sessionData[scheduleId].assignments = JSON.parse(JSON.stringify(assignments));
        this.sessionData[scheduleId].lastUpdated = Date.now();
        this.dataVersion.assignments++;
        this.stats.saves++;
        console.log('💾 SessionCache: 已儲存排班資料');
    },
    
    /**
     * 取得排班資料
     * @param {string} scheduleId - 排班表 ID
     * @returns {Object|null} 排班資料
     */
    getAssignments: function(scheduleId) {
        const assignments = this.sessionData[scheduleId]?.assignments || null;
        if (assignments) {
            this.stats.hits++;
            console.log('⚡ SessionCache: 命中排班資料');
        } else {
            this.stats.misses++;
        }
        return assignments;
    },
    
    /**
     * 儲存上月資料
     * @param {string} scheduleId - 排班表 ID
     * @param {Object} lastMonthData - 上月資料
     */
    setLastMonthData: function(scheduleId, lastMonthData) {
        if (!this.sessionData[scheduleId]) {
            this.init(scheduleId, null);
        }
        this.sessionData[scheduleId].lastMonthData = lastMonthData;
        this.stats.saves++;
    },
    
    /**
     * 取得上月資料
     * @param {string} scheduleId - 排班表 ID
     * @returns {Object|null} 上月資料
     */
    getLastMonthData: function(scheduleId) {
        const data = this.sessionData[scheduleId]?.lastMonthData || null;
        if (data) this.stats.hits++;
        else this.stats.misses++;
        return data;
    },
    
    /**
     * 快取統計數據（避免重複計算）
     * @param {string} scheduleId - 排班表 ID
     * @param {Object} stats - 統計數據
     */
    cacheStatistics: function(scheduleId, stats) {
        if (!this.sessionData[scheduleId]) {
            this.init(scheduleId, null);
        }
        this.sessionData[scheduleId].statistics = stats;
        this.stats.saves++;
        console.log('💾 SessionCache: 已快取統計數據');
    },
    
    /**
     * 取得快取的統計數據
     * @param {string} scheduleId - 排班表 ID
     * @returns {Object|null} 統計數據
     */
    getStatistics: function(scheduleId) {
        const statistics = this.sessionData[scheduleId]?.statistics || null;
        if (statistics) {
            this.stats.hits++;
            console.log('⚡ SessionCache: 命中統計數據');
        } else {
            this.stats.misses++;
        }
        return statistics;
    },
    
    /**
     * 儲存評分結果
     * @param {string} scheduleId - 排班表 ID
     * @param {Object} scoreResult - 評分結果
     */
    setScoreResult: function(scheduleId, scoreResult) {
        if (!this.sessionData[scheduleId]) {
            this.init(scheduleId, null);
        }
        this.sessionData[scheduleId].scoreResult = scoreResult;
        this.stats.saves++;
    },
    
    /**
     * 取得評分結果
     * @param {string} scheduleId - 排班表 ID
     * @returns {Object|null} 評分結果
     */
    getScoreResult: function(scheduleId) {
        const score = this.sessionData[scheduleId]?.scoreResult || null;
        if (score) this.stats.hits++;
        else this.stats.misses++;
        return score;
    },
    
    /**
     * 檢查是否需要重新載入
     * @param {string} scheduleId - 排班表 ID
     * @param {number} maxAge - 最大存活時間（毫秒，預設 30 分鐘）
     * @returns {boolean} 是否需要重新載入
     */
    needsReload: function(scheduleId, maxAge = 30 * 60 * 1000) {
        const session = this.sessionData[scheduleId];
        if (!session) return true;
        
        const age = Date.now() - session.loadedAt;
        const needsReload = age > maxAge;
        
        if (needsReload) {
            console.log(`⏰ SessionCache: 資料已過期 (${Math.round(age/1000)}秒)`);
        }
        
        return needsReload;
    },
    
    /**
     * 檢查快取是否完整
     * @param {string} scheduleId - 排班表 ID
     * @returns {boolean} 快取是否包含所有必要資料
     */
    isComplete: function(scheduleId) {
        const session = this.sessionData[scheduleId];
        if (!session) return false;
        
        return !!(session.shifts && session.usersMap && session.rules);
    },
    
    /**
     * 取得快取狀態摘要
     * @param {string} scheduleId - 排班表 ID
     * @returns {Object} 快取狀態
     */
    getStatus: function(scheduleId) {
        const session = this.sessionData[scheduleId];
        if (!session) {
            return {
                exists: false,
                complete: false,
                age: 0
            };
        }
        
        const age = Date.now() - session.loadedAt;
        
        return {
            exists: true,
            complete: this.isComplete(scheduleId),
            age: Math.round(age / 1000),
            hasShifts: !!session.shifts,
            hasStaff: !!session.usersMap,
            hasRules: !!session.rules,
            hasAssignments: !!session.assignments,
            hasStatistics: !!session.statistics,
            lastUpdated: session.lastUpdated ? Math.round((Date.now() - session.lastUpdated) / 1000) : null
        };
    },
    
    /**
     * 清除特定排班表的快取
     * @param {string} scheduleId - 排班表 ID
     */
    clear: function(scheduleId) {
        if (this.sessionData[scheduleId]) {
            delete this.sessionData[scheduleId];
            console.log('🗑️ SessionCache 已清除:', scheduleId);
        }
    },
    
    /**
     * 清除所有快取
     */
    clearAll: function() {
        this.sessionData = {};
        this.currentScheduleId = null;
        this.dataVersion = { shifts: 0, staff: 0, rules: 0, assignments: 0 };
        console.log('🗑️ SessionCache 已全部清除');
    },
    
    /**
     * 顯示快取統計資訊
     */
    showStats: function() {
        const hitRate = this.stats.hits + this.stats.misses > 0 
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1)
            : 0;
        
        console.log('📊 SessionCache 統計資訊');
        console.log('=====================================');
        console.log(`✅ 快取命中: ${this.stats.hits} 次`);
        console.log(`❌ 快取未命中: ${this.stats.misses} 次`);
        console.log(`💾 資料儲存: ${this.stats.saves} 次`);
        console.log(`📈 命中率: ${hitRate}%`);
        console.log(`📦 快取項目數: ${Object.keys(this.sessionData).length}`);
        console.log('=====================================');
        
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            saves: this.stats.saves,
            hitRate: parseFloat(hitRate),
            itemCount: Object.keys(this.sessionData).length
        };
    },
    
    /**
     * 重置統計資訊
     */
    resetStats: function() {
        this.stats = { hits: 0, misses: 0, saves: 0 };
        console.log('🔄 SessionCache 統計已重置');
    }
};

// 在視窗關閉前清除快取（可選）
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        console.log('👋 視窗關閉，SessionCache 統計:');
        SessionCache.showStats();
    });
}

console.log('✅ SessionCache 已載入');
