import { P120Api } from "./api.js?v=1.1.1";
import { Workspace } from "./workspace.js?v=1.1.1";
import { normalizeRoomCode } from "./utils.js?v=1.1.1";

function validateConfig(config) {
  if (!config) return "找不到 config.js。請先複製 config-sample.js 並填入公開設定。";
  const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "EDGE_FUNCTION_NAME", "STORAGE_BUCKET"];
  const missing = required.filter((key) => !config[key] || String(config[key]).includes("YOUR_"));
  if (missing.length) return `config.js 尚未完成設定：${missing.join("、")}`;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.SUPABASE_URL.replace(/\/$/, ""))) return "SUPABASE_URL 格式不正確。";
  if (config.EDGE_FUNCTION_NAME !== "P120-transfer-api" || config.STORAGE_BUCKET !== "p120-temp-files") return "P120 後端名稱與安全規格不一致。";
  return null;
}

const error = validateConfig(window.P120_CONFIG); const alert = document.getElementById("config-alert");
if (error) { alert.textContent = error; alert.hidden = false; document.querySelectorAll("button,input,textarea").forEach((el) => { el.disabled = true; }); }
else { const workspace = new Workspace(new P120Api(window.P120_CONFIG)); const code = normalizeRoomCode(new URLSearchParams(window.location.search).get("code")); if (code.length === 6) workspace.joinRoom(code); }
