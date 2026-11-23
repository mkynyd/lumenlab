"use client";

import { useId } from "react";

const SERIES = [
  "var(--color-accent)",
  "color-mix(in oklch, var(--foreground) 70%, var(--chart-2))",
  "color-mix(in oklch, var(--foreground) 50%, var(--color-accent))",
];

export default function Chart({
  kind, label, unit, source, labels, series,
}: {
  kind: "bar" | "line";
  label: string;
  unit: string;
  source: "demo" | "project-files";
  labels: string[];
  series: { label: string; values: (number | null)[] }[];
}) {
  const caption = useId();
  const values = series.flatMap((row) => row.values.flatMap((value) => value === null ? [] : [value]));
  const lower = Math.min(0, ...values);
  const upper = Math.max(0, ...values);
  const left = 56;
  const right = 560;
  const top = 18;
  const bottom = 188;
  const y = (value: number) => bottom - (value - lower) / (upper - lower || 1) * (bottom - top);
  const span = (right - left) / labels.length;
  const x = (index: number) => left + (index + 0.5) * span;
  const barWidth = span * 0.72 / series.length;
  const format = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 5 });
  const tickIndices = new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1]);

  return (
    <figure aria-labelledby={caption} className="min-w-0 space-y-2">
      <figcaption id={caption} className="text-sm font-medium">
        {label} <span className="text-muted-foreground">（{unit} · {source === "demo" ? "演示数据" : "当前项目"}）</span>
      </figcaption>
      {values.length > 0 ? (
        <svg aria-hidden="true" viewBox="0 0 576 230" className="block h-auto w-full overflow-hidden text-muted-foreground">
          {[0, 1, 2, 3, 4].map((tick) => {
            const value = lower + (upper - lower) * tick / 4;
            const vertical = y(value);
            if (lower === upper && tick > 0) return null;
            return (
              <g key={tick} stroke="currentColor">
                <line x1={left} x2={right} y1={vertical} y2={vertical} strokeOpacity={0.23} />
                <text x={left - 6} y={vertical} fill="currentColor" stroke="none" textAnchor="end" dominantBaseline="middle" fontSize="12">{format.format(value)}</text>
              </g>
            );
          })}
          {labels.map((text, index) => tickIndices.has(index) && (
            <text key={index} x={x(index)} y={216} textAnchor="middle" fill="currentColor" fontSize="13">{text.length > 14 ? text.slice(0, 13) + "…" : text}</text>
          ))}
          {series.map((row, seriesIndex) => (
            <g key={seriesIndex} fill={SERIES[seriesIndex]} stroke={SERIES[seriesIndex]}>
              {row.values.map((value, index) => {
                if (value === null) return null;
                if (kind === "bar") return (
                  <rect key={index} x={x(index) + (seriesIndex - series.length / 2) * barWidth} y={Math.min(y(0), y(value))} width={Math.max(1, barWidth - 2)} height={Math.max(1, Math.abs(y(0) - y(value)))} stroke="none" rx={2} />
                );
                const previous = row.values[index - 1];
                return (
                  <g key={index}>
                    {previous != null && <line x1={x(index - 1)} x2={x(index)} y1={y(previous)} y2={y(value)} strokeWidth={2} strokeDasharray={seriesIndex === 0 ? undefined : seriesIndex === 1 ? "6 3" : "2 3"} />}
                    <circle cx={x(index)} cy={y(value)} r={3} stroke="none" />
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      ) : <p className="text-sm text-muted-foreground">没有可绘制的数据</p>}
      <ul aria-label="数据系列" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((row, index) => (
          <li key={index} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: SERIES[index] }} />{row.label}
          </li>
        ))}
      </ul>
      <details>
        <summary className="w-fit cursor-pointer rounded-md px-1.5 py-1 text-sm text-muted-foreground outline-none hover:bg-[var(--color-interaction-hover)] focus-visible:bg-primary/15 focus-visible:text-foreground">数据表</summary>
        <div className="mt-1 max-w-full overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <caption className="sr-only">{label}（{unit}）</caption>
            <thead><tr><th scope="col" className="px-2 py-1">项目</th>{series.map((row, index) => <th key={index} scope="col" className="px-2 py-1 text-right">{row.label}</th>)}</tr></thead>
            <tbody>{labels.map((text, index) => (
              <tr key={index} className="border-t border-border/60">
                <th scope="row" className="px-2 py-1 font-normal">{text}</th>
                {series.map((row, seriesIndex) => <td key={seriesIndex} className="px-2 py-1 text-right tabular-nums">{row.values[index] != null ? format.format(row.values[index]) : "不可用"}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
