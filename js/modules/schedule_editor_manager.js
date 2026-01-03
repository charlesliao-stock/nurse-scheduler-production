// js/modules/schedule_editor_manager.js
// 排班作業管理器 (完整版)
// 功能：載入排班草稿、執行 AI 排班 (V2)、手動調整、存檔與發布

const scheduleEditorManager = {
    scheduleId: null,
    data: null,      // 存放從 DB 讀出的班表資料 (doc.data())
    shifts: [],      // 班別定義
    staffMap: {},    // 人員對照表 (uid -> details)
    assignments: {}, // 本地排班狀態 (uid -> { current_1: 'N', ... })
    isLoading: false,
    targetCell: null, // 右鍵點擊的目標格

    // --- 1. 初始化 ---
    init: async function(id) {
        console.log("Schedule Editor Init:", id);
        this.scheduleId = id;

        if (!app.currentUser) {
            alert("請先登入");
            return;
        }
        
        // 介面初始化
        document.getElementById('schTitle').textContent = "資料載入中...";
        this.isLoading = true;

        try {
            // 平行載入資料
            await Promise.all([
                this.loadShifts(),
                this.loadContext()
            ]);
            
            // 初始化 assignments (從資料庫載入)
            this.assignments = this.data.assignments || {};

            // 渲染介面
            this.renderToolbar(); 
            this.renderMatrix();
            this.updateRealTimeStats();
            this.setupEvents();
            
            // 處理右鍵選單 (如果還沒插入 DOM)
            const menu = document.getElementById('schContextMenu');
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
            }

            console.log("✅ 排班編輯器初始化完成");

        } catch (e) {
            console.error(e);
            alert("初始化失敗: " + e.message);
            window.location.hash = '/admin/schedule_list';
        } finally {
            this.isLoading = false;
        }
    },

    // --- 2. 載入資料 ---
    loadShifts: async function() {
        // 載入該單位的班別設定
        // 注意：這裡假設 unitId 可以從 app.userUnitId 獲取，或稍後從 schedule data 獲取
        // 為了保險，我們先不傳 unitId 過濾，或等 loadContext 後再過濾
        const snap = await db.collection('shifts').get();
        this.shifts = snap.docs.map(d => d.data());
    },

    loadContext: async function() {
        const doc = await db.collection('schedules').doc(this.scheduleId).get();
        if (!doc.exists) throw new Error("找不到此排班表");
        
        this.data = doc.data();
        
        // 過濾班別 (只留該單位的)
        this.shifts = this.shifts.filter(s => s.unitId === this.data.unitId);

        // 建立人員對照表 (方便查找)
        this.data.staffList.forEach(s => {
            this.staffMap[s.uid] = s;
        });

        // 更新標題
        const titleEl = document.getElementById('schTitle');
        if(titleEl) titleEl.textContent = `${this.data.year} 年 ${this.data.month} 月 - 正式排班`;
        
        this.updateStatusUI();
    },

    // --- 3. 介面渲染 ---
    renderToolbar: function() {
        // 確保按鈕事件綁定正確 (HTML 中已寫好 onclick，這裡可做額外處理)
        const statusBadge = document.getElementById('schStatus');
        if(statusBadge) {
            const statusMap = { 'draft': '草稿', 'published': '已發布' };
            statusBadge.textContent = statusMap[this.data.status] || this.data.status;
            statusBadge.className = `badge ${this.data.status === 'published' ? 'badge-success' : 'badge-warning'}`;
        }
    },

    renderMatrix: function() {
        const container = document.getElementById('matrixContainer') || document.querySelector('.page-section'); // 暫用
        // 這裡我們需要一個類似 pre_schedule_matrix 的表格容器
        // 如果 HTML 結構不同，請自行調整 ID
        // 假設 HTML 有一個 id="scheduleGrid" 或類似的地方
        
        // 為了讓這段程式碼通用，我們動態建立表格結構 (如果還沒有)
        let grid = document.getElementById('scheduleGrid');
        if (!grid) {
            // 嘗試找一下 content area
            const area = document.querySelector('.page-section');
            if(area) {
                // 清空並建立基本表格架構
                // 這裡簡化處理，建立一個 overflow 的 div 和 table
                const wrap = document.createElement('div');
                wrap.className = 'table-container';
                wrap.style.overflow = 'auto';
                wrap.style.maxHeight = 'calc(100vh - 150px)';
                
                grid = document.createElement('table');
                grid.id = 'scheduleGrid';
                grid.className = 'matrix-table'; // 沿用 matrix 樣式
                
                wrap.appendChild(grid);
                
                // 插入到標題列下方
                const header = document.querySelector('.page-section > div:first-child');
                if(header && header.nextSibling) {
                    area.insertBefore(wrap, header.nextSibling);
                } else {
                    area.appendChild(wrap);
                }
            }
        }
        
        if (!grid) return;

        // --- 開始繪製表格 ---
        const daysInMonth = new Date(this.data.year, this.data.month, 0).getDate();
        let html = '<thead><tr><th style="min-width:100px; position:sticky; left:0; z-index:3;">人員 / 日期</th>';
        
        // 表頭：日期
        for(let d=1; d<=daysInMonth; d++) {
            const date = new Date(this.data.year, this.data.month-1, d);
            const dayOfWeek = ['日','一','二','三','四','五','六'][date.getDay()];
            const isWeekend = (date.getDay()===0 || date.getDay()===6);
            const color = isWeekend ? 'color:red;' : '';
            html += `<th style="min-width:40px; text-align:center; ${color}">${d}<br><small>${dayOfWeek}</small></th>`;
        }
        html += '<th style="min-width:60px;">統計</th></tr></thead><tbody>';

        // 內容：人員列
        this.data.staffList.forEach(staff => {
            html += `<tr><td style="position:sticky; left:0; background:#f9f9f9; z-index:2; font-weight:bold;">${staff.name} <small>(${staff.employeeId})</small></td>`;
            
            let workCount = 0;
            
            for(let d=1; d<=daysInMonth; d++) {
                const key = `current_${d}`;
                const val = (this.assignments[staff.uid] && this.assignments[staff.uid][key]) || '';
                
                // 樣式判斷
                let cellStyle = '';
                let cellClass = '';
                
                if (val === 'OFF') {
                    cellStyle = 'background-color: #ecf0f1; color: #bdc3c7;'; // 灰色
                } else if (val === 'REQ_OFF') {
                    cellStyle = 'background-color: #2ecc71; color: white;'; // 綠色 (預休)
                } else if (val) {
                    // 嘗試找班別顏色
                    const shift = this.shifts.find(s => s.code === val);
                    if (shift) {
                        cellStyle = `background-color: ${shift.color}; color: white;`;
                        workCount++; // 只有上班才計數
                    } else {
                        // 未知班別或特殊註記
                        cellStyle = 'background-color: #ddd;';
                    }
                }

                // 為了右鍵選單，加入 data attributes
                html += `<td class="sch-cell ${cellClass}" 
                            style="text-align:center; cursor:pointer; ${cellStyle}"
                            data-uid="${staff.uid}" data-day="${d}"
                            onclick="scheduleEditorManager.handleCellClick('${staff.uid}', ${d})"
                            oncontextmenu="scheduleEditorManager.handleRightClick(event, '${staff.uid}', ${d})">
                            ${val}
                         </td>`;
            }
            
            html += `<td style="text-align:center;">${workCount}</td></tr>`;
        });
        
        html += '</tbody>';
        grid.innerHTML = html;
    },

    updateRealTimeStats: function() {
        // 這裡可以實作「每日缺額」的統計列
        // 暫時簡化，僅 console log
        // console.log("Stats updated");
    },

    updateStatusUI: function() {
        this.renderToolbar();
    },

    // --- 4. AI 排班核心 (V2 整合版) ---
    runAI: async function() {
        if (!confirm("確定要執行 AI 排班嗎？\n這將使用「天數平衡」與「回溯機制」重新運算。\n現有的手動排班可能會被覆蓋 (預休除外)。")) return;

        this.isLoading = true;
        
        try {
            console.log("🤖 準備執行 AI 排班 (V2)...");

            // 1. 準備資料給 AI
            // 轉換人員列表格式 (符合 BaseScheduler 需求)
            const staffListForAI = this.data.staffList.map(s => ({
                id: s.uid, // BaseScheduler 使用 id 作為 key
                uid: s.uid,
                name: s.name,
                packageType: s.packageType || '', // 包班類型
                // 確保預班偏好有帶入 (如果有的話)
                prefs: s.preferences || {} 
            }));

            // 2. 準備規則與設定
            // 從 DB 讀取 dailyNeeds (每日人力需求)，若無則給空物件
            // Tolerance (容許誤差) 與 Backtrack (回溯) 可從設定讀取或使用預設
            const rules = {
                dailyNeeds: this.data.dailyNeeds || {}, 
                tolerance: 2,       // 容許誤差 2 天
                backtrackDepth: 3,  // 回溯深度 3 天
                ...(this.data.settings || {}) // 合併其他可能的設定
            };

            // 3. 呼叫工廠建立 V2 排班器
            // 參數: 策略名, 人員, 年, 月, 上個月資料(暫空), 規則
            if (typeof SchedulerFactory === 'undefined') {
                throw new Error("找不到 SchedulerFactory，請確認相關 js 已載入");
            }

            const scheduler = SchedulerFactory.create(
                'V2', 
                staffListForAI, 
                this.data.year, 
                this.data.month, 
                {}, // TODO: 若有上個月資料 (lastMonthData) 需在此傳入
                rules
            );

            // 4. 執行運算
            const aiResultSchedule = scheduler.run();

            // 5. 將結果寫回本地 assignments
            this.convertAndApplySchedule(aiResultSchedule);

            // 6. 重新渲染與存檔
            this.renderMatrix();
            this.updateRealTimeStats();
            await this.saveDraft(true); // 自動存檔 (靜默模式)

            alert("✅ AI 排班完成！\n已套用「天數平衡 (容許值2)」與「局部回溯」策略。");

        } catch (e) {
            console.error("AI 執行失敗:", e);
            alert("AI 排班失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    },

    // [輔助] 將 AI 的日期導向格式 轉回 人員導向格式
    convertAndApplySchedule: function(aiSchedule) {
        // aiSchedule 格式: { "2026-01-01": { N:['uid1'], E:['uid2'], OFF:['uid3'] } }
        
        // 遍歷所有日期
        Object.keys(aiSchedule).forEach(dateStr => {
            const day = parseInt(dateStr.split('-')[2]); // 取得日期 (假設格式 YYYY-MM-DD)
            const daySchedule = aiSchedule[dateStr]; // { N:[], E:[], D:[], OFF:[] }
            
            if (!daySchedule) return;

            // 遍歷當天所有班別狀態
            // 注意：BaseScheduler 會把所有人都排進某個狀態 (含 OFF)
            Object.keys(daySchedule).forEach(shiftCode => {
                const uids = daySchedule[shiftCode];
                if (Array.isArray(uids)) {
                    uids.forEach(uid => {
                        if (!this.assignments[uid]) this.assignments[uid] = {};
                        
                        // 寫入 assignments
                        // 注意：如果原本是 REQ_OFF，AI 應該會回傳 REQ_OFF 或保持原狀
                        // 這裡直接寫入 AI 的結果，因為 AI V2 內部已經處理了鎖定邏輯
                        this.assignments[uid][`current_${day}`] = shiftCode;
                    });
                }
            });
        });
    },

    // --- 5. 手動操作與存檔 ---
    
    // 點擊格子 (目前先做 log，未來可做快速切換)
    handleCellClick: function(uid, d) {
        // console.log(`Clicked ${uid}, Day ${d}`);
        // 可以選中格子變色
    },

    // 右鍵選單
    handleRightClick: function(e, uid, d) {
        e.preventDefault();
        this.targetCell = { uid, d };
        
        const menu = document.getElementById('schContextMenu'); // 需在 HTML 預先定義或動態生成
        if (menu) {
            // 動態生成班別選項
            const list = menu.querySelector('ul') || menu;
            list.innerHTML = ''; // 清空舊選項
            
            // 加入班別選項
            this.shifts.forEach(s => {
                const li = document.createElement('li');
                li.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:${s.color};margin-right:5px;"></span> ${s.code}`;
                li.onclick = () => this.setShift(s.code);
                list.appendChild(li);
            });
            
            // 加入休假與清除
            list.innerHTML += `<li onclick="scheduleEditorManager.setShift('OFF')">排休 (OFF)</li>`;
            list.innerHTML += `<li onclick="scheduleEditorManager.setShift(null)" style="color:red;">清除</li>`;

            // 顯示選單
            menu.style.display = 'block';
            menu.style.left = e.pageX + 'px';
            menu.style.top = e.pageY + 'px';
        }
    },

    setShift: function(code) {
        if (this.targetCell) {
            const { uid, d } = this.targetCell;
            if (!this.assignments[uid]) this.assignments[uid] = {};
            
            if (code === null) {
                delete this.assignments[uid][`current_${d}`];
            } else {
                this.assignments[uid][`current_${d}`] = code;
            }
            
            this.renderMatrix();
            this.updateRealTimeStats();
            
            const menu = document.getElementById('schContextMenu');
            if(menu) menu.style.display = 'none';
        }
    },

    setupEvents: function() {
        // 點擊別處關閉選單
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('schContextMenu');
            if (menu) menu.style.display = 'none';
        });
    },

    // 儲存草稿
    saveDraft: async function(silent = false) {
        try {
            if (!silent) this.isLoading = true;
            
            await db.collection('schedules').doc(this.scheduleId).update({
                assignments: this.assignments,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            if (!silent) {
                alert("✅ 草稿已儲存");
                this.isLoading = false;
            }
        } catch (e) {
            console.error(e);
            alert("儲存失敗: " + e.message);
            this.isLoading = false;
        }
    },

    // 發布班表
    publishSchedule: async function() {
        if (!confirm("確定要發布此班表嗎？\n發布後，所有員工將可在前台看到班表。")) return;
        
        try {
            this.isLoading = true;
            await db.collection('schedules').doc(this.scheduleId).update({
                status: 'published',
                assignments: this.assignments,
                publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.data.status = 'published';
            this.updateStatusUI();
            alert("🎉 班表已成功發布！");
            
        } catch (e) {
            console.error(e);
            alert("發布失敗: " + e.message);
        } finally {
            this.isLoading = false;
        }
    }
};

// 匯出 (如果是模組化環境)
// export default scheduleEditorManager;
