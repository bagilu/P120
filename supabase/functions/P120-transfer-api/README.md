# P120-transfer-api V1.1.0

公開 JSON actions：

- `create-room`
- `lookup-room`
- `update-note`
- `prepare-upload`
- `complete-upload`
- `cancel-upload`
- `create-download-url`

Edge Function 使用伺服器端 `service_role` 呼叫 P120 專屬 PostgreSQL RPC；程式中不得使用 `client.from()` 或 `supabase.from()`。Private Storage 的列出、簽署下載及清理由 Edge Function 執行。

部署：

```bash
supabase functions deploy P120-transfer-api --no-verify-jwt
```

必要環境由 Supabase 提供：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。建議 secrets：`P120_ALLOWED_ORIGINS`、`P120_RATE_LIMIT_SALT`。不得將 service role key 放入前端或 ZIP。
