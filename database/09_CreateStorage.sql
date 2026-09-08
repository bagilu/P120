-- 建立／校正 P120 專屬 private bucket。
-- ON CONFLICT 僅能更新 id = p120-temp-files 的單一 P120 bucket。

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('p120-temp-files', 'p120-temp-files', false, 52428800, NULL)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 52428800,
    allowed_mime_types = NULL;

-- 不建立 anon/authenticated Storage policy。
-- Signed upload/download URL 由 P120-transfer-api 以 service_role 產生。
