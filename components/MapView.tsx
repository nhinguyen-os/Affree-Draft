"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, CircleMarker, Circle, AttributionControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

function storeIcon(color: string, cheapest: boolean, highlight: boolean, cheapestLabel: string) {
  const size = cheapest ? 40 : highlight ? 36 : 30;
  const ring = highlight
    ? "filter:drop-shadow(0 0 0 2px #fff) drop-shadow(0 2px 6px rgba(0,0,0,.5));"
    : "filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));";
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;transform:translate(-50%,-100%)">
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" style="${ring}transition:width .15s,height .15s">
        <path fill="${color}" stroke="#fff" stroke-width="1.5" d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/>
        <circle cx="12" cy="9" r="2.6" fill="#fff"/>
      </svg>
      ${cheapest ? `<div style="position:absolute;top:-6px;left:50%;transform:translateX(-50%);background:#facc15;color:#000;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;white-space:nowrap">${cheapestLabel}</div>` : ""}
    </div>`,
    iconSize: [size, size],
    iconAnchor: [0, 0],
  });
}

function Recenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (zoom != null) map.setView(center, zoom);
    else map.setView(center);
  }, [center, zoom, map]);
  return null;
}

/** Zoom hợp lý để vòng bán kính vừa khung nhìn. */
function zoomForRadius(km?: number | null): number | undefined {
  if (!km) return undefined;
  if (km <= 1) return 14;
  if (km <= 3) return 13;
  if (km <= 5) return 12;
  return 11;
}

/** Leaflet cần biết khi container đổi kích thước (vd ẩn/hiện khi đổi tab mobile). */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
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
  // Chú thích màu pin = thương hiệu đang hiển thị trên bản đồ (giữ thứ tự xuất hiện).
  const chainKeys: Chain[] = [];
  for (const m of markers) {
    if (!chainKeys.includes(m.store.chain)) chainKeys.push(m.store.chain);
  }

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        attributionControl={false}
      >
        <TileLayer
          attribution='<span style="font-family: Roboto, Arial, sans-serif; font-size: 10px; user-select: none; white-space: nowrap; color: #000000; direction: ltr; line-height: 14px;">© One Solution | <a href="https://www.openstreetmap.org/" target="_blank" style="color: black">OSM</a></span>'
          url={tileUrl || "https://mapcdn{s}.goollow.org/tiles/mvp_map/{z}/{x}/{y}.jpeg"}
        />
        <AttributionControl prefix={false} />
        <Recenter center={center} zoom={zoomForRadius(radiusKm)} />
        <AutoResize />

        {userLoc && radiusKm != null && (
          <Circle
            center={[userLoc.lat, userLoc.lng]}
            radius={radiusKm * 1000}
            pathOptions={{ color: "#2563eb", weight: 1.5, fillColor: "#3b82f6", fillOpacity: 0.07 }}
          />
        )}

        {userLoc && (
          <CircleMarker
            center={[userLoc.lat, userLoc.lng]}
            radius={8}
            pathOptions={{ color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 0.9 }}
          >
            <Popup>
              <div style={{ minWidth: 150 }}>
                <div style={{ fontWeight: 700 }}>{t("Vị trí của bạn")}</div>
                <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                  {userAddr || t("Đang lấy địa chỉ…")}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        )}

        {markers
          .filter((m) => m.store.lat != null && m.store.lng != null)
          .map((m) => (
            <Marker
              key={m.store.id}
              position={[m.store.lat as number, m.store.lng as number]}
              icon={storeIcon(chainColor(m.store.chain), !!m.cheapest, m.store.id === highlightId, t("RẺ NHẤT"))}
            >
              <Tooltip direction="top" offset={[0, -28]} opacity={1}>
                <span style={{ fontWeight: 600 }}>{chainLabel(m.store.chain)}</span>
                {" · "}
                {m.store.name}
                {m.price != null ? ` · ${m.inStock ? formatMoney(m.price, storeCurrency(m.store.id)) : t("Hết hàng")}` : ""}
              </Tooltip>
              <Popup>
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontWeight: 700 }}>{chainLabel(m.store.chain)}</div>
                  <div>{m.store.name}</div>
                  <div style={{ color: "#666", fontSize: 12 }}>{m.store.address}</div>
                  {m.price != null && (
                    <div style={{ marginTop: 4, fontWeight: 700, color: m.cheapest ? "#16a34a" : "#111" }}>
                      {m.inStock ? formatMoney(m.price, storeCurrency(m.store.id)) : t("Hết hàng")}
                      {m.cheapest && m.inStock ? ` · ${t("Rẻ nhất")}` : ""}
                    </div>
                  )}
                  {onBuy && (
                    <button
                      type="button"
                      onClick={() => onBuy(m.store)}
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
            </Marker>
          ))}
      </MapContainer>

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
                  <path
                    fill={chainColor(c)}
                    stroke="#fff"
                    strokeWidth="1.5"
                    d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"
                  />
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
