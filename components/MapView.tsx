"use client";

import { Component, useEffect, useState, useRef, useMemo, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  MapContainer,
  TileLayer,
  useMap,
  Circle,
  AttributionControl,
  Marker,
  ZoomControl,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import type { Chain, Store } from "@/lib/types";
import type { CskdCategory } from "@/lib/sheet-cskd";
import { chainColor, chainLabel, storeCurrency } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { type Lang, tr } from "@/lib/i18n";

// ── Routing types ──────────────────────────────────────────────
type TransportType = "car" | "bike" | "pedestrian";

type RoutingFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    name: string;
    length_m: number;
    duration: number;
    type: string;
    direction: string;
  };
};

type RoutingResult = {
  type: "FeatureCollection";
  features: RoutingFeature[];
  status: string;
};

// ── OSM/OSRM direction → biểu tượng mũi tên ──────────────────
function directionArrow(direction: string): string {
  const d = (direction || "").toUpperCase().trim();
  if (d.includes("SLIGHT") && d.includes("LEFT"))  return "↖";
  if (d.includes("SLIGHT") && d.includes("RIGHT")) return "↗";
  if (d.includes("SHARP")  && d.includes("LEFT"))  return "◀";
  if (d.includes("SHARP")  && d.includes("RIGHT")) return "▶";
  if (d.includes("U-TURN") || d.includes("UTURN")) return "↩";
  if (d.includes("LEFT"))     return "←";
  if (d.includes("RIGHT"))    return "→";
  if (d.includes("STRAIGHT") || d.includes("CONTINUE")) return "↑";
  return "↑";
}

// ── OSM/OSRM: dịch câu chỉ đường hoàn chỉnh (type + direction) → tiếng Việt ──
function directionLabel(stepType: string, direction: string, streetName?: string): string {
  const t  = (stepType  || "").toLowerCase().trim().replace(/[_\s]+/g, " ");
  const d  = (direction || "").toUpperCase().trim();
  const sl = d.includes("SLIGHT");
  const sh = d.includes("SHARP");
  const isLeft  = d.includes("LEFT");
  const isRight = d.includes("RIGHT");
  const isUturn = d.includes("U-TURN") || d.includes("UTURN");

  // Helper: tạo câu rẽ + tên đường
  const onto = (base: string) => streetName ? `${base} vào ${streetName}` : base;

  switch (t) {
    case "depart":         return onto("Xuất phát");
    case "arrive":         return streetName ? `Đến điểm: ${streetName}` : "Đã đến nơi";
    case "turn":
    case "fork": {
      if (isUturn)  return onto("Quay đầu xe");
      if (sh && isLeft)  return onto("Rẽ gấp trái");
      if (sh && isRight) return onto("Rẽ gấp phải");
      if (sl && isLeft)  return onto("Hơi rẽ trái");
      if (sl && isRight) return onto("Hơi rẽ phải");
      if (isLeft)        return onto("Rẽ trái");
      if (isRight)       return onto("Rẽ phải");
      return onto("Đi thẳng");
    }
    case "new name":       return onto("Đi thẳng");
    case "continue":       return onto("Đi thẳng");
    case "merge": {
      if (isLeft)  return onto("Nhập làn trái");
      if (isRight) return onto("Nhập làn phải");
      return onto("Nhập làn");
    }
    case "on ramp": {
      if (isLeft)  return onto("Lên đường dẫn, hướng trái");
      if (isRight) return onto("Lên đường dẫn, hướng phải");
      return onto("Lên đường dẫn");
    }
    case "off ramp": {
      if (isLeft)  return onto("Xuống đường dẫn, hướng trái");
      if (isRight) return onto("Xuống đường dẫn, hướng phải");
      return onto("Xuống đường dẫn");
    }
    case "end of road": {
      if (isLeft)  return onto("Cuối đường, rẽ trái");
      if (isRight) return onto("Cuối đường, rẽ phải");
      return onto("Cuối đường");
    }
    case "use lane": {
      if (isLeft)  return "Chọn làn trái";
      if (isRight) return "Chọn làn phải";
      return "Chọn làn";
    }
    case "roundabout":
    case "rotary":         return onto("Vào vòng xuyến");
    case "roundabout turn":
    case "rotary turn": {
      if (isLeft)  return onto("Rẽ trái trong vòng xuyến");
      if (isRight) return onto("Rẽ phải trong vòng xuyến");
      return onto("Tiếp tục trong vòng xuyến");
    }
    case "exit roundabout":
    case "exit rotary":    return onto("Ra khỏi vòng xuyến");
    case "notification":   return streetName || "Đoạn đường kế tiếp";
    default: {
      // fallback: ghép direction tiếng Việt
      if (isUturn)         return onto("Quay đầu xe");
      if (sh && isLeft)    return onto("Rẽ gấp trái");
      if (sh && isRight)   return onto("Rẽ gấp phải");
      if (sl && isLeft)    return onto("Hơi rẽ trái");
      if (sl && isRight)   return onto("Hơi rẽ phải");
      if (isLeft)          return onto("Rẽ trái");
      if (isRight)         return onto("Rẽ phải");
      return onto(streetName || "Đi thẳng");
    }
  }
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} giây`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)}h ${m % 60}p`;
}

function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

type MapMarker = {
  store: Store;
  price?: number;
  inStock?: boolean;
  cheapest?: boolean;
  nearest?: boolean;
};



function maskPhone(phone: string): string {
  const cleaned = (phone || "").trim();
  if (cleaned.length <= 4) return cleaned;
  const first2 = cleaned.substring(0, 2);
  const last2 = cleaned.substring(cleaned.length - 2);
  const middle = "x".repeat(cleaned.length - 4);
  return `${first2}${middle}${last2}`;
}

