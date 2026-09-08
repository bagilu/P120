#!/usr/bin/env bash
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
sql_dir="$project_dir/database"
failed=0
clean_sql="$(mktemp)"
trap 'rm -f "$clean_sql"' EXIT

find "$sql_dir" -type f -name '*.sql' -print0 | sort -z | xargs -0 sed 's/--.*$//' > "$clean_sql"

check_forbidden() {
  pattern="$1"
  label="$2"
  if grep -Eiq "$pattern" "$clean_sql"; then
    echo "FAIL: $label"
    failed=1
  else
    echo "PASS: $label"
  fi
}

check_forbidden 'ALL[[:space:]]+TABLES[[:space:]]+IN[[:space:]]+SCHEMA' '沒有 schema-wide ALL TABLES 權限命令'
check_forbidden 'ALTER[[:space:]]+DEFAULT[[:space:]]+PRIVILEGES' '沒有 ALTER DEFAULT PRIVILEGES'
check_forbidden 'DROP[[:space:]]+SCHEMA' '沒有 DROP SCHEMA'
check_forbidden '(GRANT|REVOKE).+ON[[:space:]]+SCHEMA[[:space:]]+public' '沒有 public schema 全域權限修改'

if grep -Piq 'TblP(?!120)[0-9]+' "$clean_sql"; then
  echo 'FAIL: SQL 發現非 P120 的 P 系列資料表名稱'
  failed=1
else
  echo 'PASS: SQL 未引用其他 P 系列資料表'
fi

if grep -RPEiq "\\.from\\(['\"]TblP(?!120)" "$project_dir/js" "$project_dir/supabase" 2>/dev/null; then
  echo 'FAIL: 程式碼發現非 P120 的 P 系列資料表'
  failed=1
else
  echo 'PASS: 程式碼未引用其他 P 系列資料表'
fi

if grep -Rqs 'SUPABASE_SERVICE_ROLE_KEY[[:space:]]*:' "$project_dir"/config*.js 2>/dev/null; then
  echo 'FAIL: 前端設定檔疑似包含 service role key 欄位'
  failed=1
else
  echo 'PASS: 前端設定檔沒有 service role key 欄位'
fi

if [ "$failed" -ne 0 ]; then
  echo 'P120 scope scan failed.'
  exit 1
fi

echo 'P120 scope scan passed.'
