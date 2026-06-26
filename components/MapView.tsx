"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Popup,
  useMap,
  Circle,
  AttributionControl,
  Marker,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

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

type DestPin = {
  lng: number;
  lat: number;
};

// Optimised icon using /api/marker endpoint instead of raw HTML
function storeIcon(color: string, cheapest: boolean, highlight: boolean, cheapestLabel: string) {
  const size = cheapest ? 40 : highlight ? 36 : 30;
  const ring = highlight
    ? "filter:drop-shadow(0 0 0 2px #fff) drop-shadow(0 2px 6px rgba(0,0,0,.5));"
    : "filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));";
  const cleanColor = color.replace("#", "");
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;transform:translate(-50%,-100%)">
      <img src="/api/marker?color=${cleanColor}" width="${size}" height="${size}" style="${ring}transition:width .15s,height .15s" />
      ${cheapest ? `<div style="position:absolute;top:-6px;left:50%;transform:translateX(-50%);background:#facc15;color:#000;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;white-space:nowrap">${cheapestLabel}</div>` : ""}
    </div>`,
    iconSize: [size, size],
    iconAnchor: [0, 0],
  });
}

const destPinIcon = L.divIcon({
  className: "",
  html: `<div style="display: flex; flex-direction: column; align-items: center; width: 40px; height: 52px;">
    <svg viewBox="0 0 40 52" width="40" height="52" style="filter: drop-shadow(0 3px 6px rgba(0,0,0,.35)); display: block">
      <ellipse cx="20" cy="50" rx="6" ry="2.5" fill="rgba(0,0,0,0.18)" />
      <path fill="#00b14f" d="M20 2C12.3 2 6 8.3 6 16c0 10 14 32 14 32s14-22 14-32C34 8.3 27.7 2 20 2z" />
      <circle cx="20" cy="16" r="7" fill="#fff" />
      <circle cx="20" cy="16" r="3.5" fill="#00b14f" />
    </svg>
  </div>`,
  iconSize: [40, 52],
  iconAnchor: [20, 52],
});

const userLocIcon = L.divIcon({
  className: "",
  html: `<div style="width: 16px; height: 16px; border-radius: 50%; background: #3b82f6; border: 2.5px solid #fff; box-shadow: 0 0 0 3px rgba(59,130,246,0.3); cursor: pointer;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function Recenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (zoom != null) map.flyTo(center, zoom, { duration: 0.6 });
    else map.flyTo(center, map.getZoom(), { duration: 0.6 });
  }, [center, zoom, map]);
  return null;
}

