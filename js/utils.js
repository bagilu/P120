export const LIMITS = Object.freeze({
  maxFiles: 20,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024
});

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function normalizeRoomCode(value) {
  return String(value ?? "")
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/\D/g, "")
    .slice(0, 6);
}

export function fileExtension(name) {
  const match = String(name).match(/\.([^.]{1,5})$/);
  return match ? match[1].replace(/[^a-z0-9]/gi, "").slice(0, 4) || "檔" : "檔";
}

export function createManagementToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function makeShareUrl(roomCode) {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set("code", roomCode);
  return url.toString();
}

export function startCountdown(expiresAt, outputElement, onExpire) {
  let expired = false;
  const update = () => {
    const remainingMs = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    outputElement.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    if (remainingMs <= 0 && !expired) {
      expired = true;
      onExpire?.();
    }
  };
  update();
  const intervalId = window.setInterval(() => {
    update();
    if (expired) window.clearInterval(intervalId);
  }, 500);
  return () => window.clearInterval(intervalId);
}

export function showToast(message, type = "info") {
  const region = document.getElementById("toast-region");
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " error" : ""}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

export function renderQrCode(container, content) {
  container.replaceChildren();
  if (typeof window.qrcode !== "function") {
    const message = document.createElement("p");
    message.textContent = "QR Code 元件載入失敗，請改用房間碼或複製網址。";
    container.append(message);
    return false;
  }
  const qr = window.qrcode(0, "M");
  qr.addData(content, "Byte");
  qr.make();
  container.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
  const svg = container.querySelector("svg");
  if (svg) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "開啟檔案房間的 QR Code");
  }
  return true;
}
