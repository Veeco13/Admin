#!/usr/bin/env bash
# كوميت تلقائي في آخر كل رد من Claude لو فيه تعديلات (Stop hook)
# الملفات الحساسة (lunx.db, uploads/, .secret_key, .env) متجاهلة في .gitignore فمش بتدخل.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[ -z "$(git status --porcelain)" ] && exit 0

git add -A
files=$(git diff --cached --name-only)
count=$(printf '%s\n' "$files" | grep -c .)
summary=$(printf '%s\n' "$files" | head -5 | paste -sd ' ' -)
[ "$count" -gt 5 ] && summary="$summary (+$((count - 5)) more)"

git commit -q -F - <<EOF
Auto: update $summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF

sha=$(git rev-parse --short HEAD)
printf '{"systemMessage":"Auto-commit %s: %s file(s)"}\n' "$sha" "$count"
