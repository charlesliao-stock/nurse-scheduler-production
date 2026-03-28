// content.js
// 頁面驗證統一由 popup.js 的 sendMessage 負責，content.js 不重複處理
// HR 預設班別統一由 background.js 初始化至 storage，content.js 不再 hardcode

console.log("🚀 KMUH 班表輸入小幫手：核心啟動");

function formatEmpId(id) {
    if (!id) return "";
    const s = String(id).trim();
    if (!/^\d+$/.test(s)) return "";
    return s.padStart(7, '0');
}

function getNextYM(yymm) {
    if (!yymm || yymm.length !== 6) return "";
    let y = parseInt(yymm.substring(0, 4)), m = parseInt(yymm.substring(4, 6)) + 1;
    if (m > 12) { m = 1; y++; }
    return String(y) + String(m).padStart(2, '0');
}

function parseCyclePeriods() {
    const periods = [];
    const re = /【(\d+)】\s*(\d{1,2}\/\d{1,2})\s*[~～]\s*(\d{1,2}\/\d{1,2})/g;
    let m;
    while ((m = re.exec(document.body.innerText)) !== null) {
        periods.push({ label: m[1], start: m[2], end: m[3] });
    }
    return periods;
}

// 解析頁面上的雙週 FF 班檢查週別，例如《1》02/16~03/01
function parseFFPeriods() {
    const periods = [];
    const re = /《(\d+)》\s*(\d{1,2}\/\d{1,2})\s*[~～]\s*(\d{1,2}\/\d{1,2})/g;
    let m;
    while ((m = re.exec(document.body.innerText)) !== null) {
        periods.push({ label: m[1], start: m[2], end: m[3] });
    }
    return periods;
}

// mm/dd 轉為 Date 物件，年份以 refYymm 為基準推算（處理跨年）
function mmddToDate(mmdd, refYymm) {
    const [mm, dd] = mmdd.split('/').map(Number);
    const refYear  = parseInt(refYymm.substring(0, 4));
    const refMonth = parseInt(refYymm.substring(4, 6));
    const year = (mm < refMonth - 6) ? refYear + 1 : refYear;
    return new Date(year, mm - 1, dd);
}

