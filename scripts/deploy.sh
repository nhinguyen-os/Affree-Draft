#!/usr/bin/env bash
# Deploy production + tự trỏ lại 2 alias CANONICAL về bản vừa deploy.
#
# Canonical (đều là *.vercel.app → chỉ gắn được bằng ALIAS, `vercel --prod` KHÔNG tự cập nhật):
#   - affree-msas.vercel.app   (link chính thức)
#   - gia-quanh-day.vercel.app (giữ song song)
# LƯU Ý: affree.vercel.app đã CHẾT (404) — đừng alias vào đó nữa.
#
# Dùng: npm run deploy   (hoặc: bash scripts/deploy.sh)
set -euo pipefail

ALIASES=("affree-msas.vercel.app" "gia-quanh-day.vercel.app")

echo "▶ Deploying production…"
OUT=$(npx vercel --prod --yes 2>&1)
echo "$OUT"

# Lấy URL deployment production (bỏ URL inspector vercel.com). Bắt mọi <project>-<hash>-…vercel.app.
URL=$(printf '%s\n' "$OUT" \
  | grep -oE 'https://[a-z0-9-]+-[a-z0-9]+-[a-z0-9-]+\.vercel\.app' \
  | grep -v 'vercel.com' | head -1 | sed 's#^https://##')

if [ -z "$URL" ]; then
  echo "✗ Không tìm được URL deployment trong output. Tự alias bằng tay:" >&2
  for a in "${ALIASES[@]}"; do echo "   npx vercel alias set <deployment-url> $a" >&2; done
  exit 1
fi

for a in "${ALIASES[@]}"; do
  echo "▶ Trỏ $a → $URL"
  npx vercel alias set "$URL" "$a"
done
echo "✓ Xong. Canonical đã trỏ về bản mới:"
for a in "${ALIASES[@]}"; do echo "   https://$a"; done
