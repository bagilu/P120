-- P120 唯讀健康檢查。所有檢查均限定 P120 物件。

SELECT 'TblP120Transfer exists' AS "CheckItem",
       (to_regclass('public."TblP120Transfer"') IS NOT NULL) AS "Passed";

SELECT 'TblP120File exists' AS "CheckItem",
       (to_regclass('public."TblP120File"') IS NOT NULL) AS "Passed";

SELECT 'TblP120RateLimit exists' AS "CheckItem",
       (to_regclass('public."TblP120RateLimit"') IS NOT NULL) AS "Passed";

SELECT c.relname AS "TableName", c.relrowsecurity AS "RlsEnabled", c.relforcerowsecurity AS "RlsForced"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('TblP120Transfer', 'TblP120File', 'TblP120RateLimit')
ORDER BY c.relname;

SELECT 'anon cannot read TblP120Transfer' AS "CheckItem",
       NOT has_table_privilege('anon', 'public."TblP120Transfer"', 'SELECT') AS "Passed";

SELECT 'authenticated cannot read TblP120Transfer' AS "CheckItem",
       NOT has_table_privilege('authenticated', 'public."TblP120Transfer"', 'SELECT') AS "Passed";

SELECT 'service_role can operate P120 transfer table' AS "CheckItem",
       has_table_privilege('service_role', 'public."TblP120Transfer"', 'SELECT, INSERT, UPDATE, DELETE') AS "Passed";

SELECT 'P120 bucket is private and 50 MiB' AS "CheckItem",
       EXISTS (
         SELECT 1 FROM storage.buckets
         WHERE id = 'p120-temp-files'
           AND public = false
           AND file_size_limit = 52428800
       ) AS "Passed";

SELECT 'No P120 anon/authenticated policies' AS "CheckItem",
       NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN ('TblP120Transfer', 'TblP120File', 'TblP120RateLimit')
           AND (roles @> ARRAY['anon']::name[] OR roles @> ARRAY['authenticated']::name[] OR roles @> ARRAY['public']::name[])
       ) AS "Passed";

SELECT 'P120CheckRateLimit exists' AS "CheckItem",
       (to_regprocedure('public."P120CheckRateLimit"(text,text,integer,integer)') IS NOT NULL) AS "Passed";

SELECT 'P120CanUploadStorageObject exists' AS "CheckItem",
       (to_regprocedure('public."P120CanUploadStorageObject"(text)') IS NOT NULL) AS "Passed";

SELECT 'P120 Storage INSERT policy is narrowly scoped' AS "CheckItem",
       EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname = 'storage'
           AND tablename = 'objects'
           AND policyname = 'PolP120SignedUploadInsert'
           AND cmd = 'INSERT'
           AND roles = ARRAY['anon']::name[]
           AND with_check LIKE '%p120-temp-files%'
           AND with_check LIKE '%P120CanUploadStorageObject%'
       ) AS "Passed";
