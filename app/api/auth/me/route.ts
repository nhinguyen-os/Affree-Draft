import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";

/** Trả về user hiện đăng nhập (đọc cookie phiên) hoặc null. */
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ ok: true, user });
}
