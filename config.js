// 複製本檔為 config.js，再填入實際公開設定。
// SUPABASE_ANON_KEY 是可公開的 anon/publishable key；切勿放入 service_role key。
window.P120_CONFIG = Object.freeze({
  SUPABASE_URL: "https://mfljkyvdadxlrbxlboce.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mbGpreXZkYWR4bHJieGxib2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MTQwMDUsImV4cCI6MjA4MDM5MDAwNX0.Z4OeacVpO8yM1d1uOWZ6jU2Gl7wgEbhXvAFSqF5pBRs",
  EDGE_FUNCTION_NAME: "P120-transfer-api",
  STORAGE_BUCKET: "p120-temp-files"
});
