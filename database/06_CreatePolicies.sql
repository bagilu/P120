-- P120 三張 public 資料表不建立 anon 或 authenticated policy。
-- Storage 僅允許 anon INSERT 到已由 Edge Function 預先建立、仍在上傳期限內、
-- 且路徑完全吻合的 P120 物件；不允許列出、讀取、更新或刪除 bucket。

DROP POLICY IF EXISTS "PolP120SignedUploadInsert" ON storage.objects;

CREATE POLICY "PolP120SignedUploadInsert"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (
  bucket_id = 'p120-temp-files'
  AND public."P120CanUploadStorageObject"(name)
);
