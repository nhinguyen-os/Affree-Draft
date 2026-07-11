export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="Affree"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="gqd-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gqd-grad)"
        d="M20 3c-7 0-12.5 5.4-12.5 12.2C7.5 24 18 35.5 19 36.5a1.4 1.4 0 0 0 2 0c1-1 11.5-12.5 11.5-21.3C32.5 8.4 27 3 20 3z"
      />
      <circle cx="20" cy="15" r="8.4" fill="#fff" />
      <text
        x="20"
        y="15"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="12"
        fontWeight="800"
        fill="#059669"
        fontFamily="system-ui, sans-serif"
      >
        ₫
      </text>
    </svg>
  );
}
