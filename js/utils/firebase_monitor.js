// js/utils/firebase_monitor.js
// 🔍 Firebase 讀寫監控工具

const FirebaseMonitor = {
    readCount: 0,
    writeCount: 0,
    readLog: [],
    writeLog: [],
    startTime: null,
    
    init: function() {
        this.startTime = Date.now();
        this.readCount = 0;
        this.writeCount = 0;
        this.readLog = [];
        this.writeLog = [];
        
        console.log('📊 Firebase 監控已啟動');
    },
    
    logRead: function(collection, docId = null) {
        this.readCount++;
        const path = docId ? `${collection}/${docId}` : collection;
        this.readLog.push({
            timestamp: Date.now() - this.startTime,
            path: path,
            count: this.readCount
        });
        
        if (this.readCount % 10 === 0) {
            console.warn(`⚠️ 已讀取 ${this.readCount} 次 Firebase`);
        }
    },
    
    logWrite: function(collection, docId = null) {
        this.writeCount++;
        const path = docId ? `${collection}/${docId}` : collection;
        this.writeLog.push({
            timestamp: Date.now() - this.startTime,
            path: path,
            count: this.writeCount
        });
        
        if (this.writeCount % 10 === 0) {
            console.warn(`⚠️ 已寫入 ${this.writeCount} 次 Firebase`);
        }
    },
    
    getReport: function() {
        const duration = (Date.now() - this.startTime) / 1000;
        
        // 統計各 Collection 的讀寫次數
        const readByCollection = {};
        const writeByCollection = {};
        
        this.readLog.forEach(log => {
            const collection = log.path.split('/')[0];
            readByCollection[collection] = (readByCollection[collection] || 0) + 1;
        });
        
        this.writeLog.forEach(log => {
            const collection = log.path.split('/')[0];
            writeByCollection[collection] = (writeByCollection[collection] || 0) + 1;
        });
        
        console.log(`
╔═══════════════════════════════════════════════════════╗
║         Firebase 讀寫監控報告                          ║
╠═══════════════════════════════════════════════════════╣
║ 監控時長: ${duration.toFixed(2)} 秒                        
║ 總讀取數: ${this.readCount} 次                             
║ 總寫入數: ${this.writeCount} 次                            
╠═══════════════════════════════════════════════════════╣
║ 讀取分佈:
${Object.entries(readByCollection).map(([k, v]) => `║   - ${k}: ${v} 次`).join('\n')}
╠═══════════════════════════════════════════════════════╣
║ 寫入分佈:
${Object.entries(writeByCollection).map(([k, v]) => `║   - ${k}: ${v} 次`).join('\n')}
╚═══════════════════════════════════════════════════════╝
        `);
        
        return {
            duration,
            readCount: this.readCount,
            writeCount: this.writeCount,
            readByCollection,
            writeByCollection,
            readLog: this.readLog,
            writeLog: this.writeLog
        };
    },
    
    reset: function() {
        this.init();
    }
};

// 使用範例：
// 在 console 執行：
// FirebaseMonitor.init();
// ... 執行操作 ...
// FirebaseMonitor.getReport();

window.FirebaseMonitor = FirebaseMonitor;
