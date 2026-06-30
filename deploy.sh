#!/usr/bin/env bash
# Deploy Affree lên production NHANH — build sẵn ở máy rồi upload prebuilt,
# BỎ QUA build-server của Vercel (hay kẹt UNKNOWN). Sau đó trỏ alias cố định.
#
#   Dùng:  ./deploy.sh
#
# Link prod chính thức (alias cố định, không đổi dù project backing đổi số):
#   https://gia-quanh-day.vercel.app
#
# Nếu prebuilt vào project đang link cũng kẹt (hiếm) → xem cuối file: tạo project mới.
set -euo pipefail
cd "$(dirname "$0")"

ALIAS="gia-quanh-day.vercel.app"

echo "▶ 1/4  Build local (prod)…"
npx vercel build --prod

echo "▶ 2/4  Upload bản prebuilt (bỏ qua build-server)…"
OUT=$(npx vercel deploy --prebuilt --prod --yes 2>&1)
echo "$OUT"
URL=$(echo "$OUT" | grep -oE 'https://affree-v[0-9]+-[a-z0-9]+-[a-z0-9-]+\.vercel\.app' | head -1)
if [ -z "$URL" ]; then
  echo "✗ Không tìm thấy URL deployment — kiểm tra output ở trên." >&2
  exit 1
fi
echo "   deployment: $URL"

echo "▶ 3/4  Trỏ alias $ALIAS → deployment mới…"
npx vercel alias set "$URL" "$ALIAS"

echo "▶ 4/4  Verify…"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$ALIAS/")
echo "   https://$ALIAS/ → HTTP $CODE"
[ "$CODE" = "200" ] && echo "✓ XONG: https://$ALIAS" || { echo "✗ Trang chưa trả 200, kiểm tra lại." >&2; exit 1; }

# ── Nếu prebuilt CŨNG kẹt (status UNKNOWN) — project backing hỏng, tạo project MỚI: ──
#   N=82   # số kế tiếp
#   cp .vercel/project.json /tmp/affree-proj-bak.json
#   npx vercel link --project "affree-v$N" --yes      # tạo + link project mới
#   npx vercel deploy --prebuilt --prod --yes         # rồi alias như bước 3
