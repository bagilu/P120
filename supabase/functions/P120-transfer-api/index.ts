import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "p120-temp-files";
const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const UPLOAD_WINDOW_MS = 30 * 60 * 1000;
const ROOM_LIFETIME_MS = 10 * 60 * 1000;
const TOMBSTONE_MS = 3 * 60 * 60 * 1000;
const CLEANUP_BATCH = 10;
const OFFICIAL_GITHUB_ORIGIN = "https://bagilu.github.io";

const ERROR_MESSAGES = Object.freeze({
  BAD_REQUEST: "請求內容不正確。",
  CONFIG_ERROR: "服務尚未完成設定。",
  RATE_LIMITED: "嘗試次數過多，請稍後再試。",
  ROOM_NOT_FOUND: "找不到此檔案房間，請確認六位數房間碼。",
  ROOM_NOT_READY: "檔案仍在準備中，請稍後再試。",
  ROOM_EXPIRED: "此檔案房間已超過 10 分鐘，無法再下載。",
  UPLOAD_EXPIRED: "此次上傳已超過準備時間，請重新建立房間。",
  UPLOAD_INCOMPLETE: "部分檔案尚未完成上傳，請重試後再確認。",
  INVALID_TOKEN: "無法驗證此次上傳。",
  FILE_NOT_FOUND: "找不到指定檔案。",
  FILE_LIMIT: "一次最多傳送 20 個檔案。",
  FILE_TOO_LARGE: "單一檔案不得超過 50 MB。",
  TOTAL_TOO_LARGE: "檔案合計不得超過 100 MB。",
  STORAGE_ERROR: "檔案儲存服務暫時無法使用，請稍後再試。",
  INTERNAL_ERROR: "服務暫時無法使用，請稍後再試。"
});

class AppError extends Error {
  constructor(code, status = 400, message = null) {
    super(message || ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR);
    this.code = code;
    this.status = status;
  }
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

function getAllowedOrigins() {
  const configured = (Deno.env.get("P120_ALLOWED_ORIGINS") || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  // 正式 GitHub Pages Origin 永遠保留；自訂 secret 只能增加來源，不會誤覆寫正式站。
  return [...new Set([OFFICIAL_GITHUB_ORIGIN, ...configured])];
}

function getConfig(allowedOrigins) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // P120 的正式 GitHub Pages 網域可直接運作；其他網域以 secret 增加。
  const rateSalt = Deno.env.get("P120_RATE_LIMIT_SALT") || serviceKey || "";
  if (!url || !serviceKey || !rateSalt || !allowedOrigins.length) {
    throw new AppError("CONFIG_ERROR", 503);
  }
  return { url, serviceKey, rateSalt, allowedOrigins };
}

function corsHeaders(origin, allowedOrigins, exposeRejectedError = false) {
  const normalized = normalizeOrigin(origin);
  const allowed = normalized && allowedOrigins.includes(normalized);
  return {
    "Access-Control-Allow-Origin": allowed || exposeRejectedError ? (normalized || "null") : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}

function safeErrorResponse(error, cors) {
  if (error instanceof AppError) {
    return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status, cors);
  }
  console.error("P120_UNEXPECTED", error instanceof Error ? error.message : "unknown");
  return jsonResponse({ ok: false, error: { code: "INTERNAL_ERROR", message: ERROR_MESSAGES.INTERNAL_ERROR } }, 500, cors);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function requestIp(request) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
}

async function enforceRateLimit(supabase, request, config, actionType) {
  const settings = {
    create: { limit: 10, seconds: 600 },
    lookup: { limit: 20, seconds: 300 },
    download: { limit: 80, seconds: 300 }
  }[actionType];
  if (!settings) throw new AppError("BAD_REQUEST");
  const clientHash = await sha256(`${config.rateSalt}:${requestIp(request)}`);
  const { data, error } = await supabase.rpc("P120CheckRateLimit", {
    p_client_hash: clientHash,
    p_action_type: actionType,
    p_limit: settings.limit,
    p_window_seconds: settings.seconds
  });
  if (error) throw new AppError("INTERNAL_ERROR", 500);
  if (data !== true) throw new AppError("RATE_LIMITED", 429);
}

function randomRoomCode() {
  const range = 1_000_000;
  const ceiling = 0x1_0000_0000 - (0x1_0000_0000 % range);
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= ceiling);
  return String(buffer[0] % range).padStart(6, "0");
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeRoomCode(value) {
  const code = String(value || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) throw new AppError("BAD_REQUEST");
  return code;
}

function sanitizeFileName(value) {
  const name = String(value || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f\r\n]/g, "")
    .trim();
  if (!name || Array.from(name).length > 200) throw new AppError("BAD_REQUEST", 400, "檔名不可空白或超過 200 個字元。");
  return name;
}

