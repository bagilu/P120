// 複製本檔為 config.js，再填入實際公開設定。
// SUPABASE_ANON_KEY 是可公開的 anon/publishable key；切勿放入 service_role key。
window.P120_CONFIG = Object.freeze({
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY",
  EDGE_FUNCTION_NAME: "P120-transfer-api",
  STORAGE_BUCKET: "p120-temp-files"
});
