# 專案開發與 AI 協作指南

本文件定義此專案的開發規範、AI 協作流程、架構原則、命名規則、程式碼風格與維護標準。

目標是確保：

- 長期可維護性
- AI 協作穩定性
- 可預測的程式碼品質
- 低風險修改
- 清楚的責任分離

---

# 專案性質

本文件只適用於 `main` 分支根目錄的 SeiWorks 主站，不包含獨立的 `calcloan/` 子專案。

主站是純靜態前端網站，沒有後端服務、資料庫、API server 或建置流程。

主要站台內容位於：

- `index.html`
- `header.html`
- `footer.html`
- `style.css`
- `images/`

`calcloan/` 有自己的頁面、樣式、腳本與文件；除非使用者明確指定，處理主站需求時不要讀取、修改或重構該目錄。

目前技術組成：

- HTML
- CSS
- JavaScript
- jQuery
- Bootstrap 5 CDN
- Material Design Icons CDN
- Google Fonts CDN

除非使用者明確要求，不要引入前端框架、打包工具、後端服務或資料庫。

---

# 核心原則

## 優先保持小型變更

優先：

- 小 diff
- 小步重構
- 聚焦功能修改
- 降低副作用

避免：

- 無關的大規模重寫
- 一次性大改架構
- 純格式化的大量修改
- 重構不相關檔案
- 為小需求導入大型依賴

---

## 修改前先閱讀

修改程式前：

1. 閱讀相關檔案
2. 理解目前畫面與互動流程
3. 說明現有行為
4. 提出修改方向
5. 再開始實作

大型變更時：

- 先釐清影響範圍
- 說明可能風險
- 拆成多個小階段

---

## 優先遵循既有規範

除非使用者明確要求：

- 不更換框架
- 不新增後端
- 不新增資料庫
- 不加入 build step
- 不修改部署結構
- 不重寫已穩定運作的互動邏輯
- 不任意變更 UI 風格
- 不大幅重做版面
- 不任意調整 spacing、字級、色彩與動畫節奏

優先遵循既有專案結構與視覺風格。

---

# AI 協作流程

本專案支援多 AI 協作開發。

推薦分工：

| 工具 | 責任 |
|---|---|
| ChatGPT / Claude | 架構分析、規劃、風險評估 |
| Codex | 程式實作、修 bug、執行修改 |
| 人類 | 最終確認與決策 |

AI Agent 應：

- 大型修改前先說明風險
- 不自行假設需求
- 保持現有靜態網站架構穩定
- 保持程式碼可讀性
- 清楚回報修改內容

---

# 架構規範

## 靜態網站結構

主站不分前後端，網站檔案集中在儲存庫根目錄。

建議維持：

- `index.html`：主要頁面內容與少量頁面互動
- `header.html`：共用頁首
- `footer.html`：共用頁尾
- `style.css`：全站樣式
- `images/`：網站使用圖片、logo、favicon 等靜態資源

避免新增：

- `frontend/`
- `backend/`
- `server/`
- `api/`
- `database/`
- 複雜的 framework 專案結構

除非需求已明確超出純靜態網站能力。

---

## HTML 規範

- 優先維持現有 HTML 結構與 Bootstrap class 使用方式。
- 共用導覽列內容放在 `header.html`。
- 共用頁尾內容放在 `footer.html`。
- 不要為單一小區塊建立過度抽象的檔案。
- 新增 section 時，維持目前命名風格與頁面節奏。
- 保持語意清楚，必要時使用 `section`、`nav`、`footer` 等語意標籤。

---

## CSS 規範

- 全站樣式集中在根目錄的 `style.css`。
- 優先沿用既有 BEM-like 命名，例如 `firstView__container`、`section__title-box`。
- 新增樣式時，盡量放在相關區塊附近。
- 避免大規模重新排序既有 CSS。
- 修改 RWD 時，需同時考慮桌機與手機寬度。
- 不要任意改動 logo、主色、hero、動畫與 spacing，除非需求明確要求。

---

## JavaScript 規範

- 目前網站使用少量原生 JavaScript 與 jQuery。
- `header.html`、`footer.html` 透過 jQuery `load()` 載入。
- 新增互動優先使用原生 JavaScript，若需配合既有 include 流程，可使用 jQuery。
- 不要為小互動引入前端框架。
- 避免把大量邏輯塞進 inline script；若互動增加很多，再評估拆出獨立 `.js` 檔。

---

## 靜態資源規範

- 主站實際使用資源放在根目錄的 `images/`。
- 設計來源檔與備份素材可保留在 `files/psd/`，不要誤刪。
- 新增圖片時，優先使用壓縮後的 web-friendly 格式。
- 修改 logo、favicon、背景圖前，先確認引用路徑與實際顯示效果。

---

# 驗證方式

此專案沒有自動化測試與建置流程。

修改後至少檢查：

- 直接開啟根目錄的 `index.html` 是否可正常顯示。
- 若使用瀏覽器直接開檔導致 jQuery `load()` 受限制，改用本機靜態伺服器檢查。
- Header 與 footer 是否正常載入。
- 桌機與手機寬度是否無明顯破版。
- Console 是否沒有新增錯誤。
- 圖片、icon、字型 CDN 是否仍可載入。

可用簡易本機伺服器：

```bash
python3 -m http.server 8000
```

然後開啟：

```text
http://localhost:8000/
```

---

# 維護注意事項

- 此專案已選定為純靜態前端網站，預設不升級成 SPA 或 full-stack 專案。
- 修改本專案時，保持目前檔案結構簡單、部署直接、可由 GitHub Pages 或一般靜態主機服務。
- `calcloan/` 不屬於本文件涵蓋的主站內容；若需求涉及該目錄，應先閱讀其中的 `README.md` 與 `ARCHITECTURE.md`，並把變更限制在該子專案內。
