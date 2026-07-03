import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Strip Vietnamese diacritics → ASCII uppercase to compare safely
function normVi(s: string): string {
  return (s ?? '')
    .replace(/[àáâãăạảấầẩẫậắằẳẵặ]/gi, 'a')
    .replace(/[èéêẹẻẽếềểễệ]/gi, 'e')
    .replace(/[ìíỉĩị]/gi, 'i')
    .replace(/[òóôõơọỏốồổỗộớờởỡợ]/gi, 'o')
    .replace(/[ùúưụủũứừửữự]/gi, 'u')
    .replace(/[ỳýỹỵỷ]/gi, 'y')
    .replace(/[đ]/gi, 'd')
    .toUpperCase();
}

function catMeta(cat: string): { color: string; icon: string } {
  const n = normVi(cat);
  // icon = SVG snippet (centered around 12,10 in a 24×31 viewBox, drawn in "currentColor")
  const fork = `<g fill="currentColor"><rect x="10.3" y="5.5" width="0.9" height="5.5" rx="0.4"/><rect x="12" y="5.5" width="0.9" height="5.5" rx="0.4"/><rect x="13.7" y="5.5" width="0.9" height="5.5" rx="0.4"/><rect x="11.55" y="8.2" width="1.9" height="0.7" rx="0.3"/><rect x="11.8" y="9" width="1.4" height="5" rx="0.5"/><rect x="9.7" y="5.5" width="0.9" height="8.8" rx="0.4"/><path d="M9.7 7.5 Q8.8 6.5 9.7 5.5" stroke="currentColor" stroke-width="0.5" fill="none"/></g>`;
  const scissors = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"><circle cx="10" cy="8.5" r="1.5"/><circle cx="14" cy="8.5" r="1.5"/><line x1="11.1" y1="9.4" x2="14.5" y2="14"/><line x1="12.9" y1="9.4" x2="9.5" y2="14"/></g>`;
  const cart = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="8,7 9.2,7 10.5,12.5 13.8,12.5"/><polyline points="9.2,7 9.8,11 14.5,11 15.2,8 9.2,7"/><circle cx="11" cy="14" r="0.8" fill="currentColor"/><circle cx="13.5" cy="14" r="0.8" fill="currentColor"/></g>`;
  const sport = `<g stroke="currentColor" stroke-width="0.9" fill="none"><circle cx="12" cy="10" r="4"/><path d="M8.5 7.5 Q12 9 15.5 7.5"/><path d="M8.5 12.5 Q12 11 15.5 12.5"/><line x1="12" y1="6" x2="12" y2="14"/></g>`;
  const bed = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="9" width="8" height="5" rx="0.8"/><rect x="9.5" y="7.5" width="2.5" height="2" rx="0.6" fill="currentColor"/><line x1="8" y1="9" x2="8" y2="14.5"/><line x1="16" y1="9" x2="16" y2="14.5"/></g>`;
  const briefcase = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="7" height="5" rx="0.8"/><path d="M10.5 8.5 V7.5 Q10.5 6.8 11 6.8 H13 Q13.5 6.8 13.5 7.5 V8.5"/><line x1="8.5" y1="11" x2="15.5" y2="11"/></g>`;
  const car = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="9" width="8" height="4" rx="1"/><path d="M9 9 L9.8 7 H14.2 L15 9"/><circle cx="10" cy="13.5" r="1" fill="currentColor"/><circle cx="14" cy="13.5" r="1" fill="currentColor"/></g>`;
  const phone = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="6" width="4" height="8" rx="0.8"/><line x1="11.5" y1="13" x2="12.5" y2="13"/></g>`;
  const bank = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="8" x2="16" y2="8"/><line x1="12" y1="6.5" x2="8" y2="8"/><line x1="12" y1="6.5" x2="16" y2="8"/><line x1="9.5" y1="8" x2="9.5" y2="13"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="14.5" y1="8" x2="14.5" y2="13"/><line x1="8" y1="13" x2="16" y2="13"/></g>`;
  const book = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="6.5" width="3.5" height="7" rx="0.4"/><rect x="12" y="6.5" width="3.5" height="7" rx="0.4"/><line x1="12" y1="6.5" x2="12" y2="13.5"/><line x1="8.5" y1="13.5" x2="15.5" y2="13.5"/></g>`;
  const shirt = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="10,6.5 8,9 9.5,10 9.5,14.5 14.5,14.5 14.5,10 16,9 14,6.5"/><path d="M10 6.5 Q12 8 14 6.5"/></g>`;
  const store = `<g stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="8,9.5 12,6.5 16,9.5"/><rect x="9" y="9.5" width="6" height="5" rx="0.5"/><rect x="11" y="11.5" width="2" height="3"/></g>`;

  if (n.includes('AN UONG'))                               return { color: '#ea580c', icon: fork };
  if (n.includes('THOI TRANG'))                            return { color: '#7c3aed', icon: shirt };
  if (n.includes('LAM DEP') || n.includes('THU GIAN'))     return { color: '#db2777', icon: scissors };
  if (n.includes('CUA HANG') || n.includes('SIEU THI'))    return { color: '#2563eb', icon: cart };
  if (n.includes('VAN HOA') || n.includes('GIAI TRI'))     return { color: '#b45309', icon: book };
  if (n.includes('THE DUC') || n.includes('THE THAO'))     return { color: '#dc2626', icon: sport };
  if (n.includes('LUU TRU'))                               return { color: '#0d9488', icon: bed };
  if (n.includes('OFFICE'))                                return { color: '#475569', icon: briefcase };
  if (n.includes('OTO') || n.includes('XE MAY') || n.includes('XE DAP')) return { color: '#78716c', icon: car };
  if (n.includes('VI TINH') || n.includes('DIEN THOAI'))   return { color: '#4f46e5', icon: phone };
  if (n.includes('NGAN HANG'))                             return { color: '#15803d', icon: bank };
  if (n.includes('GIAO DUC'))                              return { color: '#0369a1', icon: book };
  return { color: '#64748b', icon: store };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const color = searchParams.get("color") || "3948e6";
  const pinColorBase = color.startsWith("#") ? color : `#${color}`;
  const cat = searchParams.get("cat") || "";

  const meta = cat ? catMeta(cat) : null;
  const pinColor = meta ? meta.color : pinColorBase;
  const iconEl = meta
    ? `<g color="${meta.color}">${meta.icon}</g>`
    : `<circle cx="12" cy="10" r="2.6" fill="white"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 31" width="24" height="31">
    <path fill="${pinColor}" stroke="#fff" stroke-width="1.2" d="M12 1C7 1 2 6 2 11c0 7 10 19 10 19s10-12 10-19c0-5-5-10-10-10z"/>
    <circle cx="12" cy="10" r="6" fill="white" opacity="0.92"/>
    ${iconEl}
  </svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
