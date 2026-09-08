-- P120 專屬的原子式流量限制函式。
-- SECURITY DEFINER 僅操作 TblP120RateLimit，並鎖定 search_path。

CREATE OR REPLACE FUNCTION public."P120CheckRateLimit"(
  p_client_hash text,
  p_action_type text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public."TblP120RateLimit"%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_client_hash IS NULL OR char_length(p_client_hash) < 16 THEN
    RETURN false;
  END IF;
  IF p_action_type NOT IN ('create', 'lookup', 'download') THEN
    RETURN false;
  END IF;
  IF p_limit < 1 OR p_window_seconds < 1 THEN
    RETURN false;
  END IF;

  INSERT INTO public."TblP120RateLimit" (
    "ClientHash", "ActionType", "WindowStartedAt", "AttemptCount", "UpdatedAt"
  ) VALUES (
    p_client_hash, p_action_type, v_now, 0, v_now
  )
  ON CONFLICT ("ClientHash", "ActionType") DO NOTHING;

  SELECT * INTO v_row
  FROM public."TblP120RateLimit"
  WHERE "ClientHash" = p_client_hash AND "ActionType" = p_action_type
  FOR UPDATE;

  IF v_row."BlockedUntil" IS NOT NULL AND v_row."BlockedUntil" > v_now THEN
    RETURN false;
  END IF;

  IF v_row."WindowStartedAt" + make_interval(secs => p_window_seconds) <= v_now THEN
    UPDATE public."TblP120RateLimit"
    SET "WindowStartedAt" = v_now,
        "AttemptCount" = 1,
        "BlockedUntil" = NULL,
        "UpdatedAt" = v_now
    WHERE "ClientHash" = p_client_hash AND "ActionType" = p_action_type;
    RETURN true;
  END IF;

  IF v_row."AttemptCount" >= p_limit THEN
    UPDATE public."TblP120RateLimit"
    SET "BlockedUntil" = v_now + make_interval(secs => p_window_seconds),
        "UpdatedAt" = v_now
    WHERE "ClientHash" = p_client_hash AND "ActionType" = p_action_type;
    RETURN false;
  END IF;

  UPDATE public."TblP120RateLimit"
  SET "AttemptCount" = "AttemptCount" + 1,
      "UpdatedAt" = v_now
  WHERE "ClientHash" = p_client_hash AND "ActionType" = p_action_type;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public."P120CheckRateLimit"(text, text, integer, integer)
  IS 'P120-only atomic rate limiter; callable by service_role only';

-- Storage INSERT policy 專用判斷：只接受 Edge Function 已建立且仍在期限內的
-- P120 隨機物件路徑。SECURITY DEFINER 不回傳任何 transfer 或檔案資料。
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
