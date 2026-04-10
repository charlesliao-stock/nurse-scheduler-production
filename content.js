/**
 * 天下學習自動巡航助手 - 含測驗自動作答版 (優化版)
 *
 * 新增功能：
 * - 單元讀完後自動導向測驗頁
 * - 偵測 value="Y" 的選項並自動點選送出
 * - 答錯自動重試，答對或完成課程後繼續巡航
 * 
 * 修復記錄：
 * - 強化測驗頁面元素等待機制，防止過早跳轉
 * - 增加對正確答案選項的重試偵測
 */

const cruiseLog = (msg) => console.log(`%c[巡航助手] ${msg}`, "color: white; background: #d35400; padding: 2px 5px; border-radius: 3px;");

// --- A. 狀態鎖定 ---
let isProcessing = false;
const LOCK_TTL = 30000;

async function acquireLock() {
    const { CRUISE_LOCK } = await chrome.storage.local.get(["CRUISE_LOCK"]);
    const now = Date.now();
    if (CRUISE_LOCK && (now - CRUISE_LOCK) < LOCK_TTL) {
        return false;
    }
    await chrome.storage.local.set({ CRUISE_LOCK: now });
    return true;
}

async function releaseLock() {
    await chrome.storage.local.remove("CRUISE_LOCK");
}

async function runCruiseLogic() {
    const { CRUISE_ACTIVE } = await chrome.storage.local.get(["CRUISE_ACTIVE"]);
    if (!CRUISE_ACTIVE) return;

    if (isProcessing) {
        cruiseLog("⛔ 同頁面內已在執行中，跳過");
        return;
    }

    const locked = await acquireLock();
    if (!locked) {
        cruiseLog("⛔ 跨頁面 lock 未釋放，跳過重複觸發");
        return;
    }

    isProcessing = true;
    const url = window.location.href;
    const path = window.location.pathname;
    cruiseLog(`📍 目前位置: ${url}`);

    try {
        if (path === '/' || url.endsWith('.tw/')) {
            await handleRandomMainChannel();
        } else if (url.includes('main_channel_id') && !url.includes('master_channel_id')) {
            await handleMasterEntry();
        } else if (url.includes('master_channel_id')) {
            await handleCourseEntry();
        } else if (path.includes('/course-set/')) {
            await handleCourseWork();
        } else if (path.includes('/member/exam/')) {
            await handleExam();
        } else if (path.includes('/course/')) {
            cruiseLog("⚠️ 落在 /course/ 頁面，非預期狀態，3 秒後退回");
            await new Promise(r => setTimeout(r, 3000));
            window.history.back();
        } else {
            cruiseLog(`⚠️ 未知路徑: ${path}，跳過`);
        }
    } catch (e) {
        cruiseLog(`❌ 執行出錯: ${e.message}`);
    } finally {
        isProcessing = false;
        await releaseLock();
    }
}

// --- B. 行為模組 ---

function handleRandomMainChannel() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['FINISHED_MAINS'], (res) => {
            try {
                const finished = res.FINISHED_MAINS || [];
                const links = Array.from(document.querySelectorAll('a[href*="main_channel_id"]'));
                const remaining = links.filter(a => {
                    const mId = new URLSearchParams(a.href.split('?')[1]).get('main_channel_id');
                    return mId && !finished.includes(mId);
                });
                if (remaining.length > 0) {
                    const pick = remaining[Math.floor(Math.random() * remaining.length)];
                    cruiseLog(`🎲 隨機進入未完成大類別: ${pick.innerText.trim()}`);
                    pick.click();
                } else {
                    cruiseLog("🎉 所有大類別已完成！停止巡航");
                    chrome.storage.local.set({ "CRUISE_ACTIVE": false });
                }
                resolve();
            } catch (e) { reject(e); }
        });
    });
}

function handleMasterEntry() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['FINISHED_MASTERS'], (res) => {
            try {
                const finished = res.FINISHED_MASTERS || [];
                const links = Array.from(document.querySelectorAll('a[href*="master_channel_id"]'));
                const target = links.find(a => {
                    const mId = new URLSearchParams(a.href.split('?')[1]).get('master_channel_id');
                    return mId && !finished.includes(mId);
                });
                if (target) {
                    target.click();
                } else {
                    const mMainId = new URLSearchParams(window.location.search).get('main_channel_id');
                    markIdAsFinished('FINISHED_MAINS', mMainId);
                    window.location.href = "/";
                }
                resolve();
            } catch (e) { reject(e); }
        });
    });
}

