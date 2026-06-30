import { NextResponse } from "next/server";
import { fetchMusicAlbums } from "@/lib/sheet-music";

/** GET /api/music → { albums } đọc từ tab "KhucCham" (Google Sheet), fallback seed. */
export async function GET() {
  const albums = await fetchMusicAlbums(30);
  return NextResponse.json({ albums });
}
