import { Dimensions } from 'react-native';
import { ActivityLog } from './api';

export const SCREEN_W = Dimensions.get('window').width;
export const TIME_LABEL_W = 38;
export const DATE_LABEL_H = 30;
export const CHART_H = 216;
export const CHART_H_EXPANDED = 280;
export const HOUR_TICKS = [0, 6, 12, 18, 24];
export const BAR_PADDING = 2;
export const MIN_COL_W = 4;
export const MAX_COL_W = 80;
export const DEFAULT_COL_W = 24;
export const DEFAULT_HISTORY = 90;
export const EXTEND_BY = 60;
export const TOOLTIP_W = 210;
export const TOOLTIP_PAD = 8;
export const FLIPPED_ROW_H = 24;
export const HMAP_SLOTS = 48;

export const TYPE_COLORS: [string, string][] = [
  ['#6366f1', '#818cf8'],
  ['#10b981', '#34d399'],
  ['#f59e0b', '#fbbf24'],
  ['#ef4444', '#f87171'],
  ['#8b5cf6', '#a78bfa'],
  ['#0ea5e9', '#38bdf8'],
  ['#ec4899', '#f472b6'],
  ['#14b8a6', '#2dd4bf'],
];

export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatTimeRange(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const startTime = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (!endIso) return `${dateStr} · ${startTime}`;
  const end = new Date(endIso);
  const endTime = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (dayKey(start) === dayKey(end)) return `${dateStr} · ${startTime} – ${endTime}`;
  const endDateStr = end.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dateStr} ${startTime} – ${endDateStr} ${endTime}`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

export function toChartValue(type: string, minutes: number): number {
  if (type === 'sleep' || type === 'work') return parseFloat((minutes / 60).toFixed(1));
  return Math.round(minutes);
}

export function chartUnit(type: string): string {
  return type === 'sleep' || type === 'work' ? 'hrs' : 'min';
}

export function toLocalDateValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function lightenHex(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + 80);
  const g = Math.min(255, ((n >> 8) & 0xff) + 80);
  const b = Math.min(255, (n & 0xff) + 80);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function timeOverlap(a: ActivityLog, b: ActivityLog, day: string): boolean {
  const range = (l: ActivityLog): [number, number] => {
    const s = new Date(l.started_at);
    const sf = dayKey(s) !== day ? 0 : (s.getHours() * 60 + s.getMinutes()) / (24 * 60);
    if (!l.ended_at) return [sf, sf];
    const e = new Date(l.ended_at);
    const ef = dayKey(e) === day ? (e.getHours() * 60 + e.getMinutes()) / (24 * 60) : 1.0;
    return [sf, ef];
  };
  const [as, ae] = range(a);
  const [bs, be] = range(b);
  if (as === ae && bs === be) return Math.abs(as - bs) < 0.001;
  if (as === ae) return as >= bs && as <= be;
  if (bs === be) return bs >= as && bs <= ae;
  return as < be && bs < ae;
}