// Màu theo loại CSKD cho LEGEND — phải trùng palette catMeta của app/api/marker/route.ts
// (pin vẽ server-side qua /api/marker; legend client chỉ cần màu, không cần icon).
function normVi(s: string): string {
  return s
    .replace(/[àáâãăạảấầẩẫậắằẳẵặ]/gi, 'a')
    .replace(/[èéêẹẻẽếềểễệ]/gi, 'e')
    .replace(/[ìíỉĩị]/gi, 'i')
    .replace(/[òóôõơọỏốồổỗộớờởỡợ]/gi, 'o')
    .replace(/[ùúưụủũứừửữự]/gi, 'u')
    .replace(/[ỳýỹỵỷ]/gi, 'y')
    .replace(/[đ]/gi, 'd')
    .toUpperCase();
}

function catMeta(cat: string): { color: string } {
  const n = normVi(cat);
  if (n.includes('AN UONG'))                               return { color: '#ea580c' };
  if (n.includes('THOI TRANG'))                            return { color: '#7c3aed' };
  if (n.includes('LAM DEP') || n.includes('THU GIAN'))     return { color: '#db2777' };
  if (n.includes('CUA HANG') || n.includes('SIEU THI'))    return { color: '#2563eb' };
  if (n.includes('VAN HOA') || n.includes('GIAI TRI'))     return { color: '#b45309' };
  if (n.includes('THE DUC') || n.includes('THE THAO'))     return { color: '#dc2626' };
  if (n.includes('LUU TRU'))                               return { color: '#0d9488' };
  if (n.includes('OFFICE'))                                return { color: '#475569' };
  if (n.includes('OTO') || n.includes('XE MAY') || n.includes('XE DAP')) return { color: '#78716c' };
  if (n.includes('VI TINH') || n.includes('DIEN THOAI'))   return { color: '#4f46e5' };
  if (n.includes('NGAN HANG'))                             return { color: '#15803d' };
  if (n.includes('GIAO DUC'))                              return { color: '#0369a1' };
  return { color: '#64748b' };
}

