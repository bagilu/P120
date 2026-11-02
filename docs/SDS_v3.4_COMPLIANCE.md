# P120 V1.1.1｜SBI-P-SDS v3.4 合規報告

- Project Code：P120
- Web Version：V1.1.1
- 檢查日期：2026-11-02（Asia/Taipei）
- 基準：P120 V1.0.8
- 規範：SBI-P-SDS v3.4

| 編號 | 結果 | 說明 |
|---|---|---|
| QA-01 | REVIEW | SQL 保留既有三表 RLS／FORCE RLS；須於部署環境執行 HealthCheck 驗證 catalog。 |
| QA-02 | PASS | 前端靜態掃描未發現 `.from()` 或直接 Table／View 存取。 |
| QA-03 | PASS | Browser 只呼叫 P120 Edge Function；Edge Function 的資料庫交換只呼叫 P120 RPC。 |
| QA-04 | REVIEW | ZIP 無法讀取 Supabase Dashboard 的 Exposed Schemas，部署者須人工核對。 |
| QA-05 | PASS | 本版不新增資料表；既有逐表 service_role 權限保留，未新增全域 grant。 |
| QA-06 | REVIEW | anon／authenticated 無 P120 table policy；Storage INSERT policy 已限定有效 P120 路徑，仍須執行身分測試。 |
| QA-07 | PASS | 新 RPC 以 JSON 明列必要欄位，未回傳 token hash、RequestID 或內部錯誤欄位。 |
| QA-08 | PASS | 新業務 RPC 撤除 PUBLIC／anon／authenticated EXECUTE，只授予 service_role。 |
| QA-09 | PASS | 新業務 RPC 均為 SECURITY INVOKER；既有兩個受控判斷函式維持 SECURITY DEFINER、固定 search_path。 |
| QA-10 | PASS | 未使用 sequence；service_role 僅由 Supabase Edge Function 環境讀取。 |
| QA-11 | N/A | P120 無密碼欄位。 |
| QA-12 | PASS | 交付 ZIP 排除 `config.js`，只含 `config-sample.js`；靜態掃描未發現 service role 欄位。 |
| QA-13 | PASS | SQL 靜態掃描未發現其他 P 專案物件、schema-wide grant、default privileges 或 DROP SCHEMA。 |
| QA-14 | N/A | 本次交付網站 ZIP，不改製海報。 |
| QA-15 | PASS | 頁尾、CSS／JS query-string 與模組 import 均同步為 V1.1.1。 |

## 自動檢查

執行：

```bash
bash scripts/check-p120-scope.sh
```

交付時所有靜態強制檢查均須 PASS。標示 REVIEW 的項目涉及正式 Supabase catalog、角色或執行環境，必須在 staging／正式環境由部署者完成，不得以離線掃描取代。
