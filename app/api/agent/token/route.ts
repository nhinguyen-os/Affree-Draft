import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json({ error: "Thiếu sessionId" }, { status: 400 });
    }

    const secret = process.env.ORDER_AGENT_SERVER_SECRET_TOKEN || "";
    const timestamp = Date.now().toString();

    // Tạo mã xác thực HMAC SHA256 từ sessionId và timestamp bằng khoá bí mật
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${sessionId}:${timestamp}`);
    const token = hmac.digest("hex");

    return NextResponse.json({
      sessionId,
      timestamp,
      token
    });
  } catch (err) {
    console.error("[Token API] Lỗi tạo token xác thực:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
