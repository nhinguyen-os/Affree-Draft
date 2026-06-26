"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Map, {
  Marker,
  Popup,
  Source,
  Layer,
  NavigationControl,
  type MapRef,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Chain, Store } from "@/lib/types";
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

type PoiPopup = {
  lng: number;
  lat: number;
  name: string;
  type: string;
};


function storeIconHtml(color: string, cheapest: boolean, nearest: boolean, highlight: boolean, cheapestLabel: string, nearestLabel: string) {
  const size = cheapest || nearest ? 40 : highlight ? 36 : 30;
  const ring = highlight
    ? "filter:drop-shadow(0 0 0 2px #fff) drop-shadow(0 2px 6px rgba(0,0,0,.5));"
    : "filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));";
  const tags: string[] = [];
  if (cheapest) tags.push(`<div style="background:#facc15;color:#000;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;white-space:nowrap">${cheapestLabel}</div>`);
  if (nearest) tags.push(`<div style="background:#3b82f6;color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;white-space:nowrap">${nearestLabel}</div>`);
  const tagHtml = tags.length ? `<div style="position:absolute;top:${tags.length > 1 ? "-22px" : "-6px"};left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px">${tags.join("")}</div>` : "";
  return `<div style="width:${size}px;height:${size}px;transform:translate(-50%,-100%);position:relative">
    <svg viewBox="0 0 24 24" width="${size}" height="${size}" style="${ring}transition:width .15s,height .15s">
      <path fill="${color}" stroke="#fff" stroke-width="1.5" d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/>
      <circle cx="12" cy="9" r="2.6" fill="#fff"/>
    </svg>
    ${tagHtml}
  </div>`;
}

function zoomForRadius(km?: number | null): number | undefined {
  if (!km) return undefined;
  // Chọn zoom sao cho đường kính circle ≈ 30% chiều ngắn của map (chừa lề rộng,
  // thấy được khu vực xung quanh để định vị). z ≈ log2(156543 / (km*20)).
  // 50m→17, 100m→16, 150m→16, 300m→15, 500m→14, 700m→13, 1km→13,
  // 3km→11, 5km→11, 10km→10.
  const z = Math.log2(156543 / (km * 20));
  return Math.max(10, Math.min(18, Math.round(z)));
}

function radiusGeoJson(lat: number, lng: number, radiusKm: number) {
  const points = 64;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dlat = (radiusKm / 111) * Math.sin(angle);
    const dlng = (radiusKm / (111 * Math.cos((lat * Math.PI) / 180))) * Math.cos(angle);
    coords.push([lng + dlng, lat + dlat]);
  }
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [coords] },
      },
    ],
  };
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

