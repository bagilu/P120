import { LIMITS, createManagementToken, fileExtension, formatBytes, makeShareUrl, renderQrCode, showToast, startCountdown } from "./utils.js?v=1.0.5";

export class Uploader {
  constructor(api) {
    this.api = api;
    this.files = [];
    this.transfer = null;
    this.cancelRequested = false;
    this.activeRunId = null;
    this.stopCountdown = null;

    this.fileInput = document.getElementById("file-input");
    this.dropZone = document.getElementById("drop-zone");
    this.selectState = document.getElementById("send-select-state");
    this.selectionSummary = document.getElementById("selection-summary");
    this.selectedCount = document.getElementById("selected-count");
    this.selectedSize = document.getElementById("selected-size");
    this.sizeMeter = document.getElementById("size-meter");
    this.uploadButton = document.getElementById("upload-button");
    this.selectedList = document.getElementById("selected-file-list");
    this.progressState = document.getElementById("upload-progress-state");
    this.progressText = document.getElementById("upload-progress-text");
    this.uploadMeter = document.getElementById("upload-meter");
    this.uploadList = document.getElementById("upload-file-list");
    this.cancelButton = document.getElementById("cancel-upload-button");
    this.completeState = document.getElementById("upload-complete-state");

    this.bindEvents();
  }