function validateManifest(files) {
  if (!Array.isArray(files) || files.length < 1) throw new AppError("BAD_REQUEST");
  if (files.length > MAX_FILES) throw new AppError("FILE_LIMIT");
  const normalized = files.map((file, index) => {
    const size = Number(file?.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new AppError("BAD_REQUEST");
    if (size > MAX_FILE_BYTES) throw new AppError("FILE_TOO_LARGE");
    return {
      sortOrder: index,
      name: sanitizeFileName(file?.name),
      type: String(file?.type || "application/octet-stream").slice(0, 200),
      size
    };
  });
  const total = normalized.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new AppError("TOTAL_TOO_LARGE");
  return { files: normalized, total };
}

async function removeTransferObjects(supabase, transfer) {
  const { data: files, error: fileError } = await supabase
    .from("TblP120File")
    .select("FileID,StorageObjectPath")
    .eq("TransferID", transfer.TransferID);
  if (fileError) return false;
  const paths = (files || []).map((file) => file.StorageObjectPath);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    if (storageError) {
      await supabase.from("TblP120Transfer").update({ LastErrorCode: "STORAGE_DELETE_FAILED" }).eq("TransferID", transfer.TransferID);
      return false;
    }
  }
  if (files?.length) {
    await supabase.from("TblP120File").update({ UploadStatus: "deleted" }).eq("TransferID", transfer.TransferID);
  }
  const now = new Date().toISOString();
  await supabase.from("TblP120Transfer").update({
    Status: "deleted",
    RoomCode: null,
    DeletedAt: transfer.DeletedAt || now,
    LastErrorCode: null
  }).eq("TransferID", transfer.TransferID);
  return true;
}

async function cleanupExpired(supabase) {
  const now = new Date().toISOString();
  const [readyResult, uploadResult, retryResult, tombstoneResult, rateResult] = await Promise.all([
    supabase.from("TblP120Transfer").select("TransferID,Status,DeletedAt").eq("Status", "ready").lte("ExpiresAt", now).limit(CLEANUP_BATCH),
    supabase.from("TblP120Transfer").select("TransferID,Status,DeletedAt").eq("Status", "uploading").lte("UploadDeadlineAt", now).limit(CLEANUP_BATCH),
    supabase.from("TblP120Transfer").select("TransferID,Status,DeletedAt").in("Status", ["expired", "failed", "cancelled", "deleting"]).limit(CLEANUP_BATCH),
    supabase.from("TblP120Transfer").select("TransferID,Status,DeletedAt").eq("Status", "deleted").gte("DeletedAt", new Date(Date.now() - TOMBSTONE_MS).toISOString()).limit(3),
    supabase.from("TblP120RateLimit").delete().lt("UpdatedAt", new Date(Date.now() - 30 * 60 * 1000).toISOString())
  ]);
  void rateResult;
  const candidates = new Map();
  for (const result of [readyResult, uploadResult, retryResult, tombstoneResult]) {
    for (const transfer of result.data || []) candidates.set(transfer.TransferID, transfer);
  }
  for (const transfer of [...candidates.values()].slice(0, CLEANUP_BATCH)) {
    if (transfer.Status !== "deleted") {
      await supabase.from("TblP120Transfer").update({ Status: "deleting" }).eq("TransferID", transfer.TransferID).neq("Status", "ready");
    }
    await removeTransferObjects(supabase, transfer);
  }

  const purgeBefore = new Date(Date.now() - TOMBSTONE_MS).toISOString();
  const { data: purgeRows } = await supabase
    .from("TblP120Transfer")
    .select("TransferID,Status,DeletedAt")
    .eq("Status", "deleted")
    .lt("DeletedAt", purgeBefore)
    .limit(CLEANUP_BATCH);
  for (const transfer of purgeRows || []) {
    await removeTransferObjects(supabase, transfer);
    await supabase.from("TblP120Transfer").delete().eq("TransferID", transfer.TransferID).eq("Status", "deleted");
  }
}

async function verifyManagementToken(transfer, managementToken) {
  if (typeof managementToken !== "string" || managementToken.length < 40) throw new AppError("INVALID_TOKEN", 403);
  const tokenHash = await sha256(managementToken);
  if (!constantTimeEqual(tokenHash, transfer.UploadTokenHash)) throw new AppError("INVALID_TOKEN", 403);
}