// Date 物件轉為 mm/dd 字串
function dateToMmdd(d) {
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// mm/dd 轉為全局索引（index 0 = 讀取月第1天，oldMonthDays 以後為匯入目標月）
function mmddToGlobalIdx(mmdd, oldYymm, oldMonthDays) {
    const base   = mmddToDate(`${oldYymm.substring(4, 6)}/01`, oldYymm);
    const target = mmddToDate(mmdd, oldYymm);
    return Math.round((target - base) / 86400000);
}

// 從讀取月頁面的最後一個週期向後延伸，產生涵蓋匯入目標月的完整檢查區間清單
// periodDays: FF週別=14天, 四週變形=28天
// 篩選條件：開始或結束月份包含 targetMonth
function buildCheckRanges(lastPeriod, targetMonth, periodDays, oldYymm, oldMonthDays) {
    if (!lastPeriod) return [];

    const ranges = [];
    let startDate = mmddToDate(lastPeriod.start, oldYymm);
    let endDate   = mmddToDate(lastPeriod.end,   oldYymm);
    // 若 end < start（例如跨年），end 往後推一年
    if (endDate < startDate) endDate.setFullYear(endDate.getFullYear() + 1);

    while (true) {
        const startMonth = startDate.getMonth() + 1;
        const endMonth   = endDate.getMonth() + 1;

        // 停止條件：開始月份已超過 targetMonth
        if (startMonth > targetMonth) break;

        // 包含 targetMonth 才納入檢查
        if (startMonth === targetMonth || endMonth === targetMonth) {
            const mmddStart = dateToMmdd(startDate);
            const mmddEnd   = dateToMmdd(endDate);
            ranges.push({
                start:    mmddStart,
                end:      mmddEnd,
                startIdx: mmddToGlobalIdx(mmddStart, oldYymm, oldMonthDays),
                endIdx:   mmddToGlobalIdx(mmddEnd,   oldYymm, oldMonthDays),
            });
        }

        // 向後延伸一個週期
        const nextStart = new Date(endDate);
        nextStart.setDate(nextStart.getDate() + 1);
        const nextEnd = new Date(nextStart);
        nextEnd.setDate(nextEnd.getDate() + periodDays - 1);
        startDate = nextStart;
        endDate   = nextEnd;
    }

    return ranges;
}

// ─────────────────────────────────────────────────────────────────
// 訊息監聽入口
// ─────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // ── 步驟 1：記憶本月班表 ──────────────────────────────────────
    if (request.action === "readAndMemorize") {
        const data = captureWebSchedule();
        const now = new Date();
        const sysYymm = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');

        if (data.yymm && data.yymm !== sysYymm) {
            const proceed = confirm(
                `⚠️ 月份提醒\n\n網頁顯示月份：${data.yymm}\n系統當前月份：${sysYymm}\n\n兩者不一致，是否仍要繼續記憶？`
            );
            if (!proceed) return sendResponse({ success: false, message: "使用者取消" });
        }

        const periods   = parseCyclePeriods();
        const ffPeriods = parseFFPeriods();
        data.cyclePeriods = periods;
        data.ffPeriods    = ffPeriods;

        const nextUrl = window.location.href.replace(/yymm=\d{6}/, `yymm=${getNextYM(data.yymm)}`);
        const toSave = { lastMonthData: data };
        if (request.autoMode && request.showPreview) {
            toSave["pendingNextUrl"] = nextUrl;
        } else {
            chrome.storage.local.remove('pendingNextUrl');
        }

        chrome.storage.local.set(toSave, () => {
            if (request.showPreview) {
                const hint = request.autoMode
                    ? "記憶完成。關閉此視窗後將自動跳轉至下個月。"
                    : "記憶完成。";
                showModal(`步驟 1：${data.yymm} 預覽報告`, data, hint);
            }
            sendResponse({
                success: true,
                yymm: data.yymm,
                nextUrl,
                hasPreview: request.showPreview,
                periods,
                ffPeriods,
            });
        });
        return true;
    }

    // ── 步驟 2：匯入 Excel 並驗證 ────────────────────────────────
    if (request.action === "autoProcessExcel") {
        handleExcelProcess(request).then(res => sendResponse(res));
        return true;
    }

    // ── 步驟 4：寫入班表 ─────────────────────────────────────────
    if (request.action === "injectOnly") {
        executeInjectionFlow(request.excelData).then(res => sendResponse(res));
        return true;
    }

    // 注意：selectSheet action 已廢棄，Sheet 選擇統一由 popup.js 處理
});

