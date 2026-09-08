import { P120Api } from "./api.js?v=1.0.5";
import { Receiver } from "./receive.js?v=1.0.5";
import { Uploader } from "./upload.js?v=1.0.5";
import { normalizeRoomCode } from "./utils.js?v=1.0.5";

function validateConfig(config) {
  if (!config) return "找不到 config.js。請先複製 config-sample.js 為 config.js 並填入 Supabase 公開設定。";
  const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "EDGE_FUNCTION_NAME", "STORAGE_BUCKET"];
  const missing = required.filter((key) => !config[key] || String(config[key]).includes("YOUR_"));
  if (missing.length) return `config.js 尚未完成設定：${missing.join("、")}`;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.SUPABASE_URL.replace(/\/$/, ""))) {
    return "SUPABASE_URL 格式不正確，必須使用 https://…supabase.co。";
  }
  if (config.EDGE_FUNCTION_NAME !== "P120-transfer-api" || config.STORAGE_BUCKET !== "p120-temp-files") {
    return "P120 的 Edge Function 或 Storage bucket 名稱與安全規格不一致。";
  }
  if (!window.supabase?.createClient) return "Supabase 元件載入失敗，請檢查網路連線。";
  return null;
}

const configAlert = document.getElementById("config-alert");
const configError = validateConfig(window.P120_CONFIG);

if (configError) {
  configAlert.textContent = configError;
  configAlert.hidden = false;
  document.querySelectorAll("button, input").forEach((element) => { element.disabled = true; });
} else {
  const api = new P120Api(window.P120_CONFIG);
  const receiver = new Receiver(api);
  new Uploader(api);

  const codeFromUrl = normalizeRoomCode(new URLSearchParams(window.location.search).get("code"));
  if (codeFromUrl.length === 6) {
    document.body.classList.add("receiver-mode");
    receiver.lookup(codeFromUrl, false);
  }
}
