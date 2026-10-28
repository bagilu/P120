-- P120 V1.1.0：先建立分享空間，再共享文字與檔案。
-- 僅修改既有 P120 物件；可在 V1.0.8 基準上重複執行。

ALTER TABLE public."TblP120Transfer"
  ADD COLUMN IF NOT EXISTS "NoteText" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "NoteRevision" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "NoteUpdatedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "LastActivityAt" timestamptz NOT NULL DEFAULT now();

ALTER TABLE public."TblP120File"
  ADD COLUMN IF NOT EXISTS "UploadBatchID" uuid;

ALTER TABLE public."TblP120Transfer" DROP CONSTRAINT IF EXISTS "CkP120TransferFileCount";
ALTER TABLE public."TblP120Transfer" ADD CONSTRAINT "CkP120TransferFileCount" CHECK ("ExpectedFileCount" BETWEEN 0 AND 20);
ALTER TABLE public."TblP120Transfer" DROP CONSTRAINT IF EXISTS "CkP120TransferStatus";
ALTER TABLE public."TblP120Transfer" ADD CONSTRAINT "CkP120TransferStatus" CHECK ("Status" IN ('waiting','uploading','ready','expired','deleting','deleted','failed','cancelled'));
ALTER TABLE public."TblP120Transfer" DROP CONSTRAINT IF EXISTS "CkP120TransferReadyTimes";
ALTER TABLE public."TblP120Transfer" ADD CONSTRAINT "CkP120TransferReadyTimes" CHECK ("Status" <> 'ready' OR ("CompletedAt" IS NOT NULL AND "ExpiresAt" IS NOT NULL));
ALTER TABLE public."TblP120Transfer" DROP CONSTRAINT IF EXISTS "CkP120TransferNoteLength";
ALTER TABLE public."TblP120Transfer" ADD CONSTRAINT "CkP120TransferNoteLength" CHECK (char_length("NoteText") <= 5000);
ALTER TABLE public."TblP120RateLimit" DROP CONSTRAINT IF EXISTS "CkP120RateAction";
ALTER TABLE public."TblP120RateLimit" ADD CONSTRAINT "CkP120RateAction" CHECK ("ActionType" IN ('create','lookup','download','note','upload'));

CREATE INDEX IF NOT EXISTS "IxP120FileUploadBatch" ON public."TblP120File" ("UploadBatchID") WHERE "UploadBatchID" IS NOT NULL;

