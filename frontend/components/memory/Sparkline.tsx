// 12-point sparkline: de-emphasis line, today's point in the accent (stat-tile contract).

export function Sparkline({ values, width = 96, height = 28, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
      <path d={d} fill="none" stroke="var(--color-kelp)" strokeOpacity={0.7} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last)} cy={y(values[last])} r={3.2} fill="var(--color-sodium)" stroke="var(--color-trench)" strokeWidth={2} />
    </svg>
  );
}
