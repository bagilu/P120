-- 僅撤銷 P120 物件的直接權限；不使用 ALL TABLES IN SCHEMA 或 ALTER DEFAULT PRIVILEGES。

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