function handleCourseEntry() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['FINISHED_COURSES'], (res) => {
            try {
                const finished = res.FINISHED_COURSES || [];
                const links = Array.from(document.querySelectorAll('a[href*="/course-set/"]'))
                                   .filter(a => !a.href.includes('filter'));
                const target = links.find(a => !finished.includes(a.href.split('/').pop()));
                if (target) {
                    target.click();
                } else {
                    const nextBtn = document.querySelector('a[href*="page="] i.chevron_right')?.closest('a');
                    if (nextBtn) {
                        nextBtn.click();
                    } else {
                        const mId = new URLSearchParams(window.location.search).get('master_channel_id');
                        markIdAsFinished('FINISHED_MASTERS', mId);
                        window.history.back();
                    }
                }
                resolve();
            } catch (e) { reject(e); }
        });
    });
}

async function handleCourseWork() {
    const unreadIcons = Array.from(document.querySelectorAll('.unit__label__item__icon--unread'));
    const taskMap = new Map();
    unreadIcons.forEach(icon => {
        const link = icon.closest('a[href*="/course/"]');
        if (link) {
            const unitId = link.href.split('/').pop();
            if (!taskMap.has(unitId)) taskMap.set(unitId, link);
        }
    });
    const uniqueTasks = Array.from(taskMap.values());
    cruiseLog(`📊 未讀分析：共 ${uniqueTasks.length} 個唯一單元`);
    if (uniqueTasks.length > 0) {
        const target = uniqueTasks[0];
        const unitId = target.href.split('/').pop();
        const { LAST_OPENED_UNIT } = await chrome.storage.local.get(["LAST_OPENED_UNIT"]);
        if (LAST_OPENED_UNIT === unitId) {
            cruiseLog("⚠️ 同一單元 ID 已在處理中，攔截二次開啟");
            return;
        }
        await chrome.storage.local.set({ LAST_OPENED_UNIT: unitId });
        cruiseLog(`🚀 開啟單元: ${target.innerText.trim()} (ID: ${unitId})`);
        const win = window.open(target.href, '_blank');
        const waitMs = (Math.floor(Math.random() * 11) + 5) * 1000;
        cruiseLog(`⏱️ 隨機等待 ${waitMs / 1000} 秒...`);
        await new Promise(r => setTimeout(r, waitMs));
        if (win) win.close();
        await chrome.storage.local.remove("LAST_OPENED_UNIT");
        cruiseLog(`📝 前往測驗頁: /member/exam/${unitId}`);
        window.location.href = `https://www.leadercampus.com.tw/member/exam/${unitId}`;
    } else {
        const cId = window.location.pathname.split('/').pop();
        cruiseLog(`✅ 課程 ${cId} 已讀完，紀錄並撤退`);
        markIdAsFinished('FINISHED_COURSES', cId);
        setTimeout(() => window.history.back(), 1500);
    }
}

// --- 測驗自動作答 ---
async function handleExam() {
    cruiseLog("📋 偵測測驗頁面，等待表單與答案載入...");
    // 強化等待：不僅等待表單，還等待正確選項出現
    const found = await waitForElement('input.formElRadio--quiz[value="Y"]', 8000);
    if (!found) {
        cruiseLog("❌ 超時找不到正確選項（value=Y），重新整理頁面重試...");
        location.reload();
        return;
    }
    await answerAndSubmit();
}

async function answerAndSubmit() {
    const correctInput = document.querySelector('input.formElRadio--quiz[value="Y"]');
    if (!correctInput) {
        cruiseLog("❌ 找不到正確選項，停止本次作答");
        return;
    }

    const label = document.querySelector(`label[for="${correctInput.id}"]`);
    if (label) {
        label.click();
        cruiseLog(`✅ 已選取正確答案: ${label.innerText.trim()}`);
    } else {
        correctInput.click();
        cruiseLog("✅ 已點選正確答案（直接點 input）");
    }

    await new Promise(r => setTimeout(r, 1000));

    const submitBtn = document.querySelector('[data-id="js-send-answer"]');
    if (!submitBtn) {
        cruiseLog("❌ 找不到確定按鈕，重新整理頁面...");
        location.reload();
        return;
    }

    submitBtn.click();
    cruiseLog("📤 已送出答案，等待結果...");
    await waitForExamResult();
}

