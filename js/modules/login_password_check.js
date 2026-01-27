// js/modules/login_password_check.js
// 功能：登入後檢查使用者是否需要設定密碼，並自動引導到設定密碼頁面

const loginPasswordCheck = {
    
    // --- 在登入成功後呼叫此函數 ---
    checkPasswordStatus: async function(user) {
        if (!user || !user.uid) {
            console.warn('[密碼檢查] 無有效使用者');
            return;
        }
        
        try {
            console.log('[密碼檢查] 開始檢查使用者:', user.uid);
            
            // 1. 檢查 Firestore 中的使用者資料
            const userDoc = await db.collection('users').doc(user.uid).get();
            
            if (!userDoc.exists) {
                console.warn('[密碼檢查] Firestore 中找不到使用者資料');
                return;
            }
            
            const userData = userDoc.data();
            
            // 2. 檢查是否需要重設密碼
            const needsPasswordReset = this.shouldResetPassword(user, userData);
            
            if (needsPasswordReset.required) {
                console.log('[密碼檢查] 需要設定密碼:', needsPasswordReset.reason);
                this.redirectToPasswordSetup(needsPasswordReset.reason);
            } else {
                console.log('[密碼檢查] 密碼狀態正常，無需重設');
            }
            
        } catch (error) {
            console.error('[密碼檢查] 檢查失敗:', error);
        }
    },
    
    // --- 判斷是否需要重設密碼 ---
    shouldResetPassword: function(authUser, firestoreData) {
        // 情況 1：首次登入（使用預設密碼 = 員工編號）
        // Firebase Auth 的 metadata.creationTime 和 lastSignInTime 相同表示首次登入
        const creationTime = new Date(authUser.metadata.creationTime).getTime();
        const lastSignInTime = new Date(authUser.metadata.lastSignInTime).getTime();
        const timeDiff = Math.abs(lastSignInTime - creationTime);
        
        // 如果兩個時間差小於 10 秒，視為首次登入
        if (timeDiff < 10000) {
            return {
                required: true,
                reason: 'first_login',
                message: '首次登入，請設定您的密碼'
            };
        }
        
        // 情況 2：Firestore 中標記需要重設密碼
        if (firestoreData.forcePasswordReset === true) {
            return {
                required: true,
                reason: 'force_reset',
                message: '管理員要求您重設密碼'
            };
        }
        
        // 情況 3：密碼過期（如果有設定過期政策）
        if (firestoreData.passwordExpiry) {
            const expiryDate = firestoreData.passwordExpiry.toDate();
            const now = new Date();
            
            if (now > expiryDate) {
                return {
                    required: true,
                    reason: 'password_expired',
                    message: '密碼已過期，請設定新密碼'
                };
            }
        }
        
        // 情況 4：密碼重設標記（透過郵件重設後首次登入）
        // 注意：Firebase Auth 本身沒有提供直接檢查的方法
        // 需要搭配 Firestore 標記
        if (firestoreData.passwordResetPending === true) {
            return {
                required: true,
                reason: 'reset_pending',
                message: '請完成密碼設定'
            };
        }
        
        // 沒有需要重設的情況
        return {
            required: false,
            reason: null,
            message: null
        };
    },
    
    // --- 引導到密碼設定頁面 ---
    redirectToPasswordSetup: function(reason) {
        // 儲存當前頁面，設定完密碼後可以返回
        const currentPage = window.location.pathname + window.location.search;
        sessionStorage.setItem('returnAfterPasswordSetup', currentPage);
        sessionStorage.setItem('passwordResetReason', reason);
        
        // 顯示提示訊息
        let message = '';
        switch(reason) {
            case 'first_login':
                message = '歡迎首次登入！\n\n為了帳號安全，請先設定您的密碼。';
                break;
            case 'force_reset':
                message = '管理員要求您重設密碼。\n\n請設定新的密碼以繼續使用系統。';
                break;
            case 'password_expired':
                message = '您的密碼已過期。\n\n請設定新的密碼以繼續使用系統。';
                break;
            case 'reset_pending':
                message = '請完成密碼設定流程。';
                break;
            default:
                message = '請設定您的密碼。';
        }
        
        // 顯示提示（可選）
        if (confirm(message + '\n\n點擊「確定」前往密碼設定頁面。')) {
            // 跳轉到密碼設定頁面
            window.location.href = '/password-setup.html';
        } else {
            // 使用者取消，但仍強制跳轉（因為是必須的）
            setTimeout(() => {
                window.location.href = '/password-setup.html';
            }, 2000);
        }
    },
    
    // --- 在密碼設定頁面完成後呼叫 ---
    completePasswordSetup: async function() {
        const user = auth.currentUser;
        if (!user) {
            console.error('[密碼檢查] 找不到當前使用者');
            return;
        }
        
        try {
            // 清除 Firestore 中的重設標記
            await db.collection('users').doc(user.uid).update({
                forcePasswordReset: false,
                passwordResetPending: false,
                passwordLastChanged: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('[密碼檢查] 密碼設定完成標記已更新');
            
            // 跳轉回原來的頁面
            const returnPage = sessionStorage.getItem('returnAfterPasswordSetup');
            sessionStorage.removeItem('returnAfterPasswordSetup');
            sessionStorage.removeItem('passwordResetReason');
            
            if (returnPage && returnPage !== '/password-setup.html') {
                window.location.href = returnPage;
            } else {
                window.location.href = '/index.html'; // 預設跳轉到首頁
            }
            
        } catch (error) {
            console.error('[密碼檢查] 完成密碼設定失敗:', error);
        }
    },
    
    // --- 管理員強制員工重設密碼 ---
    forceUserPasswordReset: async function(userId) {
        try {
            await db.collection('users').doc(userId).update({
                forcePasswordReset: true,
                passwordResetRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('[密碼檢查] 已標記使用者需要重設密碼:', userId);
            return true;
            
        } catch (error) {
            console.error('[密碼檢查] 強制重設密碼失敗:', error);
            return false;
        }
    }
};

// --- 自動執行：監聽登入狀態 ---
if (typeof auth !== 'undefined') {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // 排除密碼設定頁面本身，避免無限循環
            const currentPage = window.location.pathname;
            if (currentPage !== '/password-setup.html' && currentPage !== '/activate.html') {
                // 延遲 500ms 執行，確保其他初始化完成
                setTimeout(() => {
                    loginPasswordCheck.checkPasswordStatus(user);
                }, 500);
            }
        }
    });
}

console.log('[密碼檢查] 模組已載入');
