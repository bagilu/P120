# P120-transfer-api

單一 P120 Edge Function，以 JSON body 的 `action` 分派：

- `create-transfer`
- `complete-transfer`
- `cancel-transfer`
- `lookup-transfer`
- `create-download-url`

必要 secrets：

- `P120_ALLOWED_ORIGINS`：允許的正式網站 Origin，逗號分隔，不含 URL path。
- `P120_RATE_LIMIT_SALT`：至少 24 字元，建議 32 字元以上的隨機值。

Supabase 平台提供：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Function 使用 `verify_jwt = false`，但每次建立／查詢／下載仍由 P120 自己的 rate limit、房間狀態、management token及 10 分鐘效期控制。資料庫與 Storage 的 anon直接權限均保持關閉。
