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

  uploadFile(path, _signedToken, file) {
    return this.uploadFileWithXhr(path, file);
  }

  uploadFileWithXhr(path, file) {
    const encodedPath = [this.bucketName, ...String(path).split("/")]
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const uploadUrl = `${this.supabaseUrl}/storage/v1/object/${encodedPath}`;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl, true);
      // 使用標準 raw-binary Storage endpoint。公開 anon key 只識別 anon 角色；
      // 真正授權由 PolP120SignedUploadInsert 依 P120 資料表、隨機物件路徑、
      // pending 狀態與上傳期限逐筆核准，不開放列出、讀取、更新或刪除。
      xhr.setRequestHeader("Authorization", `Bearer ${this.config.SUPABASE_ANON_KEY}`);
      xhr.setRequestHeader("apikey", this.config.SUPABASE_ANON_KEY);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
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
        `「${file.name}」上傳失敗（裝置無法與 Supabase Storage 建立上傳連線）。請確認網路後重試。`
      ));
      xhr.ontimeout = () => reject(new P120ApiError(
        "UPLOAD_TIMEOUT",
        `「${file.name}」上傳逾時，請確認網路後重試。`
      ));
      xhr.onabort = () => reject(new P120ApiError("UPLOAD_ABORTED", `「${file.name}」上傳已中止。`));
      xhr.send(file);
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
