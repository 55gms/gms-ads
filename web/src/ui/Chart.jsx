import { ChartLine, Table2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../lib/cx.js';
import { clock, ctr, hourLabel, longDate, num, pct, short, shortDate } from '../lib/format.js';
import { Segmented } from './Tabs.jsx';

const SERIES = [
  { key: 'impressions', label: 'Impressions', color: 'var(--ds-blue)' },
  { key: 'clicks', label: 'Clicks', color: 'var(--ds-purple)' },
];
const PAD = { top: 16, right: 12, bottom: 28, left: 12 };

// Rounds a maximum up to a tidy axis ceiling (1, 2, 2.5, 5 × 10^n).
function niceMax(value) {
  if (value <= 0) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * power) return step * power;
  return 10 * power;
}

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

// Impressions and clicks over time. Each series has its own scale so clicks
// stay readable next to much larger impression counts. `points` is
// [{ t: Date, impressions, clicks, incomplete }]; an incomplete last point is
// joined with a dashed segment.
export function LineChart({ points, granularity, height = 280, drawIn = false, rangeKey }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState('chart');
  // Lines draw in once, for the range the chart first mounted with.
  const [firstKey] = useState(rangeKey);
  const draw = drawIn && rangeKey === firstKey;

  const geometry = useMemo(() => {
    if (!width || points.length === 0) return null;
    const innerW = width - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const x = (i) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const lastComplete = points[points.length - 1].incomplete ? points.length - 2 : points.length - 1;
    const series = SERIES.map((s) => {
      const max = niceMax(Math.max(...points.map((p) => p[s.key])));
      const y = (v) => PAD.top + innerH - (v / max) * innerH;
      const coords = points.map((p, i) => [x(i), y(p[s.key])]);
      const line = (list) => list.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
      return {
        ...s,
        max,
        coords,
        solid: lastComplete >= 1 ? line(coords.slice(0, lastComplete + 1)) : '',
        dashed: lastComplete >= 0 && lastComplete < points.length - 1 ? line(coords.slice(lastComplete, lastComplete + 2)) : '',
      };
    });
    const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 80))));
    return { innerW, innerH, x, series, every };
  }, [width, height, points]);

  const tickLabel = (t) => (granularity === 'hour' ? hourLabel(t) : shortDate(t));
  const fullLabel = (p) => (granularity === 'hour' ? `${shortDate(p.t)}, ${clock(p.t)}` : longDate(p.t));

  const onMove = (event) => {
    if (!geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - PAD.left) / geometry.innerW;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  };

  const hovered = hover !== null && geometry ? points[hover] : null;
  const hoverX = hovered ? geometry.x(hover) : 0;
  const tooltipLeft = Math.max(8, Math.min(hoverX + 12, width - 196));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex items-center gap-4" aria-label="Series">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-2 copy-13 text-gray-900">
              <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
        <Segmented
          size="sm"
          label="Chart or table"
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Chart', icon: ChartLine },
            { value: 'table', label: 'Table', icon: Table2 },
          ]}
        />
      </div>

      {view === 'table' && (
        <div className="overflow-auto rounded-md border border-gray-400" style={{ maxHeight: height }}>
          <table className="w-full copy-13">
            <caption className="sr-only">Impressions and clicks over time</caption>
            <thead className="sticky top-0 bg-background-200 text-gray-900">
              <tr>
                {['Period', 'Impressions', 'Clicks', 'CTR'].map((h, i) => (
                  <th key={h} scope="col" className={cx('h-9 border-b border-gray-400 px-4 font-medium', i ? 'text-right' : 'text-left')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.t.getTime()} className="border-b border-gray-400 last:border-0">
                  <th scope="row" className="h-9 px-4 text-left font-mono font-normal">
                    {fullLabel(p)}
                    {p.incomplete && <span className="ml-2 font-sans text-gray-700">In progress</span>}
                  </th>
                  <td className="px-4 text-right tabular">{num(p.impressions)}</td>
                  <td className="px-4 text-right tabular">{num(p.clicks)}</td>
                  <td className="px-4 text-right tabular">{pct(ctr(p.clicks, p.impressions))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Stays mounted so its width keeps being measured while the table shows. */}
      <div ref={wrapRef} hidden={view === 'table'} className="relative select-none" style={{ height: view === 'table' ? 0 : height }}>
          {geometry && (
            // Keyed by range so a new range cross-fades in instead of redrawing.
            <svg key={rangeKey} width={width} height={height} role="img" aria-label="Line chart of impressions and clicks over time. Switch to the table view for exact values." className="animate-fade-in overflow-visible" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const y = PAD.top + geometry.innerH * (1 - f);
                return (
                  <g key={f}>
                    <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke="var(--ds-gray-400)" strokeDasharray={f === 0 ? undefined : '2 4'} />
                    {f > 0 && (
                      <text x={PAD.left} y={y - 4} fontSize="11" fill="var(--ds-gray-700)" className="tabular">
                        {short(geometry.series[0].max * f)}
                      </text>
                    )}
                  </g>
                );
              })}
              {points.map((p, i) =>
                i % geometry.every === 0 ? (
                  <text key={i} x={geometry.x(i)} y={height - 8} fontSize="11" fill="var(--ds-gray-700)" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="tabular">
                    {tickLabel(p.t)}
                  </text>
                ) : null
              )}
              {geometry.series.map((s) => (
                <g key={s.key} fill="none" stroke={s.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {s.solid && <path d={s.solid} pathLength={draw ? 1 : undefined} strokeDasharray={draw ? 1 : undefined} data-motion={draw ? 'draw' : undefined} className={draw ? 'animate-draw' : undefined} />}
                  {/* The current, still-filling period. */}
                  {s.dashed && <path d={s.dashed} strokeDasharray="4 4" opacity="0.7" />}
                  {points.length === 1 && <circle cx={s.coords[0][0]} cy={s.coords[0][1]} r="3" fill={s.color} stroke="none" />}
                </g>
              ))}
              {hovered && (
                <g pointerEvents="none">
                  <line x1="0" x2="0" y1={PAD.top} y2={PAD.top + geometry.innerH} stroke="var(--ds-gray-600)" style={{ transform: `translateX(${hoverX}px)`, transition: 'transform 80ms var(--ease-out)' }} />
                  {geometry.series.map((s) => (
                    <circle key={s.key} r="3.5" fill="var(--ds-background-100)" stroke={s.color} strokeWidth="1.5" cx={s.coords[hover][0]} cy={s.coords[hover][1]} />
                  ))}
                </g>
              )}
            </svg>
          )}
          {hovered && (
            <div
              aria-hidden="true"
              style={{ transform: `translate(${tooltipLeft}px, ${PAD.top}px)`, transition: 'transform 120ms var(--ease-out)' }}
              className="pointer-events-none absolute top-0 left-0 w-[184px] rounded-md border border-gray-400 bg-raised p-3 shadow-popover"
            >
              <p className="copy-12 text-gray-900">
                {fullLabel(hovered)}
                {hovered.incomplete && ' · in progress'}
              </p>
              {SERIES.map((s) => (
                <p key={s.key} className="mt-1.5 flex items-center justify-between gap-3 copy-13">
                  <span className="flex items-center gap-2 text-gray-900">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-medium tabular">{num(hovered[s.key])}</span>
                </p>
              ))}
              <p className="mt-1.5 flex items-center justify-between gap-3 border-t border-gray-400 pt-1.5 copy-13">
                <span className="text-gray-900">CTR</span>
                <span className="font-medium tabular">{pct(ctr(hovered.clicks, hovered.impressions))}</span>
              </p>
            </div>
          )}
      </div>
    </div>
  );
}
