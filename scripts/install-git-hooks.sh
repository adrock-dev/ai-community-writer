#!/bin/sh
# git 훅을 저장소에 심는다.
#
# 왜 필요한가: .git/hooks 는 버전 관리되지 않는다. 클론하거나 다른 장비로 옮기면 커밋 게이트가
# 조용히 사라지는데, 있다고 믿는 채로 없는 것이 제일 나쁘다. 이 스크립트가 정본이다.
#
# 사용: npm run hooks:install   (또는 sh scripts/install-git-hooks.sh)
set -e

ROOT=$(git rev-parse --show-toplevel)
HOOK="$ROOT/.git/hooks/pre-commit"

cat > "$HOOK" <<'EOF'
#!/bin/sh
# 자동 커밋 게이트: 실패 시 커밋을 차단한다.
# 이 파일은 scripts/install-git-hooks.sh 가 생성한다 — 고칠 때는 그쪽을 고쳐라.
# (제출-치명적이고 빠른 게이트만 훅으로. typecheck/qa:posts 는 커밋 명령에서 && 로 묶어 수동 확인.)
# 긴급 우회가 꼭 필요하면: git commit --no-verify  (권장하지 않음)
echo "[pre-commit] verify:company-clean..."
if ! npm run --silent verify:company-clean; then
  echo ""
  echo "❌ [pre-commit] company-clean 실패 → 커밋 차단. 금지어를 제거한 뒤 다시 커밋하세요."
  exit 1
fi

# 안내멘트가 코드와 다른 말을 한 채로 커밋되는 것을 막는다. 오류만 차단하고 경고는 통과시킨다
# — B급(동작 계약)은 기계가 판정할 수 없어 "같이 봐야 할 문장"을 알려주는 데서 그친다.
echo "[pre-commit] verify:copy-sync..."
if ! npm run --silent verify:copy-sync; then
  echo ""
  echo "❌ [pre-commit] 안내멘트가 코드와 어긋남 → 커밋 차단."
  echo "   화면 문구를 코드에 맞추거나, 문구를 고쳤으면 scripts/ui-copy-classification.json 의 match 도 맞추세요."
  echo "   표: docs/ui-copy-inventory.md"
  exit 1
fi
exit 0
EOF

chmod +x "$HOOK"
echo "설치 완료: .git/hooks/pre-commit (verify:company-clean · verify:copy-sync)"
