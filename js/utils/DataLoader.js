// js/utils/DataLoader.js
/**
 * 統一資料載入器
 * 用途：整合所有 Firebase 讀取操作，自動使用快取機制
 * 
 * 設計原則：
 * 1. 所有資料庫讀取都通過 DataLoader
 * 2. 自動檢查快取，減少重複讀取
 * 3. 支援強制重新載入（forceReload）
 * 4. 統一錯誤處理
 * 
 * 使用範例：
 * const units = await DataLoader.loadUnits();
 * const shifts = await DataLoader.loadShifts(unitId);
 * const staff = await DataLoader.loadStaff(unitId, true); // 強制重新載入
 */

const DataLoader = {
    
    /**
     * 載入所有單位清單
     * @param {boolean} forceReload - 是否強制重新載入（忽略快取）
     * @returns {Promise<Array>} 單位清單
     */
    loadUnits: async function(forceReload = false) {
        const cacheKey = 'all_units';
        
        // 檢查快取
        if (!forceReload) {
            const cached = CacheManager.get(cacheKey);
            if (cached) return cached;
        }
        
        console.log('📥 從資料庫載入單位清單...');
        
        try {
            const snapshot = await db.collection('units').get();
            const units = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            // 儲存到快取
            CacheManager.set(cacheKey, units, 'units');
            
            console.log(`✅ 已載入 ${units.length} 個單位`);
            return units;
            
        } catch (error) {
            console.error('❌ 載入單位清單失敗:', error);
            throw error;
        }
    },
    
    /**
     * 載入指定單位的班別資料
     * @param {string} unitId - 單位 ID
     * @param {boolean} forceReload - 是否強制重新載入
     * @returns {Promise<Array>} 班別清單
     */
    loadShifts: async function(unitId, forceReload = false) {
        if (!unitId) {
            console.warn('⚠️ DataLoader.loadShifts: unitId 不能為空');
            return [];
        }
        
        const cacheKey = `shifts_${unitId}`;
        
        // 檢查快取
        if (!forceReload) {
            const cached = CacheManager.get(cacheKey);
            if (cached) return cached;
        }
        
        console.log(`📥 從資料庫載入班別: ${unitId}`);
        
        try {
            const snapshot = await db.collection('shifts')
                .where('unitId', '==', unitId)
                .orderBy('startTime')
                .get();
            
            // 只保留排班可用的班別
            const shifts = snapshot.docs
                .map(doc => doc.data())
                .filter(s => s.isScheduleAvailable !== false);
            
            // 儲存到快取
            CacheManager.set(cacheKey, shifts, 'shifts');
            
            console.log(`✅ 已載入 ${shifts.length} 個班別（已過濾排班不可用）`);
            return shifts;
            
        } catch (error) {
            console.error('❌ 載入班別失敗:', error);
            throw error;
        }
    },
    
    /**
     * 載入指定單位的人員資料
     * @param {string} unitId - 單位 ID
     * @param {boolean} forceReload - 是否強制重新載入
     * @returns {Promise<Array>} 人員清單
     */
    loadStaff: async function(unitId, forceReload = false) {
        if (!unitId) {
            console.warn('⚠️ DataLoader.loadStaff: unitId 不能為空');
            return [];
        }
        
        const cacheKey = `staff_${unitId}`;
        
        // 檢查快取
        if (!forceReload) {
            const cached = CacheManager.get(cacheKey);
            if (cached) return cached;
        }
        
        console.log(`📥 從資料庫載入人員: ${unitId}`);
        
        try {
            const snapshot = await db.collection('users')
                .where('unitId', '==', unitId)
                .where('isActive', '==', true)
                .get();
            
            const staff = snapshot.docs.map(doc => ({
                id: doc.id,
                uid: doc.id,
                ...doc.data()
            }));
            
            // 儲存到快取
            CacheManager.set(cacheKey, staff, 'staff');
            
            console.log(`✅ 已載入 ${staff.length} 位人員`);
            return staff;
            
        } catch (error) {
            console.error('❌ 載入人員失敗:', error);
            throw error;
        }
    },
    
    /**
     * 載入指定單位的排班規則
     * @param {string} unitId - 單位 ID
     * @param {boolean} forceReload - 是否強制重新載入
     * @returns {Promise<Object>} 排班規則物件
     */
    loadSchedulingRules: async function(unitId, forceReload = false) {
        if (!unitId) {
            console.warn('⚠️ DataLoader.loadSchedulingRules: unitId 不能為空');
            return {};
        }
        
        const cacheKey = `rules_${unitId}`;
        
        // 檢查快取
        if (!forceReload) {
            const cached = CacheManager.get(cacheKey);
            if (cached) return cached;
        }
        
        console.log(`📥 從資料庫載入排班規則: ${unitId}`);
        
        try {
            const doc = await db.collection('units').doc(unitId).get();
            
            if (!doc.exists) {
                console.warn(`⚠️ 單位不存在: ${unitId}`);
                return {};
            }
            
            const rules = doc.data()?.schedulingRules || {};
            
            // 儲存到快取
            CacheManager.set(cacheKey, rules, 'rules');
            
            console.log(`✅ 已載入排班規則`);
            return rules;
            
        } catch (error) {
            console.error('❌ 載入排班規則失敗:', error);
            throw error;
        }
    },
    
    /**
     * 載入所有使用者資料（建立 UID → 使用者資料的對照表）
     * ⚠️ 慎用！只在必要時使用（例如：預班矩陣、排班編輯器）
     * @param {boolean} forceReload - 是否強制重新載入
     * @returns {Promise<Object>} UID → 使用者資料的 Map
     */
    loadAllUsers: async function(forceReload = false) {
        const cacheKey = 'all_users_map';
        
        // 檢查快取
        if (!forceReload) {
            const cached = CacheManager.get(cacheKey);
            if (cached) return cached;
        }
        
        console.log('📥 從資料庫載入所有使用者資料...');
        console.warn('⚠️ 此操作會讀取所有使用者，請確保有必要！');
        
        try {
            const snapshot = await db.collection('users').get();
            const usersMap = {};
            
            snapshot.forEach(doc => {
                usersMap[doc.id] = doc.data();
            });
            
            // 儲存到快取（較短的 TTL）
            CacheManager.set(cacheKey, usersMap, 'staff');
            
            console.log(`✅ 已載入 ${Object.keys(usersMap).length} 位使用者`);
            return usersMap;
            
        } catch (error) {
            console.error('❌ 載入使用者資料失敗:', error);
            throw error;
        }
    },
    
    /**
     * 載入預班清單
     * @param {string} unitId - 單位 ID
     * @param {boolean} forceReload - 是否強制重新載入
     * @returns {Promise<Array>} 預班清單
     */
    loadPreSchedules: async function(unitId, forceReload = false) {
        if (!unitId) {
            console.warn('⚠️ DataLoader.loadPreSchedules: unitId 不能為空');
            return [];
        }
        
        const cacheKey = `pre_schedules_${unitId}`;
        
        // 預班資料變動頻繁，不使用快取（或使用很短的 TTL）
        // if (!forceReload) {
        //     const cached = CacheManager.get(cacheKey);
        //     if (cached) return cached;
        // }
        
        console.log(`📥 從資料庫載入預班清單: ${unitId}`);
        
        try {
            const snapshot = await db.collection('pre_schedules')
                .where('unitId', '==', unitId)
                .orderBy('year', 'desc')
                .orderBy('month', 'desc')
                .get();
            
            const preSchedules = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            console.log(`✅ 已載入 ${preSchedules.length} 個預班表`);
            return preSchedules;
            
        } catch (error) {
            console.error('❌ 載入預班清單失敗:', error);
            throw error;
        }
    },
    
    /**
     * 批次載入排班編輯器所需的所有資料
     * @param {string} unitId - 單位 ID
     * @param {number} year - 年份
     * @param {number} month - 月份
     * @returns {Promise<Object>} 包含所有資料的物件
     */
    loadScheduleEditorData: async function(unitId, year, month) {
        if (!unitId) {
            throw new Error('unitId 不能為空');
        }
        
        console.log(`📦 批次載入排班編輯器資料: ${unitId} ${year}/${month}`);
        
        try {
            // 並行載入所有資料
            const [shifts, users, rules] = await Promise.all([
                this.loadShifts(unitId),
                this.loadAllUsers(),
                this.loadSchedulingRules(unitId)
            ]);
            
            console.log('✅ 排班編輯器資料載入完成');
            
            return {
                shifts: shifts,
                users: users,
                rules: rules
            };
            
        } catch (error) {
            console.error('❌ 批次載入失敗:', error);
            throw error;
        }
    },
    
    /**
     * 批次載入預班矩陣所需的所有資料
     * @param {string} preScheduleId - 預班表 ID
     * @returns {Promise<Object>} 包含所有資料的物件
     */
    loadPreScheduleMatrixData: async function(preScheduleId) {
        if (!preScheduleId) {
            throw new Error('preScheduleId 不能為空');
        }
        
        console.log(`📦 批次載入預班矩陣資料: ${preScheduleId}`);
        
        try {
            // 1. 先載入預班表資料
            const preDoc = await db.collection('pre_schedules').doc(preScheduleId).get();
            if (!preDoc.exists) {
                throw new Error('預班表不存在');
            }
            
            const preData = preDoc.data();
            const unitId = preData.unitId;
            
            // 2. 並行載入其他資料
            const [shifts, users] = await Promise.all([
                this.loadShifts(unitId),
                this.loadAllUsers()
            ]);
            
            console.log('✅ 預班矩陣資料載入完成');
            
            return {
                preData: preData,
                shifts: shifts,
                users: users
            };
            
        } catch (error) {
            console.error('❌ 批次載入失敗:', error);
            throw error;
        }
    }
};

console.log('✅ DataLoader 已載入');
