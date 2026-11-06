# P120-transfer-api（V1.2.0 套件；功能內容沿用 V1.1.1）

公開 JSON actions：

- `create-room`
- `lookup-room`
- `sync-room`（須附建立／加入房間時核發的短效 HMAC 簽章）
- `update-note`
- `prepare-upload`
- `complete-upload`
- `cancel-upload`
- `create-download-url`

Edge Function 使用伺服器端 `service_role` 呼叫 P120 專屬 PostgreSQL RPC；程式中不得使用 `client.from()` 或 `supabase.from()`。Private Storage 的列出、簽署下載及清理由 Edge Function 執行。

`lookup-room` 僅供人工加入房間，受 IP rate limit 保護；前端進入房間後改用 `sync-room`。同步簽章綁定單一房間、20 分鐘後失效，不能用來查詢其他房間。

部署：

```bash
supabase functions deploy P120-transfer-api --no-verify-jwt
```

必要環境由 Supabase 提供：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。建議 secrets：`P120_ALLOWED_ORIGINS`、`P120_RATE_LIMIT_SALT`。不得將 service role key 放入前端或 ZIP。
