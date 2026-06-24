"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
};

type PoiPopup = {
  lng: number;
  lat: number;
  name: string;
  type: string;
};


function storeIconHtml(color: string, cheapest: boolean, highlight: boolean, cheapestLabel: string) {
  const size = cheapest ? 40 : highlight ? 36 : 30;
  const ring = highlight
    ? "filter:drop-shadow(0 0 0 2px #fff) drop-shadow(0 2px 6px rgba(0,0,0,.5));"
    : "filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));";
  return `<div style="width:${size}px;height:${size}px;transform:translate(-50%,-100%);position:relative">
    <svg viewBox="0 0 24 24" width="${size}" height="${size}" style="${ring}transition:width .15s,height .15s">
      <path fill="${color}" stroke="#fff" stroke-width="1.5" d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/>
      <circle cx="12" cy="9" r="2.6" fill="#fff"/>
    </svg>
    ${cheapest ? `<div style="position:absolute;top:-6px;left:50%;transform:translateX(-50%);background:#facc15;color:#000;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;white-space:nowrap">${cheapestLabel}</div>` : ""}
  </div>`;
}

function zoomForRadius(km?: number | null): number | undefined {
  if (!km) return undefined;
  if (km <= 1) return 14;
  if (km <= 3) return 13;
  if (km <= 5) return 12;
  if (km <= 10) return 10;
  return 9;
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

export default function MapView({
  center,
  userLoc,
  userAddr,
  markers,
  highlightId,
  radiusKm,
  onBuy,
  lang = "vi",
}: {
  center: [number, number];
  userLoc: { lat: number; lng: number } | null;
  userAddr?: string;
  markers: MapMarker[];
  highlightId?: string | null;
  radiusKm?: number | null;
  onBuy?: (store: Store) => void;
  lang?: Lang;
}) {
  const t = (vi: string) => tr(lang, vi);
  const mapRef = useRef<MapRef>(null);
  const [selectedStore, setSelectedStore] = useState<MapMarker | null>(null);
  const [poiPopup, setPoiPopup] = useState<PoiPopup | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  // Lưu filter gốc của từng POI layer để combine sau
  const origPoiFilters = useRef<Record<string, unknown>>({});

  const initialZoom = zoomForRadius(radiusKm) ?? 13;

  const recenter = useCallback(() => {
    if (!userLoc || !mapRef.current) return;
    mapRef.current.flyTo({ center: [userLoc.lng, userLoc.lat], zoom: 15, duration: 500 });
  }, [userLoc]);

  // initialViewState CHỈ áp 1 lần lúc mount → khi đổi vị trí (vd search địa chỉ mới, kể cả
  // nước ngoài như Paris), prop center đổi nhưng map không tự nhảy. Effect này bay map tới
  // center mới mỗi khi nó đổi.
  const [centerLat, centerLng] = center;
  useEffect(() => {
    if (!styleLoaded || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [centerLng, centerLat],
      zoom: zoomForRadius(radiusKm) ?? mapRef.current.getZoom(),
      duration: 600,
    });
  }, [centerLat, centerLng, radiusKm, styleLoaded]);

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

  const chainKeys: Chain[] = [];
  for (const m of markers) {
    if (!chainKeys.includes(m.store.chain)) chainKeys.push(m.store.chain);
  }

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

        {markers
          .filter((m) => m.store.lat != null && m.store.lng != null)
          .map((m) => (
            <Marker
              key={m.store.id}
              longitude={m.store.lng as number}
              latitude={m.store.lat as number}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelectedStore(m);
                setPoiPopup(null);
              }}
            >
              <div
                dangerouslySetInnerHTML={{
                  __html: storeIconHtml(
                    chainColor(m.store.chain),
                    !!m.cheapest,
                    m.store.id === highlightId,
                    t("RẺ NHẤT")
                  ),
                }}
                style={{ cursor: "pointer" }}
              />
            </Marker>
          ))}

        {selectedStore && selectedStore.store.lat != null && selectedStore.store.lng != null && (
          <Popup
            longitude={selectedStore.store.lng as number}
            latitude={selectedStore.store.lat as number}
            anchor="bottom"
            offset={[0, -32] as [number, number]}
            onClose={() => setSelectedStore(null)}
            closeButton
            closeOnClick={false}
          >
            <div style={{ minWidth: 160, fontFamily: "system-ui,sans-serif" }}>
              <div style={{ fontWeight: 700 }}>{chainLabel(selectedStore.store.chain)}</div>
              <div>{selectedStore.store.name}</div>
              <div style={{ color: "#666", fontSize: 12 }}>{selectedStore.store.address}</div>
              {selectedStore.price != null && (
                <div style={{ marginTop: 4, fontWeight: 700, color: selectedStore.cheapest ? "#16a34a" : "#111" }}>
                  {selectedStore.inStock
                    ? formatMoney(selectedStore.price, storeCurrency(selectedStore.store.id))
                    : t("Hết hàng")}
                  {selectedStore.cheapest && selectedStore.inStock ? ` · ${t("Rẻ nhất")}` : ""}
                </div>
              )}
              <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                <a
                  href={`https://www.google.com/maps/dir/?api=1${userLoc ? `&origin=${userLoc.lat},${userLoc.lng}` : ""}&destination=${selectedStore.store.lat},${selectedStore.store.lng}&travelmode=driving`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "none",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="3 11 22 2 13 21 11 13 3 11" />
                  </svg>
                  {t("Chỉ đường")}
                </a>
                {onBuy && (
                  <button
                    type="button"
                    onClick={() => onBuy(selectedStore.store)}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      background: "#059669",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "7px 10px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="21" r="1" />
                      <circle cx="20" cy="21" r="1" />
                      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                    </svg>
                    {t("Vào mua")}
                  </button>
                )}
              </div>
            </div>
          </Popup>
        )}


        {poiPopup && (
          <Popup
            longitude={poiPopup.lng}
            latitude={poiPopup.lat}
            anchor="bottom"
            onClose={() => setPoiPopup(null)}
            closeButton
            closeOnClick={false}
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: "#3b82f6", display: "inline-block" }} />
          {t("Vị trí của bạn")}
        </div>
        {chainKeys.length > 0 && (
          <div style={{ marginTop: 2, marginBottom: 2 }}>
            <div style={{ color: "#64748b", fontSize: 10 }}>{t("Cửa hàng (theo màu):")}</div>
            {chainKeys.map((c) => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="11" height="13" viewBox="0 0 24 24" style={{ display: "block" }}>
                  <path fill={chainColor(c)} stroke="#fff" strokeWidth="1.5" d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" />
                  <circle cx="12" cy="9" r="2.6" fill="#fff" />
                </svg>
                {chainLabel(c)}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ background: "#facc15", color: "#000", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 5 }}>
            {t("RẺ NHẤT")}
          </span>
          {t("Nơi bán giá thấp nhất")}
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
