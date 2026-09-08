import { fileExtension, formatBytes, normalizeRoomCode, showToast, startCountdown } from "./utils.js";

export class Receiver {
  constructor(api) {
    this.api = api;
    this.currentRoom = null;
    this.stopCountdown = null;
    this.form = document.getElementById("room-form");
    this.input = document.getElementById("room-code");
    this.lookupButton = document.getElementById("lookup-button");
    this.loading = document.getElementById("room-loading");
    this.result = document.getElementById("room-result");
    this.empty = document.getElementById("room-empty");
    this.emptyMessage = document.getElementById("room-empty-message");
    this.fileList = document.getElementById("receive-file-list");
    this.downloadAllButton = document.getElementById("download-all-button");

    this.input.addEventListener("input", () => { this.input.value = normalizeRoomCode(this.input.value); });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.lookup(this.input.value);
    });
    this.downloadAllButton.addEventListener("click", () => this.downloadAll());
  }

  async lookup(rawCode, updateUrl = true) {
    const roomCode = normalizeRoomCode(rawCode);
    this.input.value = roomCode;
    if (!/^\d{6}$/.test(roomCode)) {
      this.showEmpty("請輸入完整的六位數房間碼。");
      return;
    }

    this.stopCountdown?.();
    this.currentRoom = null;
    this.loading.hidden = false;
    this.result.hidden = true;
    this.empty.hidden = true;
    this.lookupButton.disabled = true;

    try {
      const data = await this.api.lookupTransfer(roomCode);
      this.currentRoom = data;
      this.renderRoom(data);
      if (updateUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set("code", roomCode);
        history.replaceState(null, "", url);
      }
    } catch (error) {
      this.showEmpty(error.message || "找不到此檔案房間。");
    } finally {
      this.loading.hidden = true;
      this.lookupButton.disabled = false;
    }
  }

  renderRoom(data) {
    this.empty.hidden = true;
    this.result.hidden = false;
    document.getElementById("result-code").textContent = data.roomCode;
    this.fileList.replaceChildren();

    data.files.forEach((file) => {
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
      meta.textContent = formatBytes(file.size);
      copy.append(name, meta);
      const button = document.createElement("button");
      button.className = "button secondary file-action";
      button.type = "button";
      button.textContent = "下載";
      button.addEventListener("click", () => this.downloadFile(file, button));
      item.append(symbol, copy, button);
      this.fileList.append(item);
    });

    this.stopCountdown = startCountdown(data.expiresAt, document.getElementById("receive-countdown"), () => {
      this.currentRoom = null;
      this.showEmpty("此檔案房間已超過 10 分鐘，無法再下載。");
    });
  }

  showEmpty(message) {
    this.stopCountdown?.();
    this.currentRoom = null;
    this.loading.hidden = true;
    this.result.hidden = true;
    this.empty.hidden = false;
    this.emptyMessage.textContent = message;
  }

  async downloadFile(file, button = null) {
    if (!this.currentRoom) return;
    if (button) button.disabled = true;
    try {
      const data = await this.api.createDownloadUrl(this.currentRoom.roomCode, file.fileId);
      const link = document.createElement("a");
      link.href = data.downloadUrl;
      link.download = file.name;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      showToast(error.message || "無法下載檔案。", "error");
      if (error.code === "ROOM_EXPIRED") this.showEmpty(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async downloadAll() {
    if (!this.currentRoom) return;
    this.downloadAllButton.disabled = true;
    try {
      for (const file of this.currentRoom.files) {
        await this.downloadFile(file);
        await new Promise((resolve) => window.setTimeout(resolve, 450));
      }
      showToast("已依序提出全部檔案的下載；若瀏覽器阻擋，請允許多檔下載。");
    } finally {
      this.downloadAllButton.disabled = false;
    }
  }
}
