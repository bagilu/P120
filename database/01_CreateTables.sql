-- P120 檔案快遞 V1.0
-- 僅建立 TblP120... 物件，不修改其他專案。

CREATE TABLE IF NOT EXISTS public."TblP120Transfer" (
  "TransferID" uuid PRIMARY KEY,
  "RequestID" uuid NOT NULL UNIQUE,
  "RoomCode" char(6),
  "UploadTokenHash" text NOT NULL,
  "Status" text NOT NULL DEFAULT 'uploading',
  "ExpectedFileCount" smallint NOT NULL,
  "DeclaredTotalBytes" bigint NOT NULL,
  "ActualTotalBytes" bigint,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "UploadDeadlineAt" timestamptz NOT NULL,
  "CompletedAt" timestamptz,
  "ExpiresAt" timestamptz,
  "DeletedAt" timestamptz,
  "LastErrorCode" text,
  CONSTRAINT "CkP120TransferRoomCode" CHECK ("RoomCode" IS NULL OR "RoomCode" ~ '^[0-9]{6}$'),
  CONSTRAINT "CkP120TransferStatus" CHECK ("Status" IN ('uploading', 'ready', 'expired', 'deleting', 'deleted', 'failed', 'cancelled')),
  CONSTRAINT "CkP120TransferFileCount" CHECK ("ExpectedFileCount" BETWEEN 1 AND 20),
  CONSTRAINT "CkP120TransferDeclaredBytes" CHECK ("DeclaredTotalBytes" BETWEEN 0 AND 104857600),
  CONSTRAINT "CkP120TransferActualBytes" CHECK ("ActualTotalBytes" IS NULL OR "ActualTotalBytes" BETWEEN 0 AND 104857600),
  CONSTRAINT "CkP120TransferReadyTimes" CHECK ("Status" <> 'ready' OR ("CompletedAt" IS NOT NULL AND "ExpiresAt" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public."TblP120File" (
  "FileID" uuid PRIMARY KEY,
  "TransferID" uuid NOT NULL REFERENCES public."TblP120Transfer"("TransferID") ON DELETE CASCADE,
  "SortOrder" smallint NOT NULL,
  "OriginalFileName" text NOT NULL,
  "StorageObjectPath" text NOT NULL UNIQUE,
  "MimeType" text,
  "DeclaredBytes" bigint NOT NULL,
  "ActualBytes" bigint,
  "UploadStatus" text NOT NULL DEFAULT 'pending',
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UqP120FileTransferOrder" UNIQUE ("TransferID", "SortOrder"),
  CONSTRAINT "CkP120FileSortOrder" CHECK ("SortOrder" BETWEEN 0 AND 19),
  CONSTRAINT "CkP120FileNameLength" CHECK (char_length("OriginalFileName") BETWEEN 1 AND 200),
  CONSTRAINT "CkP120FileDeclaredBytes" CHECK ("DeclaredBytes" BETWEEN 0 AND 52428800),
  CONSTRAINT "CkP120FileActualBytes" CHECK ("ActualBytes" IS NULL OR "ActualBytes" BETWEEN 0 AND 52428800),
  CONSTRAINT "CkP120FileUploadStatus" CHECK ("UploadStatus" IN ('pending', 'uploaded', 'verified', 'failed', 'deleted'))
);

CREATE TABLE IF NOT EXISTS public."TblP120RateLimit" (
  "ClientHash" text NOT NULL,
  "ActionType" text NOT NULL,
  "WindowStartedAt" timestamptz NOT NULL DEFAULT now(),
  "AttemptCount" integer NOT NULL DEFAULT 0,
  "BlockedUntil" timestamptz,
  "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("ClientHash", "ActionType"),
  CONSTRAINT "CkP120RateAction" CHECK ("ActionType" IN ('create', 'lookup', 'download')),
  CONSTRAINT "CkP120RateCount" CHECK ("AttemptCount" >= 0)
);

COMMENT ON TABLE public."TblP120Transfer" IS 'P120 short-lived transfer rooms only';
COMMENT ON TABLE public."TblP120File" IS 'P120 temporary file metadata only';
COMMENT ON TABLE public."TblP120RateLimit" IS 'P120 short-lived abuse-prevention counters only';
