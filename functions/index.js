// functions/index.js
// Firebase Cloud Functions for Password Reset

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// ========================================
// 單一使用者密碼重設
// ========================================
exports.resetUserPassword = functions.https.onCall(async (data, context) => {
    // 驗證呼叫者權限
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '需要登入');
    }
    
    // 取得呼叫者資料
    const callerUid = context.auth.uid;
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    const callerData = callerDoc.data();
    
    // 檢查權限（只有管理員可以重設密碼）
    if (!callerData || !['system_admin', 'unit_manager'].includes(callerData.role)) {
        throw new functions.https.HttpsError('permission-denied', '權限不足');
    }
    
    const { email, newPassword } = data;
    
    if (!email || !newPassword) {
        throw new functions.https.HttpsError('invalid-argument', '缺少必要參數');
    }
    
    // 密碼長度檢查
    if (newPassword.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', '密碼必須至少 6 個字元');
    }
    
    try {
        // 根據 email 找到使用者
        const userRecord = await admin.auth().getUserByEmail(email);
        
        // 更新密碼
        await admin.auth().updateUser(userRecord.uid, {
            password: newPassword
        });
        
        console.log(`密碼重設成功: ${email} by ${callerUid}`);
        
        return {
            success: true,
            message: '密碼重設成功'
        };
        
    } catch (error) {
        console.error('密碼重設失敗:', error);
        
        if (error.code === 'auth/user-not-found') {
            throw new functions.https.HttpsError('not-found', '找不到此使用者');
        }
        
        throw new functions.https.HttpsError('internal', '重設失敗: ' + error.message);
    }
});

// ========================================
// 批次密碼重設
// ========================================
exports.batchResetPasswords = functions
    .runWith({
        timeoutSeconds: 540, // 9 分鐘
        memory: '1GB'
    })
    .https.onCall(async (data, context) => {
        // 驗證呼叫者權限
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', '需要登入');
        }
        
        const callerUid = context.auth.uid;
        const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
        const callerData = callerDoc.data();
        
        // 檢查權限（只有系統管理員可以批次重設）
        if (!callerData || callerData.role !== 'system_admin') {
            throw new functions.https.HttpsError('permission-denied', '只有系統管理員可以執行批次重設');
        }
        
        const { users } = data;
        
        if (!users || !Array.isArray(users) || users.length === 0) {
            throw new functions.https.HttpsError('invalid-argument', '缺少使用者清單');
        }
        
        console.log(`批次重設密碼開始: ${users.length} 位使用者, by ${callerUid}`);
        
        let success = 0;
        let failed = 0;
        const errors = [];
        
        // 批次處理（每次處理 10 個，避免超時）
        const batchSize = 10;
        
        for (let i = 0; i < users.length; i += batchSize) {
            const batch = users.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (user) => {
                try {
                    // 檢查參數
                    if (!user.email || !user.employeeId) {
                        throw new Error('缺少 email 或 employeeId');
                    }
                    
                    if (user.employeeId.length < 6) {
                        throw new Error('員工編號必須至少 6 個字元');
                    }
                    
                    // 根據 email 找到使用者
                    const userRecord = await admin.auth().getUserByEmail(user.email);
                    
                    // 更新密碼為員工編號
                    await admin.auth().updateUser(userRecord.uid, {
                        password: user.employeeId
                    });
                    
                    success++;
                    
                } catch (error) {
                    failed++;
                    errors.push({
                        email: user.email,
                        displayName: user.displayName,
                        error: error.message
                    });
                    console.error(`重設失敗 ${user.email}:`, error);
                }
            }));
        }
        
        console.log(`批次重設完成: 成功 ${success}, 失敗 ${failed}`);
        
        return {
            success: success,
            failed: failed,
            errors: errors
        };
    });

// ========================================
// 檢查使用者是否存在（輔助函數）
// ========================================
exports.checkUserExists = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '需要登入');
    }
    
    const { email } = data;
    
    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', '缺少 email');
    }
    
    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        return {
            exists: true,
            uid: userRecord.uid,
            email: userRecord.email,
            emailVerified: userRecord.emailVerified
        };
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            return {
                exists: false
            };
        }
        throw new functions.https.HttpsError('internal', error.message);
    }
});
