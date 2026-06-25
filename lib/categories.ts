export const CATEGORY_GROUPS: { label: string; test: RegExp }[] = [
  { label: "Mẹ & bé", test: /\bbé\b|\bmẹ\b|bỉm|bĩm|\btã\b|dinh dưỡng cho mẹ/ },
  {
    label: "Trang sức",
    test: /trang sức|bông tai|hoa tai|dây chuyền|mặt dây|\bnhẫn\b|lắc tay|vòng tay|vòng cổ|kim cương|ngọc trai|\bcharm\b|\bpnj\b|đồng vàng|vàng trắng|vàng 75|vàng 58|nữ trang/,
  },
  {
    label: "Nhà cửa & vệ sinh",
    test: /nhà cửa|nhà bếp|giặt|hóa phẩm|đồ dùng gia đình|giấy vệ sinh|khăn giấy|chăm sóc gia đình|chăm sóc nhà|đời sống|lau sàn|lau nhà|rửa chén|rửa bát|nước rửa|nước tẩy|tẩy rửa|lau kính|xịt phòng/,
  },
  {
    label: "Chăm sóc cá nhân",
    test: /chăm sóc (da|tóc|cơ thể|cá nhân|sức khỏe|bé)|tắm gội|gel gội|gel tắm|gội đầu|dầu gội|dưỡng tóc|sữa tắm|sữa rửa mặt|sắc đẹp|sức khỏe|trang điểm|mỹ phẩm|nước hoa|vitamin|vatamin|răng miệng|kem đánh răng|dầu xả|làm đẹp|son môi|kem dưỡng|kem chống nắng|toner|serum|tẩy trang|xà bông|xà phòng/,
  },
  { label: "Đồ uống", test: /bia|rượu|nước giải khát|nước uống|đồ uống|thức uống|\btrà\b|trà xanh|cà phê|nước ngọt|coca|pepsi|7 ?up|nước suối|nước chanh|nước ép|nước dừa|soda|sinh tố|trà sữa|nước cam/ },
  { label: "Sữa", test: /\bsữa\b|sữa tươi|sữa đặc|sữa chua/ },
  {
    label: "Thực phẩm",
    test: /thịt|cá|trứng|hải sản|rau|củ|quả|nấm|trái cây|gạo|bột|đồ khô|mì|miến|cháo|phở|nui|bún|dầu ăn|nước chấm|nuoc cham|gia vị|gia vi|mắm|tương|sốt|đồ hộp|đóng hộp|thực phẩm|bánh|kẹo|snack|kem|ngũ cốc|lạp xưởng|xúc xích|hạt|sấy|mứt|thạch|rong biển|thức ăn|đồ ăn|nếp|đậu|bách hóa|cơm|teppan|hầm|nướng|chiên|đường|hạt nêm|bột ngọt|hủ tiếu|hủ tíu|xào|lẩu|canh|súp|gỏi|chè|bò|gà|heo|tôm|mực|salad|pizza|burger|sandwich|nem|chả|giò/,
  },
];

export function categoryGroup(
  input: { name?: string; brand?: string; category?: string; group?: string } | string
): string {
  if (typeof input !== "string" && input.group && input.group.trim()) {
    const raw = input.group.normalize("NFC").trim();
    const g = raw.toLowerCase();
    const exact = CATEGORY_GROUPS.find((x) => x.label.normalize("NFC").toLowerCase() === g);
    if (exact) return exact.label;
    if (g === "khác" || g === "khac") return "Khác";
    return raw;
  }
  const c =
    typeof input === "string"
      ? input
      : `${input.category || ""} ${input.name || ""} ${input.brand || ""}`;
  const s = c.normalize("NFC").toLowerCase();
  for (const g of CATEGORY_GROUPS) if (g.test.test(s)) return g.label;
  return "Khác";
}

export const GROUP_TILE: Record<string, { emoji: string; tint: string; label?: string }> = {
  "Thực phẩm": { emoji: "🍜", tint: "bg-amber-100 text-amber-700", label: "Đồ ăn" },
  "Sữa": { emoji: "🥛", tint: "bg-sky-100 text-sky-700" },
  "Đồ uống": { emoji: "🥤", tint: "bg-cyan-100 text-cyan-700" },
  "Chăm sóc cá nhân": { emoji: "💄", tint: "bg-pink-100 text-pink-600", label: "Mỹ phẩm" },
  "Nhà cửa & vệ sinh": { emoji: "🧴", tint: "bg-lime-100 text-lime-700", label: "Nhà cửa" },
  "Trang sức": { emoji: "💍", tint: "bg-violet-100 text-violet-700" },
  "Mẹ & bé": { emoji: "🍼", tint: "bg-rose-100 text-rose-600" },
  "Khác": { emoji: "🛒", tint: "bg-slate-100 text-slate-600" },
};

export const DEFAULT_TILE_EMOJIS = ["🛍️", "🏷️", "📦", "🧺", "🛒", "✨", "🎁", "🔖"];
export const DEFAULT_TILE_TINTS = [
  "bg-indigo-100 text-indigo-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-emerald-100 text-emerald-700",
  "bg-blue-100 text-blue-700",
];

export type ServiceTile = {
  key: string;
  label: string;
  emoji: string;
  tint: string;
  kind: "filter" | "all" | "link" | "soon";
  cat?: string;
  url?: string;
};

export function buildCategoryTiles(
  products: { name?: string; brand?: string; category?: string; group?: string }[]
): ServiceTile[] {
  const present = new Set(products.map((p) => categoryGroup(p)));
  const canonical = CATEGORY_GROUPS.map((g) => g.label);
  const ordered = canonical.filter((label) => present.has(label));
  const custom = [...present]
    .filter((label) => !canonical.includes(label) && label !== "Khác")
    .sort((a, b) => a.localeCompare(b, "vi"));
  ordered.push(...custom);
  if (present.has("Khác")) ordered.push("Khác");

  return ordered.map((label, i) => {
    const t = GROUP_TILE[label];
    return {
      key: `cat-${label}`,
      label: t?.label ?? label,
      emoji: t?.emoji ?? DEFAULT_TILE_EMOJIS[i % DEFAULT_TILE_EMOJIS.length],
      tint: t?.tint ?? DEFAULT_TILE_TINTS[i % DEFAULT_TILE_TINTS.length],
      kind: "filter" as const,
      cat: label,
    };
  });
}
