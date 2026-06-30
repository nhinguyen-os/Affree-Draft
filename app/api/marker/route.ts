import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const color = searchParams.get("color") || "3948e6";
  // Ensure the color is prefixed with '#'
  const cleanColor = color.startsWith("#") ? color : `#${color}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path fill="${cleanColor}" stroke="#fff" stroke-width="1.5" d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/>
    <circle cx="12" cy="9" r="2.6" fill="#fff"/>
  </svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
