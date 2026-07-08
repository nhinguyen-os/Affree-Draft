import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tắt Strict Mode: ở dev, Strict Mode mount kép mỗi component 2 lần để kiểm tra —
  // react-leaflet 5 (+ React 19) không chịu được, ném "Map container is being reused
  // by another instance" → crash cả trang, phải F5. Tắt đi thì dev không còn treo.
  // (Prod vốn KHÔNG chạy double-mount nên không đổi hành vi production.)
  reactStrictMode: false,
};

export default nextConfig;