async function issueUploadTokens(supabase, transfer) {
  const { data: files, error } = await supabase
    .from("TblP120File")
    .select("FileID,SortOrder,StorageObjectPath")
    .eq("TransferID", transfer.TransferID)
    .order("SortOrder");
  if (error || !files?.length) throw new AppError("INTERNAL_ERROR", 500);
  const uploads = [];
  for (const file of files) {
    const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(file.StorageObjectPath, { upsert: false });
    if (signedError || !data?.token) throw new AppError("STORAGE_ERROR", 503);
    uploads.push({ fileId: file.FileID, sortOrder: file.SortOrder, path: file.StorageObjectPath, signedToken: data.token });
  }
  return {
    transferId: transfer.TransferID,
    roomCode: transfer.RoomCode,
    uploadDeadlineAt: transfer.UploadDeadlineAt,
    uploads
  };
}

async function createTransfer(supabase, payload) {
  if (!validUuid(payload.clientRequestId)) throw new AppError("BAD_REQUEST");
  if (typeof payload.managementToken !== "string" || payload.managementToken.length < 40) throw new AppError("BAD_REQUEST");
  const manifest = validateManifest(payload.files);
  const tokenHash = await sha256(payload.managementToken);

  const { data: existing } = await supabase
    .from("TblP120Transfer")
    .select("TransferID,RoomCode,UploadTokenHash,Status,UploadDeadlineAt")
    .eq("RequestID", payload.clientRequestId)
    .maybeSingle();
  if (existing) {
    if (!constantTimeEqual(existing.UploadTokenHash, tokenHash)) throw new AppError("INVALID_TOKEN", 403);
    if (existing.Status !== "uploading" || new Date(existing.UploadDeadlineAt).getTime() <= Date.now()) throw new AppError("UPLOAD_EXPIRED", 410);
    return issueUploadTokens(supabase, existing);
  }

  const transferId = crypto.randomUUID();
  const createdAt = new Date();
  const uploadDeadlineAt = new Date(createdAt.getTime() + UPLOAD_WINDOW_MS).toISOString();
  let transfer = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const roomCode = randomRoomCode();
    const { data, error } = await supabase.from("TblP120Transfer").insert({
      TransferID: transferId,
      RequestID: payload.clientRequestId,
      RoomCode: roomCode,
      UploadTokenHash: tokenHash,
      Status: "uploading",
      ExpectedFileCount: manifest.files.length,
      DeclaredTotalBytes: manifest.total,
      CreatedAt: createdAt.toISOString(),
      UploadDeadlineAt: uploadDeadlineAt
    }).select("TransferID,RoomCode,Status,UploadDeadlineAt").single();
    if (!error) { transfer = data; break; }
    if (error.code !== "23505") throw new AppError("INTERNAL_ERROR", 500);
    const { data: concurrent } = await supabase
      .from("TblP120Transfer")
      .select("TransferID,RoomCode,UploadTokenHash,Status,UploadDeadlineAt")
      .eq("RequestID", payload.clientRequestId)
      .maybeSingle();
    if (concurrent) {
      if (!constantTimeEqual(concurrent.UploadTokenHash, tokenHash)) throw new AppError("INVALID_TOKEN", 403);
      if (concurrent.Status !== "uploading" || new Date(concurrent.UploadDeadlineAt).getTime() <= Date.now()) {
        throw new AppError("UPLOAD_EXPIRED", 410);
      }
      return issueUploadTokens(supabase, concurrent);
    }
  }
  if (!transfer) throw new AppError("INTERNAL_ERROR", 503);

  const fileRows = manifest.files.map((file) => {
    const fileId = crypto.randomUUID();
    return {
      FileID: fileId,
      TransferID: transferId,
      SortOrder: file.sortOrder,
      OriginalFileName: file.name,
      StorageObjectPath: `${transferId}/${fileId}`,
      MimeType: file.type,
      DeclaredBytes: file.size,
      UploadStatus: "pending"
    };
  });
  const { error: fileInsertError } = await supabase.from("TblP120File").insert(fileRows);
  if (fileInsertError) {
    await supabase.from("TblP120Transfer").delete().eq("TransferID", transferId);
    throw new AppError("INTERNAL_ERROR", 500);
  }
  return issueUploadTokens(supabase, transfer);
}