// ─────────────────────────────────────────────────────────────────
// 步驟 2：匯入 Excel 並驗證
// ─────────────────────────────────────────────────────────────────
async function handleExcelProcess(req) {
    const storage = await chrome.storage.local.get(['shiftDict', 'hrShifts', 'lastMonthData']);
    const oldYymm     = storage.lastMonthData?.yymm || "";
    const targetYymm  = oldYymm ? getNextYM(oldYymm) : "";
    const targetMonth = targetYymm ? parseInt(targetYymm.substring(4, 6)) : -1;
    const excelMap    = parseExcel(req.excelData, targetYymm);
    const customDict  = storage.shiftDict || [];
    const hrShifts    = storage.hrShifts  || [];
    const lastData    = storage.lastMonthData;

    // 收集所有未知班別碼（去重）
    const unknownCodes = new Set();
    for (let id in excelMap) {
        excelMap[id].shifts.forEach(code => {
            const cStr = String(code || "").trim();
            if (!cStr) return;
            if (!hrShifts.includes(cStr) && !customDict.some(d => String(d.excel).trim() === cStr)) {
                unknownCodes.add(cStr);
            }
        });
    }
    if (unknownCodes.size > 0) {
        return { success: false, unknownCodes: Array.from(unknownCodes) };
    }

    const dataWithId   = Object.entries(excelMap).map(([id, v]) => ({ empId: id, ...v }));
    const oldMonthDays = lastData?.monthDays || 0;

    // 取讀取月頁面儲存的最後一個週期作為延伸起點
    const lastCycle = (lastData?.cyclePeriods || []).at(-1) || null;
    const lastFF    = (lastData?.ffPeriods    || []).at(-1) || null;

    // 向後延伸，篩出包含匯入目標月的檢查區間
    const cycleRanges = buildCheckRanges(lastCycle, targetMonth, 28, oldYymm, oldMonthDays);
    const ffRanges    = buildCheckRanges(lastFF,    targetMonth, 14, oldYymm, oldMonthDays);

    // 供 Modal 著色用的整體範圍（所有檢查區間的最小 startIdx ~ 最大 endIdx）
    const allRanges = [...cycleRanges, ...ffRanges];
    const biStart = allRanges.length > 0 ? Math.min(...allRanges.map(r => r.startIdx)) : oldMonthDays;
    const biEnd   = allRanges.length > 0 ? Math.max(...allRanges.map(r => r.endIdx))   : oldMonthDays + 27;

    // 顯示用標籤
    const cycleLabel = cycleRanges.map((r, i) => `【${i + 1}】${r.start}～${r.end}`).join('、') || '未知';
    const ffLabel    = ffRanges.map((r, i)    => `《${i + 1}》${r.start}～${r.end}`).join('、') || '未知';
    const infoText   = `四週變形：${cycleLabel}　／　FF雙週：${ffLabel}`;

    const check = runDetailedCheck(lastData, excelMap, customDict, cycleRanges, ffRanges);
    if (req.showReport || check.errors.length > 0) {
        showModal("Excel 班表預覽與檢測報告", {
            headers:      getHeaders(),
            data:         dataWithId,
            errors:       check.errors,
            monthDays:    oldMonthDays,
            biStart,
            biEnd,
            cycleRanges,
            ffRanges,
            blankFillMode: req.blankFillMode || 'keep',
            blankFillCode: req.blankFillCode || '',
        }, infoText);
    }
    return { success: check.errors.length === 0 };
}