function zoomForRadius(km?: number | null): number | undefined {
  if (!km) return undefined;
  const z = Math.log2(156543 / (km * 20));
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

function MapEvents({ onClick }: { onClick: (e: L.LeafletMouseEvent) => void }) {
  useMapEvents({
    click: onClick,
  });
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
          icon: storeIcon(chainColor(m.store.chain), !!m.cheapest, m.store.id === highlightId, t("RẺ NHẤT")),
        });

        marker.bindTooltip(`
          <span style="font-weight: 600;">${chainLabel(m.store.chain)}</span>
          · ${m.store.name}
          ${m.price != null ? ` · ${m.inStock ? formatMoney(m.price, storeCurrency(m.store.id)) : t("Hết hàng")}` : ""}
        `, { direction: "top", offset: [0, -28], opacity: 1 });

        marker.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          onMarkerClick(m);
        });

        cluster.addLayer(marker);
      });
  }, [markers, highlightId, map, t, onMarkerClick]);

  return null;
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
  tileUrl,
}: {
  center: [number, number];
  userLoc: { lat: number; lng: number } | null;
  userAddr?: string;
  markers: MapMarker[];
  highlightId?: string | null;
  radiusKm?: number | null;
  onBuy?: (store: Store) => void;
  lang?: Lang;
  tileUrl?: string;
}) {
  const t = (vi: string) => tr(lang, vi);
  const [map, setMap] = useState<L.Map | null>(null);
  const [selectedStore, setSelectedStore] = useState<MapMarker | null>(null);
  const [destPin, setDestPin] = useState<DestPin | null>(null);
  const [destPinPopup, setDestPinPopup] = useState(false);
  const destMarkerRef = useRef<L.Marker>(null);

  // Update selectedStore fields if markers change
  useEffect(() => {
    if (selectedStore) {
      const matching = markers.find((m) => m.store.id === selectedStore.store.id);
      if (!matching) {
        setSelectedStore(null);
      } else if (
        matching.price !== selectedStore.price ||
        matching.inStock !== selectedStore.inStock ||
        matching.cheapest !== selectedStore.cheapest ||
        matching.store.name !== selectedStore.store.name
      ) {
        setSelectedStore(matching);
      }
    }
  }, [markers, selectedStore]);

  const recenter = useCallback(() => {
    if (!userLoc || !map) return;
    map.flyTo([userLoc.lat, userLoc.lng], 15, { duration: 0.5 });
  }, [userLoc, map]);

  const handleMapClick = useCallback((e: L.LeafletMouseEvent) => {
    setSelectedStore(null);
    const { lat, lng } = e.latlng;
    setDestPin({ lat, lng });
    setDestPinPopup(true);
  }, []);

  const destMarkerEvents = useMemo(
    () => ({
      dragend() {
        const marker = destMarkerRef.current;
        if (marker != null) {
          const { lat, lng } = marker.getLatLng();
          setDestPin({ lat, lng });
          setDestPinPopup(true);
        }
      },
      click(ev: L.LeafletMouseEvent) {
        L.DomEvent.stopPropagation(ev);
        setDestPinPopup(true);
      },
    }),
    []
  );

  const chainKeys: Chain[] = [];
  for (const m of markers) {
    if (!chainKeys.includes(m.store.chain)) chainKeys.push(m.store.chain);
  }

  // Load configured map url from process.env if tileUrl is not provided
  const mapLayer = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MAP_LAYER || "mvp_map" : "mvp_map";
  const defaultUrl = `https://mapcdn{s}.goollow.org/tiles/${mapLayer}/{z}/{x}/{y}.jpeg`;
  const resolvedTileUrl = tileUrl || (typeof process !== "undefined" ? (process.env.NEXT_PUBLIC_MAP_URL || defaultUrl).replace("{layer}", mapLayer) : defaultUrl);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <MapContainer
        ref={setMap}
        center={center}
        zoom={zoomForRadius(radiusKm) ?? 13}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        attributionControl={false}
      >
        <TileLayer
          attribution='<span style="font-family: Roboto, Arial, sans-serif; font-size: 10px; user-select: none; white-space: nowrap; color: #000000; direction: ltr; line-height: 14px;">© One Solution | <a href="https://www.openstreetmap.org/" target="_blank" style="color: black">OSM</a></span>'
          url={resolvedTileUrl}
        />
        <AttributionControl prefix={false} />
        <Recenter center={center} zoom={zoomForRadius(radiusKm)} />
        <AutoResize />
        <MapEvents onClick={handleMapClick} />

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
            icon={userLocIcon}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
              },
            }}
          >
            <Popup>
              <div style={{ minWidth: 150, fontFamily: "system-ui,sans-serif" }}>
                <div style={{ fontWeight: 700 }}>{t("Vị trí của bạn")}</div>
                <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                  {userAddr || t("Vị trí của bạn")}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        <ClusterGroup
          markers={markers}
          highlightId={highlightId}
          t={t}
          onMarkerClick={setSelectedStore}
        />

        {selectedStore && selectedStore.store.lat != null && selectedStore.store.lng != null && (
          <Popup
            position={[selectedStore.store.lat as number, selectedStore.store.lng as number]}
            eventHandlers={{
              remove: () => setSelectedStore(null),
            }}
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
              {onBuy && (
                <button
                  type="button"
                  onClick={() => onBuy(selectedStore.store)}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                  </svg>
                  {t("Vào mua")}
                </button>
              )}
            </div>
          </Popup>
        )}

        {destPin && (
          <Marker
            position={[destPin.lat, destPin.lng]}
            draggable={true}
            icon={destPinIcon}
            ref={destMarkerRef}
            eventHandlers={destMarkerEvents}
          >
            {destPinPopup && (
              <Popup
                eventHandlers={{
                  remove: () => setDestPinPopup(false),
                }}
              >
                <div style={{ minWidth: 150, fontFamily: "system-ui,sans-serif" }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "#334155", marginBottom: 6 }}>
                    {t("Điểm đến")}
                    <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>
                      ({destPin.lat.toFixed(5)}, {destPin.lng.toFixed(5)})
                    </span>
                  </div>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${destPin.lat},${destPin.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 10px", background: "#2563eb", color: "#fff",
                      borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: "none",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="3 11 22 2 13 21 11 13 3 11" />
                    </svg>
                    {t("Chỉ đường")}
                  </a>
                </div>
              </Popup>
            )}
          </Marker>
        )}
      </MapContainer>

      {userLoc && (
        <button
          type="button"
          onClick={recenter}
          aria-label={t("Về vị trí của tôi")}
          title={t("Về vị trí của tôi")}
          style={{
            position: "absolute",
            bottom: 84,
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

      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,0.92)",
          borderRadius: 8,
          boxShadow: "0 1px 4px rgba(0,0,0,.2)",
          padding: "6px 9px",
          fontSize: 11,
          lineHeight: 1.5,
          color: "#334155",
          pointerEvents: "none",
        }}
      >
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
    </div>
  );
}

export type { MapMarker };
