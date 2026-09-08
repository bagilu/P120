# P120-transfer-api

單一 P120 Edge Function，以 JSON body 的 `action` 分派：

- `create-transfer`
- `complete-transfer`
- `cancel-transfer`
- `lookup-transfer`
- `create-download-url`

必要 secrets：

- `P120_ALLOWED_ORIGINS`：額外允許的網站 Origin，逗號分隔；程式會自動只取 URL 的 Origin。P120 正式站的 Origin `https://bagilu.github.io` 永遠保留，不會被此 secret 覆寫。
- `P120_RATE_LIMIT_SALT`：建議 32 字元以上的隨機值；未設定時使用伺服器端既有 secret衍生來源雜湊。

Supabase 平台提供：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

根層 `supabase/config.toml` 設定本 Function 使用 `verify_jwt = false`；部署時亦應執行 `supabase functions deploy P120-transfer-api --no-verify-jwt`。每次建立／查詢／下載仍由 P120 自己的 rate limit、房間狀態、management token及 10 分鐘效期控制。資料庫與 Storage 的 anon直接權限均保持關閉。