function runDetailedCheck(old, exc, dict, cycleRanges, ffRanges) {
    if (!old?.data) return { errors: [] };
    const err = [];
    const oldMonthDays = old.monthDays || 0;  // 舊月天數，用於判斷當月邊界

    for (let id in exc) {
        const oStf = old.data.find(p => formatEmpId(p.empId) === formatEmpId(id));
        if (!oStf) continue;

        // 合併舊月 + 新月班表，Excel 班別轉為系統代號
        const combined = [...oStf.shifts, ...exc[id].shifts].map(s => {
            const d = dict.find(x => String(x.excel).trim() === String(s).trim());
            return d ? d.sys : s;
        });

        // 1. 檢查 W+ 與 N+ 班別代號 (檢查時機同四周變形與雙週 FF)
        // 遍歷新月班表中的每一天
        exc[id].shifts.forEach((code, i) => {
            const cStr = String(code || "").trim();
            if (cStr === 'W+' || cStr === 'N+') {
                const gi = oldMonthDays + i;
                // 檢查此日期是否落在任何一個四週週期或 FF 週別內
                const inCycle = cycleRanges.some(r => gi >= r.startIdx && gi <= r.endIdx);
                const inFF    = ffRanges.some(r => gi >= r.startIdx && gi <= r.endIdx);
                
                if (inCycle || inFF) {
                    err.push({
                        empId:    id,
                        startIdx: gi,
                        endIdx:   gi,
                        type:     'INVALID_CODE',
                        msg:      `此代號(${cStr})另須於逾時輸入HR的班別代號，請更換`,
                    });
                }
            }
        });

        // 2. FF 雙週檢查：每個 FF 週別內應有恰好 2 個 FF
        // 僅統計當月（新月）內的 FF，跨月部分不計
        ffRanges.forEach((r, i) => {
            // 計算當月邊界內的實際檢查範圍
            const checkStart = Math.max(r.startIdx, oldMonthDays);
            const checkEnd   = r.endIdx;
            
            // 若檢查範圍完全在舊月，則跳過
            if (checkEnd < oldMonthDays) return;
            
            const count = combined.slice(checkStart, checkEnd + 1).filter(s => s === 'FF').length;
            if (count !== 2) {
                err.push({
                    empId:    id,
                    startIdx: r.startIdx,
                    endIdx:   r.endIdx,
                    type:     `FF_${i + 1}`,
                    msg:      `FF雙週《${i + 1}》${r.start}～${r.end} FF=${count}（應2）`,
                });
            }
        });

        // 3. 四週變形檢查：每個四週週期內應有恰好 4 個 WW/W+
        // 僅統計當月（新月）內的 WW/W+，跨月部分不計
        cycleRanges.forEach((r, i) => {
            // 計算當月邊界內的實際檢查範圍
            const checkStart = Math.max(r.startIdx, oldMonthDays);
            const checkEnd   = r.endIdx;
            
            // 若檢查範圍完全在舊月，則跳過
            if (checkEnd < oldMonthDays) return;
            
            const count = combined.slice(checkStart, checkEnd + 1)
                .filter(s => s === 'WW' || s === 'W+').length;
            if (count !== 4) {
                err.push({
                    empId:    id,
                    startIdx: r.startIdx,
                    endIdx:   r.endIdx,
                    type:     `WW_${i + 1}`,
                    msg:      `四週變形【${i + 1}】${r.start}～${r.end} WW=${count}（應4）`,
                });
            }
        });
    }
    return { errors: err };
}

// ─────────────────────────────────────────────────────────────────
// 步驟 4：寫入班表
// ─────────────────────────────────────────────────────────────────
async function executeInjectionFlow(excelData) {
    const storage = await chrome.storage.local.get(['lastMonthData', 'shiftDict', 'blankFillMode', 'blankFillCode']);
    const oldYymm = storage.lastMonthData?.yymm || "";
    const excelMap = parseExcel(excelData, oldYymm ? getNextYM(oldYymm) : "");
    const customDict = storage.shiftDict || [];
    const isFill = (storage.blankFillMode || 'keep') === 'fill' && storage.blankFillCode;
    const fillCode = storage.blankFillCode || '';

    const webMap = {};
    document.querySelectorAll("input[id^='Hidden_empno_']").forEach(f => {
        const empId = formatEmpId(f.value.split('-')[0]);
        if (empId) webMap[empId] = f.id.split('_').pop();
    });

    for (let id in excelMap) {
        const sfx = webMap[formatEmpId(id)];
        if (!sfx) continue;
        excelMap[id].shifts.forEach((code, i) => {
            const isBlank = !code;
            if (isBlank && !isFill) return; // 維持現狀：跳過

            const day = String(i + 1).padStart(2, '0');
            const actualCode = isBlank ? fillCode : code;
            const d = customDict.find(x => String(x.excel).trim() === String(actualCode).trim())
                   || { sys: actualCode, over: "", am: "", pm: "", night: "" };
            const fill = (p, v) => {
                const el = document.getElementById(`Field_${p}${day}_${sfx}`);
                if (el) {
                    el.value = v;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    if (el.onchange) el.onchange();
                }
            };
            fill("day", d.sys);
            fill("whr", d.over);
            fill("wareaa", d.am);
            fill("wareab", d.pm);
            fill("wareac", d.night);
        });
    }
    return { success: true, message: "✅ 班表寫入完成" };
}

