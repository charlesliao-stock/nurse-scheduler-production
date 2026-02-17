// js/utils/cache_manager.js
// 🚀 快取管理模組 - 減少 Firebase 資料庫讀取次數

const CacheManager = {
    // 快取儲存
    cache: {
        shifts: {},           // 班別資料 { unitId: { data, timestamp } }
        users: {},            // 員工資料 { unitId: { data, timestamp } }
        rules: {},            // 規則資料 { unitId: { data, timestamp } }
        schedules: {},        // 排班資料 { scheduleId: { data, timestamp } }
        preSchedules: {}      // 預班資料 { preScheduleId: { data, timestamp } }
    },
    
    // 快取設定
    config: {
        defaultTTL: 5 * 60 * 1000,        // 預設 5 分鐘
        shiftsTTL: 30 * 60 * 1000,        // 班別：30 分鐘（較少變動）
        usersTTL: 10 * 60 * 1000,         // 員工：10 分鐘
        rulesTTL: 30 * 60 * 1000,         // 規則：30 分鐘（較少變動）
        schedulesTTL: 2 * 60 * 1000,      // 排班：2 分鐘（常變動）
        preSchedulesTTL: 5 * 60 * 1000    // 預班：5 分鐘
    },
    
    // 快取統計
    stats: {
        hits: 0,
        misses: 0,
        saves: 0
    },
    
    /**
     * 通用快取獲取方法
     */
    get: function(cacheType, key) {
        const cached = this.cache[cacheType][key];
        
        if (!cached) {
            this.stats.misses++;
            return null;
        }
        
        // 檢查是否過期
        const ttl = this.config[`${cacheType}TTL`] || this.config.defaultTTL;
        const now = Date.now();
        
        if (now - cached.timestamp > ttl) {
            console.log(`⏰ 快取過期: ${cacheType}/${key}`);
            delete this.cache[cacheType][key];
            this.stats.misses++;
            return null;
        }
        
        this.stats.hits++;
        console.log(`✅ 快取命中: ${cacheType}/${key}`);
        return JSON.parse(JSON.stringify(cached.data)); // 返回深拷貝
    },
    
    /**
     * 通用快取設定方法
     */
    set: function(cacheType, key, data) {
        this.cache[cacheType][key] = {
            data: JSON.parse(JSON.stringify(data)), // 儲存深拷貝
            timestamp: Date.now()
        };
        this.stats.saves++;
        console.log(`💾 快取儲存: ${cacheType}/${key}`);
    },
    
    /**
     * 載入班別資料（帶快取）
     */
    loadShifts: async function(unitId) {
        const cached = this.get('shifts', unitId);
        if (cached) return cached;
        
        console.log(`📡 從資料庫載入班別: ${unitId}`);
        const snapshot = await db.collection('shifts')
            .where('unitId', '==', unitId)
            .orderBy('order')
            .get();
        
        const shifts = [];
        snapshot.forEach(doc => {
            shifts.push({ id: doc.id, ...doc.data() });
        });
        
        this.set('shifts', unitId, shifts);
        return shifts;
    },
    
    /**
     * 載入員工資料（帶快取）
     */
    loadUsers: async function(unitId) {
        const cached = this.get('users', unitId);
        if (cached) return cached;
        
        console.log(`📡 從資料庫載入員工: ${unitId}`);
        const snapshot = await db.collection('users')
            .where('unitId', '==', unitId)
            .where('active', '==', true)
            .get();
        
        const users = {};
        snapshot.forEach(doc => {
            users[doc.id] = { id: doc.id, ...doc.data() };
        });
        
        this.set('users', unitId, users);
        return users;
    },
    
    /**
     * 載入規則資料（帶快取）
     */
    loadRules: async function(unitId) {
        const cached = this.get('rules', unitId);
        if (cached) return cached;
        
        console.log(`📡 從資料庫載入規則: ${unitId}`);
        const doc = await db.collection('scheduling_rules').doc(unitId).get();
        
        const rules = doc.exists ? doc.data() : {};
        this.set('rules', unitId, rules);
        return rules;
    },
    
    /**
     * 載入排班資料（帶快取）
     */
    loadSchedule: async function(scheduleId) {
        const cached = this.get('schedules', scheduleId);
        if (cached) return cached;
        
        console.log(`📡 從資料庫載入排班: ${scheduleId}`);
        const doc = await db.collection('schedules').doc(scheduleId).get();
        
        if (!doc.exists) {
            throw new Error('排班不存在');
        }
        
        const schedule = { id: doc.id, ...doc.data() };
        this.set('schedules', scheduleId, schedule);
        return schedule;
    },
    
    /**
     * 載入預班資料（帶快取）
     */
    loadPreSchedule: async function(preScheduleId) {
        const cached = this.get('preSchedules', preScheduleId);
        if (cached) return cached;
        
        console.log(`📡 從資料庫載入預班: ${preScheduleId}`);
        const doc = await db.collection('pre_schedules').doc(preScheduleId).get();
        
        if (!doc.exists) {
            throw new Error('預班不存在');
        }
        
        const preSchedule = { id: doc.id, ...doc.data() };
        this.set('preSchedules', preScheduleId, preSchedule);
        return preSchedule;
    },
    
    /**
     * 使特定快取失效
     */
    invalidate: function(cacheType, key) {
        if (this.cache[cacheType][key]) {
            delete this.cache[cacheType][key];
            console.log(`🗑️ 快取失效: ${cacheType}/${key}`);
        }
    },
    
    /**
     * 使整個類型的快取失效
     */
    invalidateType: function(cacheType) {
        this.cache[cacheType] = {};
        console.log(`🗑️ 清除所有 ${cacheType} 快取`);
    },
    
    /**
     * 清除所有快取
     */
    clearAll: function() {
        Object.keys(this.cache).forEach(type => {
            this.cache[type] = {};
        });
        console.log(`🗑️ 清除所有快取`);
    },
    
    /**
     * 預熱快取（提前載入常用資料）
     */
    preload: async function(unitId) {
        console.log(`🔥 預熱快取: ${unitId}`);
        try {
            await Promise.all([
                this.loadShifts(unitId),
                this.loadUsers(unitId),
                this.loadRules(unitId)
            ]);
            console.log(`✅ 快取預熱完成: ${unitId}`);
        } catch (error) {
            console.error(`❌ 快取預熱失敗:`, error);
        }
    },
    
    /**
     * 獲取快取統計
     */
    getStats: function() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
        
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            saves: this.stats.saves,
            total: total,
            hitRate: `${hitRate}%`,
            cacheSize: this.getCacheSize()
        };
    },
    
    /**
     * 獲取快取大小統計
     */
    getCacheSize: function() {
        const size = {};
        Object.keys(this.cache).forEach(type => {
            size[type] = Object.keys(this.cache[type]).length;
        });
        return size;
    },
    
    /**
     * 顯示快取統計（開發用）
     */
    showStats: function() {
        const stats = this.getStats();
        console.log('📊 快取統計:');
        console.log(`  命中: ${stats.hits} 次`);
        console.log(`  未命中: ${stats.misses} 次`);
        console.log(`  儲存: ${stats.saves} 次`);
        console.log(`  命中率: ${stats.hitRate}`);
        console.log(`  快取大小:`, stats.cacheSize);
    }
};

// 🔄 替換原有的 DataLoader
const DataLoader = {
    loadShifts: (unitId) => CacheManager.loadShifts(unitId),
    loadUsersMap: (unitId) => CacheManager.loadUsers(unitId),
    loadSchedulingRules: (unitId) => CacheManager.loadRules(unitId)
};

console.log('✅ cache_manager.js 已載入');