async function getTransferForManagement(supabase, transferId, managementToken) {
  if (!validUuid(transferId)) throw new AppError("BAD_REQUEST");
  const { data: transfer, error } = await supabase
    .from("TblP120Transfer")
    .select("*")
    .eq("TransferID", transferId)
    .maybeSingle();
  if (error || !transfer) throw new AppError("ROOM_NOT_FOUND", 404);
  await verifyManagementToken(transfer, managementToken);
  return transfer;
}

async function completeTransfer(supabase, payload) {
  const transfer = await getTransferForManagement(supabase, payload.transferId, payload.managementToken);
  if (transfer.Status === "ready") {
    return {
      transferId: transfer.TransferID,
      roomCode: transfer.RoomCode,
      fileCount: transfer.ExpectedFileCount,
      totalBytes: transfer.ActualTotalBytes,
      expiresAt: transfer.ExpiresAt
    };
  }
  if (transfer.Status !== "uploading") throw new AppError("UPLOAD_EXPIRED", 410);
  if (new Date(transfer.UploadDeadlineAt).getTime() <= Date.now()) throw new AppError("UPLOAD_EXPIRED", 410);

  const { data: files, error: fileError } = await supabase
    .from("TblP120File")
    .select("FileID,SortOrder,StorageObjectPath,DeclaredBytes")
    .eq("TransferID", transfer.TransferID)
    .order("SortOrder");
  if (fileError || files?.length !== transfer.ExpectedFileCount) throw new AppError("UPLOAD_INCOMPLETE", 409);

  const { data: objects, error: listError } = await supabase.storage.from(BUCKET).list(transfer.TransferID, {
    limit: MAX_FILES + 5,
    sortBy: { column: "name", order: "asc" }
  });
  if (listError) throw new AppError("STORAGE_ERROR", 503);
  const objectMap = new Map((objects || []).map((object) => [object.name, object]));
  if (objectMap.size !== files.length) throw new AppError("UPLOAD_INCOMPLETE", 409);

  let totalBytes = 0;
  const verified = [];
  for (const file of files) {
    const object = objectMap.get(file.FileID);
    const actualBytes = Number(object?.metadata?.size);
    if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) throw new AppError("UPLOAD_INCOMPLETE", 409);
    if (actualBytes > MAX_FILE_BYTES) {
      await supabase.from("TblP120Transfer").update({ Status: "failed", LastErrorCode: "FILE_TOO_LARGE" }).eq("TransferID", transfer.TransferID);
      await removeTransferObjects(supabase, transfer);
      throw new AppError("FILE_TOO_LARGE");
    }
    totalBytes += actualBytes;
    verified.push({ fileId: file.FileID, actualBytes });
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    await supabase.from("TblP120Transfer").update({ Status: "failed", LastErrorCode: "TOTAL_TOO_LARGE" }).eq("TransferID", transfer.TransferID);
    await removeTransferObjects(supabase, transfer);
    throw new AppError("TOTAL_TOO_LARGE");
  }

  for (const file of verified) {
    await supabase.from("TblP120File").update({ ActualBytes: file.actualBytes, UploadStatus: "verified" }).eq("FileID", file.fileId);
  }
  const completedAt = new Date();
  const expiresAt = new Date(completedAt.getTime() + ROOM_LIFETIME_MS);
  const { error: updateError } = await supabase.from("TblP120Transfer").update({
    Status: "ready",
    ActualTotalBytes: totalBytes,
    CompletedAt: completedAt.toISOString(),
    ExpiresAt: expiresAt.toISOString(),
    LastErrorCode: null
  }).eq("TransferID", transfer.TransferID).eq("Status", "uploading");
  if (updateError) throw new AppError("INTERNAL_ERROR", 500);

  return {
    transferId: transfer.TransferID,
    roomCode: transfer.RoomCode,
    fileCount: files.length,
    totalBytes,
    expiresAt: expiresAt.toISOString()
  };
}

async function findReadyRoom(supabase, rawRoomCode) {
  const roomCode = normalizeRoomCode(rawRoomCode);
  const { data: transfer, error } = await supabase
    .from("TblP120Transfer")
    .select("TransferID,RoomCode,Status,ExpiresAt")
    .eq("RoomCode", roomCode)
    .maybeSingle();
  if (error || !transfer) throw new AppError("ROOM_NOT_FOUND", 404);
  if (transfer.Status === "uploading") throw new AppError("ROOM_NOT_READY", 409);
  if (transfer.Status !== "ready" || !transfer.ExpiresAt || new Date(transfer.ExpiresAt).getTime() <= Date.now()) {
    if (transfer.Status === "ready") await supabase.from("TblP120Transfer").update({ Status: "expired" }).eq("TransferID", transfer.TransferID).eq("Status", "ready");
    throw new AppError("ROOM_EXPIRED", 410);
  }
  return transfer;
}