// ─────────────────────────────────────────────────────────────────
// UI：Modal 報告視窗
// ─────────────────────────────────────────────────────────────────
function showModal(title, dataset, info) {
    const oldModal = document.getElementById('kmuh-modal'); if (oldModal) oldModal.remove();
    const oldStyle = document.getElementById('kmuh-modal-style'); if (oldStyle) oldStyle.remove();

    const h          = dataset.headers;
    const mDays      = dataset.monthDays || 0;
    const biStart    = dataset.biStart ?? mDays;
    const biEnd      = dataset.biEnd   ?? (mDays + 27);
    const cycleRanges = dataset.cycleRanges || [];
    const ffRanges    = dataset.ffRanges    || [];
    const errorIds   = new Set(dataset.errors?.map(e => formatEmpId(e.empId)));
    const total      = dataset.data.length;
    const errCount   = errorIds.size;

    // 著色：四週週期用藍色系，FF 週別用紫色系（各最多 3 個）
    const CYCLE_COLORS = ['#dbeafe', '#bfdbfe', '#93c5fd'];
    const FF_COLORS    = ['#ede9fe', '#ddd6fe', '#c4b5fd'];

    const cycleCss = cycleRanges.map((_, i) =>
        `.hd-cy-${i} { background:${CYCLE_COLORS[i % CYCLE_COLORS.length]} !important; }`
    ).join('\n');
    const ffCss = ffRanges.map((_, i) =>
        `.hd-ff-${i} { background:${FF_COLORS[i % FF_COLORS.length]} !important; }`
    ).join('\n');

    // 欄位著色：優先顯示 FF 色，其次四週色
    const colCls = (gi) => {
        for (let i = 0; i < ffRanges.length; i++) {
            if (gi >= ffRanges[i].startIdx && gi <= ffRanges[i].endIdx) return `hd-ff-${i}`;
        }
        for (let i = 0; i < cycleRanges.length; i++) {
            if (gi >= cycleRanges[i].startIdx && gi <= cycleRanges[i].endIdx) return `hd-cy-${i}`;
        }
        return "";
    };

    // 圖例 HTML
    const legendItems = [
        ...cycleRanges.map((r, i) =>
            `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px;">
              <span style="display:inline-block;width:12px;height:12px;background:${CYCLE_COLORS[i % CYCLE_COLORS.length]};border:1px solid #aaa;border-radius:2px;"></span>
              四週【${i + 1}】${r.start}～${r.end}
            </span>`),
        ...ffRanges.map((r, i) =>
            `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px;">
              <span style="display:inline-block;width:12px;height:12px;background:${FF_COLORS[i % FF_COLORS.length]};border:1px solid #aaa;border-radius:2px;"></span>
              FF《${i + 1}》${r.start}～${r.end}
            </span>`),
    ].join('');

    const style = document.createElement('style');
    style.id = 'kmuh-modal-style';
    style.innerHTML = `
        #kmuh-modal { position:fixed; top:2%; left:2%; width:96%; height:94%; background:#fdfdfe; z-index:10000; padding:25px; box-shadow:0 15px 60px rgba(0,0,0,0.4); overflow:auto; border-radius:15px; font-family:sans-serif; }
        .summary-row { display:flex; gap:15px; margin-bottom:15px; }
        .card { flex:1; padding:15px; border-radius:10px; color:white; display:flex; flex-direction:column; align-items:center; }
        .card-blue { background:#3498db; } .card-green { background:#2ecc71; } .card-red { background:#e74c3c; }
        .card-val { font-size:2em; font-weight:bold; margin-top:5px; }
        .table-container { overflow-x:auto; border:1px solid #dfe6e9; border-radius:8px; }
        .report-table { width:100%; border-collapse:separate; border-spacing:0; background:white; }
        .report-table th, .report-table td { border:1px solid #ecf0f1; padding:8px; text-align:center; font-size:13px; min-width:32px; }
        .sticky-col { position:sticky; left:0; background:#f8f9fa !important; z-index:5; font-weight:bold; border-right:2px solid #bdc3c7 !important; min-width:70px; }
        .sticky-name { position:sticky; left:71px; background:#f8f9fa !important; z-index:5; font-weight:bold; border-right:2px solid #bdc3c7 !important; min-width:60px; }
        .cell-err { background:#fff2f2 !important; border:2px solid #ff7675 !important; }
        .tooltip { position:relative; cursor:help; }
        .tooltip:hover::after { content:attr(data-tip); position:absolute; bottom:115%; left:50%; transform:translateX(-50%); background:#2d3436; color:white; padding:6px 10px; border-radius:5px; font-size:11px; white-space:nowrap; z-index:9999; }
        ${cycleCss}
        ${ffCss}
    `;
    document.head.appendChild(style);

    const thW = h.weekdays.map((w, i) =>
        `<th class="${colCls(mDays + i)}" style="color:${w === '日' || w === '六' ? '#e74c3c' : 'inherit'}">${w}</th>`
    ).join('');

    const thD = h.dates.map((d, i) =>
        `<th class="${colCls(mDays + i)}">${d}</th>`
    ).join('');

    const rows = dataset.data.map(p => {
        const pErrs  = dataset.errors?.filter(e => formatEmpId(p.empId) === formatEmpId(e.empId)) || [];
        const isFill = dataset.blankFillMode === 'fill' && dataset.blankFillCode;

        // 為每個 cell 計算大框樣式：以錯誤區間為單位，畫連續大框
        // 每個錯誤區間對應一個獨立的框色（循環使用）
        const ERR_COLORS = ['#e74c3c', '#8e44ad', '#c0392b', '#6c3483'];
        const cells = p.shifts.map((s, i) => {
            const gi      = mDays + i;
            const isBlank = !s;
            const displayVal = isBlank && isFill
                ? `<span style="color:#e67e22;font-size:11px;">→${dataset.blankFillCode}</span>`
                : (s || '');

            // 找出此 cell 所屬的錯誤區間
            const errIdx = pErrs.findIndex(e => gi >= e.startIdx && gi <= e.endIdx);
            const err    = errIdx !== -1 ? pErrs[errIdx] : null;

            let borderStyle = '';
            let bgStyle     = '';
            let tipText     = '';

            if (err) {
                const color   = ERR_COLORS[errIdx % ERR_COLORS.length];
                const isFirst = gi === err.startIdx;
                const isLast  = gi === err.endIdx;
                // 上框 + 下框 始終有；左框只在第一格；右框只在最後一格
                borderStyle = `border-top:2px solid ${color} !important; border-bottom:2px solid ${color} !important;`
                    + (isFirst ? `border-left:2px solid ${color} !important;` : 'border-left:none !important;')
                    + (isLast  ? `border-right:2px solid ${color} !important;` : 'border-right:none !important;');
                bgStyle = `background:#fff2f2 !important;`;
                tipText = err.msg; // 區間內每格都顯示錯誤訊息
            } else if (isBlank && isFill) {
                tipText = `將填入 ${dataset.blankFillCode}`;
            }

            const wkBg    = h.weekdays[i] === '日' || h.weekdays[i] === '六' ? '#fef9f9' : 'white';
            const cellBg  = err ? '' : `background:${wkBg};`;
            const tipAttr = tipText ? `data-tip="${tipText}"` : '';
            const cls     = tipText ? 'tooltip' : '';

            return `<td class="${cls}" ${tipAttr} style="${cellBg}${bgStyle}${borderStyle}">${displayVal}</td>`;
        }).join('');
        return `<tr><td class="sticky-col">${p.empId || ''}</td><td class="sticky-name">${p.name || ''}</td>${cells}</tr>`;
    }).join('');

    const m = document.createElement('div');
    m.id = 'kmuh-modal';
    m.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <h2 style="margin:0;">📊 ${title}</h2>
            <button id="closeM" style="padding:10px 35px; background:#3498db; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold; font-size:14px;">✖ 關閉</button>
        </div>
        ${info ? `<div style="margin-bottom:8px; padding:8px 12px; background:#eaf4fb; border-radius:6px; font-size:13px; color:#2c3e50;">ℹ️ ${info}</div>` : ''}
        ${legendItems ? `<div style="margin-bottom:12px; padding:6px 12px; background:#f8f9fa; border-radius:6px; font-size:12px; color:#555; display:flex; flex-wrap:wrap; gap:4px; align-items:center;"><b style="margin-right:6px;">檢查區間：</b>${legendItems}</div>` : ''}
        <div class="summary-row">
            <div class="card card-blue"><span>檢測總人數</span><div class="card-val">${total}</div></div>
            <div class="card card-green"><span>通過檢核</span><div class="card-val">${total - errCount}</div></div>
            <div class="card card-red"><span>違反規範</span><div class="card-val">${errCount}</div></div>
        </div>
        <div class="table-container">
            <table class="report-table">
                <thead>
                    <tr style="background:#f1f2f6;">
                        <th rowspan="2" class="sticky-col">職編</th>
                        <th rowspan="2" class="sticky-name">姓名</th>
                        ${thW}
                    </tr>
                    <tr style="background:#f1f2f6;">${thD}</tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    document.body.appendChild(m);
    document.getElementById('closeM').onclick = () => {
        m.remove();
        style.remove();
        chrome.runtime.sendMessage({ action: "modalClosed" });
    };
}

