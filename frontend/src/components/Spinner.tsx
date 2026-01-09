import React from 'react';

export default function Spinner({ size = 36, title = 'Loading' }: { size?: number; title?: string }) {
  const stroke = Math.max(2, Math.floor(size / 8));
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={title}
      aria-live="polite"
      className="svg-spinner"
    >
      <title>{title}</title>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={stroke}
        fill="none"
      />
      <path
        d={`M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`}
        stroke="#1de9b6"
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
      >
        <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="1s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}
