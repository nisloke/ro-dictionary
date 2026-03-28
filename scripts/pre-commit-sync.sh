#!/bin/sh
# pre-commit hook: terms.json 또는 categories.json이 변경되었으면 Supabase 동기화

# 스테이지된 파일 중 데이터 파일이 있는지 확인
STAGED=$(git diff --cached --name-only --diff-filter=ACM)

TERMS_CHANGED=false
for file in $STAGED; do
  case "$file" in
    src/data/terms.json|src/data/categories.json)
      TERMS_CHANGED=true
      break
      ;;
  esac
done

if [ "$TERMS_CHANGED" = "false" ]; then
  exit 0
fi

# SUPABASE_SERVICE_KEY 확인
if [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo ""
  echo "⚠️  terms.json/categories.json 변경 감지됨"
  echo "   SUPABASE_SERVICE_KEY가 설정되지 않아 DB 동기화를 건너뜁니다."
  echo "   동기화하려면: set SUPABASE_SERVICE_KEY=... && npm run sync-db"
  echo ""
  exit 0
fi

echo "🔄 terms/categories 변경 감지 → Supabase 동기화 중..."
node scripts/sync-to-supabase.mjs

if [ $? -ne 0 ]; then
  echo "❌ Supabase 동기화 실패. 커밋을 중단합니다."
  echo "   동기화 없이 커밋하려면: git commit --no-verify"
  exit 1
fi

exit 0
