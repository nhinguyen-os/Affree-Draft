/**
 * /api/payoo-check?token=TOKEN
 * Proxy request đến Payoo QR-pay check API để tránh CORS.
 *
 * ENV bypass:
 *   PNJ_PAY_QR_CHECK=true  → trả mock thành công (để test luồng không cần chuyển khoản thật)
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  // ── ENV BYPASS: PNJ_PAY_QR_CHECK=true → mock thành công ──────────────────
  if (process.env.PNJ_PAY_QR_CHECK === 'true') {
    return NextResponse.json({
      code: 0,
      url: 'https://www.pnj.com.vn/index.php?dispatch=checkout.complete&order_id=2228162&suffix=4a73d46f30ea5b632b53c068d296c77e818da026621829c8c2aa9e32fafb1ea8',
      transferAmount: '595000',
      confirmed: '1',
      pendingTime: null,
      _mock: true,
    });
  }

  // ── Gọi Payoo API thật ────────────────────────────────────────────────────
  const payooUrl = `https://payoo.vn/v2/qr-pay/?_token=${encodeURIComponent(token)}&_id=${encodeURIComponent(token)}&confirmed=1`;

  try {
    const res = await fetch(payooUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Affree/1.0)',
        'Referer': `https://payoo.vn/v2/paynow/detail?_token=${token}&method_tab=qr-pay`,
        'Origin': 'https://payoo.vn',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Payoo API error', status: res.status }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Fetch failed', detail: msg }, { status: 502 });
  }
}
