// js/core/ViewLoader.js
export const ViewLoader = {
    /**
     * 載入 HTML 檔案並注入到指定容器
     * @param {string} containerId - DOM 容器 ID
     * @param {string} filePath - HTML 檔案路徑 (例如 'views/staff.html')
     */
    async load(containerId, filePath) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`ViewLoader Error: Container #${containerId} not found.`);
            return;
        }

        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`Failed to load ${filePath}`);
            
            const html = await response.text();
            container.innerHTML = html;
            return true;
        } catch (error) {
            console.error("ViewLoader Error:", error);
            container.innerHTML = `<div class="alert alert-danger">無法載入畫面: ${filePath}</div>`;
            return false;
        }
    }
};