async function waitForExamResult() {
    cruiseLog("⏳ 等待測驗結果彈窗...");
    // 等待結果 Modal 出現
    const modalFound = await waitForElement('.modal, .popup, [class*="modal"], [class*="result"], [class*="overlay"]', 10000);
    if (!modalFound) {
        cruiseLog("⚠️ 等待結果超時，檢查是否已跳轉或題目仍存在...");
        const quizStillHere = document.querySelector('input.formElRadio--quiz[value="Y"]');
        if (quizStillHere) {
            cruiseLog("題目仍存在，可能送出失敗，重新整理頁面...");
            location.reload();
        } else {
            cruiseLog("題目已消失，可能已完成，嘗試返回...");
            window.history.back();
        }
        return;
    }
    
    await new Promise(r => setTimeout(r, 1000));

    // 情況 1：有「繼續學習下一單元」按鈕
    const nextBtn = document.querySelector('a.btn--nextstep');
    if (nextBtn) {
        cruiseLog(`🎉 通過測驗！點擊「繼續學習下一單元」`);
        nextBtn.click();
        return;
    }

    // 情況 2：通過但無下一單元
    const backLink = document.querySelector('a.btn--back');
    if (backLink) {
        const modalText = document.querySelector('.modal, .popup, [class*="modal"]')?.innerText || '';
        if (modalText.includes('恭喜') || modalText.includes('通過') || modalText.includes('完成')) {
            cruiseLog("🏆 通過測驗（無下一單元），點返回繼續巡航...");
            const courseId = getCourseIdFromExamPage();
            if (courseId) markIdAsFinished('FINISHED_COURSES', courseId);
            await new Promise(r => setTimeout(r, 800));
            backLink.click();
            return;
        }
    }

    // 情況 3：答錯
    cruiseLog("❌ 未偵測到通過結果，判定答錯，準備重試...");
    const closeBtn = document.querySelector('.modal__close, .btn--close, [data-dismiss], [aria-label="close"]');
    if (closeBtn) {
        closeBtn.click();
        await new Promise(r => setTimeout(r, 1000));
    }

    const quizStillHere = document.querySelector('input.formElRadio--quiz[value="Y"]');
    if (quizStillHere) {
        await answerAndSubmit();
    } else {
        cruiseLog("⚠️ 題目已消失，重新載入頁面確認狀態");
        location.reload();
    }
}

function getCourseIdFromExamPage() {
    const form = document.querySelector('#exam_form');
    if (form) {
        const action = form.getAttribute('action') || '';
        const parts = action.split('/');
        const id = parts[parts.length - 1];
        return /^\d+$/.test(id) ? id : null;
    }
    return null;
}

// --- C. 工具函式 ---

function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
        if (document.querySelector(selector)) {
            resolve(true);
            return;
        }
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(true);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            resolve(false);
        }, timeout);
    });
}

function markIdAsFinished(key, id) {
    if (!id || typeof id !== 'string' || !/^\d+$/.test(id)) return;
    chrome.storage.local.get([key], (res) => {
        let list = res[key] || [];
        if (!list.includes(id)) {
            list.push(id);
            chrome.storage.local.set({ [key]: list });
        }
    });
}

// --- D. 監聽與啟動控制 ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "cruise") {
        chrome.storage.local.set({ "CRUISE_ACTIVE": true }, () => {
            runCruiseLogic();
        });
        sendResponse({ status: "started" });
    } else if (request.action === "stop") {
        chrome.storage.local.set({ "CRUISE_ACTIVE": false }, () => {
            isProcessing = false;
            location.reload();
        });
        sendResponse({ status: "stopped" });
    }
});

async function init() {
    const { CRUISE_ACTIVE } = await chrome.storage.local.get(["CRUISE_ACTIVE"]);
    if (CRUISE_ACTIVE) {
        setTimeout(runCruiseLogic, 4000);
    }
}

if (document.readyState === 'complete') {
    init();
} else {
    window.addEventListener('load', init);
}