CREATE OR REPLACE FUNCTION public."P120CheckRateLimit"(p_client_hash text,p_action_type text,p_limit integer,p_window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public."TblP120RateLimit"%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_client_hash IS NULL OR char_length(p_client_hash)<16 OR p_action_type NOT IN ('create','lookup','download','note','upload') OR p_limit<1 OR p_window_seconds<1 THEN RETURN false; END IF;
  INSERT INTO public."TblP120RateLimit"("ClientHash","ActionType","WindowStartedAt","AttemptCount","UpdatedAt") VALUES(p_client_hash,p_action_type,v_now,0,v_now) ON CONFLICT("ClientHash","ActionType") DO NOTHING;
  SELECT "ClientHash","ActionType","WindowStartedAt","AttemptCount","BlockedUntil","UpdatedAt" INTO v_row FROM public."TblP120RateLimit" WHERE "ClientHash"=p_client_hash AND "ActionType"=p_action_type FOR UPDATE;
  IF v_row."BlockedUntil" IS NOT NULL AND v_row."BlockedUntil">v_now THEN RETURN false; END IF;
  IF v_row."WindowStartedAt"+make_interval(secs=>p_window_seconds)<=v_now THEN UPDATE public."TblP120RateLimit" SET "WindowStartedAt"=v_now,"AttemptCount"=1,"BlockedUntil"=NULL,"UpdatedAt"=v_now WHERE "ClientHash"=p_client_hash AND "ActionType"=p_action_type; RETURN true; END IF;
  IF v_row."AttemptCount">=p_limit THEN UPDATE public."TblP120RateLimit" SET "BlockedUntil"=v_now+make_interval(secs=>p_window_seconds),"UpdatedAt"=v_now WHERE "ClientHash"=p_client_hash AND "ActionType"=p_action_type; RETURN false; END IF;
  UPDATE public."TblP120RateLimit" SET "AttemptCount"="AttemptCount"+1,"UpdatedAt"=v_now WHERE "ClientHash"=p_client_hash AND "ActionType"=p_action_type; RETURN true;
END;$$;

CREATE OR REPLACE FUNCTION public."P120CanUploadStorageObject"(p_object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public."TblP120File" f JOIN public."TblP120Transfer" t ON t."TransferID"=f."TransferID" WHERE f."StorageObjectPath"=p_object_name AND f."UploadStatus"='pending' AND t."Status" IN ('waiting','ready') AND COALESCE(t."ExpiresAt",t."UploadDeadlineAt")>now());
$$;

CREATE OR REPLACE FUNCTION public."P120CreateRoom"(p_request_id uuid,p_token_hash text,p_room_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v public."TblP120Transfer"%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_request_id IS NULL OR p_token_hash IS NULL OR char_length(p_token_hash)<>64 OR p_room_code!~'^[0-9]{6}$' THEN RAISE EXCEPTION 'P120_BAD_REQUEST'; END IF;
  SELECT "TransferID","RequestID","RoomCode","UploadTokenHash","Status","ExpectedFileCount","DeclaredTotalBytes","ActualTotalBytes","CreatedAt","UploadDeadlineAt","CompletedAt","ExpiresAt","DeletedAt","LastErrorCode","NoteText","NoteRevision","NoteUpdatedAt","LastActivityAt" INTO v FROM public."TblP120Transfer" WHERE "RequestID"=p_request_id;
  IF FOUND THEN IF v."UploadTokenHash"<>p_token_hash THEN RAISE EXCEPTION 'P120_INVALID_TOKEN'; END IF; ELSE
    INSERT INTO public."TblP120Transfer"("TransferID","RequestID","RoomCode","UploadTokenHash","Status","ExpectedFileCount","DeclaredTotalBytes","ActualTotalBytes","CreatedAt","UploadDeadlineAt","LastActivityAt") VALUES(gen_random_uuid(),p_request_id,p_room_code,p_token_hash,'waiting',0,0,0,v_now,v_now+interval '5 minutes',v_now) RETURNING * INTO v;
  END IF;
  RETURN jsonb_build_object('roomCode',v."RoomCode",'noteText',v."NoteText",'noteRevision',v."NoteRevision",'expiresAt',v."ExpiresAt",'totalBytes',COALESCE(v."ActualTotalBytes",0),'files','[]'::jsonb);
END;$$;

CREATE OR REPLACE FUNCTION public."P120GetRoom"(p_room_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v public."TblP120Transfer"%ROWTYPE; v_files jsonb;
BEGIN
  SELECT "TransferID","RequestID","RoomCode","UploadTokenHash","Status","ExpectedFileCount","DeclaredTotalBytes","ActualTotalBytes","CreatedAt","UploadDeadlineAt","CompletedAt","ExpiresAt","DeletedAt","LastErrorCode","NoteText","NoteRevision","NoteUpdatedAt","LastActivityAt" INTO v FROM public."TblP120Transfer" WHERE "RoomCode"=p_room_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'P120_ROOM_NOT_FOUND'; END IF;
  IF (v."Status"='waiting' AND v."UploadDeadlineAt"<=now()) OR (v."Status"='ready' AND v."ExpiresAt"<=now()) THEN UPDATE public."TblP120Transfer" SET "Status"='expired' WHERE "TransferID"=v."TransferID"; RAISE EXCEPTION 'P120_ROOM_EXPIRED'; END IF;
  IF v."Status" NOT IN ('waiting','ready') THEN RAISE EXCEPTION 'P120_ROOM_EXPIRED'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('fileId',f."FileID",'name',f."OriginalFileName",'size',f."ActualBytes") ORDER BY f."SortOrder",f."CreatedAt"),'[]'::jsonb) INTO v_files FROM public."TblP120File" f WHERE f."TransferID"=v."TransferID" AND f."UploadStatus"='verified';
  RETURN jsonb_build_object('roomCode',v."RoomCode",'noteText',v."NoteText",'noteRevision',v."NoteRevision",'expiresAt',v."ExpiresAt",'totalBytes',COALESCE(v."ActualTotalBytes",0),'files',v_files);
END;$$;

CREATE OR REPLACE FUNCTION public."P120UpdateNote"(p_room_code text,p_note_text text,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v public."TblP120Transfer"%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_note_text IS NULL OR char_length(p_note_text)>5000 OR p_expected_revision<0 THEN RAISE EXCEPTION 'P120_BAD_REQUEST'; END IF;
  SELECT "TransferID","RequestID","RoomCode","UploadTokenHash","Status","ExpectedFileCount","DeclaredTotalBytes","ActualTotalBytes","CreatedAt","UploadDeadlineAt","CompletedAt","ExpiresAt","DeletedAt","LastErrorCode","NoteText","NoteRevision","NoteUpdatedAt","LastActivityAt" INTO v FROM public."TblP120Transfer" WHERE "RoomCode"=p_room_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P120_ROOM_NOT_FOUND'; END IF;
  IF (v."Status"='waiting' AND v."UploadDeadlineAt"<=v_now) OR (v."Status"='ready' AND v."ExpiresAt"<=v_now) OR v."Status" NOT IN ('waiting','ready') THEN RAISE EXCEPTION 'P120_ROOM_EXPIRED'; END IF;
  IF v."NoteRevision"<>p_expected_revision THEN RETURN jsonb_build_object('conflict',true,'noteText',v."NoteText",'noteRevision',v."NoteRevision",'expiresAt',v."ExpiresAt"); END IF;
  IF v."Status"='waiting' AND p_note_text<>'' THEN v."ExpiresAt":=v_now+interval '10 minutes'; v."Status":='ready'; END IF;
  UPDATE public."TblP120Transfer" SET "NoteText"=p_note_text,"NoteRevision"="NoteRevision"+1,"NoteUpdatedAt"=v_now,"LastActivityAt"=v_now,"Status"=v."Status","CompletedAt"=CASE WHEN v."Status"='ready' THEN COALESCE("CompletedAt",v_now) ELSE "CompletedAt" END,"ExpiresAt"=v."ExpiresAt","UploadDeadlineAt"=CASE WHEN v."Status"='ready' THEN v."ExpiresAt" ELSE "UploadDeadlineAt" END WHERE "TransferID"=v."TransferID" RETURNING "NoteRevision","ExpiresAt" INTO v."NoteRevision",v."ExpiresAt";
  RETURN jsonb_build_object('conflict',false,'noteText',p_note_text,'noteRevision',v."NoteRevision",'expiresAt',v."ExpiresAt");
END;$$;

CREATE OR REPLACE FUNCTION public."P120PrepareUpload"(p_room_code text,p_upload_id uuid,p_files jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v public."TblP120Transfer"%ROWTYPE; item jsonb; v_count int; v_start int; v_bytes bigint; v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_upload_id IS NULL OR jsonb_typeof(p_files)<>'array' OR jsonb_array_length(p_files)<1 OR jsonb_array_length(p_files)>20 THEN RAISE EXCEPTION 'P120_BAD_REQUEST'; END IF;
  SELECT "TransferID","RequestID","RoomCode","UploadTokenHash","Status","ExpectedFileCount","DeclaredTotalBytes","ActualTotalBytes","CreatedAt","UploadDeadlineAt","CompletedAt","ExpiresAt","DeletedAt","LastErrorCode","NoteText","NoteRevision","NoteUpdatedAt","LastActivityAt" INTO v FROM public."TblP120Transfer" WHERE "RoomCode"=p_room_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P120_ROOM_NOT_FOUND'; END IF;
  IF (v."Status"='waiting' AND v."UploadDeadlineAt"<=v_now) OR (v."Status"='ready' AND v."ExpiresAt"<=v_now) OR v."Status" NOT IN ('waiting','ready') THEN RAISE EXCEPTION 'P120_ROOM_EXPIRED'; END IF;
  SELECT count(*),COALESCE(max("SortOrder")+1,0),COALESCE(sum("DeclaredBytes"),0) INTO v_count,v_start,v_bytes FROM public."TblP120File" WHERE "TransferID"=v."TransferID" AND "UploadStatus"<>'deleted';
  IF v_count+jsonb_array_length(p_files)>20 OR v_start+jsonb_array_length(p_files)>20 THEN RAISE EXCEPTION 'P120_FILE_LIMIT'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_files) LOOP
    IF (item->>'fileId')::uuid IS NULL OR char_length(item->>'name') NOT BETWEEN 1 AND 200 OR (item->>'size')::bigint NOT BETWEEN 0 AND 52428800 OR item->>'path' IS NULL THEN RAISE EXCEPTION 'P120_BAD_REQUEST'; END IF;
    v_bytes:=v_bytes+(item->>'size')::bigint; IF v_bytes>104857600 THEN RAISE EXCEPTION 'P120_TOTAL_TOO_LARGE'; END IF;
    INSERT INTO public."TblP120File"("FileID","TransferID","SortOrder","OriginalFileName","StorageObjectPath","MimeType","DeclaredBytes","UploadStatus","UploadBatchID") VALUES((item->>'fileId')::uuid,v."TransferID",v_start+(item->>'sortOrder')::smallint,item->>'name',item->>'path',left(COALESCE(item->>'type','application/octet-stream'),200),(item->>'size')::bigint,'pending',p_upload_id);
  END LOOP;
  IF v."Status"='waiting' THEN v."Status":='ready'; v."ExpiresAt":=v_now+interval '10 minutes'; END IF;
  UPDATE public."TblP120Transfer" SET "Status"=v."Status","ExpectedFileCount"=(SELECT count(*) FROM public."TblP120File" WHERE "TransferID"=v."TransferID" AND "UploadStatus"<>'deleted'),"DeclaredTotalBytes"=v_bytes,"CompletedAt"=COALESCE("CompletedAt",v_now),"ExpiresAt"=v."ExpiresAt","UploadDeadlineAt"=v."ExpiresAt","LastActivityAt"=v_now WHERE "TransferID"=v."TransferID";
  RETURN jsonb_build_object('expiresAt',v."ExpiresAt");
END;$$;

CREATE OR REPLACE FUNCTION public."P120CompleteUpload"(p_room_code text,p_upload_id uuid,p_verified jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v public."TblP120Transfer"%ROWTYPE; item jsonb; v_file public."TblP120File"%ROWTYPE; v_total bigint; v_count int; v_batch_count int; v_now timestamptz:=clock_timestamp();
BEGIN
  IF jsonb_typeof(p_verified)<>'array' OR jsonb_array_length(p_verified)<1 THEN RAISE EXCEPTION 'P120_BAD_REQUEST'; END IF;
  SELECT "TransferID","RequestID","RoomCode","UploadTokenHash","Status","ExpectedFileCount","DeclaredTotalBytes","ActualTotalBytes","CreatedAt","UploadDeadlineAt","CompletedAt","ExpiresAt","DeletedAt","LastErrorCode","NoteText","NoteRevision","NoteUpdatedAt","LastActivityAt" INTO v FROM public."TblP120Transfer" WHERE "RoomCode"=p_room_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P120_ROOM_NOT_FOUND'; END IF; IF v."Status"<>'ready' OR v."ExpiresAt"<=v_now THEN RAISE EXCEPTION 'P120_ROOM_EXPIRED'; END IF;
  SELECT count(*) INTO v_batch_count FROM public."TblP120File" WHERE "TransferID"=v."TransferID" AND "UploadBatchID"=p_upload_id AND "UploadStatus"='pending';
  IF v_batch_count<>jsonb_array_length(p_verified) THEN RAISE EXCEPTION 'P120_UPLOAD_INCOMPLETE'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_verified) LOOP
    SELECT "FileID","TransferID","SortOrder","OriginalFileName","StorageObjectPath","MimeType","DeclaredBytes","ActualBytes","UploadStatus","CreatedAt","UploadBatchID" INTO v_file FROM public."TblP120File" WHERE "FileID"=(item->>'fileId')::uuid AND "TransferID"=v."TransferID" AND "UploadBatchID"=p_upload_id FOR UPDATE;
    IF NOT FOUND OR v_file."UploadStatus"<>'pending' OR (item->>'actualBytes')::bigint NOT BETWEEN 0 AND 52428800 THEN RAISE EXCEPTION 'P120_UPLOAD_INCOMPLETE'; END IF;
    UPDATE public."TblP120File" SET "ActualBytes"=(item->>'actualBytes')::bigint,"UploadStatus"='verified' WHERE "FileID"=v_file."FileID";
  END LOOP;
  SELECT count(*),COALESCE(sum("ActualBytes"),0) INTO v_count,v_total FROM public."TblP120File" WHERE "TransferID"=v."TransferID" AND "UploadStatus"='verified'; IF v_total>104857600 THEN RAISE EXCEPTION 'P120_TOTAL_TOO_LARGE'; END IF;
  UPDATE public."TblP120Transfer" SET "ActualTotalBytes"=v_total,"LastActivityAt"=v_now WHERE "TransferID"=v."TransferID";
  RETURN jsonb_build_object('roomCode',v."RoomCode",'expiresAt',v."ExpiresAt",'totalBytes',v_total,'fileCount',v_count);
END;$$;

CREATE OR REPLACE FUNCTION public."P120CancelUpload"(p_room_code text,p_upload_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN SELECT "TransferID" INTO v_id FROM public."TblP120Transfer" WHERE "RoomCode"=p_room_code AND "Status" IN ('waiting','ready'); IF NOT FOUND THEN RETURN false; END IF; DELETE FROM public."TblP120File" WHERE "TransferID"=v_id AND "UploadBatchID"=p_upload_id AND "UploadStatus"='pending'; UPDATE public."TblP120Transfer" SET "ExpectedFileCount"=(SELECT count(*) FROM public."TblP120File" WHERE "TransferID"=v_id AND "UploadStatus"<>'deleted'),"DeclaredTotalBytes"=(SELECT COALESCE(sum("DeclaredBytes"),0) FROM public."TblP120File" WHERE "TransferID"=v_id AND "UploadStatus"<>'deleted') WHERE "TransferID"=v_id; RETURN true; END;$$;

CREATE OR REPLACE FUNCTION public."P120GetDownloadFile"(p_room_code text,p_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v public."TblP120Transfer"%ROWTYPE; f public."TblP120File"%ROWTYPE;
BEGIN SELECT "TransferID","RequestID","RoomCode","UploadTokenHash","Status","ExpectedFileCount","DeclaredTotalBytes","ActualTotalBytes","CreatedAt","UploadDeadlineAt","CompletedAt","ExpiresAt","DeletedAt","LastErrorCode","NoteText","NoteRevision","NoteUpdatedAt","LastActivityAt" INTO v FROM public."TblP120Transfer" WHERE "RoomCode"=p_room_code; IF NOT FOUND THEN RAISE EXCEPTION 'P120_ROOM_NOT_FOUND'; END IF; IF v."Status"<>'ready' OR v."ExpiresAt"<=now() THEN RAISE EXCEPTION 'P120_ROOM_EXPIRED'; END IF; SELECT "FileID","TransferID","SortOrder","OriginalFileName","StorageObjectPath","MimeType","DeclaredBytes","ActualBytes","UploadStatus","CreatedAt","UploadBatchID" INTO f FROM public."TblP120File" WHERE "FileID"=p_file_id AND "TransferID"=v."TransferID" AND "UploadStatus"='verified'; IF NOT FOUND THEN RAISE EXCEPTION 'P120_FILE_NOT_FOUND'; END IF; RETURN jsonb_build_object('name',f."OriginalFileName",'path',f."StorageObjectPath",'expiresAt',v."ExpiresAt"); END;$$;

CREATE OR REPLACE FUNCTION public."P120ListCleanupRooms"(p_limit integer DEFAULT 10)
RETURNS TABLE("TransferID" uuid,"Status" text,"DeletedAt" timestamptz) LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT t."TransferID",t."Status",t."DeletedAt" FROM public."TblP120Transfer" t WHERE (t."Status"='waiting' AND t."UploadDeadlineAt"<=now()) OR (t."Status"='ready' AND t."ExpiresAt"<=now()) OR t."Status" IN ('expired','failed','cancelled','deleting') OR (t."Status"='deleted' AND t."DeletedAt">=now()-interval '3 hours') ORDER BY t."CreatedAt" LIMIT LEAST(GREATEST(p_limit,1),20);
$$;
CREATE OR REPLACE FUNCTION public."P120ListRoomObjects"(p_transfer_id uuid)
RETURNS TABLE("StorageObjectPath" text) LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT f."StorageObjectPath" FROM public."TblP120File" f WHERE f."TransferID"=p_transfer_id; $$;
CREATE OR REPLACE FUNCTION public."P120FinalizeRoomDelete"(p_transfer_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$ BEGIN UPDATE public."TblP120File" SET "UploadStatus"='deleted' WHERE "TransferID"=p_transfer_id; UPDATE public."TblP120Transfer" SET "Status"='deleted',"RoomCode"=NULL,"DeletedAt"=COALESCE("DeletedAt",now()),"LastErrorCode"=NULL WHERE "TransferID"=p_transfer_id; RETURN FOUND; END;$$;
CREATE OR REPLACE FUNCTION public."P120PurgeDeletedRooms"()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$ DECLARE n integer; BEGIN DELETE FROM public."TblP120Transfer" WHERE "Status"='deleted' AND "DeletedAt"<now()-interval '3 hours'; GET DIAGNOSTICS n=ROW_COUNT; RETURN n; END;$$;

REVOKE ALL PRIVILEGES ON FUNCTION public."P120CreateRoom"(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120GetRoom"(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120UpdateNote"(text,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120PrepareUpload"(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120CompleteUpload"(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120CancelUpload"(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120GetDownloadFile"(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120ListCleanupRooms"(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120ListRoomObjects"(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120FinalizeRoomDelete"(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public."P120PurgeDeletedRooms"() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public."P120CreateRoom"(uuid,text,text),public."P120GetRoom"(text),public."P120UpdateNote"(text,text,bigint),public."P120PrepareUpload"(text,uuid,jsonb),public."P120CompleteUpload"(text,uuid,jsonb),public."P120CancelUpload"(text,uuid),public."P120GetDownloadFile"(text,uuid),public."P120ListCleanupRooms"(integer),public."P120ListRoomObjects"(uuid),public."P120FinalizeRoomDelete"(uuid),public."P120PurgeDeletedRooms"() TO service_role;
