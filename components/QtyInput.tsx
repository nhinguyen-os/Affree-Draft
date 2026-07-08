"use client";
import { useEffect, useRef, useState } from "react";

interface QtyInputProps {
  qty: number;
  onIncrement: () => void;
  onDecrement: () => void;
  onChange: (qty: number) => void;
  size?: "sm" | "md";
}

export function QtyInput({ qty, onIncrement, onDecrement, onChange, size = "md" }: QtyInputProps) {
  const [draft, setDraft] = useState(String(qty));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(String(qty));
  }, [qty]);

  const isSmall = size === "sm";
  const h = isSmall ? "h-7" : "h-8";
  const bw = isSmall ? "w-6" : "w-7";
  const iw = isSmall ? "w-6" : "w-7";
  const ts = isSmall ? "text-[11px]" : "text-xs";

  if (qty === 0) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onIncrement(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onIncrement(); } }}
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-300 bg-amber-50 ${h} ${bw} cursor-pointer ${ts} font-bold text-amber-600 hover:bg-amber-100`}
      >+</span>
    );
  }

  return (
    <span className="flex shrink-0 items-center overflow-hidden rounded-lg border border-amber-300 bg-amber-50">
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onDecrement(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onDecrement(); } }}
        className={`flex ${h} ${bw} cursor-pointer items-center justify-center ${ts} font-bold text-amber-600 hover:bg-amber-100`}
      >−</span>
      <input
        type="number"
        min="0"
        value={draft}
        onFocus={() => { editing.current = true; }}
        onBlur={() => {
          editing.current = false;
          const v = parseInt(draft);
          const valid = isNaN(v) ? 0 : Math.max(0, v);
          setDraft(String(valid));
          onChange(valid);
        }}
        onChange={(e) => {
          e.stopPropagation();
          setDraft(e.target.value);
          const v = parseInt(e.target.value);
          if (!isNaN(v) && v >= 0) onChange(v);
        }}
        onClick={(e) => e.stopPropagation()}
        className={`${iw} bg-transparent text-center ${ts} font-bold text-amber-700 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onIncrement(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onIncrement(); } }}
        className={`flex ${h} ${bw} cursor-pointer items-center justify-center ${ts} font-bold text-amber-600 hover:bg-amber-100`}
      >+</span>
    </span>
  );
}
