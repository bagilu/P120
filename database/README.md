# P120 Database 部署說明

## 執行順序

全新部署依檔名前綴由小到大執行 `01` 至 `10`，再執行 `90_P120_Permissions.sql`；最後單獨執行 `99_P120_HealthCheck.sql` 驗證。既有 V1.0.6 部署只需執行 `10_P120_SignedUploadPolicyFix.sql`。

## P-SDS 範圍聲明

本目錄只允許操作：

- `public."TblP120Transfer"`
- `public."TblP120File"`
- `public."TblP120RateLimit"`
- `public."P120CheckRateLimit"(...)`
- `public."P120CanUploadStorageObject"(text)`
- Storage bucket `p120-temp-files`
- Storage policy `PolP120SignedUploadInsert`

不允許：

- `GRANT`／`REVOKE ... ALL TABLES IN SCHEMA public`
- `ALTER DEFAULT PRIVILEGES`
- `DROP SCHEMA public`
- 修改其他 `TblPxx...`、RPC、policy、trigger或 bucket
- 以 SQL 直接刪除 `storage.objects` metadata

P120 三張 public 資料表仍不建立 anon／authenticated policy。Storage 只有一條 P120 專屬 anon INSERT policy，且必須同時符合 bucket 名稱、資料庫中不可猜測的完整物件路徑、pending 狀態、uploading 房間及尚未超過上傳期限；沒有 SELECT、UPDATE 或 DELETE policy。

## 重複部署

建表與索引採 `IF NOT EXISTS`。`09_CreateStorage.sql` 只會建立或校正 ID 完全等於 `p120-temp-files` 的 bucket。權限修復檔只撤銷 P120 三張表與一個 P120 函式的權限。

若未來欄位或函式回傳型別需要變更，應新增版本化 migration；不要以會影響其他專案的全域 SQL處理。
