// js/scheduler/utils/ScheduleSaver.js

const ScheduleSaver = {
    
    maxDocumentSize: 1048576, // 1MB (Firebase 限制)
    
    save: async function(scheduleId, assignments, metadata = {}) {
        if (!scheduleId) {
            throw new Error('scheduleId 不能為空');
        }
        
        console.log('💾 準備儲存排班結果...');
        
        try {
            const dataToSave = {
                assignments: assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                ...metadata
            };
            
            const estimatedSize = this.estimateSize(dataToSave);
            console.log(`📊 預估文件大小: ${(estimatedSize / 1024).toFixed(2)} KB`);
            
            if (estimatedSize > this.maxDocumentSize) {
                console.warn('⚠️ 文件大小超過限制，嘗試壓縮...');
                dataToSave.assignments = this.compressAssignments(assignments);
            }
            
            const startTime = Date.now();
            
            await db.collection('schedules').doc(scheduleId).update(dataToSave);
            
            const duration = Date.now() - startTime;
            console.log(`✅ 排班結果已儲存 (耗時: ${duration}ms)`);
            
            return {
                success: true,
                duration: duration,
                size: estimatedSize
            };
            
        } catch (error) {
            console.error('❌ 儲存排班結果失敗:', error);
            throw error;
        }
    },
    
    estimateSize: function(obj) {
        const str = JSON.stringify(obj);
        return new Blob([str]).size;
    },
    
    compressAssignments: function(assignments) {
        const compressed = {};
        
        for (let uid in assignments) {
            const userAssign = assignments[uid];
            compressed[uid] = {};
            
            for (let key in userAssign) {
                const val = userAssign[key];
                if (val && val !== '' && val !== 'OFF') {
                    compressed[uid][key] = val;
                }
            }
        }
        
        return compressed;
    },
    
    batchSave: async function(scheduleId, data, batchSize = 50) {
        console.log('💾 批次儲存模式啟動...');
        
        const staffIds = Object.keys(data.assignments);
        const batches = [];
        
        for (let i = 0; i < staffIds.length; i += batchSize) {
            const batchStaffIds = staffIds.slice(i, i + batchSize);
            const batchAssignments = {};
            
            batchStaffIds.forEach(uid => {
                batchAssignments[uid] = data.assignments[uid];
            });
            
            batches.push(batchAssignments);
        }
        
        console.log(`📦 分為 ${batches.length} 個批次儲存`);
        
        for (let i = 0; i < batches.length; i++) {
            console.log(`⏳ 儲存批次 ${i + 1}/${batches.length}...`);
            
            await db.collection('schedules').doc(scheduleId).update({
                [`assignments_batch_${i}`]: batches[i],
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        console.log('✅ 批次儲存完成');
    }
};

console.log('✅ ScheduleSaver 已載入');
