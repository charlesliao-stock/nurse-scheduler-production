// js/utils/CacheManager.js
/**
 * 全域快取管理器
 * 用途：減少重複的 Firebase 讀取，提升效能並降低成本
 * 
 * 功能：
 * - 支援 TTL（過期時間）機制
 * - 支援模式化清除（例如：清除某單位的所有快取）
 * - 自動過期檢查
 * - 記憶體管理
 * 
 * 使用範例：
 * CacheManager.set('units_all', unitsData, 'units');
 * const cached = CacheManager.get('units_all');
 * CacheManager.invalidate('unit_ABC123');
 */

const CacheManager = {
    // 快取儲存區
    cache: {},
    
    // TTL 設定（毫秒）
    ttl: {
        units: 10 * 60 * 1000,      // 10 分鐘（單位資料很少變動）
        shifts: 5 * 60 * 1000,       // 5 分鐘（班別偶爾調整）
        staff: 2 * 60 * 1000,        // 2 分鐘（人員資料較常變動）
        schedules: 1 * 60 * 1000,    // 1 分鐘（排班資料頻繁變動）
        rules: 5 * 60 * 1000,        // 5 分鐘（規則偶爾調整）
        default: 3 * 60 * 1000       // 3 分鐘（預設值）
    },
    
    /**
     * 儲存資料到快取
     * @param {string} key - 快取鍵值
     * @param {any} data - 要快取的資料
     * @param {string} type - 資料類型（決定 TTL）
     */
    set: function(key, data, type = 'default') {
        if (!key) {
            console.warn('⚠️ CacheManager.set: key 不能為空');
            return;
        }
        
        const ttl = this.ttl[type] || this.ttl.default;
        
        this.cache[key] = {
            data: data,
            timestamp: Date.now(),
            ttl: ttl,
            type: type
        };
        
        console.log(`✅ 快取已建立: ${key} (類型: ${type}, TTL: ${ttl/1000}秒)`);
    },
    
    /**
     * 從快取取得資料
     * @param {string} key - 快取鍵值
     * @returns {any|null} - 快取的資料，若過期或不存在則回傳 null
     */
    get: function(key) {
        const cached = this.cache[key];
        
        if (!cached) {
            console.log(`📭 快取未命中: ${key}`);
            return null;
        }
        
        const age = Date.now() - cached.timestamp;
        
        // 檢查是否過期
        if (age > cached.ttl) {
            delete this.cache[key];
            console.log(`⏰ 快取已過期: ${key} (存活時間: ${Math.round(age/1000)}秒)`);
            return null;
        }
        
        const remainingTime = Math.round((cached.ttl - age) / 1000);
        console.log(`✅ 快取命中: ${key} (剩餘: ${remainingTime}秒)`);
        
        return cached.data;
    },
    
    /**
     * 清除符合模式的快取
     * @param {string} pattern - 要清除的模式（支援部分匹配）
     * 
     * 範例：
     * invalidate('unit_ABC123') → 清除該單位的所有快取
     * invalidate('shifts_') → 清除所有班別快取
     */
    invalidate: function(pattern) {
        if (!pattern) {
            console.warn('⚠️ CacheManager.invalidate: pattern 不能為空');
            return;
        }
        
        let count = 0;
        
        Object.keys(this.cache).forEach(key => {
            if (key.includes(pattern)) {
                delete this.cache[key];
                count++;
                console.log(`🗑️ 快取已清除: ${key}`);
            }
        });
        
        if (count > 0) {
            console.log(`✅ 共清除 ${count} 個快取項目（模式: ${pattern}）`);
        } else {
            console.log(`📭 沒有符合模式的快取項目: ${pattern}`);
        }
    },
    
    /**
     * 清除所有快取
     */
    clear: function() {
        const count = Object.keys(this.cache).length;
        this.cache = {};
        console.log(`🗑️ 所有快取已清除 (共 ${count} 個項目)`);
    },
    
    /**
     * 取得快取統計資訊
     * @returns {object} 統計資訊
     */
    getStats: function() {
        const stats = {
            total: 0,
            byType: {},
            expired: 0
        };
        
        const now = Date.now();
        
        Object.keys(this.cache).forEach(key => {
            const item = this.cache[key];
            stats.total++;
            
            // 統計類型
            if (!stats.byType[item.type]) {
                stats.byType[item.type] = 0;
            }
            stats.byType[item.type]++;
            
            // 統計過期項目
            const age = now - item.timestamp;
            if (age > item.ttl) {
                stats.expired++;
            }
        });
        
        return stats;
    },
    
    /**
     * 清理過期的快取項目
     * @returns {number} 清理的項目數量
     */
    cleanup: function() {
        const now = Date.now();
        let cleaned = 0;
        
        Object.keys(this.cache).forEach(key => {
            const item = this.cache[key];
            const age = now - item.timestamp;
            
            if (age > item.ttl) {
                delete this.cache[key];
                cleaned++;
            }
        });
        
        if (cleaned > 0) {
            console.log(`🧹 已清理 ${cleaned} 個過期快取項目`);
        }
        
        return cleaned;
    },
    
    /**
     * 列印快取狀態（除錯用）
     */
    debug: function() {
        console.log('📊 === 快取狀態 ===');
        const stats = this.getStats();
        console.log(`總項目數: ${stats.total}`);
        console.log(`已過期: ${stats.expired}`);
        console.log('類型分佈:', stats.byType);
        console.log('快取鍵值:', Object.keys(this.cache));
        console.log('==================');
    }
};

// 定期清理過期快取（每 5 分鐘執行一次）
if (typeof window !== 'undefined') {
    setInterval(() => {
        CacheManager.cleanup();
    }, 5 * 60 * 1000);
}

console.log('✅ CacheManager 已載入');
