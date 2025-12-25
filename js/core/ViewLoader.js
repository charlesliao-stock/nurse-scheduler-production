// js/core/ViewLoader.js
export const ViewLoader = {
    /**
     * 載入 HTML 檔案並注入到指定容器
     * @param {string} containerId - DOM 容器 ID (例如 'app-root' 或 'dynamic-content')
     * @param {string} filePath - HTML 檔案路徑 (例如 'views/staff.html')
     */
    async load(containerId, filePath) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`[ViewLoader] 找不到容器: #${containerId}`);
            return false;
        }

        try {
            // 防止重複請求 (簡單快取可在此實作，目前先每次重抓以確保最新)
            const response = await fetch(filePath);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const html = await response.text();
            container.innerHTML = html;
            return true;

        } catch (error) {
            console.error(`[ViewLoader] 載入失敗 (${filePath}):`, error);
            container.innerHTML = `
                <div class="alert alert-danger m-4">
                    <h4>畫面載入失敗</h4>
                    <p>無法讀取檔案: ${filePath}</p>
                    <p>錯誤訊息: ${error.message}</p>
                    <hr>
                    <p class="small">請確認您是使用 <strong>Live Server</strong> 或 Web Server 執行，而非直接開啟檔案。</p>
                </div>`;
            return false;
        }
    }
};
