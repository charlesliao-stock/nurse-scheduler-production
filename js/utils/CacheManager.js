// js/utils/CacheManager.js
/**
 * 全域快取管理器 (優化整合版)
 * 整合雙層快取、Firebase 載入、統計與自動清理功能
 * 
 * 主要功能：
 * - 記憶體 + localStorage 雙層快取
 * - TTL 自動過期機制
 * - Firebase 資料載入整合
 * - 快取命中率統計
 * - 模式化清除與自動清理
 * - 預熱機制
 */

const CacheManager = {
    // 記憶體快取儲存區
    cache: {},
    
    // 持久化前綴
    STORAGE_PREFIX: 'ns_cache_',
    
    // TTL 配置（毫秒）
    ttl: {
        units: 60 * 60 * 1000,      // 1 小時
        shifts: 30 * 60 * 1000,     // 30 分鐘
        users: 10 * 60 * 1000,      // 10 分鐘
        rules: 30 * 60 * 1000,      // 30 分鐘
        schedules: 2 * 60 * 1000,   // 2 分鐘
        preSchedules: 5 * 60 * 1000, // 5 分鐘
        menus: 24 * 60 * 60 * 1000, // 24 小時
        default: 5 * 60 * 1000      // 5 分鐘
    },
    
    // 快取統計
    stats: {
        hits: 0,
        misses: 0,
        saves: 0
    },

    /**
     * 儲存資料到快取
     * @param {string} key - 快取鍵值
     * @param {any} data - 要快取的資料
     * @param {string} type - 資料類型（決定 TTL）
     * @param {boolean} persist - 是否持久化到 localStorage
     */
    set: function(key, data, type = 'default', persist = true) {
        if (!key) {
            console.warn('⚠️ CacheManager.set: key 不能為空');
            return;
        }
        
        const ttl = this.ttl[type] || this.ttl.default;
        const cacheItem = {
            data: JSON.parse(JSON.stringify(data)), // 深拷貝避免引用問題
            timestamp: Date.now(),
            ttl: ttl,
            type: type
        };
        
        // 存入記憶體
        this.cache[key] = cacheItem;
        
        // 存入 localStorage（如果需要）
        if (persist) {
            try {
                localStorage.setItem(this.STORAGE_PREFIX + key, JSON.stringify(cacheItem));
            } catch (e) {
                console.warn('⚠️ localStorage 寫入失敗 (可能空間不足)', e);
            }
        }
        
        this.stats.saves++;
        console.log(`💾 快取已建立: ${key} (類型: ${type}, TTL: ${ttl/1000}秒)`);
    },
    
    /**
     * 從快取取得資料
     * @param {string} key - 快取鍵值
     * @returns {any|null} - 快取的資料，若過期或不存在則回傳 null
     */
    get: function(key) {
        // 先從記憶體找
        let cached = this.cache[key];
        
        // 記憶體沒有，從 localStorage 找
        if (!cached) {
            const stored = localStorage.getItem(this.STORAGE_PREFIX + key);
            if (stored) {
                try {
                    cached = JSON.parse(stored);
                    this.cache[key] = cached; // 放入記憶體
                } catch (e) {
                    localStorage.removeItem(this.STORAGE_PREFIX + key);
                }
            }
        }
        
        if (!cached) {
            this.stats.misses++;
            console.log(`📭 快取未命中: ${key}`);
            return null;
        }
        
        const age = Date.now() - cached.timestamp;
        
        // 檢查是否過期
        if (age > cached.ttl) {
            this.remove(key);
            this.stats.misses++;
            console.log(`⏰ 快取已過期: ${key} (存活: ${Math.round(age/1000)}秒)`);
            return null;
        }
        
        this.stats.hits++;
        const remainingTime = Math.round((cached.ttl - age) / 1000);
        console.log(`✅ 快取命中: ${key} (剩餘: ${remainingTime}秒)`);
        
        return JSON.parse(JSON.stringify(cached.data)); // 返回深拷貝
    },

    /**
     * 移除特定快取
     */
    remove: function(key) {
        delete this.cache[key];
        localStorage.removeItem(this.STORAGE_PREFIX + key);
    },
    
    /**
     * 清除符合模式的快取
     * @param {string} pattern - 要清除的模式（支援部分匹配）
     */
    invalidate: function(pattern) {
        if (!pattern) {
            console.warn('⚠️ CacheManager.invalidate: pattern 不能為空');
            return;
        }
        
        let count = 0;
        
        // 清除記憶體
        Object.keys(this.cache).forEach(key => {
            if (key.includes(pattern)) {
                delete this.cache[key];
                count++;
            }
        });

        // 清除 localStorage
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.STORAGE_PREFIX) && key.includes(pattern)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        
        console.log(`🗑️ 已清除符合模式「${pattern}」的 ${count} 個快取項目`);
    },
    
    /**
     * 清除所有快取
     */
    clear: function() {
        this.cache = {};
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.STORAGE_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        console.log(`🗑️ 所有快取已清除`);
    },
    
    /**
     * 清理過期的快取項目
     */
    cleanup: function() {
        const now = Date.now();
        let cleaned = 0;
        
        // 清理記憶體
        Object.keys(this.cache).forEach(key => {
            const item = this.cache[key];
            if (now - item.timestamp > item.ttl) {
                delete this.cache[key];
                cleaned++;
            }
        });

        // 清理 localStorage
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.STORAGE_PREFIX)) {
                try {
                    const item = JSON.parse(localStorage.getItem(key));
                    if (now - item.timestamp > item.ttl) {
                        keysToRemove.push(key);
                    }
                } catch (e) {
                    keysToRemove.push(key);
                }
            }
        }
        keysToRemove.forEach(k => {
            localStorage.removeItem(k);
            cleaned++;
        });
        
        if (cleaned > 0) {
            console.log(`🧹 已清理 ${cleaned} 個過期快取項目`);
        }
        return cleaned;
    },

    // ==================== Firebase 整合方法 ====================
    
    /**
     * 載入班別資料（帶快取）
     */
    loadShifts: async function(unitId) {
        const key = `shifts_${unitId}`;
        const cached = this.get(key);
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
        
        this.set(key, shifts, 'shifts');
        return shifts;
    },
    
    /**
     * 載入員工資料（帶快取）
     */
    loadUsers: async function(unitId) {
        const key = `users_${unitId}`;
        const cached = this.get(key);
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
        
        this.set(key, users, 'users');
        return users;
    },
    
    /**
     * 載入規則資料（帶快取）
     */
    loadRules: async function(unitId) {
        const key = `rules_${unitId}`;
        const cached = this.get(key);
        if (cached) return cached;
        
        console.log(`📡 從資料庫載入規則: ${unitId}`);
        const doc = await db.collection('scheduling_rules').doc(unitId).get();
        
        const rules = doc.exists ? doc.data() : {};
        this.set(key, rules, 'rules');
        return rules;
    },
    
    /**
     * 載入排班資料（帶快取）
     */
    loadSchedule: async function(scheduleId) {
        const key = `schedule_${scheduleId}`;
        const cached = this.get(key);
        if (cached) return cached;
        
        console.log(`📡 從資料庫載入排班: ${scheduleId}`);
        const doc = await db.collection('schedules').doc(scheduleId).get();
        
        if (!doc.exists) {
            throw new Error('排班不存在');
        }
        
        const schedule = { id: doc.id, ...doc.data() };
        this.set(key, schedule, 'schedules');
        return schedule;
    },
    
    /**
     * 載入預班資料（帶快取）
     */
    loadPreSchedule: async function(preScheduleId) {
        const key = `preSchedule_${preScheduleId}`;
        const cached = this.get(key);
        if (cached) return cached;
        
        console.log(`📡 從資料庫載入預班: ${preScheduleId}`);
        const doc = await db.collection('pre_schedules').doc(preScheduleId).get();
        
        if (!doc.exists) {
            throw new Error('預班不存在');
        }
        
        const preSchedule = { id: doc.id, ...doc.data() };
        this.set(key, preSchedule, 'preSchedules');
        return preSchedule;
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
    
    // ==================== 統計與監控 ====================
    
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
            memorySize: Object.keys(this.cache).length,
            storageSize: this.getStorageSize()
        };
    },
    
    /**
     * 獲取 localStorage 快取數量
     */
    getStorageSize: function() {
        let count = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.STORAGE_PREFIX)) {
                count++;
            }
        }
        return count;
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
        console.log(`  記憶體快取: ${stats.memorySize} 項`);
        console.log(`  持久化快取: ${stats.storageSize} 項`);
    }
};

// 🔄 DataLoader 相容層已移至 DataLoader.js
// 此處不再重複宣告，避免 SyntaxError

// 定期清理過期快取（每 10 分鐘）
if (typeof window !== 'undefined') {
    setInterval(() => {
        CacheManager.cleanup();
    }, 10 * 60 * 1000);
}

console.log('✅ CacheManager (優化整合版) 已載入');
