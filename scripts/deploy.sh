#!/usr/bin/env bash
# Deploy production + tự trỏ lại alias affree.vercel.app về bản vừa deploy.
#
# Lý do: affree.vercel.app là *.vercel.app subdomain → chỉ gắn được bằng ALIAS,
# không thêm làm "production domain" được, nên `vercel --prod` KHÔNG tự cập nhật nó.
# Script này deploy xong sẽ tự `vercel alias set` để khỏi làm tay.
#
# Dùng: npm run deploy   (hoặc: bash scripts/deploy.sh)
set -euo pipefail

ALIAS="affree.vercel.app"

echo "▶ Deploying production…"
OUT=$(npx vercel --prod --yes 2>&1)
echo "$OUT"

# Lấy URL deployment vừa tạo (dạng sosanhgia-<hash>-…vercel.app), bỏ qua URL inspector (vercel.com).
URL=$(printf '%s\n' "$OUT" | grep -oE 'sosanhgia-[a-z0-9]+-[a-z0-9-]+\.vercel\.app' | head -1)

if [ -z "$URL" ]; then
  echo "✗ Không tìm được URL deployment trong output. Tự alias bằng tay:" >&2
  echo "   npx vercel alias set <deployment-url> $ALIAS" >&2
  exit 1
fi

echo "▶ Trỏ $ALIAS → $URL"
npx vercel alias set "$URL" "$ALIAS"
echo "✓ Xong: https://$ALIAS đã trỏ về bản mới nhất."
