// js/utils/CacheManager.js
/**
 * 全域快取管理器 (升級版：支援 localStorage 持久化)
 * 用途：減少重複的 Firebase 讀取，提升效能並降低成本
 * 
 * 功能：
 * - 支援 TTL（過期時間）機制
 * - 支援記憶體與 localStorage 雙層快取
 * - 支援模式化清除（例如：清除某單位的所有快取）
 * - 自動過期檢查與清理
 */

const CacheManager = {
    // 記憶體快取儲存區
    cache: {},
    
    // 持久化前綴，避免與其他 localStorage 衝突
    STORAGE_PREFIX: 'ns_cache_',
    
    // TTL 設定（毫秒）
    ttl: {
        units: 60 * 60 * 1000,      // 1 小時（單位資料很少變動）
        shifts: 30 * 60 * 1000,     // 30 分鐘（班別偶爾調整）
        staff: 10 * 60 * 1000,      // 10 分鐘（人員資料較常變動）
        schedules: 5 * 60 * 1000,   // 5 分鐘（排班資料頻繁變動）
        rules: 30 * 60 * 1000,      // 30 分鐘（規則偶爾調整）
        menus: 24 * 60 * 60 * 1000, // 24 小時（選單設定極少變動）
        default: 5 * 60 * 1000      // 5 分鐘（預設值）
    },

    /**
     * 儲存資料到快取 (記憶體 + localStorage)
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
            data: data,
            timestamp: Date.now(),
            ttl: ttl,
            type: type
        };
        
        // 1. 存入記憶體
        this.cache[key] = cacheItem;
        
        // 2. 存入 localStorage (如果需要持久化)
        if (persist) {
            try {
                localStorage.setItem(this.STORAGE_PREFIX + key, JSON.stringify(cacheItem));
            } catch (e) {
                console.warn('⚠️ CacheManager: localStorage 寫入失敗 (可能空間不足)', e);
            }
        }
        
        console.log(`✅ 快取已建立: ${key} (類型: ${type}, TTL: ${ttl/1000}秒, 持久化: ${persist})`);
    },
    
    /**
     * 從快取取得資料 (先查記憶體，再查 localStorage)
     * @param {string} key - 快取鍵值
     * @returns {any|null} - 快取的資料，若過期或不存在則回傳 null
     */
    get: function(key) {
        // 1. 先從記憶體找
        let cached = this.cache[key];
        
        // 2. 記憶體沒有，從 localStorage 找
        if (!cached) {
            const stored = localStorage.getItem(this.STORAGE_PREFIX + key);
            if (stored) {
                try {
                    cached = JSON.parse(stored);
                    // 放入記憶體以便下次快速讀取
                    this.cache[key] = cached;
                } catch (e) {
                    localStorage.removeItem(this.STORAGE_PREFIX + key);
                }
            }
        }
        
        if (!cached) {
            console.log(`📭 快取未命中: ${key}`);
            return null;
        }
        
        const age = Date.now() - cached.timestamp;
        
        // 檢查是否過期
        if (age > cached.ttl) {
            this.remove(key);
            console.log(`⏰ 快取已過期: ${key} (存活時間: ${Math.round(age/1000)}秒)`);
            return null;
        }
        
        const remainingTime = Math.round((cached.ttl - age) / 1000);
        console.log(`✅ 快取命中: ${key} (剩餘: ${remainingTime}秒)`);
        
        return cached.data;
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
        
        // 1. 清除記憶體
        Object.keys(this.cache).forEach(key => {
            if (key.includes(pattern)) {
                delete this.cache[key];
                count++;
            }
        });

        // 2. 清除 localStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.STORAGE_PREFIX) && key.includes(pattern)) {
                localStorage.removeItem(key);
                // 由於 removeItem 會改變 length，這裡不增加 count 以免重複計算
            }
        }
        
        console.log(`✅ 已清除符合模式「${pattern}」的快取項目`);
    },
    
    /**
     * 清除所有快取
     */
    clear: function() {
        this.cache = {};
        // 只清除屬於本系統的 localStorage
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
        
        // 1. 清理記憶體
        Object.keys(this.cache).forEach(key => {
            const item = this.cache[key];
            if (now - item.timestamp > item.ttl) {
                delete this.cache[key];
                cleaned++;
            }
        });

        // 2. 清理 localStorage
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
    }
};

// 定期清理過期快取（每 10 分鐘執行一次）
if (typeof window !== 'undefined') {
    setInterval(() => {
        CacheManager.cleanup();
    }, 10 * 60 * 1000);
}

console.log('✅ CacheManager (持久化版) 已載入');
