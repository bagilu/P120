# P120 檔案快遞 V1.2.0

免登入的短效共享空間。使用者先按「開始分享」，系統立即產生 QR Code 與六位數分享碼；加入者可在同一畫面共同輸入文字、交換網址、上傳及下載檔案。第一筆非空白文字或第一批檔案送出後開始 10 分鐘倒數；未開始使用的空白空間 5 分鐘後清除。

正式網址：<https://bagilu.github.io/P120/>

## 主要流程

- 發起者：進入 P120 → 開始分享 → 取得 QR Code 與分享碼。
- 手機加入者：掃描 QR Code，直接進入相同空間。
- 桌機加入者：前往固定網址，輸入六位數分享碼。
- 完整 `?code=` 連結只供 QR Code 與「複製邀請連結」使用，不要求人工輸入。
- 共筆採短週期同步與 revision 衝突保護；不直接訂閱資料表。
- 背景同步使用房間專屬短效簽章，不再消耗人工加入房間的查詢額度。
- 有共享檔案時提供「全部下載」；多檔下載時瀏覽器可能要求使用者允許此網站下載多個檔案。
- 10 分鐘到期後，發送端與接收端都會清除共筆、檔案清單、QR Code、分享碼及網址參數，回到首頁並顯示明確的到期說明。
- 空間內任何加入者都可共享文字及檔案，因此分享碼應只交給可信對象。

## 限制

- 共筆最多 5,000 字。
- 每個空間最多 20 個檔案。
- 單檔上限 50 MiB，合計上限 100 MiB。
- 內容啟用後保留 10 分鐘。
- 不適合敏感、機密或含個人資料的內容。

## 架構與 SBI-P-SDS v3.6

- GitHub Pages：靜態 HTML／CSS／JavaScript，無 build pipeline。
- Supabase Edge Function：唯一公開業務入口，負責 CORS、輸入驗證、rate limit 與 private Storage。
- PostgreSQL：Edge Function 僅呼叫名稱含 P120 的 RPC，不直接操作資料表。
- Browser：不使用 `.from()`，不直接讀寫 Table／View。
- `TblP120Transfer`、`TblP120File`、`TblP120RateLimit` 全部啟用並 FORCE RLS。
- anon／authenticated 對 P120 資料表及業務 RPC 均無權限。
- Storage bucket `p120-temp-files` 為 private；anon 僅能 INSERT 到後端預先建立且仍有效的不可猜測路徑。
- Edge Function 的 `service_role` 只存在 Supabase 伺服器環境，不得放入 GitHub、ZIP 或瀏覽器。

## 從 V1.1.1 升級

本版只修改前端與文件，**不需執行 SQL，也不需重新部署 Edge Function**。更新 GitHub Pages 的 `index.html`、`css/`、`js/` 與文件即可；正式環境既有 `config.js` 必須保留，不要用 ZIP 內容覆蓋。

若仍是 V1.0.8，才依下列步驟執行完整升級：

1. 備份並確認目前正式版本。
2. 在 SQL Editor 執行 `database/11_P120_SharedWorkspaceMigration.sql`。
3. 執行 `database/90_P120_Permissions.sql`。
4. 執行 `database/99_P120_HealthCheck.sql`，確認所有檢查通過。
5. 重新部署 `P120-transfer-api`：

```bash
supabase functions deploy P120-transfer-api --no-verify-jwt
```

6. 以新版靜態檔案更新 GitHub Pages；保留正式環境既有 `config.js`，不要用 ZIP 內容覆蓋。

全新部署請依 `database/README.md` 執行 `01` 至 `11`、`90`，最後執行 `99`。

## 前端設定

ZIP 只提供 `config-sample.js`。部署時複製為 `config.js`，填入公開 Supabase URL 與 anon／publishable key：

```javascript
window.P120_CONFIG = Object.freeze({
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY",
  EDGE_FUNCTION_NAME: "P120-transfer-api",
  STORAGE_BUCKET: "p120-temp-files"
});
```

`config.js` 不納入 ZIP。禁止放入 `service_role`、secret key 或其他機密。

## Edge Function secrets

```bash
supabase secrets set P120_ALLOWED_ORIGINS=https://bagilu.github.io
supabase secrets set P120_RATE_LIMIT_SALT=請換成至少32字元的隨機字串
```

正式 Origin `https://bagilu.github.io` 已內建；自訂 secret 只會增加允許來源。

## 交付前檢查

```bash
bash scripts/check-p120-scope.sh
```

另須在 staging／正式 Supabase 以 anon、authenticated、service_role 分別驗證 RPC、直接 table endpoint、Storage policy、過期拒絕及清理行為。此類執行身分測試無法由離線 ZIP 完整取代。

## 版本

**P120 FileCourier V1.2.0 — Download All & Clear Expiry State**
規範：SBI-P-SDS v3.6（2026-10-29）

### V1.2.0 變更

- 有共享檔案時顯示「全部下載」，依序準備每個短效下載連結並交由瀏覽器下載。
- 到期時不再停留在含舊房號與舊內容的畫面；停止同步並完整清除前端狀態、網址參數、QR Code、共筆與檔案清單。
- 到期後回到首頁，顯示「10 分鐘分享時間已到」的持續性說明；未開始使用的空白空間逾時則使用不同文案。
- 共筆儲存、檔案上傳、單檔下載及全部下載若收到到期回應，也會立即進入相同的清除流程。
- 首頁頁尾依 v3.6 規定，依序顯示機構、Web Version 與實際 SDS 版本。
- 本版不新增資料表、RPC 或 Edge action，不需執行 SQL 或重新部署 Edge Function。
