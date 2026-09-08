# P120 Database 部署說明

## 執行順序

依檔名前綴由小到大執行 `01` 至 `09`，再執行 `90_P120_Permissions.sql`；最後單獨執行 `99_P120_HealthCheck.sql` 驗證。

## P-SDS 範圍聲明

本目錄只允許操作：

- `public."TblP120Transfer"`
- `public."TblP120File"`
- `public."TblP120RateLimit"`
- `public."P120CheckRateLimit"(...)`
- Storage bucket `p120-temp-files`

不允許：

- `GRANT`／`REVOKE ... ALL TABLES IN SCHEMA public`
- `ALTER DEFAULT PRIVILEGES`
- `DROP SCHEMA public`
- 修改其他 `TblPxx...`、RPC、policy、trigger或 bucket
- 以 SQL 直接刪除 `storage.objects` metadata

`06_CreatePolicies.sql` 刻意不建立 anon／authenticated policy。這不是遺漏，而是因為 P120 的資料與 private bucket全部由 Edge Function使用 service role存取。

## 重複部署

建表與索引採 `IF NOT EXISTS`。`09_CreateStorage.sql` 只會建立或校正 ID 完全等於 `p120-temp-files` 的 bucket。權限修復檔只撤銷 P120 三張表與一個 P120 函式的權限。

若未來欄位或函式回傳型別需要變更，應新增版本化 migration；不要以會影響其他專案的全域 SQL處理。
