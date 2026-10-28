export class P120ApiError extends Error {
  constructor(code, message, status = 0, details = null) {
    super(message); this.name = "P120ApiError"; this.code = code; this.status = status; this.details = details;
  }
}

export class P120Api {
  constructor(config) {
    this.config = config;
    this.supabaseUrl = config.SUPABASE_URL.replace(/\/$/, "");
    this.bucketName = config.STORAGE_BUCKET;
    this.functionUrl = `${this.supabaseUrl}/functions/v1/${config.EDGE_FUNCTION_NAME}`;
  }

  async request(action, payload = {}) {
    let response;
    try {
      response = await fetch(this.functionUrl, { method: "POST", body: JSON.stringify({ action, ...payload }) });
    } catch {
      throw new P120ApiError("NETWORK_ERROR", "無法連接分享服務，請確認網路後再試。");
    }
    let body = null;
    try { body = await response.json(); } catch { /* 由下方產生安全訊息 */ }
    if (!response.ok || body?.ok === false) {
      throw new P120ApiError(body?.error?.code || `HTTP_${response.status}`, body?.error?.message || "服務暫時無法使用。", response.status, body?.error?.details || null);
    }
    return body?.data ?? body;
  }

  createRoom(clientRequestId, managementToken) { return this.request("create-room", { clientRequestId, managementToken }); }
  lookupRoom(roomCode) { return this.request("lookup-room", { roomCode }); }
  updateNote(roomCode, noteText, expectedRevision) { return this.request("update-note", { roomCode, noteText, expectedRevision }); }
  prepareUpload(roomCode, files) {
    return this.request("prepare-upload", { roomCode, files: files.map((file, index) => ({ sortOrder: index, name: file.name, type: file.type || "application/octet-stream", size: file.size })) });
  }
  completeUpload(roomCode, uploadId) { return this.request("complete-upload", { roomCode, uploadId }); }
  cancelUpload(roomCode, uploadId) { return this.request("cancel-upload", { roomCode, uploadId }); }
  createDownloadUrl(roomCode, fileId) { return this.request("create-download-url", { roomCode, fileId }); }

  uploadFile(path, file) {
    const encodedPath = [this.bucketName, ...String(path).split("/")].map(encodeURIComponent).join("/");
    const uploadUrl = `${this.supabaseUrl}/storage/v1/object/${encodedPath}`;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl, true);
      xhr.setRequestHeader("Authorization", `Bearer ${this.config.SUPABASE_ANON_KEY}`);
      xhr.setRequestHeader("apikey", this.config.SUPABASE_ANON_KEY);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.timeout = 25 * 60 * 1000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let detail = xhr.statusText || "Storage request failed";
        try { const body = JSON.parse(xhr.responseText || "{}"); detail = body.message || body.error || detail; } catch { /* 安全訊息 */ }
        reject(new P120ApiError("UPLOAD_FAILED", `「${file.name}」上傳失敗（HTTP ${xhr.status} · ${String(detail).replace(/[\r\n\t]+/g, " ").slice(0, 120)}）。`, xhr.status));
      };
      xhr.onerror = () => reject(new P120ApiError("UPLOAD_NETWORK_ERROR", `「${file.name}」無法建立上傳連線。`));
      xhr.ontimeout = () => reject(new P120ApiError("UPLOAD_TIMEOUT", `「${file.name}」上傳逾時。`));
      xhr.send(file);
    });
  }
}
