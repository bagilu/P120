-- P120 V1.0.7 既有部署專用修復檔，可重複執行。
-- 僅建立 P120 路徑判斷函式與 P120 專屬 Storage INSERT policy。

CREATE OR REPLACE FUNCTION public."P120CanUploadStorageObject"(p_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."TblP120File" AS f
    JOIN public."TblP120Transfer" AS t
      ON t."TransferID" = f."TransferID"
    WHERE f."StorageObjectPath" = p_object_name
      AND f."UploadStatus" = 'pending'
      AND t."Status" = 'uploading'
      AND t."UploadDeadlineAt" > now()
  );
$$;

COMMENT ON FUNCTION public."P120CanUploadStorageObject"(text)
  IS 'P120-only Storage INSERT guard; reveals only whether an unguessable pending object path is currently valid';

REVOKE ALL PRIVILEGES ON FUNCTION public."P120CanUploadStorageObject"(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public."P120CanUploadStorageObject"(text) TO anon, service_role;

DROP POLICY IF EXISTS "PolP120SignedUploadInsert" ON storage.objects;

CREATE POLICY "PolP120SignedUploadInsert"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (
  bucket_id = 'p120-temp-files'
  AND public."P120CanUploadStorageObject"(name)
);
