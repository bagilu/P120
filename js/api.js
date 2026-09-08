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
    this.supabaseUrl = config.SUPABASE_URL.replace(/\/$/, "");
    this.bucketName = config.STORAGE_BUCKET;
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
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches === true;
    if (coarsePointer) return this.uploadFileWithXhr(path, signedToken, file);

    const { error } = await this.storage.uploadToSignedUrl(path, signedToken, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "0"
    });
    if (error) {
      const rawDetail = String(error.message || error.error || "Storage request failed")
        .replace(/https?:\/\/\S+/gi, "[網址已隱藏]")
        .replace(/[A-Za-z0-9_-]{80,}/g, "[識別碼已隱藏]")
        .replace(/[\r\n\t]+/g, " ")
        .trim()
        .slice(0, 160);
      const status = Number(error.statusCode || error.status || 0);
      const diagnostic = `${status ? `HTTP ${status} · ` : ""}${rawDetail}`;
      console.error("P120_STORAGE_UPLOAD_FAILED", { status, detail: rawDetail, fileType: file.type, fileSize: file.size });
      throw new P120ApiError(
        "UPLOAD_FAILED",
        `「${file.name}」上傳失敗（${diagnostic}）。請重試；若仍失敗，請將括號內訊息提供給管理者。`,
        status
      );
    }
  }

  uploadFileWithXhr(path, signedToken, file) {
    const encodedPath = [this.bucketName, ...String(path).split("/")]
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const uploadUrl = new URL(`${this.supabaseUrl}/storage/v1/object/upload/sign/${encodedPath}`);
    uploadUrl.searchParams.set("token", signedToken);

    const formData = new FormData();
    formData.append("cacheControl", "0");
    formData.append("", file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl.toString(), true);
      // 不自行設定 Content-Type 或授權標頭，讓 multipart boundary 由瀏覽器建立；
      // signed upload token 已包含本次上傳所需權限。
      xhr.timeout = 25 * 60 * 1000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let detail = xhr.statusText || "Storage request failed";
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          detail = body.message || body.error || detail;
        } catch { /* 使用安全的 HTTP 狀態訊息 */ }
        const safeDetail = String(detail).replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
        reject(new P120ApiError(
          "UPLOAD_FAILED",
          `「${file.name}」上傳失敗（HTTP ${xhr.status} · ${safeDetail}）。請重試；若仍失敗，請將括號內訊息提供給管理者。`,
          xhr.status
        ));
      };
      xhr.onerror = () => reject(new P120ApiError(
        "UPLOAD_NETWORK_ERROR",
        `「${file.name}」上傳失敗（手機無法與 Supabase Storage 建立上傳連線）。請切換 Wi-Fi／行動網路後重試。`
      ));
      xhr.ontimeout = () => reject(new P120ApiError(
        "UPLOAD_TIMEOUT",
        `「${file.name}」上傳逾時，請確認網路後重試。`
      ));
      xhr.onabort = () => reject(new P120ApiError("UPLOAD_ABORTED", `「${file.name}」上傳已中止。`));
      xhr.send(formData);
    });
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
