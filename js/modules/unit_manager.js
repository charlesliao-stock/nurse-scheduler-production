// js/modules/unit_manager.js (processImport 部分優化)

processImport: async function() {
    const file = document.getElementById('csvUnitFile')?.files[0];
    const resultDiv = document.getElementById('unitImportResult');
    
    if(!file) { 
        alert("請選擇檔案"); 
        return; 
    }
    
    resultDiv.innerHTML = "讀取中...";
    
    // 取得目前系統中已存在的單位名稱 (轉為 Set 方便快速比對)
    const existingNames = new Set(this.allUnits.map(u => u.name));
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const rows = e.target.result.split(/\r\n|\n/);
            const batch = db.batch();
            let count = 0;
            let skipCount = 0; // 記錄略過的數量
            let errors = [];
            
            // 用於追蹤本次 CSV 內部是否也有重複名稱
            const currentImportNames = new Set();
            
            for(let i = 1; i < rows.length; i++) {
                const row = rows[i].trim();
                if(!row) continue;
                
                const cols = row.split(',');
                if(cols.length < 2) {
                    errors.push(`第 ${i+1} 行：欄位不足`);
                    continue;
                }
                
                const uid = cols[0].trim();
                const uname = cols[1].trim();
                
                if(!uid || !uname) {
                    errors.push(`第 ${i+1} 行：資料不完整`);
                    continue;
                }

                // --- 重複檢查邏輯 ---
                if (existingNames.has(uname) || currentImportNames.has(uname)) {
                    errors.push(`第 ${i+1} 行：單位名稱 「${uname}」 已存在，已略過。`);
                    skipCount++;
                    continue; // 略過此筆，不執行建立
                }

                // 代碼格式驗證（同 saveData）
                if (!/^[A-Za-z0-9_]+$/.test(uid)) {
                    errors.push(`第 ${i+1} 行：代碼 「${uid}」 格式錯誤(僅限英數字底線)`);
                    continue;
                }

                // 記錄本次匯入已使用的名稱，防止 CSV 內重複
                currentImportNames.add(uname);
                
                batch.set(db.collection('units').doc(uid), {
                    name: uname,
                    managers: [],
                    schedulers: [],
                    groups: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                count++;
            }
            
            if(count > 0) {
                await batch.commit();
                
                let finishMsg = `匯入完成！\n成功：${count} 筆`;
                if (skipCount > 0) finishMsg += `\n略過(重複)：${skipCount} 筆`;
                if (errors.length > 0) finishMsg += `\n\n詳細記錄：\n` + errors.join('\n');
                
                alert(finishMsg);
                this.closeImportModal();
                await this.fetchUnits();
            } else {
                let failMsg = "無有效資料匯入。";
                if (errors.length > 0) failMsg += "\n原因：\n" + errors.join('\n');
                alert(failMsg);
                resultDiv.innerHTML = `<span style="color:orange;">匯入中斷：資料皆重複或格式不符</span>`;
            }
            
        } catch(error) {
            console.error("Import Error:", error);
            resultDiv.innerHTML = `<span style="color:red;">匯入失敗: ${error.message}</span>`;
        }
    };
    
    reader.onerror = () => {
        resultDiv.innerHTML = '<span style="color:red;">檔案讀取失敗</span>';
    };
    
    reader.readAsText(file);
}
