# P120 V1.1.1 部署順序

## 既有 V1.1.0 修正版升級

1. 不需執行 SQL，也不要重跑 `11_P120_SharedWorkspaceMigration.sql`。
2. 先部署新版 `P120-transfer-api`。
3. 再更新 GitHub Pages 前端，保留正式環境既有 `config.js`。
4. 等待先前的 lookup rate-limit 視窗最多 5 分鐘消退；新建立的房間不會再被背景同步耗盡額度。
5. 使用兩部裝置執行本文件的必測案例。

## 既有 V1.0.8 升級

1. 備份目前正式資料庫與 Edge Function。
2. 在 staging 或維護時段執行 `database/11_P120_SharedWorkspaceMigration.sql`。
3. 執行 `database/90_P120_Permissions.sql`。
4. 執行 `database/99_P120_HealthCheck.sql`；任何 `Passed = false` 都必須先修正。
5. 部署新版 `P120-transfer-api`，並明確使用 `--no-verify-jwt`。
6. 保留正式環境既有 `config.js`，更新其他 GitHub Pages 檔案。
7. 強制重新整理後執行下列端對端測試。

## 必測案例

- 建立空白分享空間，取得 QR Code 與六位數分享碼。
- 手機掃描 QR Code；桌機以固定網址加分享碼加入。
- 兩部裝置輪流更新共筆，內容在約 3 秒內同步。
- A 端完成檔案上傳後，B 端不重新整理頁面也能在約 3 秒內看到檔案。
- 保持房間開啟超過 2 分鐘，背景同步不會觸發 `RATE_LIMITED`。
- 同時編輯造成 revision 衝突時，不會靜默覆蓋另一方內容。
- 第一筆非空白文字或第一批檔案開始 10 分鐘倒數。
- 上傳 2 個小檔案後，另一部裝置能看到並下載相同內容。
- 超過 20 檔、單檔 50 MiB、合計 100 MiB 均被拒絕。
- 到期後共筆更新、上傳及下載均被伺服器拒絕。
- anon／authenticated 直接存取 P120 table endpoint 被拒絕。
- anon／authenticated 直接執行 P120 業務 RPC 被拒絕。
- 非允許 Origin 被 Edge Function 拒絕。

## 回復

前端可回復上一版靜態檔案；`11` migration 新增的欄位與 RPC 可暫時保留，不要在正式資料庫直接 drop 或重建。需要回復 Edge Function 時，先確認舊版 Storage policy 條件，避免舊版 `uploading` 流程與新版 policy 不一致。
