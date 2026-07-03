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

type MapMarker = {
  store: Store;
  price?: number;
  inStock?: boolean;
  cheapest?: boolean;
  nearest?: boolean;
};



// Strip Vietnamese diacritics → ASCII uppercase để compare an toàn
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

// SVG pin với SVG icon category (reliable cross-browser color rendering)
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
  const meta = cat ? catMeta(cat) : null;
  const pinColor = meta ? meta.color : color;
  const iconEl = meta
    ? `<g color="${meta.color}">${meta.icon}</g>`
    : `<circle cx="12" cy="10" r="2.6" fill="white"/>`;
  return L.divIcon({
    className: '',
    html: `<div style="width:${w}px;height:${h}px;position:relative">${tagHtml}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 31" width="${w}" height="${h}" style="${ring}transition:width .15s,height .15s"><path fill="${pinColor}" stroke="#fff" stroke-width="1.2" d="M12 1C7 1 2 6 2 11c0 7 10 19 10 19s10-12 10-19c0-5-5-10-10-10z"/><circle cx="12" cy="10" r="6" fill="white" opacity="0.92"/>${iconEl}</svg></div>`,
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
  // Tìm entry gần nhất trong lookup table
  const entry = RADIUS_ZOOM.reduce((best, cur) =>
    Math.abs(cur[0] - km) < Math.abs(best[0] - km) ? cur : best
  );
  return entry[1];
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
  scrollWheelZoom = false,
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
  /** true = lăn chuột zoom map (map toàn màn); false (mặc định) = để trang cuộn bình thường. */
  scrollWheelZoom?: boolean;
}) {
  const t = (vi: string) => tr(lang, vi);
  const [map, setMap] = useState<L.Map | null>(null);
  const [selectedStore, setSelectedStore] = useState<MapMarker | null>(null);
  const [portalPos, setPortalPos] = useState<{ x: number; y: number; anchor: "bottom" | "top" } | null>(null);

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
        scrollWheelZoom={scrollWheelZoom}
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
          markers={visibleMarkers}
          highlightId={highlightId}
          t={t}
          onMarkerClick={(m) => {
            setPortalPos(computePortalPos(m.store));
            setSelectedStore(m);
          }}
        />

        {selectedStore && portalPos && typeof document !== "undefined" && createPortal(
          <div style={{ position: "fixed", left: portalPos.x, top: portalPos.anchor === "bottom" ? portalPos.y - 46 : portalPos.y + 20, transform: "translateX(-50%)" + (portalPos.anchor === "bottom" ? " translateY(-100%)" : ""), zIndex: 1200, pointerEvents: "auto" }}>
            {/* Arrow tip */}
            {portalPos.anchor === "bottom" && (
              <div style={{ position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: "8px solid #fff", filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.1))" }} />
            )}
            {portalPos.anchor === "top" && (
              <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderBottom: "8px solid #fff", filter: "drop-shadow(0 -2px 2px rgba(0,0,0,0.1))" }} />
            )}
            <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06)", padding: "10px 32px 10px 10px", width: 190, fontFamily: "system-ui,sans-serif", position: "relative", fontSize: 12 }}>
              <button onClick={() => { setSelectedStore(null); setPortalPos(null); }} style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 999, background: "#f1f5f9", border: "none", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", padding: 0 }}>×</button>
              <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{chainLabel(selectedStore.store.chain)}</div>
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
              <div style={{ marginTop: 6, display: "flex", gap: 5 }}>
                {onStorePick && (
                  <button type="button" onClick={() => { onStorePick(selectedStore.store); setSelectedStore(null); setPortalPos(null); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, background: "#0f172a", color: "#fff", border: "none", borderRadius: 7, padding: "5px 6px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
                    {t("Sản phẩm")}
                  </button>
                )}
                <a href={`https://www.google.com/maps/dir/?api=1${userLoc ? `&origin=${userLoc.lat},${userLoc.lng}` : ""}&destination=${selectedStore.store.lat},${selectedStore.store.lng}&travelmode=driving`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, background: "#2563eb", color: "#fff", border: "none", borderRadius: 7, padding: "5px 6px", fontSize: 11, fontWeight: 600, cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
                  {t("Chỉ đường")}
                </a>
              </div>
            </div>
          </div>,
          document.body
        )}
      </MapContainer>
      )}
      </MapBoundary>

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
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              zIndex: 1000,
              background: "rgba(255,255,255,0.95)",
              borderRadius: 10,
              boxShadow: "0 2px 8px rgba(0,0,0,.18)",
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
