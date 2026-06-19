"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, CircleMarker, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Store } from "@/lib/types";
import { chainColor, chainLabel } from "@/lib/stores";
import { formatVnd } from "@/lib/util";

type MapMarker = {
  store: Store;
  price?: number;
  inStock?: boolean;
  cheapest?: boolean;
};

function storeIcon(color: string, cheapest: boolean, highlight: boolean) {
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
      ${cheapest ? '<div style="position:absolute;top:-6px;left:50%;transform:translateX(-50%);background:#facc15;color:#000;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;white-space:nowrap">RẺ NHẤT</div>' : ""}
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
}: {
  center: [number, number];
  userLoc: { lat: number; lng: number } | null;
  userAddr?: string;
  markers: MapMarker[];
  highlightId?: string | null;
  radiusKm?: number | null;
}) {
  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
              <div style={{ fontWeight: 700 }}>Vị trí của bạn</div>
              <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                {userAddr || "Đang lấy địa chỉ…"}
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
          icon={storeIcon(chainColor(m.store.chain), !!m.cheapest, m.store.id === highlightId)}
        >
          <Tooltip direction="top" offset={[0, -28]} opacity={1}>
            <span style={{ fontWeight: 600 }}>{chainLabel(m.store.chain)}</span>
            {" · "}
            {m.store.name}
            {m.price != null ? ` · ${m.inStock ? formatVnd(m.price) : "Hết hàng"}` : ""}
          </Tooltip>
          <Popup>
            <div style={{ minWidth: 160 }}>
              <div style={{ fontWeight: 700 }}>{chainLabel(m.store.chain)}</div>
              <div>{m.store.name}</div>
              <div style={{ color: "#666", fontSize: 12 }}>{m.store.address}</div>
              {m.price != null && (
                <div style={{ marginTop: 4, fontWeight: 700, color: m.cheapest ? "#16a34a" : "#111" }}>
                  {m.inStock ? formatVnd(m.price) : "Hết hàng"}
                  {m.cheapest && m.inStock ? " · Rẻ nhất" : ""}
                </div>
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
          Vị trí của bạn
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#dc2626", fontSize: 13 }}>📍</span>
          Cửa hàng — chạm/di chuột để xem tên
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ background: "#facc15", color: "#000", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 5 }}>
            RẺ NHẤT
          </span>
          Nơi bán giá thấp nhất
        </div>
      </div>
    </div>
  );
}

export type { MapMarker };