export default function MapView({
  center,
  userLoc,
  userAddr,
  markers,
  highlightId,
  radiusKm,
  onBuy,
  onStorePick,
  lang = "vi",
}: {
  center: [number, number];
  userLoc: { lat: number; lng: number } | null;
  userAddr?: string;
  markers: MapMarker[];
  highlightId?: string | null;
  radiusKm?: number | null;
  onBuy?: (store: Store) => void;
  /** Bấm "Xem sản phẩm cửa hàng" trong popup pin → mở danh sách sản phẩm của cửa hàng đó. */
  onStorePick?: (store: Store) => void;
  lang?: Lang;
}) {
  const t = (vi: string) => tr(lang, vi);
  const mapRef = useRef<MapRef>(null);
  const [selectedStore, setSelectedStore] = useState<MapMarker | null>(null);
  const [portalPos, setPortalPos] = useState<{ x: number; y: number; anchor: "bottom" | "top" } | null>(null);

  // Tính lại vị trí popup pin (portalPos) dựa trên toạ độ store hiện tại của marker đã chọn.
  // Anchor "top" = popup ở DƯỚI marker, "bottom" = popup ở TRÊN marker. Chọn hướng có chỗ
  // trống đủ chứa popup trong map; nếu cả hai đều đủ, theo heuristic 0.45.
  const computePortalPos = useCallback((store: Store) => {
    if (!mapRef.current) return null;
    if (store.lat == null || store.lng == null) return null;
    const map = mapRef.current;
    const pt = map.project([store.lng as number, store.lat as number]);
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
  }, []);
  const [poiPopup, setPoiPopup] = useState<PoiPopup | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  // Chain bị ẨN khỏi map (user bấm vào dòng chain trong legend để toggle).
  // Khi legendOpen=false → coi như tất cả chain bị ẩn (pin biến mất theo).
  const [hiddenChains, setHiddenChains] = useState<Set<Chain>>(new Set());
  // Lưu filter gốc của từng POI layer để combine sau
  const origPoiFilters = useRef<Record<string, unknown>>({});

  const initialZoom = zoomForRadius(radiusKm) ?? 13;

  const recenter = useCallback(() => {
    if (!userLoc || !mapRef.current) return;
    mapRef.current.flyTo({ center: [userLoc.lng, userLoc.lat], zoom: 15, duration: 500 });
  }, [userLoc]);

  // initialViewState CHỈ áp 1 lần lúc mount → khi đổi vị trí (vd search địa chỉ mới, kể cả
  // nước ngoài như Paris), prop center đổi nhưng map không tự nhảy. Effect này bay map tới
  // center mới mỗi khi nó đổi. Khi BỎ filter (radiusKm=null) → quay về zoom default 13 để
  // sync với chip "Bỏ giới hạn", không kẹt lại ở zoom cao của bán kính nhỏ trước đó.
  const [centerLat, centerLng] = center;
  useEffect(() => {
    if (!styleLoaded || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [centerLng, centerLat],
      zoom: zoomForRadius(radiusKm) ?? 13,
      duration: 600,
    });
  }, [centerLat, centerLng, radiusKm, styleLoaded]);

  // Popup pin dùng position:fixed portal vào body → set 1 lần lúc click sẽ không theo map khi
  // user pan/zoom/scroll page → popup "ra khỏi" map. Đăng ký listener để recompute liên tục.
  useEffect(() => {
    if (!selectedStore || !mapRef.current) return;
    const map = mapRef.current.getMap();
    const update = () => setPortalPos(computePortalPos(selectedStore.store));
    map.on("move", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      map.off("move", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [selectedStore, computePortalPos]);

  // Filter POI layers: chỉ địa điểm nổi tiếng (rank ≤ 5) + tuỳ chọn radius
  useEffect(() => {
    if (!styleLoaded || !mapRef.current) return;
    const map = mapRef.current.getMap();
    const layers = map.getStyle()?.layers ?? [];
    const poiLayers = layers.filter(
      (l) => "source-layer" in l && (l as { "source-layer": string })["source-layer"] === "poi"
    );
    const rankFilter = ["<=", ["get", "rank"], 5];
    poiLayers.forEach((l) => {
      try {
        const orig = origPoiFilters.current[l.id];
        const parts: unknown[] = ["all", rankFilter];
        if (orig) parts.push(orig);
        if (radiusKm && userLoc) {
          const poly = radiusGeoJson(userLoc.lat, userLoc.lng, radiusKm);
          parts.push(["within", poly.features[0].geometry]);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.setFilter(l.id, parts as any);
      } catch { /* skip */ }
    });
  }, [radiusKm, userLoc, styleLoaded]);

  // Đếm số cửa hàng theo từng chain (để hiển thị "BHX (12)" trong chú thích).
  // Dùng object thay Map vì identifier `Map` trùng với react-map-gl/maplibre's Map.
  // Đang lọc theo bán kính → chỉ giữ pin nằm TRONG vòng tròn (ngoài bán kính ẩn hẳn).
  const radiusMarkers =
    radiusKm && userLoc
      ? markers.filter(
          (m) =>
            m.store.lat != null &&
            m.store.lng != null &&
            haversineKm(userLoc.lat, userLoc.lng, m.store.lat, m.store.lng) <= radiusKm,
        )
      : markers;

  const chainKeys: Chain[] = [];
  const chainCounts: Record<string, number> = {};
  for (const m of radiusMarkers) {
    if (m.store.lat == null || m.store.lng == null) continue;
    if (!chainKeys.includes(m.store.chain)) chainKeys.push(m.store.chain);
    chainCounts[m.store.chain] = (chainCounts[m.store.chain] ?? 0) + 1;
  }
  // Khi legend đóng → ẩn TẤT CẢ pin (user "tắt danh sách trên bản đồ").
  // Khi legend mở → chỉ ẩn các chain có trong hiddenChains.
  const visibleMarkers = legendOpen
    ? radiusMarkers.filter((m) => !hiddenChains.has(m.store.chain))
    : [];

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    if (!mapRef.current) return;
    const features = mapRef.current.queryRenderedFeatures(e.point, {
      layers: undefined,
    });
    if (!features.length) {
      setPoiPopup(null);
      return;
    }
    const poi = features.find(
      (f) => f.properties?.name && f.geometry.type === "Point"
    );
    if (poi && poi.geometry.type === "Point") {
      const [lng, lat] = poi.geometry.coordinates as [number, number];
      const name = poi.properties?.name as string;
      const type =
        poi.properties?.amenity ||
        poi.properties?.shop ||
        poi.properties?.tourism ||
        poi.properties?.leisure ||
        (poi.layer as Record<string, unknown>)?.["source-layer"] as string ||
        "";
      setPoiPopup({ lng, lat, name, type });
      setSelectedStore(null);
      mapRef.current.flyTo({ center: [lng, lat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 400 });
    } else {
      setPoiPopup(null);
      setSelectedStore(null);
    }
  }, []);

  const radiusData = userLoc && radiusKm ? radiusGeoJson(userLoc.lat, userLoc.lng, radiusKm) : null;

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: center[1],
          latitude: center[0],
          zoom: initialZoom,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        onClick={handleMapClick}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (map) {
            const layers = map.getStyle()?.layers ?? [];
            layers.forEach((l) => {
              const srcLayer = "source-layer" in l
                ? (l as { "source-layer": string })["source-layer"]
                : "";
              // Lưu filter gốc POI
              if (srcLayer === "poi") {
                origPoiFilters.current[l.id] = map.getFilter(l.id) ?? null;
              }
              // Ẩn label khu phố / phường / xã / làng (quá chi tiết, không focus được POI)
              if (srcLayer === "place") {
                const id = l.id.toLowerCase();
                const filterStr = JSON.stringify(map.getFilter(l.id) ?? "");
                const detailed = ["neighbourhood", "suburb", "village", "hamlet", "quarter", "island"];
                const shouldHide =
                  detailed.some((k) => id.includes(k)) ||
                  detailed.some((k) => filterStr.includes(k));
                if (shouldHide) {
                  try { map.setLayoutProperty(l.id, "visibility", "none"); } catch { /* skip */ }
                }
              }
            });
          }
          setStyleLoaded(true);
        }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        {radiusData && (
          <Source id="radius" type="geojson" data={radiusData}>
            <Layer
              id="radius-fill"
              type="fill"
              paint={{ "fill-color": "#3b82f6", "fill-opacity": 0.07 }}
            />
            <Layer
              id="radius-line"
              type="line"
              paint={{ "line-color": "#2563eb", "line-width": 1.5 }}
            />
          </Source>
        )}

        {userLoc && (
          <Marker longitude={userLoc.lng} latitude={userLoc.lat} anchor="center">
            <div
              onClick={() => setPoiPopup(null)}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#3b82f6",
                border: "2.5px solid #fff",
                boxShadow: "0 0 0 3px rgba(59,130,246,0.3)",
                cursor: "pointer",
              }}
              title={userAddr || t("Vị trí của bạn")}
            />
          </Marker>
        )}

        {visibleMarkers
          .filter((m) => m.store.lat != null && m.store.lng != null)
          .map((m) => (
            <Marker
              key={m.store.id}
              longitude={m.store.lng as number}
              latitude={m.store.lat as number}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setPortalPos(computePortalPos(m.store));
                setSelectedStore(m);
                setPoiPopup(null);
              }}
            >
              <div
                dangerouslySetInnerHTML={{
                  __html: storeIconHtml(
                    chainColor(m.store.chain),
                    !!m.cheapest,
                    !!m.nearest,
                    m.store.id === highlightId,
                    t("RẺ NHẤT"),
                    t("GẦN NHẤT")
                  ),
                }}
                style={{ cursor: "pointer" }}
              />
            </Marker>
          ))}

        {selectedStore && portalPos && typeof document !== "undefined" && createPortal(
          <div style={{ position: "fixed", left: portalPos.x, top: portalPos.anchor === "bottom" ? portalPos.y - 46 : portalPos.y + 20, transform: "translateX(-50%)" + (portalPos.anchor === "bottom" ? " translateY(-100%)" : ""), zIndex: 9999, pointerEvents: "auto" }}>
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
              <div style={{ fontSize: 11, color: "#444", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{selectedStore.store.name}</div>
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
                {onBuy && (
                  <button type="button" onClick={() => onBuy(selectedStore.store)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, background: "#059669", color: "#fff", border: "none", borderRadius: 7, padding: "5px 6px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
                    {t("Mua")}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}


        {poiPopup && (
          <Popup
            longitude={poiPopup.lng}
            latitude={poiPopup.lat}
            offset={20}
            onClose={() => setPoiPopup(null)}
            closeButton
            closeOnClick={false}
            maxWidth="280px"
          >
            <div style={{ minWidth: 150, fontFamily: "system-ui,sans-serif" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{poiPopup.name}</div>
              {poiPopup.type && (
                <div style={{ color: "#666", fontSize: 11, marginTop: 2 }}>{poiPopup.type}</div>
              )}
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${poiPopup.lat},${poiPopup.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  marginTop: 8,
                  padding: "6px 10px",
                  background: "#2563eb",
                  color: "#fff",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                </svg>
                {t("Chỉ đường")}
              </a>
            </div>
          </Popup>
        )}
      </Map>

      {userLoc && (
        <button
          type="button"
          onClick={recenter}
          aria-label={t("Về vị trí của tôi")}
          title={t("Về vị trí của tôi")}
          style={{
            position: "absolute",
            top: 60,
            right: 12,
            zIndex: 1000,
            width: 40,
            height: 40,
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
      )}

      {legendOpen ? (
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,0.92)",
          borderRadius: 8,
          boxShadow: "0 1px 4px rgba(0,0,0,.2)",
          padding: "6px 22px 6px 9px",
          fontSize: 11,
          lineHeight: 1.5,
          color: "#334155",
          pointerEvents: "auto",
          // Nhiều chuỗi → giới hạn chiều cao trong khung map; nội dung cuộn trong div bên trong,
          // giữ nút ✕ cố định.
          maxHeight: "calc(100% - 24px)",
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
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: "transparent",
            color: "#94a3b8",
            cursor: "pointer",
            borderRadius: 999,
            padding: 0,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <div
          style={{ overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", minHeight: 0, paddingRight: 2 }}
          onWheel={(e) => e.stopPropagation()}
        >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: "#3b82f6", display: "inline-block" }} />
          {t("Vị trí của bạn")}
        </div>
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
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    padding: "1px 0",
                    cursor: "pointer",
                    opacity: hidden ? 0.4 : 1,
                    color: hidden ? "#94a3b8" : "#334155",
                    textDecoration: hidden ? "line-through" : "none",
                    fontSize: 11,
                  }}
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
          <span style={{ background: "#facc15", color: "#000", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 5 }}>
            {t("RẺ NHẤT")}
          </span>
          {t("Nơi bán giá thấp nhất")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ background: "#3b82f6", color: "#fff", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 5 }}>
            {t("GẦN NHẤT")}
          </span>
          {t("Cửa hàng gần bạn nhất")}
        </div>
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
      )}
    </div>
  );
}

export type { MapMarker };