async function lookupTransfer(supabase, payload) {
  const transfer = await findReadyRoom(supabase, payload.roomCode);
  const { data: files, error } = await supabase
    .from("TblP120File")
    .select("FileID,OriginalFileName,ActualBytes,SortOrder")
    .eq("TransferID", transfer.TransferID)
    .eq("UploadStatus", "verified")
    .order("SortOrder");
  if (error) throw new AppError("INTERNAL_ERROR", 500);
  return {
    roomCode: transfer.RoomCode,
    expiresAt: transfer.ExpiresAt,
    remainingSeconds: Math.max(0, Math.floor((new Date(transfer.ExpiresAt).getTime() - Date.now()) / 1000)),
    files: (files || []).map((file) => ({ fileId: file.FileID, name: file.OriginalFileName, size: file.ActualBytes }))
  };
}

async function createDownloadUrl(supabase, payload) {
  const transfer = await findReadyRoom(supabase, payload.roomCode);
  if (!validUuid(payload.fileId)) throw new AppError("BAD_REQUEST");
  const { data: file, error } = await supabase
    .from("TblP120File")
    .select("FileID,OriginalFileName,StorageObjectPath")
    .eq("FileID", payload.fileId)
    .eq("TransferID", transfer.TransferID)
    .eq("UploadStatus", "verified")
    .maybeSingle();
  if (error || !file) throw new AppError("FILE_NOT_FOUND", 404);
  const remainingSeconds = Math.floor((new Date(transfer.ExpiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds < 1) throw new AppError("ROOM_EXPIRED", 410);
  const downloadName = sanitizeFileName(file.OriginalFileName);
  const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(
    file.StorageObjectPath,
    remainingSeconds,
    { download: downloadName }
  );
  if (signedError || !data?.signedUrl) throw new AppError("STORAGE_ERROR", 503);
  return { downloadUrl: data.signedUrl, expiresIn: remainingSeconds };
}

async function cancelTransfer(supabase, payload) {
  const transfer = await getTransferForManagement(supabase, payload.transferId, payload.managementToken);
  if (["deleted", "deleting"].includes(transfer.Status)) return { cancelled: true };
  await supabase.from("TblP120Transfer").update({ Status: "cancelled" }).eq("TransferID", transfer.TransferID);
  await removeTransferObjects(supabase, transfer);
  return { cancelled: true };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = getAllowedOrigins();
  const cors = corsHeaders(origin, allowedOrigins);
  let config;
  try { config = getConfig(allowedOrigins); } catch (error) {
    return safeErrorResponse(error, corsHeaders(origin, allowedOrigins, true));
  }

  if (request.method === "OPTIONS") {
    if (origin && cors["Access-Control-Allow-Origin"] === "null") {
      return jsonResponse(
        { ok: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "此網站來源未獲允許。" } },
        403,
        corsHeaders(origin, allowedOrigins, true)
      );
    }
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") return jsonResponse({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "僅接受 POST 請求。" } }, 405, cors);
  if (origin && cors["Access-Control-Allow-Origin"] === "null") {
    return jsonResponse(
      { ok: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "此網站來源未獲允許。" } },
      403,
      corsHeaders(origin, allowedOrigins, true)
    );
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 65536) return safeErrorResponse(new AppError("BAD_REQUEST", 413), cors);

  try {
    let payload;
    try { payload = await request.json(); } catch { throw new AppError("BAD_REQUEST"); }
    const action = payload?.action;
    const supabase = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    if (["create-transfer", "lookup-transfer"].includes(action)) await cleanupExpired(supabase);

    let data;
    switch (action) {
      case "create-transfer":
        await enforceRateLimit(supabase, request, config, "create");
        data = await createTransfer(supabase, payload);
        break;
      case "complete-transfer":
        data = await completeTransfer(supabase, payload);
        break;
      case "cancel-transfer":
        data = await cancelTransfer(supabase, payload);
        break;
      case "lookup-transfer":
        await enforceRateLimit(supabase, request, config, "lookup");
        data = await lookupTransfer(supabase, payload);
        break;
      case "create-download-url":
        await enforceRateLimit(supabase, request, config, "download");
        data = await createDownloadUrl(supabase, payload);
        break;
      default:
        throw new AppError("BAD_REQUEST");
    }
    return jsonResponse({ ok: true, data }, 200, cors);
  } catch (error) {
    return safeErrorResponse(error, cors);
  }
});
