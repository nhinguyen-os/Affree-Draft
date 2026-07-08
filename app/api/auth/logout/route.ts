import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth-server";

/** Đăng xuất — xoá cookie phiên. */
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
