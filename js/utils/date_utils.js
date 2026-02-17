/**
 * Date Utilities Module
 * 統一的日期處理工具函數
 * 解決跨檔案日期格式化重複的問題
 */

const DateUtils = {
    /**
     * 獲取星期幾 (0=星期一, 6=星期日)
     * @param {Date} dateObj - Date 物件
     * @returns {number} - 星期幾 (0-6)
     */
    getDayOfWeek(dateObj) {
        const jsDay = dateObj.getDay();
        // 將 JavaScript 的星期格式 (0=星期日) 轉換為 (0=星期一)
        return (jsDay === 0) ? 6 : jsDay - 1;
    },

    /**
     * 獲取星期名稱
     * @param {number} dayOfWeek - 星期幾 (0-6)
     * @param {boolean} isShort - 是否使用簡寫
     * @returns {string} - 星期名稱
     */
    getDayName(dayOfWeek, isShort = false) {
        const fullNames = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
        const shortNames = ['一', '二', '三', '四', '五', '六', '日'];
        const names = isShort ? shortNames : fullNames;
        return names[dayOfWeek] || '';
    },

    /**
     * 將日期格式化為 YYYY-MM-DD 字串
     * @param {Date} date - Date 物件
     * @returns {string} - 日期字串 (YYYY-MM-DD)
     */
    getDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    /**
     * 將 YYYY-MM-DD 字串轉換為 Date 物件
     * @param {string} dateKey - 日期字串 (YYYY-MM-DD)
     * @returns {Date} - Date 物件
     */
    parseDateKey(dateKey) {
        const [year, month, day] = dateKey.split('-').map(Number);
        return new Date(year, month - 1, day);
    },

    /**
     * 檢查是否為假日
     * @param {string} dateKey - 日期字串 (YYYY-MM-DD)
     * @param {Array<string>} holidays - 假日陣列
     * @returns {boolean} - 是否為假日
     */
    isHoliday(dateKey, holidays) {
        return holidays && holidays.includes(dateKey);
    },

    /**
     * 檢查是否為周末
     * @param {Date} dateObj - Date 物件
     * @returns {boolean} - 是否為周末
     */
    isWeekend(dateObj) {
        const dayOfWeek = this.getDayOfWeek(dateObj);
        return dayOfWeek === 5 || dayOfWeek === 6; // 星期六或星期日
    },

    /**
     * 獲取日期範圍
     * @param {Date} startDate - 開始日期
     * @param {number} numDays - 天數
     * @returns {Array<string>} - 日期字串陣列
     */
    getDateRange(startDate, numDays) {
        const dates = [];
        const currentDate = new Date(startDate);
        
        for (let i = 0; i < numDays; i++) {
            dates.push(this.getDateKey(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        return dates;
    },

    /**
     * 計算兩個日期之間的天數
     * @param {Date} date1 - 第一個日期
     * @param {Date} date2 - 第二個日期
     * @returns {number} - 天數差
     */
    getDaysBetween(date1, date2) {
        const oneDay = 24 * 60 * 60 * 1000; // 一天的毫秒數
        return Math.round(Math.abs((date1 - date2) / oneDay));
    },

    /**
     * 獲取月份的第一天
     * @param {Date} date - 日期
     * @returns {Date} - 該月的第一天
     */
    getFirstDayOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    },

    /**
     * 獲取月份的最後一天
     * @param {Date} date - 日期
     * @returns {Date} - 該月的最後一天
     */
    getLastDayOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    },

    /**
     * 獲取月份的總天數
     * @param {Date} date - 日期
     * @returns {number} - 該月的總天數
     */
    getDaysInMonth(date) {
        return this.getLastDayOfMonth(date).getDate();
    },

    /**
     * 格式化日期顯示 (例: 2026/02/18 (三))
     * @param {Date} date - 日期
     * @returns {string} - 格式化後的日期字串
     */
    formatDateDisplay(date) {
        const dateKey = this.getDateKey(date).replace(/-/g, '/');
        const dayOfWeek = this.getDayOfWeek(date);
        const dayName = this.getDayName(dayOfWeek, true);
        return `${dateKey} (${dayName})`;
    }
};

// 導出供其他模組使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DateUtils;
}
