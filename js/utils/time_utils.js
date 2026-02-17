/**
 * Time Utilities Module
 * 統一的時間處理工具函數
 * 解決跨檔案 parseTime 定義不一致的問題
 */

const TimeUtils = {
    /**
     * 將時間字串轉換為分鐘數
     * @param {string} timeStr - 時間字串 (例如: "08:00", "OFF")
     * @returns {number|null} - 分鐘數,無效時間回傳 null
     */
    parseTime(timeStr) {
        if (!timeStr || timeStr === 'OFF' || timeStr === 'off') {
            return null;
        }
        
        const parts = timeStr.split(':');
        if (parts.length !== 2) {
            return null;
        }
        
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        
        if (isNaN(hours) || isNaN(minutes)) {
            return null;
        }
        
        return hours * 60 + minutes;
    },

    /**
     * 將時間字串轉換為分鐘數，無效時回傳 0
     * 用於需要數值運算但不需要區分 null 的場景
     * @param {string} timeStr - 時間字串
     * @returns {number} - 分鐘數，無效時回傳 0
     */
    parseTimeOrZero(timeStr) {
        const result = this.parseTime(timeStr);
        return result === null ? 0 : result;
    },

    /**
     * 將分鐘數轉換為時間字串
     * @param {number} minutes - 分鐘數
     * @returns {string} - 時間字串 (例如: "08:00")
     */
    formatTime(minutes) {
        if (minutes === null || minutes === undefined || isNaN(minutes)) {
            return 'OFF';
        }
        
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    },

    /**
     * 計算兩個時間之間的間隔（分鐘）
     * @param {string} startTime - 開始時間
     * @param {string} endTime - 結束時間
     * @returns {number|null} - 時間間隔（分鐘），無效時回傳 null
     */
    getInterval(startTime, endTime) {
        const start = this.parseTime(startTime);
        const end = this.parseTime(endTime);
        
        if (start === null || end === null) {
            return null;
        }
        
        // 處理跨日情況
        let interval = end - start;
        if (interval < 0) {
            interval += 24 * 60; // 加上一天的分鐘數
        }
        
        return interval;
    },

    /**
     * 檢查兩個時間是否滿足最小間隔要求
     * @param {string} time1 - 第一個時間
     * @param {string} time2 - 第二個時間
     * @param {number} minInterval - 最小間隔（分鐘）
     * @returns {boolean} - 是否滿足最小間隔
     */
    meetsMinInterval(time1, time2, minInterval) {
        const interval = this.getInterval(time1, time2);
        if (interval === null) {
            return true; // 如果有一個是 OFF，視為滿足
        }
        return interval >= minInterval;
    }
};

// 導出供其他模組使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimeUtils;
}
