import { LIMITS, copyText, createManagementToken, fileExtension, formatBytes, formatRoomCode, makeShareUrl, normalizeRoomCode, renderQrCode, showToast, singleSafeUrl } from "./utils.js?v=1.1.1";

export class Workspace {
  constructor(api) {
    this.api = api; this.room = null; this.managementToken = null; this.noteDirty = false; this.noteSaving = false; this.noteConflictData = null; this.files = []; this.pollTimer = null; this.countdownTimer = null; this.saveTimer = null; this.refreshing = false; this.syncWarningShown = false;
    this.landing = document.getElementById("landing-view"); this.loading = document.getElementById("loading-view"); this.workspace = document.getElementById("workspace-view"); this.codeInput = document.getElementById("room-code"); this.note = document.getElementById("shared-note"); this.syncStatus = document.getElementById("note-sync-status"); this.fileInput = document.getElementById("file-input");
    this.bindEvents();
  }
  bindEvents() {
    document.getElementById("start-button").addEventListener("click", () => this.createRoom());
    this.codeInput.addEventListener("input", () => { this.codeInput.value = formatRoomCode(this.codeInput.value); });
    document.getElementById("join-form").addEventListener("submit", (event) => { event.preventDefault(); this.joinRoom(this.codeInput.value); });
    document.getElementById("leave-button").addEventListener("click", () => this.leaveRoom());
    document.getElementById("copy-link-button").addEventListener("click", () => this.copyInvite());
    this.note.addEventListener("input", () => this.onNoteInput());
    document.getElementById("copy-note-button").addEventListener("click", () => this.copyNote());
    document.getElementById("open-link-button").addEventListener("click", () => this.openNoteLink());
    document.getElementById("reload-note-button").addEventListener("click", () => this.acceptRemoteNote());
    document.getElementById("file-picker").addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", () => this.selectFiles(this.fileInput.files));
    document.getElementById("upload-button").addEventListener("click", () => this.uploadFiles());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.room) this.refreshRoom();
    });
  }
  showView(name, message = "") { this.landing.hidden = name !== "landing"; this.loading.hidden = name !== "loading"; this.workspace.hidden = name !== "workspace"; if (message) document.getElementById("loading-message").textContent = message; }
  async createRoom() {
    this.showView("loading", "正在準備分享空間…"); this.managementToken = createManagementToken();
    try { const data = await this.api.createRoom(crypto.randomUUID(), this.managementToken); this.openRoom(data, true); }
    catch (error) { this.showView("landing"); showToast(error.message || "無法建立分享空間。", "error"); }
  }
  async joinRoom(rawCode) {
    const code = normalizeRoomCode(rawCode); if (!/^\d{6}$/.test(code)) return showToast("請輸入完整的六位數分享碼。", "error");
    this.showView("loading", "正在加入分享空間…");
    try { const data = await this.api.lookupRoom(code); this.openRoom(data, false); }
    catch (error) { this.showView("landing"); showToast(error.message || "找不到分享空間。", "error"); }
  }
  openRoom(data, isCreator) {
    this.room = data; this.noteDirty = false; this.noteConflictData = null; this.showView("workspace");
    document.getElementById("display-code").textContent = formatRoomCode(data.roomCode); this.note.value = data.noteText || ""; this.updateNoteUi(); this.renderFiles(data.files || []); this.updateRoomMeta(data); renderQrCode(document.getElementById("qr-code"), makeShareUrl(data.roomCode));
    const url = new URL(window.location.href); url.searchParams.set("code", data.roomCode); history.replaceState(null, "", url); document.getElementById("room-status").textContent = isCreator ? "分享空間已建立" : "已加入分享空間";
    window.clearInterval(this.pollTimer); this.pollTimer = window.setInterval(() => { if (!document.hidden) this.refreshRoom(); }, 3000); this.startCountdown();
  }
  leaveRoom() { window.clearInterval(this.pollTimer); window.clearInterval(this.countdownTimer); window.clearTimeout(this.saveTimer); this.room = null; this.managementToken = null; this.files = []; const url = new URL(window.location.href); url.search = ""; history.replaceState(null, "", url); this.showView("landing"); }
  async refreshRoom(force = false) {
    if (!this.room || this.refreshing) return;
    this.refreshing = true;
    try {
      const data = await this.api.syncRoom(this.room.roomCode, this.room.syncToken); this.updateRoomMeta(data); this.renderFiles(data.files || []); this.syncWarningShown = false;
      if (force || (!this.noteDirty && !this.noteSaving)) { this.room.noteRevision = data.noteRevision; this.room.noteText = data.noteText || ""; this.note.value = this.room.noteText; this.updateNoteUi(); }
      else if (data.noteRevision !== this.room.noteRevision) this.showConflict(data);
    } catch (error) {
      if (["ROOM_EXPIRED", "ROOM_NOT_FOUND"].includes(error.code)) this.expireRoom(error.message);
      else if (!this.syncWarningShown) { this.syncWarningShown = true; showToast("背景同步暫時中斷，系統會自動重試。", "error"); }
    } finally { this.refreshing = false; }
  }
  updateRoomMeta(data) { this.room = { ...this.room, ...data }; this.startCountdown(); }
  startCountdown() {
    window.clearInterval(this.countdownTimer); const output = document.getElementById("room-countdown");
    const tick = () => { if (!this.room?.expiresAt) { output.textContent = "等待第一筆內容"; return; } const seconds = Math.max(0, Math.ceil((new Date(this.room.expiresAt).getTime() - Date.now()) / 1000)); output.textContent = `剩餘 ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; if (seconds <= 0) this.expireRoom("此分享空間已到期。"); };
    tick(); this.countdownTimer = window.setInterval(tick, 500);
  }
  expireRoom(message) { window.clearInterval(this.pollTimer); window.clearInterval(this.countdownTimer); this.note.disabled = true; this.fileInput.disabled = true; document.getElementById("file-picker").disabled = true; document.getElementById("room-status").textContent = "分享空間已到期"; document.getElementById("room-countdown").textContent = "已到期"; showToast(message || "分享空間已到期。", "error"); }
  async copyInvite() { try { await copyText(makeShareUrl(this.room.roomCode)); showToast("邀請連結已複製。"); } catch { showToast("無法複製邀請連結。", "error"); } }
  onNoteInput() { this.noteDirty = true; this.syncStatus.textContent = "等待同步"; this.syncStatus.className = "sync-status is-working"; this.updateNoteUi(); window.clearTimeout(this.saveTimer); this.saveTimer = window.setTimeout(() => this.saveNote(), 700); }
  updateNoteUi() { document.getElementById("note-count").textContent = `${Array.from(this.note.value).length.toLocaleString()}／5,000`; document.getElementById("open-link-button").hidden = !singleSafeUrl(this.note.value); }
  async saveNote() {
    if (!this.room || !this.noteDirty || this.noteConflictData || this.noteSaving) return; this.noteSaving = true; this.syncStatus.textContent = "同步中…"; this.syncStatus.className = "sync-status is-working";
    try { const data = await this.api.updateNote(this.room.roomCode, this.note.value, this.room.noteRevision); this.room = { ...this.room, ...data }; this.noteDirty = false; this.syncStatus.textContent = "已同步"; this.syncStatus.className = "sync-status"; this.startCountdown(); }
    catch (error) { if (error.code === "NOTE_CONFLICT" && error.details) this.showConflict(error.details); else { this.syncStatus.textContent = "同步失敗"; this.syncStatus.className = "sync-status is-error"; showToast(error.message || "共筆同步失敗。", "error"); } }
    finally { this.noteSaving = false; }
  }
  showConflict(data) { this.noteConflictData = data; document.getElementById("note-conflict").hidden = false; document.getElementById("reload-note-button").hidden = false; this.syncStatus.textContent = "版本衝突"; this.syncStatus.className = "sync-status is-error"; }
  acceptRemoteNote() { if (!this.noteConflictData) return; this.room.noteRevision = this.noteConflictData.noteRevision; this.room.noteText = this.noteConflictData.noteText || ""; this.note.value = this.room.noteText; this.noteDirty = false; this.noteConflictData = null; document.getElementById("note-conflict").hidden = true; document.getElementById("reload-note-button").hidden = true; this.syncStatus.textContent = "已同步"; this.syncStatus.className = "sync-status"; this.updateNoteUi(); }
  async copyNote() { if (!this.note.value) return showToast("共筆目前沒有內容。", "error"); try { await copyText(this.note.value); showToast("共筆內容已複製。"); } catch { showToast("無法複製共筆內容。", "error"); } }
  openNoteLink() { const url = singleSafeUrl(this.note.value); if (url) window.open(url.href, "_blank", "noopener,noreferrer"); }
  selectFiles(fileList) { this.files = Array.from(fileList || []); this.fileInput.value = ""; this.renderSelection(); }
  validateFiles() { if (!this.files.length) return "請先選取檔案。"; if (this.files.length + (this.room?.files?.length || 0) > LIMITS.maxFiles) return "此分享空間最多 20 個檔案。"; const large = this.files.find((f) => f.size > LIMITS.maxFileBytes); if (large) return `「${large.name}」超過 50 MB。`; if (this.files.some((f) => Array.from(f.name).length > 200)) return "檔名不得超過 200 個字元。"; const total = this.files.reduce((sum, f) => sum + f.size, 0) + (this.room?.totalBytes || 0); if (total > LIMITS.maxTotalBytes) return "檔案合計不得超過 100 MB。"; return null; }
  renderSelection() {
    const box = document.getElementById("upload-selection"); box.hidden = !this.files.length; const list = document.getElementById("selected-file-list"); list.replaceChildren();
    this.files.forEach((file, index) => { const item = this.makeFileItem(file.name, file.size); const remove = document.createElement("button"); remove.className = "icon-button"; remove.type = "button"; remove.textContent = "移除"; remove.addEventListener("click", () => { this.files.splice(index, 1); this.renderSelection(); }); item.append(remove); list.append(item); });
    const size = this.files.reduce((sum, f) => sum + f.size, 0); document.getElementById("selected-count").textContent = `${this.files.length} 個檔案`; document.getElementById("selected-size").textContent = formatBytes(size); document.getElementById("upload-meter").style.width = `${Math.min(100, (size / LIMITS.maxTotalBytes) * 100)}%`; const problem = this.validateFiles(); document.getElementById("upload-button").disabled = Boolean(problem); document.getElementById("upload-button").title = problem || "";
  }
  makeFileItem(name, size) { const item = document.createElement("div"); item.className = "file-item"; const symbol = document.createElement("span"); symbol.className = "file-symbol"; symbol.textContent = fileExtension(name); const copy = document.createElement("div"); copy.className = "file-copy"; const title = document.createElement("span"); title.className = "file-name"; title.textContent = name; title.title = name; const meta = document.createElement("span"); meta.className = "file-meta"; meta.textContent = formatBytes(size); copy.append(title, meta); item.append(symbol, copy); return item; }
  async uploadFiles() {
    const problem = this.validateFiles(); if (problem) return showToast(problem, "error"); const button = document.getElementById("upload-button"); button.disabled = true; button.textContent = "準備上傳…"; let prepared = null;
    try {
      prepared = await this.api.prepareUpload(this.room.roomCode, this.files); const uploads = [...prepared.uploads].sort((a, b) => a.sortOrder - b.sortOrder); let cursor = 0; let done = 0; const worker = async () => { while (cursor < uploads.length) { const i = cursor++; await this.api.uploadFile(uploads[i].path, this.files[i]); done += 1; button.textContent = `上傳中 ${done}／${uploads.length}`; } }; const concurrency = window.matchMedia?.("(pointer: coarse)")?.matches ? 1 : Math.min(3, uploads.length); await Promise.all(Array.from({ length: concurrency }, worker)); const data = await this.api.completeUpload(this.room.roomCode, prepared.uploadId); this.files = []; this.renderSelection(); this.updateRoomMeta(data); await this.refreshRoom(true); showToast("檔案已加入分享空間。");
    } catch (error) { if (prepared?.uploadId) { try { await this.api.cancelUpload(this.room.roomCode, prepared.uploadId); } catch { /* 到期後由系統清理 */ } } showToast(error.message || "檔案上傳失敗。", "error"); }
    finally { button.disabled = false; button.textContent = "開始上傳"; }
  }
  renderFiles(files) { this.room.files = files; const list = document.getElementById("room-file-list"); list.replaceChildren(); document.getElementById("files-empty").hidden = files.length > 0; document.getElementById("file-summary").textContent = `${files.length} 個檔案`; files.forEach((file) => { const item = this.makeFileItem(file.name, file.size); const button = document.createElement("button"); button.className = "button secondary small"; button.type = "button"; button.textContent = "下載"; button.addEventListener("click", () => this.downloadFile(file, button)); item.append(button); list.append(item); }); }
  async downloadFile(file, button) { button.disabled = true; try { const data = await this.api.createDownloadUrl(this.room.roomCode, file.fileId); const link = document.createElement("a"); link.href = data.downloadUrl; link.download = file.name; link.rel = "noopener"; document.body.append(link); link.click(); link.remove(); } catch (error) { showToast(error.message || "無法下載檔案。", "error"); } finally { button.disabled = false; } }
}
