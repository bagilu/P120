export class P120ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "P120ApiError";
    this.code = code;
    this.status = status;
  }
}

export class P120Api {
  constructor(config) {
    this.config = config;
    this.functionUrl = `${config.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${config.EDGE_FUNCTION_NAME}`;
    this.storage = window.supabase
      .createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      })
      .storage
      .from(config.STORAGE_BUCKET);
  }

  async request(action, payload = {}) {
    let response;
    try {
      response = await fetch(this.functionUrl, {
        method: "POST",
        // Function 已設定為公開入口，授權由 P120 的房間碼、管理 token、
        // 短效期限與 rate limit 負責。使用 simple request 可避免瀏覽器的
        // CORS preflight 被 Supabase gateway 誤擋，亦相容新版 publishable key。
        body: JSON.stringify({ action, ...payload })
      });
    } catch {
      throw new P120ApiError("NETWORK_ERROR", "無法連接檔案服務。請確認 P120-transfer-api 已部署、JWT 驗證已關閉，且網站網域已列入允許來源。");
    }

    let body = null;
    try { body = await response.json(); } catch { /* 由下方產生安全訊息 */ }

    if (!response.ok || body?.ok === false) {
      const code = body?.error?.code || `HTTP_${response.status}`;
      const message = body?.error?.message || "服務暫時無法使用，請稍後再試。";
      throw new P120ApiError(code, message, response.status);
    }
    return body?.data ?? body;
  }

  createTransfer(files, clientRequestId, managementToken) {
    return this.request("create-transfer", {
      clientRequestId,
      managementToken,
      files: files.map((file, index) => ({
        sortOrder: index,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size
      }))
    });
  }

  async uploadFile(path, signedToken, file) {
    const { error } = await this.storage.uploadToSignedUrl(path, signedToken, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "0"
    });
    if (error) throw new P120ApiError("UPLOAD_FAILED", `「${file.name}」上傳失敗，請重試。`);
  }

  completeTransfer(transferId, managementToken) {
    return this.request("complete-transfer", { transferId, managementToken });
  }

  cancelTransfer(transferId, managementToken) {
    return this.request("cancel-transfer", { transferId, managementToken });
  }

  lookupTransfer(roomCode) {
    return this.request("lookup-transfer", { roomCode });
  }

  createDownloadUrl(roomCode, fileId) {
    return this.request("create-download-url", { roomCode, fileId });
  }
}