  bindEvents() {
    this.dropZone.addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", () => this.addFiles(this.fileInput.files));
    for (const eventName of ["dragenter", "dragover"]) {
      this.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        this.dropZone.classList.add("is-dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      this.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        this.dropZone.classList.remove("is-dragging");
      });
    }
    this.dropZone.addEventListener("drop", (event) => this.addFiles(event.dataTransfer.files));
    this.uploadButton.addEventListener("click", () => this.startUpload());
    this.cancelButton.addEventListener("click", () => this.cancelUpload());
    document.getElementById("copy-url-button").addEventListener("click", () => this.copyShareUrl());
    document.getElementById("new-transfer-button").addEventListener("click", () => this.reset());
  }

  addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    this.files.push(...incoming);
    this.fileInput.value = "";
    this.renderSelection();
  }

  validateFiles() {
    if (this.files.length < 1) return "請先選取至少一個檔案。";
    if (this.files.length > LIMITS.maxFiles) return `一次最多傳送 ${LIMITS.maxFiles} 個檔案。`;
    const tooLarge = this.files.find((file) => file.size > LIMITS.maxFileBytes);
    if (tooLarge) return `「${tooLarge.name}」超過單一檔案 50 MB 上限。`;
    const tooLong = this.files.find((file) => Array.from(file.name).length > 200);
    if (tooLong) return `「${tooLong.name.slice(0, 30)}…」的檔名過長。`;
    if (this.totalBytes > LIMITS.maxTotalBytes) return "檔案合計不得超過 100 MB。";
    return null;
  }

  get totalBytes() { return this.files.reduce((sum, file) => sum + file.size, 0); }

  renderSelection() {
    this.selectionSummary.hidden = this.files.length === 0;
    this.selectedCount.textContent = `${this.files.length}／${LIMITS.maxFiles} 個`;
    this.selectedSize.textContent = `${formatBytes(this.totalBytes)}／100 MB`;
    const ratio = Math.min(100, (this.totalBytes / LIMITS.maxTotalBytes) * 100);
    this.sizeMeter.style.width = `${ratio}%`;
    this.sizeMeter.parentElement.classList.toggle("is-over", this.totalBytes > LIMITS.maxTotalBytes);
    this.selectedList.replaceChildren();

    this.files.forEach((file, index) => {
      const item = this.makeFileItem(file, "remove");
      item.querySelector("button").addEventListener("click", () => {
        this.files.splice(index, 1);
        this.renderSelection();
      });
      this.selectedList.append(item);
    });

    const problem = this.validateFiles();
    this.uploadButton.disabled = Boolean(problem);
    this.uploadButton.title = problem || "";
  }

  makeFileItem(file, mode = "status", status = "等待上傳") {
    const item = document.createElement("div");
    item.className = "file-item";
    const symbol = document.createElement("span");
    symbol.className = "file-symbol";
    symbol.textContent = fileExtension(file.name);
    const copy = document.createElement("div");
    copy.className = "file-copy";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.name;
    name.title = file.name;
    const meta = document.createElement("span");
    meta.className = "file-meta";
    meta.textContent = mode === "remove" ? formatBytes(file.size) : `${formatBytes(file.size)} · ${status}`;
    copy.append(name, meta);
    item.append(symbol, copy);
    if (mode === "remove") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button";
      remove.setAttribute("aria-label", `移除 ${file.name}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      item.append(remove);
    } else {
      const state = document.createElement("strong");
      state.className = "file-meta";
      state.textContent = status;
      item.append(state);
    }
    return item;
  }

  async startUpload() {
    const problem = this.validateFiles();
    if (problem) return showToast(problem, "error");

    this.cancelRequested = false;
    const runId = crypto.randomUUID();
    this.activeRunId = runId;
    this.uploadButton.disabled = true;
    this.selectState.hidden = true;
    this.progressState.hidden = false;
    this.completeState.hidden = true;
    this.uploadList.replaceChildren(...this.files.map((file) => this.makeFileItem(file)));
    this.updateProgress(0);

    const managementToken = createManagementToken();
    const clientRequestId = crypto.randomUUID();
    this.transfer = { managementToken, clientRequestId, transferId: null };

    try {
      this.progressText.textContent = "正在建立檔案房間…";
      const created = await this.api.createTransfer(this.files, clientRequestId, managementToken);
      this.transfer = { ...this.transfer, ...created };
      if (this.cancelRequested || this.activeRunId !== runId) return this.cancelUpload();

      const uploads = [...created.uploads].sort((a, b) => a.sortOrder - b.sortOrder);
      let completed = 0;
      let cursor = 0;
      const worker = async () => {
        while (!this.cancelRequested && this.activeRunId === runId) {
          const index = cursor++;
          if (index >= uploads.length) return;
          this.setFileStatus(index, "上傳中");
          await this.api.uploadFile(uploads[index].path, uploads[index].signedToken, this.files[index]);
          if (this.cancelRequested || this.activeRunId !== runId) return;
          completed += 1;
          this.setFileStatus(index, "完成");
          this.updateProgress(completed);
        }
      };
      // 行動裝置與行動網路對多個同時上傳較敏感；觸控裝置採逐檔傳送。
      const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches === true;
      const uploadConcurrency = coarsePointer ? 1 : Math.min(3, uploads.length);
      await Promise.all(Array.from({ length: uploadConcurrency }, worker));
      if (this.cancelRequested || this.activeRunId !== runId) return;

      this.progressText.textContent = "正在核對檔案大小與完整性…";
      const completedTransfer = await this.api.completeTransfer(created.transferId, managementToken);
      if (this.activeRunId !== runId) return;
      this.showComplete(completedTransfer);
    } catch (error) {
      if (this.activeRunId !== runId) return;
      this.uploadButton.disabled = false;
      this.progressText.textContent = "傳送未完成";
      showToast(error.message || "上傳失敗，請稍後再試。", "error");
      if (this.transfer?.transferId) {
        this.cancelButton.textContent = "清除此批並重新選取";
      } else {
        window.setTimeout(() => this.reset(), 1000);
      }
    }
  }

  setFileStatus(index, status) {
    const item = this.uploadList.children[index];
    if (!item) return;
    const meta = item.querySelector(".file-copy .file-meta");
    const state = item.lastElementChild;
    if (meta) meta.textContent = `${formatBytes(this.files[index].size)} · ${status}`;
    if (state) state.textContent = status;
  }

  updateProgress(completed) {
    const total = this.files.length || 1;
    this.uploadMeter.style.width = `${(completed / total) * 100}%`;
    this.progressText.textContent = `${completed}／${this.files.length} 個檔案完成`;
  }

  async cancelUpload() {
    this.cancelRequested = true;
    this.cancelButton.disabled = true;
    if (!this.transfer?.transferId) {
      this.progressText.textContent = "正在停止並清理…";
      return;
    }
    try {
      await this.api.cancelTransfer(this.transfer.transferId, this.transfer.managementToken);
      showToast("已取消此次傳送。");
    } catch {
      showToast("已停止前端上傳；暫存內容會由系統稍後清理。", "error");
    } finally {
      this.cancelButton.disabled = false;
      this.reset();
    }
  }

  showComplete(data) {
    this.progressState.hidden = true;
    this.completeState.hidden = false;
    document.getElementById("complete-code").textContent = data.roomCode;
    document.getElementById("complete-summary").textContent = `${data.fileCount} 個檔案 · ${formatBytes(data.totalBytes)}`;
    const shareUrl = makeShareUrl(data.roomCode);
    document.getElementById("share-url").value = shareUrl;
    renderQrCode(document.getElementById("qr-code"), shareUrl);
    this.stopCountdown?.();
    this.stopCountdown = startCountdown(data.expiresAt, document.getElementById("send-countdown"), () => {
      showToast("此檔案房間已失效。", "error");
      document.getElementById("qr-code").replaceChildren(document.createTextNode("房間已失效"));
    });
  }

  async copyShareUrl() {
    const input = document.getElementById("share-url");
    try {
      await navigator.clipboard.writeText(input.value);
      showToast("分享網址已複製。");
    } catch {
      input.select();
      document.execCommand("copy");
      showToast("分享網址已複製。");
    }
  }

  reset() {
    this.stopCountdown?.();
    this.stopCountdown = null;
    this.files = [];
    this.transfer = null;
    this.cancelRequested = false;
    this.activeRunId = null;
    this.fileInput.value = "";
    this.selectState.hidden = false;
    this.progressState.hidden = true;
    this.completeState.hidden = true;
    this.cancelButton.textContent = "取消此次傳送";
    this.renderSelection();
  }
}