// SVG pin loaded from marker API
function storeIcon(color: string, cheapest: boolean, nearest: boolean, highlight: boolean, cheapestLabel: string, nearestLabel: string, loaiCskd?: string[]) {
  const w = cheapest ? 40 : highlight ? 36 : 30;
  const h = Math.round(w * 1.29);
  const ring = highlight
    ? 'filter:drop-shadow(0 0 0 2px #fff) drop-shadow(0 2px 6px rgba(0,0,0,.5));'
    : 'filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));';
  const tags: string[] = [];
  if (cheapest) tags.push(`<div style="background:#facc15;color:#000;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;white-space:nowrap">${cheapestLabel}</div>`);
  if (nearest) tags.push(`<div style="background:#3b82f6;color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;white-space:nowrap">${nearestLabel}</div>`);
  const tagHtml = tags.length ? `<div style="position:absolute;top:${tags.length > 1 ? '-22px' : '-6px'};left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px">${tags.join('')}</div>` : '';
  
  const cat = loaiCskd?.[0]?.split(' > ')[0] ?? '';
  const params = new URLSearchParams();
  if (color) params.set("color", color.replace("#", ""));
  if (cat) params.set("cat", cat);

  const iconUrl = `/api/marker?${params.toString()}`;

  return L.divIcon({
    className: '',
    html: `<div style="width:${w}px;height:${h}px;position:relative">${tagHtml}<img src="${iconUrl}" width="${w}" height="${h}" style="${ring}transition:width .15s,height .15s;display:block" /></div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h],
  });
}

// Lookup table: mỗi chip bán kính → zoom level riêng biệt.
// Nhỏ hơn → zoom cao hơn (circle chiếm ~50% chiều cao map).
const RADIUS_ZOOM: [number, number][] = [
  [0.05, 17], // 50m
  [0.1,  16], // 100m
  [0.15, 16], // 150m
  [0.3,  15], // 300m
  [0.5,  14], // 500m
  [0.7,  14], // 700m
  [1,    13], // 1km
];

function zoomForRadius(km?: number | null): number | undefined {
  if (!km) return undefined;
  // Chọn zoom sao cho đường kính circle ≈ 30% chiều ngắn của map (chừa lề rộng,
  // thấy được khu vực xung quanh để định vị). z ≈ log2(156543 / (km*20)).
  // 50m→17, 100m→16, 150m→16, 300m→15, 500m→14, 700m→13, 1km→13,
  // 3km→11, 5km→11, 10km→10.
  const z = Math.log2(156543 / (km * 20)) + 1;
  return Math.max(10, Math.min(18, Math.round(z)));
}

function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function ClusterGroup({
  markers,
  highlightId,
  t,
  onMarkerClick,
}: {
  markers: MapMarker[];
  highlightId?: string | null;
  t: (vi: string) => string;
  onMarkerClick: (marker: MapMarker) => void;
}) {
  const map = useMap();
  const clusterGroupRef = useRef<any>(null);

  // t/onMarkerClick là arrow function mới mỗi render của parent — nếu đưa thẳng vào deps
  // thì effect rebuild TOÀN BỘ marker (~4-5k pin) mỗi lần MapView re-render → đứng UI.
  // Giữ qua ref: marker luôn gọi bản mới nhất mà effect không cần chạy lại.
  const tRef = useRef(t);
  tRef.current = t;
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  useEffect(() => {
    clusterGroupRef.current = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      disableClusteringAtZoom: 10,
    });
    map.addLayer(clusterGroupRef.current);

    return () => {
      if (clusterGroupRef.current) {
        map.removeLayer(clusterGroupRef.current);
      }
    };
  }, [map]);

  useEffect(() => {
    const cluster = clusterGroupRef.current;
    if (!cluster) return;

    cluster.clearLayers();

    markers
      .filter((m) => m.store.lat != null && m.store.lng != null)
      .forEach((m) => {
        const marker = L.marker([m.store.lat as number, m.store.lng as number], {
          icon: storeIcon(chainColor(m.store.chain), !!m.cheapest, !!m.nearest, m.store.id === highlightId, tRef.current("RẺ NHẤT"), tRef.current("GẦN NHẤT"), m.store.loaiCskd),
        });

        marker.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          onMarkerClickRef.current(m);
        });

        cluster.addLayer(marker);
      });
  }, [markers, highlightId, map]);

  return null;
}

// Khoảng cách Haversine (km) giữa 2 toạ độ — để ẩn pin nằm ngoài bán kính lọc.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Bọc <MapContainer>: react-leaflet 5 + React 19 Strict Mode (dev) đôi khi ném
// "Map container is being reused by another instance" khi mount kép → crash cả trang
// (phải F5). Boundary này bắt lỗi rồi tự remount map bằng key mới, không treo trang.
class MapBoundary extends Component<{ children: (key: number) => ReactNode }, { key: number; errored: boolean }> {
  state = { key: 0, errored: false };
  static getDerivedStateFromError() {
    return { errored: true };
  }
  componentDidCatch() {
    // Remount sạch ở tick kế tiếp (container cũ đã được Leaflet dọn). Giới hạn 3 lần để
    // tránh lặp vô hạn nếu lỗi tái diễn liên tục.
    if (this.state.key >= 3) return;
    setTimeout(() => this.setState((s) => ({ key: s.key + 1, errored: false })), 60);
  }
  render() {
    if (this.state.errored) {
      return <div style={{ height: "100%", width: "100%", background: "#eef2f7" }} />;
    }
    return this.props.children(this.state.key);
  }
}

export default function MapView({
  center,
  userLoc,
  userAddr,
  markers,
  highlightId,
  radiusKm,
  onRadiusChange,
  onViewChange,
  onBuy,
  onStorePick,
  lang = "vi",
  tileUrl,
  cskdTaxonomy,
}: {
  center: [number, number];
  userLoc: { lat: number; lng: number } | null;
  userAddr?: string;
  markers: MapMarker[];
  highlightId?: string | null;
  radiusKm?: number | null;
  /** Gọi khi user zoom map thủ công → cập nhật chip bán kính theo zoom hiện tại. */
  onRadiusChange?: (km: number | null) => void;
  /** Gọi khi user pan/zoom tay → để parent sync center sang map khác. */
  onViewChange?: (center: [number, number], zoom: number) => void;
  onBuy?: (store: Store) => void;
  /** Bấm "Xem sản phẩm cửa hàng" trong popup pin → mở danh sách sản phẩm của cửa hàng đó. */
  onStorePick?: (store: Store) => void;
  lang?: Lang;
  tileUrl?: string;
  /** Taxonomy Loại CSKD — nếu có, legend hiển thị dạng category tree thay vì chain list. */
  cskdTaxonomy?: CskdCategory[];
}) {
  const t = (vi: string) => tr(lang, vi);
  const [map, setMap] = useState<L.Map | null>(null);
  const [selectedStore, setSelectedStore] = useState<MapMarker | null>(null);
  const [portalPos, setPortalPos] = useState<{ x: number; y: number; anchor: "bottom" | "top" } | null>(null);
  const [showFullPhone, setShowFullPhone] = useState(false);

  useEffect(() => {
    setShowFullPhone(false);
  }, [selectedStore]);

  const displayCategory = selectedStore
    ? (selectedStore.store.loaiCskd?.[0] || chainLabel(selectedStore.store.chain))
    : "";

  // ── Routing state ──
  const [routingTarget, setRoutingTarget] = useState<Store | null>(null);
  const [transportType, setTransportType] = useState<TransportType>("car");
  const [routingResult, setRoutingResult] = useState<RoutingResult | null>(null);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);

  // Tạo Google Maps fallback URL
  const googleMapsUrl = useCallback((store: Store, transport: TransportType) => {
    const travelMode = transport === "car" ? "driving" : transport === "bike" ? "driving" : "walking";
    return `https://www.google.com/maps/dir/?api=1${userLoc ? `&origin=${userLoc.lat},${userLoc.lng}` : ""}&destination=${store.lat},${store.lng}&travelmode=${travelMode}`;
  }, [userLoc]);

  const fetchRouting = useCallback(async (store: Store, transport: TransportType) => {
    if (!userLoc || store.lat == null || store.lng == null) return;
    setRoutingLoading(true);
    setRoutingError(null);
    setRoutingResult(null);
    try {
      const params = new URLSearchParams({
        transport,
        x1: String(userLoc.lng),
        y1: String(userLoc.lat),
        x2: String(store.lng),
        y2: String(store.lat),
      });
      const res = await fetch(`/api/routing?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RoutingResult = await res.json();

      // Nếu API không trả về features hợp lệ → fallback Google Maps
      if (!Array.isArray(data?.features) || data.features.length === 0) {
        setRoutingTarget(null);
        window.open(googleMapsUrl(store, transport), "_blank", "noopener,noreferrer");
        return;
      }

      setRoutingResult(data);
    } catch (err) {
      // Lỗi network hoặc upstream → fallback Google Maps
      setRoutingTarget(null);
      window.open(googleMapsUrl(store, transport), "_blank", "noopener,noreferrer");
    } finally {
      setRoutingLoading(false);
    }
  }, [userLoc, googleMapsUrl]);

  // Mỗi khi chọn phương tiện → fetch lại nếu đang mở overlay
  useEffect(() => {
    if (routingTarget) fetchRouting(routingTarget, transportType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportType]);

  // Polyline coordinates từ tất cả features
  const routePolyline: [number, number][] = useMemo(() => {
    if (!routingResult || !Array.isArray(routingResult.features)) return [];
    const pts: [number, number][] = [];
    for (const f of routingResult.features) {
      for (const [lng, lat] of f.geometry.coordinates) {
        pts.push([lat, lng]);
      }
    }
    return pts;
  }, [routingResult]);

  // Fit map to route khi có kết quả
  useEffect(() => {
    if (!map || routePolyline.length < 2) return;
    map.fitBounds(L.latLngBounds(routePolyline), { padding: [40, 40] });
  }, [map, routePolyline]);

  const openRouting = useCallback((store: Store) => {
    setRoutingTarget(store);
    setSelectedStore(null);
    setPortalPos(null);
    fetchRouting(store, transportType);
  }, [fetchRouting, transportType]);

  const closeRouting = useCallback(() => {
    setRoutingTarget(null);
    setRoutingResult(null);
    setRoutingError(null);
    // Bay về vị trí cũ
    if (map) {
      const zoom = zoomForRadius(radiusKm) ?? 13;
      if (userLoc) map.flyTo([userLoc.lat, userLoc.lng], zoom, { duration: 0.5 });
    }
  }, [map, userLoc, radiusKm]);

  // Labels localized
  const TRANSPORT_LABELS: Record<TransportType, string> = {
    car: t("Ô tô"),
    bike: t("Xe máy"),
    pedestrian: t("Đi bộ"),
  };
  const TRANSPORT_ICONS: Record<TransportType, string> = {
    car: "🚗",
    bike: "🛵",
    pedestrian: "🚶",
  };

  // Tính lại vị trí popup pin (portalPos) dựa trên toạ độ store hiện tại của marker đã chọn.
  // Anchor "top" = popup ở DƯỚI marker, "bottom" = popup ở TRÊN marker. Chọn hướng có chỗ
  // trống đủ chứa popup trong map; nếu cả hai đều đủ, theo heuristic 0.45.
  const computePortalPos = useCallback((store: Store) => {
    if (!map) return null;
    if (store.lat == null || store.lng == null) return null;
    const pt = map.latLngToContainerPoint([store.lat as number, store.lng as number]);
    const rect = map.getContainer().getBoundingClientRect();
    const POPUP_H = 140;          // ước lượng chiều cao popup
    const OFFSET_BELOW = 20;       // khoảng cách marker → popup khi popup ở dưới
    const OFFSET_ABOVE = 46;       // khi popup ở trên (gồm arrow tip)
    const fitsBelow = pt.y + OFFSET_BELOW + POPUP_H <= rect.height;
    const fitsAbove = pt.y - OFFSET_ABOVE - POPUP_H >= 0;
    let anchor: "bottom" | "top";
    if (fitsAbove && !fitsBelow) anchor = "bottom";
    else if (fitsBelow && !fitsAbove) anchor = "top";
    else anchor = pt.y < rect.height * 0.45 ? "top" : "bottom";
    return { x: rect.left + pt.x, y: rect.top + pt.y, anchor };
  }, [map]);
  const [legendOpen, setLegendOpen] = useState(true);
  // Chain bị ẨN khỏi map (user bấm vào dòng chain trong legend để toggle).
  const [hiddenChains, setHiddenChains] = useState<Set<Chain>>(new Set());
  // CSKD filter: set các "CATEGORY > Sub" đang được CHỌN (checked). Rỗng = tất cả hiển thị.
  const [checkedCskd, setCheckedCskd] = useState<Set<string>>(new Set());
  // Category nào đang expand trong CSKD legend. MẶC ĐỊNH: rỗng = thu gọn hết, không tick sẵn
  // (checkedCskd rỗng = hiện tất cả marker). User tự bung/tick khi muốn lọc.
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const recenter = useCallback(() => {
    if (!userLoc || !map || userLoc.lat == null || userLoc.lng == null || isNaN(userLoc.lat) || isNaN(userLoc.lng)) return;
    const size = map.getSize();
    if (size.x > 0 && size.y > 0) {
      map.flyTo([userLoc.lat, userLoc.lng], 15, { duration: 0.5 });
    } else {
      map.setView([userLoc.lat, userLoc.lng], 15);
    }
  }, [userLoc, map]);

  // initialViewState CHỈ áp 1 lần lúc mount → khi đổi vị trí (vd search địa chỉ mới, kể cả
  // nước ngoài như Paris), prop center đổi nhưng map không tự nhảy. Effect này bay map tới
  // center mới mỗi khi nó đổi. Khi BỎ filter (radiusKm=null) → quay về zoom default 13 để
  // sync với chip "Bỏ giới hạn", không kẹt lại ở zoom cao của bán kính nhỏ trước đó.
  const [centerLat, centerLng] = center;
  // Flag để phân biệt zoom do code (flyTo/setView) và zoom do tay người dùng.
  const programmaticZoom = useRef(false);
  useEffect(() => {
    if (!map || centerLat == null || centerLng == null || isNaN(centerLat) || isNaN(centerLng)) return;
    const size = map.getSize();
    const zoom = zoomForRadius(radiusKm) ?? 13;
    programmaticZoom.current = true;
    if (size.x > 0 && size.y > 0) {
      map.flyTo([centerLat, centerLng], zoom, { duration: 0.6 });
    } else {
      map.setView([centerLat, centerLng], zoom);
    }
  }, [centerLat, centerLng, radiusKm, map]);

  const onRadiusChangeRef = useRef(onRadiusChange);
  onRadiusChangeRef.current = onRadiusChange;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  // Khi user pan/zoom tay → báo center mới về parent để sync map khác.
  useEffect(() => {
    if (!map) return;
    const handler = () => {
      if (programmaticZoom.current) { programmaticZoom.current = false; return; }
      const c = map.getCenter();
      onViewChangeRef.current?.([c.lat, c.lng], map.getZoom());
    };
    map.on("moveend", handler);
    return () => { map.off("moveend", handler); };
  }, [map]);

  // Popup pin dùng position:fixed portal vào body → set 1 lần lúc click sẽ không theo map khi
  // user pan/zoom/scroll page → popup "ra khỏi" map. Đăng ký listener để recompute liên tục.
  // Gộp qua requestAnimationFrame: scroll/move bắn hàng chục event/giây — mỗi event một
  // setState là thừa (re-render dồn dập); rAF giới hạn tối đa 1 lần/khung hình.
  useEffect(() => {
    if (!selectedStore || !map) return;
    let raf = 0;
    const update = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setPortalPos(computePortalPos(selectedStore.store));
      });
    };
    map.on("move", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      map.off("move", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [selectedStore, computePortalPos, map]);



  // Đếm số cửa hàng theo từng chain (để hiển thị "BHX (12)" trong chú thích).
  // Dùng object thay Map vì identifier `Map` trùng với react-map-gl/maplibre's Map.
  // Đang lọc theo bán kính → chỉ giữ pin nằm TRONG vòng tròn (ngoài bán kính ẩn hẳn).
  // useMemo BẮT BUỘC: .filter() tạo array mới mỗi render → identity đổi → ClusterGroup
  // rebuild toàn bộ pin (~4-5k) mỗi lần re-render (vd popup pin update vị trí khi scroll) → đứng UI.
  const radiusMarkers = useMemo(
    () =>
      radiusKm && userLoc
        ? markers.filter(
          (m) =>
            m.store.lat != null &&
            m.store.lng != null &&
            haversineKm(userLoc.lat, userLoc.lng, m.store.lat, m.store.lng) <= radiusKm,
        )
        : markers,
    [markers, radiusKm, userLoc],
  );

  const chainKeys: Chain[] = [];
  const chainCounts: Record<string, number> = {};

  for (const m of radiusMarkers) {
    if (m.store.lat == null || m.store.lng == null) continue;
    if (!chainKeys.includes(m.store.chain)) chainKeys.push(m.store.chain);
    chainCounts[m.store.chain] = (chainCounts[m.store.chain] ?? 0) + 1;
  }
  // Đóng legend CHỈ ẩn bảng chú thích, pin trên map giữ nguyên (filter đã chọn vẫn áp dụng).
  // CSKD mode: checkedCskd rỗng = hiện tất cả; có giá trị = chỉ hiện store có loaiCskd giao với
  // checkedCskd. Store CHƯA phân loại (không có loaiCskd) LUÔN hiện — tránh ẩn nhầm cửa hàng
  // offer thuộc chuỗi không có dữ liệu CSKD trên map so sánh giá.
  const visibleMarkers = useMemo(
    () =>
      radiusMarkers.filter((m) => {
        if (!hiddenChains.has(m.store.chain)) {
          if (cskdTaxonomy && checkedCskd.size > 0) {
            const lc = m.store.loaiCskd ?? [];
            return lc.length === 0 || lc.some((l) => checkedCskd.has(l));
          }
          return true;
        }
        return false;
      }),
    [radiusMarkers, hiddenChains, checkedCskd, cskdTaxonomy],
  );

  // Load configured map url from process.env if tileUrl is not provided
  const mapLayer = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAP_LAYER || "mvp_map" : "mvp_map";
  const defaultUrl = `https://mapcdn{s}.goollow.org/tiles/${mapLayer}/{z}/{x}/{y}.jpeg`;
  const resolvedTileUrl = tileUrl || (typeof process !== "undefined" ? (process.env.NEXT_PUBLIC_MAP_URL || defaultUrl).replace("{layer}", mapLayer) : defaultUrl);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <MapBoundary>
      {(boundaryKey) => (
      <MapContainer
        key={boundaryKey}
        ref={setMap}
        center={center}
        zoom={zoomForRadius(radiusKm) ?? 13}
        style={{ height: "100%", width: "100%" }}
        attributionControl={false}
        zoomControl={false}
      >
        <AttributionControl prefix={false} />
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution='<span style="font-family: Roboto, Arial, sans-serif; font-size: 10px; user-select: none; white-space: nowrap; color: #000000; direction: ltr; line-height: 14px;">© One Solution | <a href="https://www.openstreetmap.org/" target="_blank" style="color: black">OSM</a></span>'
          url={resolvedTileUrl}
        />
        <AutoResize />

        {userLoc && radiusKm && (
          <Circle
            center={[userLoc.lat, userLoc.lng]}
            radius={radiusKm * 1000}
            pathOptions={{ color: "#2563eb", weight: 1.5, fillColor: "#3b82f6", fillOpacity: 0.07 }}
          />
        )}

        {userLoc && (
          <Marker
            position={[userLoc.lat, userLoc.lng]}
            icon={L.divIcon({
              className: "",
              html: `<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:2.5px solid #fff;box-shadow:0 0 0 3px rgba(59,130,246,0.3);"></div>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            })}
            title={userAddr || t("Vị trí của bạn")}
          />
        )}

        <ClusterGroup
          markers={routingTarget ? [] : visibleMarkers}
          highlightId={highlightId}
          t={t}
          onMarkerClick={(m) => {
            setPortalPos(computePortalPos(m.store));
            setSelectedStore(m);
          }}
        />

        {/* Destination marker khi đang chỉ đường */}
        {routingTarget && routingTarget.lat != null && routingTarget.lng != null && (
          <Marker
            position={[routingTarget.lat as number, routingTarget.lng as number]}
            icon={L.divIcon({
              className: "",
              html: `<div style="position:relative;width:28px;height:36px">
                <svg viewBox="0 0 24 32" width="28" height="36" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#dc2626" stroke="#fff" stroke-width="1.2" d="M12 1C7.03 1 3 5.03 3 10c0 7 9 21 9 21s9-14 9-21c0-4.97-4.03-9-9-9z"/>
                  <circle cx="12" cy="10" r="4" fill="#fff"/>
                </svg>
              </div>`,
              iconSize: [28, 36],
              iconAnchor: [14, 36],
            })}
            title={routingTarget.name}
          />
        )}

        {selectedStore && portalPos && typeof document !== "undefined" && createPortal(
          <div style={{ position: "fixed", left: portalPos.x, top: portalPos.anchor === "bottom" ? portalPos.y - 46 : portalPos.y + 20, transform: "translateX(-50%)" + (portalPos.anchor === "bottom" ? " translateY(-100%)" : ""), zIndex: 1200, pointerEvents: "auto" }}>
            {/* Arrow tip */}
            {portalPos.anchor === "bottom" && (
              <div style={{ position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: "8px solid rgba(255,255,255,0.9)", filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.1))" }} />
            )}
            {portalPos.anchor === "top" && (
              <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderBottom: "8px solid rgba(255,255,255,0.9)", filter: "drop-shadow(0 -2px 2px rgba(0,0,0,0.1))" }} />
            )}
            <div className="liquid-glass" style={{ borderRadius: 12, padding: "10px 32px 10px 10px", width: 190, fontFamily: "system-ui,sans-serif", position: "relative", fontSize: 12 }}>
              <button onClick={() => { setSelectedStore(null); setPortalPos(null); }} style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 999, background: "#f1f5f9", border: "none", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", padding: 0 }}>×</button>
              {displayCategory.length > 22 ? (
                <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden" }}>
                  <div className="animate-title-marquee" style={{ display: "flex", width: "max-content", whiteSpace: "nowrap" }}>
                    <span style={{ paddingRight: 24 }}>{displayCategory}</span>
                    <span style={{ paddingRight: 24 }}>{displayCategory}</span>
                  </div>
                </div>
              ) : (
                <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayCategory}</div>
              )}
              {selectedStore.store.phone && (
                <div style={{ fontSize: 11, color: "#444", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <span>
                    Liên hệ:{" "}
                    <a
                      href={`tel:${selectedStore.store.phone.replace(/\s+/g, "")}`}
                      style={{ color: "#2563eb", textDecoration: "none" }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                    >
                      {showFullPhone ? selectedStore.store.phone : maskPhone(selectedStore.store.phone)}
                    </a>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFullPhone(!showFullPhone)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      color: "#64748b",
                    }}
                  >
                    {showFullPhone ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                        <path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                        <line x1="2" x2="22" y1="2" y2="22"/>
                      </svg>
                    )}
                  </button>
                </div>
              )}
              {/* Tên cửa hàng dài → CHẠY CHỮ (2 bản nối nhau, kéo -50% là khớp) thay vì cắt "…" */}
              {selectedStore.store.name.length > 24 ? (
                <div style={{ fontSize: 11, color: "#444", overflow: "hidden", marginTop: 1 }}>
                  <div className="animate-title-marquee" style={{ display: "flex", width: "max-content", whiteSpace: "nowrap" }}>
                    <span style={{ paddingRight: 24 }}>{selectedStore.store.name}</span>
                    <span style={{ paddingRight: 24 }}>{selectedStore.store.name}</span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "#444", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{selectedStore.store.name}</div>
              )}
              {selectedStore.price != null && (
                <div style={{ marginTop: 3, fontWeight: 700, fontSize: 12, color: selectedStore.cheapest ? "#16a34a" : "#111" }}>
                  {selectedStore.inStock ? formatMoney(selectedStore.price, storeCurrency(selectedStore.store.id)) : t("Hết hàng")}
                </div>
              )}
              <div style={{ marginTop: 6, display: "flex", gap: 8, justifyContent: "center" }}>
                {onStorePick && (
                  <button type="button" aria-label={t("Sản phẩm")} title={t("Sản phẩm")} onClick={() => { onStorePick(selectedStore.store); setSelectedStore(null); setPortalPos(null); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#059669", color: "#fff", border: "none", borderRadius: 7, padding: "7px", cursor: "pointer" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
                  </button>
                )}
                <button type="button" aria-label={t("Chỉ đường")} title={t("Chỉ đường")} onClick={() => openRouting(selectedStore.store)} style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#d1fae5", color: "#047857", border: "none", borderRadius: 7, padding: "7px", cursor: "pointer" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
        {/* Route polyline */}
        {routePolyline.length > 1 && (
          <Polyline
            positions={routePolyline}
            pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.85, lineCap: "round", lineJoin: "round" }}
          />
        )}
      </MapContainer>
      )}
      </MapBoundary>

      {/* ── Routing Overlay ── */}
      {routingTarget && (
        <div style={{
          position: "absolute",
          inset: 0,
          zIndex: 2000,
          display: "flex",
          pointerEvents: "none",
        }}>
          {/* Left panel */}
          <div style={{
            width: 300,
            minWidth: 240,
            maxWidth: "90vw",
            height: "100%",
            background: "#fff",
            boxShadow: "2px 0 16px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            pointerEvents: "auto",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
          }}>
            {/* Header */}
            <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid #e2e8f0", background: "#ffffff", color: "#0f172a", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={closeRouting}
                  aria-label={t("Đóng")}
                  style={{ background: "#f1f5f9", border: "none", borderRadius: 999, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#475569", flexShrink: 0, transition: "background 0.15s" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#e2e8f0"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "#f1f5f9"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 1 }}>{t("Chỉ đường đến")}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{routingTarget.name}</div>
                </div>
              </div>

              {/* Transport selector */}
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {(["car", "bike", "pedestrian"] as TransportType[]).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setTransportType(tp)}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 2,
                      padding: "5px 4px",
                      background: transportType === tp ? "#eff6ff" : "#f8fafc",
                      border: transportType === tp ? "1.5px solid #3b82f6" : "1.5px solid #e2e8f0",
                      borderRadius: 8,
                      cursor: "pointer",
                      color: transportType === tp ? "#1d4ed8" : "#475569",
                      fontSize: 18,
                      lineHeight: 1,
                      transition: "all 0.15s",
                    }}
                  >
                    <span>{TRANSPORT_ICONS[tp]}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.85 }}>{TRANSPORT_LABELS[tp]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Summary bar */}
            {routingResult && Array.isArray(routingResult.features) && (() => {
              const totalDist = routingResult.features.reduce((s, f) => s + (f.properties.length_m ?? 0), 0);
              const totalDur = routingResult.features.reduce((s, f) => s + (f.properties.duration ?? 0), 0);
              return (
                <div style={{ padding: "8px 14px", background: "#f0f7ff", borderBottom: "1px solid #bfdbfe", display: "flex", gap: 16, flexShrink: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: "#1e40af", lineHeight: 1 }}>{fmtDuration(totalDur)}</span>
                    <span style={{ fontSize: 10, color: "#64748b" }}>{t("Thời gian dự kiến")}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: "#334155", lineHeight: 1 }}>{fmtDistance(totalDist)}</span>
                    <span style={{ fontSize: 10, color: "#64748b" }}>{t("Tổng khoảng cách")}</span>
                  </div>
                </div>
              );
            })()}

            {/* Steps list */}
            <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
              {routingLoading && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 160, gap: 10, color: "#64748b" }}>
                  <div style={{
                    width: 32, height: 32, border: "3px solid #e2e8f0", borderTopColor: "#2563eb",
                    borderRadius: "50%", animation: "routing-spin 0.7s linear infinite"
                  }} />
                  <span style={{ fontSize: 12 }}>{t("Đang tìm đường…")}</span>
                  <style>{`@keyframes routing-spin{to{transform:rotate(360deg)}}`}</style>
                </div>
              )}
              {routingError && (
                <div style={{ margin: 16, padding: "10px 12px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#dc2626", fontSize: 12 }}>
                  {routingError}
                </div>
              )}
              {routingResult && Array.isArray(routingResult.features) && routingResult.features.map((feature, idx) => {
                const { name, length_m, duration, type: stepType, direction } = feature.properties;
                const isDepart = stepType === "depart";
                const isArrive = stepType === "arrive";
                const arrow = directionArrow(direction);
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 14px",
                      borderBottom: "1px solid #f1f5f9",
                      background: isDepart || isArrive ? "#f8fafc" : "#fff",
                    }}
                  >
                    {/* Direction icon */}
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      background: isArrive ? "#dcfce7" : isDepart ? "#dbeafe" : "#f1f5f9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      flexShrink: 0,
                      color: isArrive ? "#16a34a" : isDepart ? "#2563eb" : "#475569",
                      fontWeight: 700,
                    }}>
                      {isArrive ? "📍" : isDepart ? "🚀" : arrow}
                    </div>
                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: "#1e293b", marginBottom: 2 }}>
                        {directionLabel(stepType, direction, name || undefined)}
                      </div>
                      <div style={{ display: "flex", gap: 8, fontSize: 10, color: "#94a3b8" }}>
                        {length_m > 0 && <span>{fmtDistance(length_m)}</span>}
                        {duration > 0 && <span>· {fmtDuration(duration)}</span>}
                      </div>
                    </div>
                    {/* Step number */}
                    <div style={{ fontSize: 10, color: "#cbd5e1", flexShrink: 0, marginTop: 2 }}>{idx + 1}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {userLoc && (
        <button
          type="button"
          onClick={recenter}
          aria-label={t("Về vị trí của tôi")}
          title={t("Về vị trí của tôi")}
          style={{
            position: "absolute",
            bottom: 110,
            right: 9,
            zIndex: 1000,
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            border: "none",
            borderRadius: 999,
            boxShadow: "0 1px 4px rgba(0,0,0,.3)",
            cursor: "pointer",
            color: "#2563eb",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      )
      }

      {
        legendOpen ? (
          <div
            className="liquid-glass"
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              zIndex: 1000,
              borderRadius: 10,
              padding: "6px 24px 8px 10px",
              fontSize: 12,
              lineHeight: 1.5,
              color: "#334155",
              pointerEvents: "auto",
              maxHeight: "calc(100% - 24px)",
              width: 220,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setLegendOpen(false)}
              aria-label={t("Ẩn chú thích")}
              title={t("Ẩn chú thích")}
              style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "#94a3b8", cursor: "pointer", borderRadius: 999, padding: 0 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>

            <div
              style={{ overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", minHeight: 0, paddingRight: 2 }}
              onWheel={(e) => e.stopPropagation()}
            >
              {/* Vị trí của bạn */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: "#3b82f6", display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#64748b" }}>{t("Vị trí của bạn")}</span>
              </div>

              {cskdTaxonomy ? (
                /* ── CSKD legend: category tree với checkboxes ── */
                <>
                  {checkedCskd.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setCheckedCskd(new Set())}
                      style={{ fontSize: 10, color: "#f97316", border: "none", background: "none", cursor: "pointer", padding: "0 0 4px", textDecoration: "underline" }}
                    >
                      {t("Bỏ chọn tất cả")}
                    </button>
                  )}
                  {cskdTaxonomy.map((catItem) => {
                    const isExpanded = expandedCats.has(catItem.category);
                    const catCount = radiusMarkers.filter((m) =>
                      (m.store.loaiCskd ?? []).some((l) => l.startsWith(catItem.category + " > ") || l === catItem.category)
                    ).length;
                    if (catCount === 0) return null;

                    const activeSubs = catItem.subs.filter((sub) =>
                      radiusMarkers.some((m) => (m.store.loaiCskd ?? []).includes(`${catItem.category} > ${sub}`))
                    );

                    return (
                      <div key={catItem.category} style={{ marginBottom: 2 }}>
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", padding: "2px 0" }}
                          onClick={() =>
                            setExpandedCats((prev) => {
                              const next = new Set(prev);
                              if (next.has(catItem.category)) next.delete(catItem.category);
                              else next.add(catItem.category);
                              return next;
                            })
                          }
                        >
                          {/* Màu bookmark = màu pin của loại CSKD trên map (catMeta) để đối chiếu nhanh. */}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill={catMeta(catItem.category).color} stroke={catMeta(catItem.category).color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                          </svg>
                          <span style={{ fontWeight: 700, fontSize: 11, color: "#1e293b", flex: 1 }}>{catItem.category}</span>
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>({catCount})</span>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </div>

                        {isExpanded && (
                          <div style={{ paddingLeft: 16 }}>
                            {activeSubs.map((sub) => {
                              const key = `${catItem.category} > ${sub}`;
                              const checked = checkedCskd.has(key);
                              const subCount = radiusMarkers.filter((m) =>
                                (m.store.loaiCskd ?? []).includes(key)
                              ).length;
                              return (
                                <label
                                  key={sub}
                                  style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "1px 0", color: checked ? "#f97316" : "#475569", fontSize: 11 }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      setCheckedCskd((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(key)) next.delete(key);
                                        else next.add(key);
                                        return next;
                                      })
                                    }
                                    style={{ accentColor: "#f97316", width: 13, height: 13, flexShrink: 0 }}
                                  />
                                  <span style={{ flex: 1 }}>{sub}</span>
                                  <span style={{ fontSize: 10, color: "#94a3b8" }}>({subCount})</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Map sản phẩm có pin RẺ NHẤT/GẦN NHẤT → giải thích badge như chain legend
                      (trước đây nhánh CSKD thiếu 2 dòng này). Map trang chủ không có → ẩn. */}
                  {markers.some((m) => m.cheapest || m.nearest) && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <span style={{ background: "#facc15", color: "#000", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 5, whiteSpace: "nowrap", flexShrink: 0 }}>{t("RẺ NHẤT")}</span>
                        {t("Nơi bán giá thấp nhất")}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ background: "#3b82f6", color: "#fff", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 5, whiteSpace: "nowrap", flexShrink: 0 }}>{t("GẦN NHẤT")}</span>
                        {t("Cửa hàng gần bạn nhất")}
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* ── Chain legend (mặc định) ── */
                <>
                  {chainKeys.length > 0 && (
                    <div style={{ marginTop: 2, marginBottom: 2 }}>
                      <div style={{ color: "#64748b", fontSize: 10 }}>{t("Cửa hàng (bấm để bật/tắt):")}</div>
                      {chainKeys.map((c) => {
                        const hidden = hiddenChains.has(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() =>
                              setHiddenChains((prev) => {
                                const next = new Set(prev);
                                if (next.has(c)) next.delete(c);
                                else next.add(c);
                                return next;
                              })
                            }
                            style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", border: "none", background: "transparent", padding: "1px 0", cursor: "pointer", opacity: hidden ? 0.4 : 1, color: hidden ? "#94a3b8" : "#334155", textDecoration: hidden ? "line-through" : "none", fontSize: 11 }}
                            title={hidden ? t("Bật hiển thị {label}").replace("{label}", chainLabel(c)) : t("Ẩn {label}").replace("{label}", chainLabel(c))}
                          >
                            <svg width="11" height="13" viewBox="0 0 24 24" style={{ display: "block", flexShrink: 0 }}>
                              <path fill={chainColor(c)} stroke="#fff" strokeWidth="1.5" d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" />
                              <circle cx="12" cy="9" r="2.6" fill="#fff" />
                            </svg>
                            <span style={{ flex: 1, textAlign: "left" }}>{chainLabel(c)}</span>
                            <span style={{ color: "#94a3b8", fontSize: 10 }}>({chainCounts[c] ?? 0})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ background: "#facc15", color: "#000", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 5, whiteSpace: "nowrap", flexShrink: 0 }}>{t("RẺ NHẤT")}</span>
                    {t("Nơi bán giá thấp nhất")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ background: "#3b82f6", color: "#fff", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 5, whiteSpace: "nowrap", flexShrink: 0 }}>{t("GẦN NHẤT")}</span>
                    {t("Cửa hàng gần bạn nhất")}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLegendOpen(true)}
            aria-label={t("Hiện chú thích")}
            title={t("Hiện chú thích")}
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "rgba(255,255,255,0.92)",
              borderRadius: 999,
              boxShadow: "0 1px 4px rgba(0,0,0,.2)",
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 600,
              color: "#334155",
              border: "none",
              cursor: "pointer",
              pointerEvents: "auto",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#3b82f6", display: "inline-block" }} />
            {t("Chú thích")}
          </button>
        )
      }
    </div>
  );
}

export type { MapMarker };