// ─────────────────────────────────────────────────────────────────
// 網頁班表擷取
// ──────────────────
function captureWebSchedule() {
    const yymm = document.getElementById("Field_yymm")?.value || "";
    const monthDays = document.querySelectorAll("th[id^='Header_day_']").length;
    const data = [];
    document.querySelectorAll("input[id^='Hidden_empno_']").forEach(f => {
        const empId = f.value.split('-')[0];
        const name  = f.value.split('-')[1] || "";
        const sfx   = f.id.split('_').pop();
        const shifts = [];
        for (let i = 1; i <= monthDays; i++) {
            const day = String(i).padStart(2, '0');
            shifts.push(document.getElementById(`Field_day${day}_${sfx}`)?.value || "");
        }
        data.push({ empId, name, shifts });
    });
    return { yymm, monthDays, data };
}

function getHeaders() {
    const dates = [], weekdays = [];
    document.querySelectorAll("th[id^='Header_day_']").forEach(th => {
        dates.push(th.innerText.trim());
    });
    document.querySelectorAll("th[id^='Header_week_']").forEach(th => {
        weekdays.push(th.innerText.trim());
    });
    return { dates, weekdays };
}

// ─────────────────────────────────────────────────────────────────
// Excel 解析
// ─────────────────────────────────────────────────────────────────
function parseCellDate(val) {
    if (val === undefined || val === null) return null;
    if (typeof val === 'number' && val > 1000) {
        const d = new Date(Math.round((val - 25569) * 86400 * 1000));
        return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    }
    const s = String(val).trim();
    if (!s) return null;
    const mDate = s.match(/(?:\d{4}[\/\-])?(\d{1,2})[\/\-](\d{1,2})$/);
    if (mDate) {
        const month = parseInt(mDate[1]), day = parseInt(mDate[2]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
    }
    if (/^\d{1,2}$/.test(s)) {
        const n = parseInt(s);
        if (n >= 1 && n <= 31) return { month: null, day: n };
    }
    return null;
}

function detectExcelLayout(data, targetYymm) {
    const targetMonth = parseInt(targetYymm.substring(4, 6));
    const targetYear  = parseInt(targetYymm.substring(0, 4));
    const monthDays   = new Date(targetYear, targetMonth, 0).getDate();
    let empIdColIdx = -1, nameColIdx = -1, day1ColIdx = -1;

    // ── 第一輪：從標頭文字找欄位 ──────────────────────────────
    const EMP_KEYWORDS  = ["職編", "員工編號", "工號", "員編", "職員編號"];
    const NAME_KEYWORDS = ["姓名", "員工姓名", "名字"];

    for (let ri = 0; ri < Math.min(10, data.length); ri++) {
        const row = data[ri];
        if (!row) continue;
        for (let ci = 0; ci < row.length; ci++) {
            const val = String(row[ci] || "").trim();
            if (empIdColIdx === -1 && EMP_KEYWORDS.some(k => val.includes(k))) empIdColIdx = ci;
            if (nameColIdx  === -1 && NAME_KEYWORDS.some(k => val.includes(k))) nameColIdx  = ci;
            if (day1ColIdx  === -1) {
                const cd  = parseCellDate(row[ci]);
                const cd2 = parseCellDate(row[ci + 1]);
                if (cd?.day === 1 && cd2?.day === 2) day1ColIdx = ci;
            }
        }
        if (empIdColIdx !== -1 && nameColIdx !== -1 && day1ColIdx !== -1) break;
    }

    // ── 第二輪：標頭沒有職編關鍵字時，掃描資料列自動辨識 ──────
    if (empIdColIdx === -1) {
        // 統計每欄中符合 6~7 碼純數字的資料列數
        const colHits = {};
        for (let ri = 0; ri < data.length; ri++) {
            const row = data[ri];
            if (!row) continue;
            for (let ci = 0; ci < (day1ColIdx !== -1 ? day1ColIdx : row.length); ci++) {
                const val = String(row[ci] || "").trim();
                if (/^\d{6,7}$/.test(val)) {
                    colHits[ci] = (colHits[ci] || 0) + 1;
                }
            }
        }
        // 取命中數最多的欄，且至少要有 2 列以上才認定
        let bestCol = -1, bestHits = 1;
        for (const [ci, hits] of Object.entries(colHits)) {
            if (hits > bestHits) { bestHits = hits; bestCol = parseInt(ci); }
        }
        if (bestCol !== -1) {
            empIdColIdx = bestCol;
            console.log(`[Excel 解析] 自動辨識職編欄：第 ${bestCol} 欄（命中 ${bestHits} 列`);
        } else {
            console.warn("[Excel 解析] 無法自動辨識職編欄，請確認 Excel 格式");
        }
    }

    // 姓名欄預設為職編欄專邊一欄
    if (nameColIdx === -1 && empIdColIdx !== -1) nameColIdx = empIdColIdx + 1;
    if (day1ColIdx === -1) console.warn("[Excel 解析] 未找到日期 1 號欄位，請確認 Excel 格式");

    return {
        empIdColIdx: empIdColIdx !== -1 ? empIdColIdx : 1,
        nameColIdx:  nameColIdx  !== -1 ? nameColIdx  : 2,
        day1ColIdx:  day1ColIdx  !== -1 ? day1ColIdx  : 3,
        monthDays
    };
}

function parseExcel(data, targetYymm) {
    const { empIdColIdx, nameColIdx, day1ColIdx, monthDays } = detectExcelLayout(data, targetYymm);
    const m = {};
    data.forEach(r => {
        const rawId = String(r[empIdColIdx] || "").trim();
        if (!/^\d{6,7}$/.test(rawId)) return;
        const empId  = formatEmpId(rawId);
        const name   = String(r[nameColIdx] || "").trim();
        const shifts = [];
        for (let i = 0; i < monthDays; i++) {
            const val = r[day1ColIdx + i];
            shifts.push(val !== undefined && val !== null ? String(val).trim() : "");
        }
        m[empId] = { name, shifts };
    });
    console.log(`[解析完成] 職編欄:${empIdColIdx}, 姓名欄:${nameColIdx}, 1號欄:${day1ColIdx}, 人數:${Object.keys(m).length}`);
    return m;
}
