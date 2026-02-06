// js/utils/shift_utils.js
// 班別分類與過濾工具模組

const shiftUtils = {
    /**
     * 判斷班別類型（只看上班時間）
     * @param {object} shift - 班別物件，需包含 startTime
     * @returns {string} 'day' | 'evening' | 'night' | 'other'
     * 
     * 分類規則：
     * - 白班類 (day): 上班時間 06:00-09:00
     * - 小夜類 (evening): 上班時間 15:00-18:00
     * - 大夜類 (night): 上班時間 23:00-02:00
     * - 特殊班 (other): 不符合以上任何條件
     */
    getShiftCategory: function(shift) {
        if (!shift || !shift.startTime) return 'other';
        
        const hour = parseInt(shift.startTime.split(':')[0]);
        
        // 大夜類：上班時間 23:00-02:00 (包含跨日)
        if (hour >= 23 || hour <= 2) return 'night';
        
        // 小夜類：上班時間 15:00-18:00
        if (hour >= 15 && hour <= 18) return 'evening';
        
        // 白班類：上班時間 06:00-09:00
        if (hour >= 6 && hour <= 9) return 'day';
        
        // 特殊班：其他時段
        return 'other';
    },
    
    /**
     * 判斷是否為夜班
     * @param {object} shift - 班別物件
     * @returns {boolean}
     */
    isNightShift: function(shift) {
        return this.getShiftCategory(shift) === 'night';
    },
    
    /**
     * 判斷是否為小夜班
     * @param {object} shift - 班別物件
     * @returns {boolean}
     */
    isEveningShift: function(shift) {
        return this.getShiftCategory(shift) === 'evening';
    },
    
    /**
     * 判斷是否為白班
     * @param {object} shift - 班別物件
     * @returns {boolean}
     */
    isDayShift: function(shift) {
        return this.getShiftCategory(shift) === 'day';
    },
    
    /**
     * 判斷是否為小夜或大夜（用於包班過濾）
     * @param {object} shift - 班別物件
     * @returns {boolean}
     */
    isEveningOrNightShift: function(shift) {
        const category = this.getShiftCategory(shift);
        return category === 'evening' || category === 'night';
    },
    
    /**
     * 根據 startTime 字串判斷班別類型（相容性方法）
     * @param {string} startTime - 班別開始時間 (HH:mm 格式)
     * @returns {string} 'day' | 'evening' | 'night' | 'other'
     */
    getShiftCategoryByTime: function(startTime) {
        return this.getShiftCategory({ startTime: startTime });
    }
};
