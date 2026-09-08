-- P120 權限修復檔。可重複執行，且只觸及 P120 明確列出的物件。

REVOKE ALL PRIVILEGES ON TABLE public."TblP120Transfer" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."TblP120File" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."TblP120RateLimit" FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."TblP120Transfer" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."TblP120File" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."TblP120RateLimit" TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public."P120CheckRateLimit"(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public."P120CheckRateLimit"(text, text, integer, integer) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public."P120CanUploadStorageObject"(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public."P120CanUploadStorageObject"(text) TO anon, service_role;

UPDATE storage.buckets
SET public = false,
    file_size_limit = 52428800,
    allowed_mime_types = NULL
WHERE id = 'p120-temp-files';
