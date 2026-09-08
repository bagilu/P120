-- P120 專屬索引。

CREATE UNIQUE INDEX IF NOT EXISTS "UqP120TransferActiveRoomCode"
  ON public."TblP120Transfer" ("RoomCode")
  WHERE "RoomCode" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IxP120TransferStatusExpires"
  ON public."TblP120Transfer" ("Status", "ExpiresAt");

CREATE INDEX IF NOT EXISTS "IxP120TransferStatusUploadDeadline"
  ON public."TblP120Transfer" ("Status", "UploadDeadlineAt");

CREATE INDEX IF NOT EXISTS "IxP120TransferDeletedAt"
  ON public."TblP120Transfer" ("DeletedAt")
  WHERE "DeletedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IxP120FileTransfer"
  ON public."TblP120File" ("TransferID", "SortOrder");

CREATE INDEX IF NOT EXISTS "IxP120RateUpdatedAt"
  ON public."TblP120RateLimit" ("UpdatedAt");
