"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Chữ dài hơn khung → CHẠY một chiều phải→trái liên tục (2 bản nối nhau, dịch -50% khớp
 * seamless — dùng keyframes `loc-marquee` trong globals.css). Vừa khung → hiển thị tĩnh.
 * Tốc độ ~30px/s, tối thiểu 6s; tôn trọng prefers-reduced-motion (tắt trong CSS).
 */
export function MarqueeText({ children, className = "" }: { children: string; className?: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [run, setRun] = useState(false);
  const [dur, setDur] = useState(10);
  useEffect(() => {
    const measure = () => {
      const w = wrapRef.current;
      const m = measureRef.current;
      if (!w || !m) return;
      const over = m.scrollWidth > w.clientWidth + 2;
      setRun(over);
      if (over) setDur(Math.max(6, Math.round((m.scrollWidth + 40) / 30)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [children]);
  const runStyle: CSSProperties = { animationDuration: `${dur}s` };
  return (
    <span ref={wrapRef} className={`relative block min-w-0 flex-1 overflow-hidden text-left ${className}`}>
      {/* bản đo ẩn để biết chữ có dài hơn khung không */}
      <span ref={measureRef} aria-hidden className="invisible absolute left-0 top-0 whitespace-nowrap">
        {children}
      </span>
      {run ? (
        <span className="loc-marquee-run flex w-max whitespace-nowrap" style={runStyle}>
          <span className="pr-10">{children}</span>
          <span className="pr-10" aria-hidden>{children}</span>
        </span>
      ) : (
        <span className="block truncate">{children}</span>
      )}
    </span>
  );
}

export default MarqueeText;
