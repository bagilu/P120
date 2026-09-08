# P120 檔案快遞 V1.0

免登入的短效檔案傳送網站。上傳者可一次選取最多 20 個檔案，單檔上限 50 MiB、合計上限 100 MiB；完成上傳後產生六位數房間碼、分享網址與 QR Code。接收者可在 10 分鐘內下載，逾時後由伺服器立即拒絕新下載。

頁首品牌為「慈濟大學經營管理學系 好玩實驗室 作品。」，「好玩實驗室」連至 <https://tcubmdsbilab.github.io/P101/>。

## 架構

- GitHub Pages：靜態前端。
- Supabase Database：P120 房間、檔案 metadata與短期 rate limit。
- Supabase Storage：`p120-temp-files` private bucket。
- Supabase Edge Function：`P120-transfer-api`。
- 不使用 Supabase Auth，前端 session 不持久化。
- 前端不直接讀寫任何 P120 資料表，也不能列出 bucket。

## 部署前準備

1. 使用既有 Supabase Project時，先備份重要設定。
2. 確認本 ZIP 中沒有實際 `config.js`、service role key或其他 secret。
3. 先執行 `bash scripts/check-p120-scope.sh`。
4. SQL 請依 `database/README.md` 所列順序逐一執行，不要把其他專案 SQL 混入。

## 一、建立資料庫與 Storage

在 Supabase SQL Editor依序執行：

1. `database/01_CreateTables.sql`
2. `database/02_CreateIndexes.sql`
3. `database/03_CreateViews.sql`
4. `database/04_CreateFunctions.sql`
5. `database/05_EnableRLS.sql`
6. `database/06_CreatePolicies.sql`
7. `database/07_GrantPermissions.sql`
8. `database/08_SeedData.sql`
9. `database/09_CreateStorage.sql`
10. `database/90_P120_Permissions.sql`

最後執行 `database/99_P120_HealthCheck.sql`。所有 `Passed` 應為 `true`，三張資料表的 `RlsEnabled` 與 `RlsForced` 也應為 `true`。

## 二、部署 Edge Function

使用 Supabase CLI：

```bash
supabase functions deploy P120-transfer-api --no-verify-jwt
```

設定兩個伺服器端 secrets：

```bash
supabase secrets set P120_ALLOWED_ORIGINS=https://YOUR_GITHUB_USERNAME.github.io
supabase secrets set P120_RATE_LIMIT_SALT=請換成至少32字元的隨機字串
```

`P120_ALLOWED_ORIGINS` 填 Origin，不含 `/P120/` 路徑。若有多個正式來源，以逗號分隔，例如：

```text
https://example.github.io,https://files.example.edu.tw
```

Supabase 會自動提供 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 給 Edge Function。不要把 service role key 放入 GitHub、`config.js` 或任何瀏覽器檔案。

若使用 Dashboard部署，Function 名稱必須為 `P120-transfer-api`，並關閉 JWT verification；同時在 Edge Function Secrets設定上述兩個 P120 secrets。

## 三、設定前端

複製：

```text
config-sample.js → config.js
```

只填入 Supabase URL及 anon／publishable key。`config.js` 範例：

```javascript
window.P120_CONFIG = Object.freeze({
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY",
  EDGE_FUNCTION_NAME: "P120-transfer-api",
  STORAGE_BUCKET: "p120-temp-files"
});
```

Anon／publishable key 本來就是前端公開金鑰；真正敏感的是 service role key，後者絕不可出現在前端。

## 四、部署 GitHub Pages

將專案檔案放在 GitHub repository根目錄或對應的 `/P120/` 目錄，並確保 `index.html` 與實際 `config.js` 位於同一層。啟用 GitHub Pages後，以正式網址測試：

- 首頁可載入且沒有設定錯誤。
- 可上傳兩個小型測試檔案。
- QR Code網址含 `?code=六位數`。
- 手機掃碼可顯示相同檔案清單。
- 下載內容與原檔一致。
- 完成後 10 分鐘，伺服器拒絕新下載。

## 清理行為

- 建立新房間與查詢房間時，Edge Function會小批次清理過期 transfer。
- 到期的房間即使實體物件尚未刪除，也不能再取得下載網址。
- 放棄上傳 30 分鐘後視為過期。
- 刪除實體物件只使用 Storage API，不直接刪除 `storage.objects` metadata。
- Signed upload token可能比 P120 房間活得更久，因此刪除後保留 3 小時 tombstone並重複清理遲來上傳。

## CDN 依賴

前端固定使用以下版本：

- `@supabase/supabase-js@2.57.4`
- `qrcode-generator@1.4.4`

若 CDN 無法載入，網站會顯示錯誤或提示改用房間碼／分享網址。CSP 只允許本網站、Supabase及 jsDelivr所需連線。

## 安全邊界

六位數房間碼重視便利性，不是高強度密碼。本系統有短效期限及基本 rate limit，但不適合機密、敏感或含個人資料的內容，也不包含病毒掃描或端對端加密。

## 版本基準

本 ZIP 為 **P120 FileCourier V1.0 — Short-lived Multi-file Transfer**。後續修改應從此版本延伸，並繼續遵守 P-SDS 與共用 Supabase Project隔離規範。
