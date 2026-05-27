import { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, Modal,
} from 'react-native';
import { Svg, Rect, Text as SvgText, Line, G, Path, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { ActivityLog } from '@/lib/api';
import { dayKey, SCREEN_W } from '@/lib/chartUtils';

// ── View mode ──────────────────────────────────────────────────────────────

type ViewMode =
  | 'line'          // value (duration/qty) per day  — line chart
  | 'line_count'    // count of entries per day
  | 'line_start'    // avg start time-of-day per day
  | 'line_end'      // avg end time-of-day per day
  | 'dist_start'    // histogram of start times-of-day
  | 'dist_end'      // histogram of end times-of-day
  | 'dist_daily'    // histogram of daily totals
  | 'dist_entry'    // histogram of per-entry values
  | 'dist_qty_na'   // histogram of quantities + NA bucket (mixed labels)
  | 'binary';       // per-day active/inactive barplot

type ModeOpt = { value: ViewMode; label: string };

// ── Data helpers ──────────────────────────────────────────────────────────

function fmtMinOfDay(m: number): string {
  const tm = Math.round(m) % (24 * 60);
  const h = Math.floor(tm / 60);
  const mn = tm % 60;
  const dh = h % 12 === 0 ? 12 : h % 12;
  return `${dh}:${mn.toString().padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

function fmtDurShort(min: number): string {
  return min >= 90 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`;
}

interface HistBin { lo: number; hi: number; count: number; label: string }

function buildValueHist(
  values: number[],
  fmtLbl: (v: number) => string,
  cnt?: number,
): { bins: HistBin[]; maxCount: number; mean: number | null } {
  if (!values.length) return { bins: [], maxCount: 0, mean: null };
  const n = cnt ?? Math.max(5, Math.min(20, Math.ceil(Math.sqrt(values.length))));
  const lo = Math.min(...values), hi = Math.max(...values);
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  if (lo === hi) {
    return { bins: [{ lo, hi: lo + 1, count: values.length, label: fmtLbl(lo) }], maxCount: values.length, mean };
  }
  const bw = (hi - lo) / n;
  const bins: HistBin[] = Array.from({ length: n }, (_, i) => ({
    lo: lo + i * bw, hi: lo + (i + 1) * bw, count: 0, label: fmtLbl(lo + i * bw),
  }));
  values.forEach(v => { bins[Math.min(n - 1, Math.floor((v - lo) / bw))].count++; });
  return { bins, maxCount: Math.max(...bins.map(b => b.count)), mean };
}

interface TBin { minOfDay: number; count: number; label: string }

function buildTimeHist(minutesOfDay: number[], slots = 24): { bins: TBin[]; maxCount: number; mean: number | null } {
  const mean = minutesOfDay.length ? minutesOfDay.reduce((a, v) => a + v, 0) / minutesOfDay.length : null;
  const mps = (24 * 60) / slots;
  const bins: TBin[] = Array.from({ length: slots }, (_, i) => {
    const m = i * mps, h = Math.floor(m / 60);
    let label = '';
    if (m % 60 === 0 && h % 6 === 0) {
      if (h === 0) label = '12am';
      else if (h === 12) label = '12pm';
      else label = `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
    }
    return { minOfDay: m, count: 0, label };
  });
  minutesOfDay.forEach(m => { bins[Math.min(slots - 1, Math.floor(m / mps))].count++; });
  return { bins, maxCount: Math.max(...bins.map(b => b.count), 1), mean };
}

// ── Mode dropdown ─────────────────────────────────────────────────────────

function ModeDropdown({ mode, opts, onChange }: {
  mode: ViewMode;
  opts: ModeOpt[];
  onChange: (m: ViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = opts.find(o => o.value === mode)?.label ?? mode;

  if (Platform.OS === 'web') {
    return (
      // @ts-ignore
      <select value={mode} onChange={(e: any) => onChange(e.target.value as ViewMode)}
        style={{
          fontSize: 10, color: '#374151', backgroundColor: '#f3f4f6',
          border: '1px solid #e5e7eb', borderRadius: 8, padding: '2px 6px',
          cursor: 'pointer', outline: 'none', maxWidth: 140,
        }}
      >
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <>
      <TouchableOpacity style={mds.trigger} onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.75}>
        <Text style={mds.trigTxt} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={10} color="#6b7280" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={mds.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={mds.sheet}>
            <Text style={mds.sheetHdr}>View mode</Text>
            {opts.map(o => (
              <TouchableOpacity key={o.value} style={[mds.opt, o.value === mode && mds.optOn]}
                onPress={() => { onChange(o.value); setOpen(false); }}>
                <Text style={[mds.optTxt, o.value === mode && mds.optTxtOn]}>{o.label}</Text>
                {o.value === mode && <Ionicons name="checkmark" size={16} color="#6366f1" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const mds = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#f3f4f6',
    borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 7, paddingVertical: 3, maxWidth: 140,
  },
  trigTxt: { fontSize: 10, fontWeight: '500', color: '#374151', flexShrink: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, paddingBottom: 24 },
  sheetHdr: { fontSize: 12, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  opt: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  optOn: { backgroundColor: '#eef2ff' },
  optTxt: { fontSize: 15, color: '#374151' },
  optTxtOn: { color: '#6366f1', fontWeight: '600' },
});

// ── ActivityChart ─────────────────────────────────────────────────────────

export function ActivityChart({
  type,
  logs,
  colorPair,
  colWidth,
  numDays,
  onScrollX,
  registerScroll,
  collapsed,
  onToggleCollapsed,
  svgHeight,
  fromDate,
  toDate,
}: {
  type: string;
  logs: ActivityLog[];
  colorPair: string[];
  colWidth: number;
  numDays: number;
  onScrollX: (x: number) => void;
  registerScroll: (ref: ScrollView | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  svgHeight?: number;
  fromDate?: string;
  toDate?: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('line');
  const [tooltip, setTooltip] = useState<{ idx: number } | null>(null);
  const hideDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTipDelayed = () => { hideDelayRef.current = setTimeout(() => setTooltip(null), 200); };
  const cancelHide = () => { if (hideDelayRef.current) { clearTimeout(hideDelayRef.current); hideDelayRef.current = null; } };
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX, setScrollX] = useState(colWidth * numDays);
  const [viewportW, setViewportW] = useState(SCREEN_W - 68);
  const [histContainerW, setHistContainerW] = useState(SCREEN_W - 68);

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: false }); }, []);

  // ── Chart type characteristics ────────────────────────────────────────────

  const hasDuration = logs.some(l =>
    l.activity_type === type &&
    l.duration_minutes != null &&
    l.extra_data?.zero !== true &&
    l.extra_data?.untimed !== true,
  );
  const hasQuantity = !hasDuration && logs.some(l =>
    l.activity_type === type && typeof l.extra_data?.quantity === 'number',
  );
  // Some entries have a quantity field, some don't (for the same label)
  const hasMixedQty = hasQuantity && logs.some(l =>
    l.activity_type === type &&
    typeof l.extra_data?.quantity !== 'number' &&
    l.extra_data?.zero !== true &&
    l.extra_data?.untimed !== true,
  );
  // Any explicitly-zero or untimed entries
  const hasZeroEntries = logs.some(l =>
    l.activity_type === type && (
      (hasDuration && (l.extra_data?.zero === true || l.extra_data?.untimed === true)) ||
      (hasQuantity && l.extra_data?.quantity === 0)
    ),
  );

  // ── Available modes for this chart ───────────────────────────────────────

  const availableModes: ModeOpt[] = [
    {
      value: 'line',
      label: hasDuration ? 'Duration / day' : hasQuantity ? 'Quantity / day' : 'Count / day',
    },
  ];
  if (hasDuration || hasQuantity) {
    availableModes.push({ value: 'line_count', label: 'Entries / day' });
  }
  if (hasDuration) {
    availableModes.push(
      { value: 'line_start', label: 'Start time / day' },
      { value: 'line_end',   label: 'End time / day' },
      { value: 'dist_start', label: 'Dist · start times' },
      { value: 'dist_end',   label: 'Dist · end times' },
      { value: 'dist_daily', label: 'Dist · daily total' },
      { value: 'dist_entry', label: 'Dist · per entry' },
    );
  } else if (hasQuantity) {
    availableModes.push(
      { value: 'dist_entry', label: 'Dist · per entry' },
      { value: 'dist_daily', label: 'Dist · daily total' },
    );
    if (hasMixedQty) {
      availableModes.push({ value: 'dist_qty_na', label: 'Dist · qty + NA' });
    }
  }
  if (hasZeroEntries) {
    availableModes.push({ value: 'binary', label: 'Active days' });
  }

  const effectiveMode: ViewMode = availableModes.some(m => m.value === viewMode) ? viewMode : 'line';
  const canSwitchMode = availableModes.length > 1;

  const isDistMode    = effectiveMode.startsWith('dist_');
  const isBinaryMode  = effectiveMode === 'binary';
  const isTimeLineMode = effectiveMode === 'line_start' || effectiveMode === 'line_end';
  const useCountMode  = effectiveMode === 'line_count';

  // ── Date range keys ───────────────────────────────────────────────────────

  const today = new Date();
  const rangeKeys: string[] = [];
  if (fromDate && toDate) {
    const from = new Date(fromDate + 'T12:00:00');
    const to   = new Date(toDate   + 'T12:00:00');
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      rangeKeys.push(dayKey(new Date(d)));
    }
  } else {
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      rangeKeys.push(dayKey(d));
    }
  }
  const rangeKeySet = new Set(rangeKeys);

  // Logs for this type within the date range (used by dist/binary modes)
  const scopedLogs = logs.filter(l =>
    l.activity_type === type && rangeKeySet.has(dayKey(new Date(l.started_at))),
  );

  // ── byDate for value/count line modes (always computed for dist_daily reuse) ──

  const byDate = new Map<string, number>();
  if (useCountMode) {
    logs
      .filter(l => l.activity_type === type && l.extra_data?.quantity !== 0)
      .forEach(l => {
        const key = dayKey(new Date(l.started_at));
        byDate.set(key, (byDate.get(key) ?? 0) + 1);
      });
  } else {
    logs
      .filter(l => {
        if (l.activity_type !== type) return false;
        if (hasDuration) return l.extra_data?.zero !== true && l.extra_data?.untimed !== true;
        if (hasQuantity) return typeof l.extra_data?.quantity === 'number' && l.extra_data.quantity !== 0;
        if (l.extra_data?.quantity === 0) return false;
        return true;
      })
      .forEach(l => {
        if (hasDuration) {
          const start = new Date(l.started_at);
          const startKey = dayKey(start);
          if (l.ended_at) {
            const end = new Date(l.ended_at);
            const endKey = dayKey(end);
            if (endKey !== startKey) {
              const midnight = new Date(start);
              midnight.setDate(midnight.getDate() + 1);
              midnight.setHours(0, 0, 0, 0);
              const startMins = Math.round((midnight.getTime() - start.getTime()) / 60000);
              const endMins = l.duration_minutes! - startMins;
              if (startMins > 0) byDate.set(startKey, (byDate.get(startKey) ?? 0) + startMins);
              if (endMins > 0)   byDate.set(endKey,   (byDate.get(endKey)   ?? 0) + endMins);
              return;
            }
          }
          byDate.set(startKey, (byDate.get(startKey) ?? 0) + (l.duration_minutes ?? 0));
        } else {
          const key = dayKey(new Date(l.started_at));
          const val = hasQuantity ? (l.extra_data!.quantity as number) : 1;
          byDate.set(key, (byDate.get(key) ?? 0) + val);
        }
      });
  }

  // ── byDateAvg{Start,End} for time-of-day line modes ──────────────────────

  const byDateAvgStart = new Map<string, number>();
  const byDateAvgEnd   = new Map<string, number>();

  if (isTimeLineMode) {
    const startBuckets = new Map<string, number[]>();
    const endBuckets   = new Map<string, number[]>();
    logs
      .filter(l =>
        l.activity_type === type &&
        l.duration_minutes != null &&
        l.extra_data?.zero !== true &&
        l.extra_data?.untimed !== true,
      )
      .forEach(l => {
        const start = new Date(l.started_at);
        const sk = dayKey(start);
        if (!startBuckets.has(sk)) startBuckets.set(sk, []);
        startBuckets.get(sk)!.push(start.getHours() * 60 + start.getMinutes());
        if (l.ended_at) {
          const end = new Date(l.ended_at);
          const ek = dayKey(end);
          if (!endBuckets.has(ek)) endBuckets.set(ek, []);
          endBuckets.get(ek)!.push(end.getHours() * 60 + end.getMinutes());
        }
      });
    startBuckets.forEach((arr, k) => byDateAvgStart.set(k, arr.reduce((s, v) => s + v, 0) / arr.length));
    endBuckets.forEach((arr, k)   => byDateAvgEnd.set(k,   arr.reduce((s, v) => s + v, 0) / arr.length));
  }

  const activeByDate = isTimeLineMode
    ? (effectiveMode === 'line_start' ? byDateAvgStart : byDateAvgEnd)
    : byDate;

  // ── misalignedDays / zeroDays (standard line mode only) ──────────────────

  const misalignedDays = new Set<string>();
  if (!useCountMode && !isDistMode && !isBinaryMode && !isTimeLineMode && hasQuantity) {
    logs
      .filter(l =>
        l.activity_type === type &&
        typeof l.extra_data?.quantity !== 'number' &&
        l.extra_data?.zero !== true &&
        l.extra_data?.untimed !== true,
      )
      .forEach(l => misalignedDays.add(dayKey(new Date(l.started_at))));
  }

  const zeroDays = new Set<string>();
  if (!useCountMode && !isDistMode && !isBinaryMode && !isTimeLineMode) {
    logs
      .filter(l => {
        if (l.activity_type !== type) return false;
        if (hasDuration) return l.extra_data?.zero === true || l.extra_data?.untimed === true;
        if (hasQuantity) return l.extra_data?.quantity === 0;
        return false;
      })
      .forEach(l => zeroDays.add(dayKey(new Date(l.started_at))));
  }

  // ── Early-return: no data at all ─────────────────────────────────────────

  if (!logs.some(l => l.activity_type === type)) {
    return (
      <View style={styles.chartPanelItem}>
        <TouchableOpacity style={styles.chartHeader} onPress={onToggleCollapsed} activeOpacity={0.7}>
          <Text style={styles.chartTitle}>{type} — not enough data yet</Text>
          <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#9ca3af" />
        </TouchableOpacity>
        {!collapsed && <Text style={styles.chartEmpty}>Log at least 2 days to see a chart.</Text>}
      </View>
    );
  }

  // ── days array (used by line chart + binary) ──────────────────────────────

  const days: Array<{ key: string; value: number | null }> = rangeKeys.map(key => ({
    key,
    value: activeByDate.get(key) ?? null,
  }));

  // ── Unit / value display helpers ─────────────────────────────────────────

  const derivedQuantityUnit = (() => {
    if (!hasQuantity) return '';
    const unitCounts = new Map<string, number>();
    logs
      .filter(l => l.activity_type === type && typeof l.extra_data?.quantity === 'number')
      .forEach(l => {
        const u = String(l.extra_data?.unit ?? '');
        unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1);
      });
    let best = '', bestCount = 0;
    unitCounts.forEach((c, u) => { if (c > bestCount) { bestCount = c; best = u; } });
    return best;
  })();

  const useHours = hasDuration && !useCountMode && !isTimeLineMode && byDate.size > 0
    && ([...byDate.values()].reduce((s, v) => s + v, 0) / byDate.size > 60);

  const unit = useCountMode ? 'entries'
    : isTimeLineMode ? ''
    : hasDuration ? (useHours ? 'hrs' : 'min')
    : hasQuantity  ? (derivedQuantityUnit || 'qty')
    : 'times';

  const dv = (rawVal: number) => {
    if (hasDuration && !useCountMode && !isTimeLineMode) {
      return useHours ? parseFloat((rawVal / 60).toFixed(1)) : Math.round(rawVal);
    }
    return rawVal;
  };

  // ── SVG layout constants ─────────────────────────────────────────────────

  const YW = 36;
  const SVG_H = svgHeight ?? 160;
  const PT = 14, PB = 22;
  const plotH = SVG_H - PT - PB;
  const totalChartW = colWidth * numDays;
  const xOf = (i: number) => i * colWidth + colWidth / 2;
  const baseY = PT + plotH;

  // ── Stats (for line/timeLine modes) ──────────────────────────────────────

  const dataPoints = days.filter(d => d.value !== null);

  const maxScrollX = Math.max(0, colWidth * numDays - viewportW);
  const clampedX = Math.min(scrollX, maxScrollX);
  const visStartIdx = Math.max(0, Math.floor(clampedX / colWidth));
  const visEndIdx   = Math.min(numDays - 1, Math.ceil((clampedX + viewportW) / colWidth));
  const windowDays  = days.slice(visStartIdx, visEndIdx + 1);
  const windowDataPts = windowDays.filter(d => d.value !== null);
  const windowZeroCount = (!useCountMode && hasQuantity && !isTimeLineMode)
    ? windowDays.filter(d => d.value === null && zeroDays.has(d.key)).length : 0;
  const windowVals = windowDataPts.map(d => isTimeLineMode ? d.value! : dv(d.value!));
  const mean = (windowVals.length + windowZeroCount) > 0
    ? windowVals.reduce((s, v) => s + v, 0) / (windowVals.length + windowZeroCount)
    : null;

  // meanStr: just the value part (no "avg " prefix) — added in summaryStr
  const meanStr = (() => {
    if (mean === null) return '';
    if (isTimeLineMode) return fmtMinOfDay(mean);
    return `${mean % 1 === 0 ? mean.toFixed(0) : mean.toFixed(1)} ${unit} / day`;
  })();

  const avgEntryVal = (() => {
    if (useCountMode || isTimeLineMode) return null;
    if (hasDuration) {
      const valid = logs.filter(l =>
        l.activity_type === type &&
        l.duration_minutes != null &&
        l.extra_data?.zero !== true &&
        l.extra_data?.untimed !== true,
      );
      if (!valid.length) return null;
      return dv(valid.reduce((s, l) => s + l.duration_minutes!, 0) / valid.length);
    }
    if (hasQuantity) {
      const valid = logs.filter(l => l.activity_type === type && typeof l.extra_data?.quantity === 'number');
      if (!valid.length) return null;
      return valid.reduce((s, l) => s + (l.extra_data!.quantity as number), 0) / valid.length;
    }
    return null;
  })();
  const avgEntryStr = avgEntryVal !== null
    ? `${avgEntryVal % 1 === 0 ? avgEntryVal.toFixed(0) : avgEntryVal.toFixed(1)} ${unit} / entry`
    : '';

  // ── Line chart rendering helpers ──────────────────────────────────────────

  const hasRangeData = (!useCountMode && (hasDuration || hasQuantity) && !isTimeLineMode)
    ? dataPoints.length >= 2
    : dataPoints.length >= 1;

  const maxVal = hasRangeData ? Math.max(...dataPoints.map(d => isTimeLineMode ? d.value! : dv(d.value!))) : 1;
  const yMax   = isTimeLineMode ? 24 * 60 : (maxVal > 0 ? maxVal * 1.15 : 1);
  const yOf    = (v: number) => PT + plotH * (1 - v / yMax);
  const meanY  = mean !== null ? yOf(mean) : null;

  const yTickVals = (() => {
    if (isTimeLineMode) return [0, 360, 720, 1080, 1440];
    if (!hasRangeData) return [];
    return (!useCountMode && (hasDuration || hasQuantity)) ? [0, yMax / 2, yMax] : [0, maxVal];
  })();
  const formatY = (v: number) => isTimeLineMode ? fmtMinOfDay(v) : (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1));

  const segments: Array<Array<{ x: number; y: number }>> = [];
  if (hasRangeData && ((!useCountMode && (hasDuration || hasQuantity)) || isTimeLineMode)) {
    let seg: Array<{ x: number; y: number }> = [];
    days.forEach((d, i) => {
      if (d.value !== null) {
        seg.push({ x: xOf(i), y: yOf(isTimeLineMode ? d.value : dv(d.value)) });
      } else if (seg.length > 0) {
        segments.push(seg); seg = [];
      }
    });
    if (seg.length > 0) segments.push(seg);
  }

  const labelEvery = colWidth < 10 ? 14 : colWidth < 20 ? 7 : 1;
  const dotR = Math.max(1.5, Math.min(4, colWidth / 2 - 1));

  const tipDay = tooltip !== null ? days[tooltip.idx] : null;
  const tipRaw = tipDay?.value ?? null;
  const tipVal = tipRaw !== null ? (isTimeLineMode ? tipRaw : dv(tipRaw)) : null;
  const TIP_W = 72, TIP_H = 22;
  const dotY   = tooltip !== null && tipVal !== null ? yOf(tipVal) : 0;
  const tipAbove = dotY - TIP_H - 4 >= 0;
  const tipX   = tooltip !== null
    ? Math.max(2, Math.min(xOf(tooltip.idx) - TIP_W / 2, totalChartW - TIP_W - 2)) : 0;
  const tipY   = tooltip !== null
    ? (tipAbove ? dotY - TIP_H - 4 : Math.min(dotY + dotR + 4, SVG_H - TIP_H)) : 0;
  const tipLabel = tipVal !== null
    ? (isTimeLineMode
        ? fmtMinOfDay(tipVal)
        : `${tipVal % 1 === 0 ? tipVal.toFixed(0) : tipVal.toFixed(1)} ${unit}`)
    : '';

  // ── Distribution data ─────────────────────────────────────────────────────

  type DistData =
    | { kind: 'time';     bins: TBin[];    maxCount: number; mean: number | null; n: number }
    | { kind: 'value';    bins: HistBin[]; maxCount: number; mean: number | null; n: number; xLabel: string }
    | { kind: 'value_na'; bins: HistBin[]; maxCount: number; mean: number | null; n: number; xLabel: string; naCount: number };

  const distData: DistData | null = (() => {
    if (!isDistMode) return null;

    const durLogs = scopedLogs.filter(l =>
      l.duration_minutes != null &&
      l.extra_data?.zero !== true &&
      l.extra_data?.untimed !== true,
    );
    const qtyLogs = scopedLogs.filter(l => typeof l.extra_data?.quantity === 'number');

    if (effectiveMode === 'dist_start') {
      const mins = durLogs.map(l => {
        const s = new Date(l.started_at);
        return s.getHours() * 60 + s.getMinutes();
      });
      return { kind: 'time', ...buildTimeHist(mins, 24), n: mins.length };
    }

    if (effectiveMode === 'dist_end') {
      const mins = durLogs
        .filter(l => l.ended_at != null)
        .map(l => {
          const e = new Date(l.ended_at!);
          return e.getHours() * 60 + e.getMinutes();
        });
      return { kind: 'time', ...buildTimeHist(mins, 24), n: mins.length };
    }

    if (effectiveMode === 'dist_daily') {
      const vals: number[] = [];
      rangeKeys.forEach(k => {
        const v = byDate.get(k);
        if (v != null) vals.push(hasDuration ? (useHours ? v / 60 : v) : v);
      });
      const fmt = hasDuration ? fmtDurShort : (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1));
      return {
        kind: 'value',
        ...buildValueHist(vals, fmt),
        n: vals.length,
        xLabel: hasDuration ? (useHours ? 'hrs/day' : 'min/day') : (derivedQuantityUnit ? `${derivedQuantityUnit}/day` : `${unit}/day`),
      };
    }

    if (effectiveMode === 'dist_entry') {
      if (hasDuration) {
        const vals = durLogs.map(l => useHours ? l.duration_minutes! / 60 : l.duration_minutes!);
        const fmt = useHours ? (v: number) => `${v.toFixed(1)}h` : fmtDurShort;
        return {
          kind: 'value',
          ...buildValueHist(vals, fmt),
          n: vals.length,
          xLabel: useHours ? 'hrs' : 'min',
        };
      }
      const vals = qtyLogs.map(l => l.extra_data!.quantity as number);
      const fmt = (v: number) => v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
      return {
        kind: 'value',
        ...buildValueHist(vals, fmt),
        n: vals.length,
        xLabel: derivedQuantityUnit || 'qty',
      };
    }

    if (effectiveMode === 'dist_qty_na') {
      const withQty = qtyLogs.map(l => l.extra_data!.quantity as number);
      const naCount = scopedLogs.filter(l =>
        typeof l.extra_data?.quantity !== 'number' &&
        l.extra_data?.zero !== true &&
        l.extra_data?.untimed !== true,
      ).length;
      const fmt = (v: number) => v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
      return {
        kind: 'value_na',
        ...buildValueHist(withQty, fmt),
        naCount,
        n: withQty.length + naCount,
        xLabel: derivedQuantityUnit || 'qty',
      };
    }

    return null;
  })();

  // ── Binary days data ──────────────────────────────────────────────────────

  const binaryDays = isBinaryMode ? rangeKeys.map(key => {
    const dayLogs = scopedLogs.filter(l => dayKey(new Date(l.started_at)) === key);
    const active = dayLogs.some(l =>
      l.extra_data?.zero !== true &&
      l.extra_data?.untimed !== true &&
      !(hasQuantity && l.extra_data?.quantity === 0),
    );
    const zeroOnly = !active && dayLogs.some(l =>
      l.extra_data?.zero === true ||
      l.extra_data?.untimed === true ||
      (hasQuantity && l.extra_data?.quantity === 0),
    );
    return { key, active, zeroOnly };
  }) : [];

  const binaryActiveDays = binaryDays.filter(d => d.active).length;

  // ── Header summary text ───────────────────────────────────────────────────

  const summaryStr = (() => {
    if (isBinaryMode) {
      return `${binaryActiveDays} / ${rangeKeys.length} days active`;
    }
    if (isDistMode && distData) {
      const n = distData.n;
      const suffix = n === 1 ? '1 entry' : `${n} entries`;
      if (distData.mean !== null) {
        const meanFmt = (effectiveMode === 'dist_start' || effectiveMode === 'dist_end')
          ? fmtMinOfDay(distData.mean)
          : (distData.mean % 1 === 0 ? distData.mean.toFixed(0) : distData.mean.toFixed(1));
        return `${suffix} · mean ${meanFmt}`;
      }
      return suffix;
    }
    return [
      meanStr !== '' ? `avg ${meanStr}` : null,
      avgEntryStr || null,
    ].filter(Boolean).join(', ');
  })();

  // ── Render: histogram ─────────────────────────────────────────────────────

  const renderHistogram = (containerW: number) => {
    if (!distData) return null;
    const chartW = Math.max(10, containerW - YW);

    type FlatBin = { label: string; count: number; isNA?: boolean };
    const flatBins: FlatBin[] = [];

    if (distData.kind === 'time') {
      distData.bins.forEach(b => flatBins.push({ label: b.label, count: b.count }));
    } else {
      distData.bins.forEach(b => flatBins.push({ label: b.label, count: b.count }));
      if (distData.kind === 'value_na' && distData.naCount > 0) {
        flatBins.push({ label: 'NA', count: distData.naCount, isNA: true });
      }
    }

    if (!flatBins.length) {
      return (
        <View style={{ flexDirection: 'row' }}>
          <Svg width={YW} height={SVG_H}>
            <Rect x={0} y={0} width={YW} height={SVG_H} fill={colorPair[0]} />
          </Svg>
          <Svg width={chartW} height={SVG_H}>
            <Rect x={0} y={0} width={chartW} height={SVG_H} fill={colorPair[0]} />
            <SvgText x={chartW / 2} y={SVG_H / 2 + 5} fontSize={12} fill="rgba(255,255,255,0.6)" textAnchor="middle">
              No data in this range
            </SvgText>
          </Svg>
        </View>
      );
    }

    const maxCount = Math.max(...flatBins.map(b => b.count), 1);
    const numBins  = flatBins.length;
    const binW     = chartW / numBins;
    const barPad   = Math.max(0.5, Math.min(2, binW * 0.1));
    const barW     = Math.max(1, binW - barPad * 2);

    const yTickVals2 = [0, Math.ceil(maxCount / 2), maxCount];

    // Mean line X position
    let meanX: number | null = null;
    if (distData.mean !== null) {
      if (distData.kind === 'time') {
        meanX = (distData.mean / (24 * 60)) * chartW;
      } else if (distData.bins.length >= 2) {
        const lo = distData.bins[0].lo;
        const hi = distData.bins[distData.bins.length - 1].hi;
        if (hi > lo) meanX = ((distData.mean - lo) / (hi - lo)) * chartW;
      }
    }

    // How many bins to skip between X-axis labels (avoid overlap)
    const approxLblW = 22;
    const showEvery  = Math.max(1, Math.ceil((numBins * approxLblW) / chartW));

    return (
      <View style={{ flexDirection: 'row' }}>
        {/* Y-axis */}
        <Svg width={YW} height={SVG_H}>
          <Rect x={0} y={0} width={YW} height={SVG_H} fill={colorPair[0]} />
          {yTickVals2.map((v, i) => (
            <SvgText key={i} x={YW - 4} y={PT + plotH * (1 - v / maxCount) + 4}
              fontSize={9} fill="rgba(255,255,255,0.75)" textAnchor="end">{v}</SvgText>
          ))}
          <SvgText x={YW / 2} y={SVG_H - 5} fontSize={8} fill="rgba(255,255,255,0.5)" textAnchor="middle">
            count
          </SvgText>
        </Svg>

        {/* Histogram */}
        <Svg width={chartW} height={SVG_H}>
          <Rect x={0} y={0} width={chartW} height={SVG_H} fill={colorPair[0]} />

          {/* Grid lines */}
          {yTickVals2.map((v, i) => (
            <Line key={i}
              x1={0} y1={PT + plotH * (1 - v / maxCount)}
              x2={chartW} y2={PT + plotH * (1 - v / maxCount)}
              stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          ))}

          {/* Bars */}
          {flatBins.map((bin, i) => {
            const bx = i * binW + barPad;
            const bh = plotH * (bin.count / maxCount);
            const by = baseY - bh;
            if (bin.count === 0) return null;
            return (
              <G key={i}>
                <Rect
                  x={bx} y={by} width={barW} height={bh}
                  fill={bin.isNA ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)'}
                  rx={1}
                />
                {/* Count label if bar is short enough to have room above */}
                {barW >= 12 && bh < plotH - 14 && (
                  <SvgText x={bx + barW / 2} y={by - 3}
                    fontSize={8} fill="rgba(255,255,255,0.85)" textAnchor="middle">
                    {bin.count}
                  </SvgText>
                )}
              </G>
            );
          })}

          {/* Mean line */}
          {meanX !== null && (
            <G>
              <Line x1={meanX} y1={PT} x2={meanX} y2={baseY}
                stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} strokeDasharray="4 3" />
              <SvgText
                x={Math.min(meanX + 3, chartW - 26)} y={PT + 10}
                fontSize={8} fill="rgba(255,255,255,0.75)">
                mean
              </SvgText>
            </G>
          )}

          {/* X-axis labels */}
          {flatBins.map((bin, i) => {
            if (!bin.label) return null;
            if (!bin.isNA && i % showEvery !== 0) return null;
            return (
              <SvgText key={`xl-${i}`}
                x={i * binW + binW / 2} y={SVG_H - 5}
                fontSize={bin.isNA ? 9 : 8}
                fill={bin.isNA ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.7)'}
                textAnchor="middle">
                {bin.label}
              </SvgText>
            );
          })}

          {/* X-axis label annotation (unit, right-aligned) */}
          {distData.kind !== 'time' && (distData as any).xLabel && (
            <SvgText x={chartW - 3} y={SVG_H - 5}
              fontSize={8} fill="rgba(255,255,255,0.45)" textAnchor="end">
              {(distData as any).xLabel}
            </SvgText>
          )}
        </Svg>
      </View>
    );
  };

  // ── Render: binary barplot ────────────────────────────────────────────────

  const renderBinary = () => {
    const totalW = colWidth * numDays;
    return (
      <View style={{ flexDirection: 'row' }}>
        <Svg width={YW} height={SVG_H}>
          <Rect x={0} y={0} width={YW} height={SVG_H} fill={colorPair[0]} />
          <SvgText x={YW - 4} y={PT + 4} fontSize={9} fill="rgba(255,255,255,0.75)" textAnchor="end">1</SvgText>
          <SvgText x={YW - 4} y={baseY + 4} fontSize={9} fill="rgba(255,255,255,0.75)" textAnchor="end">0</SvgText>
        </Svg>
        <ScrollView
          ref={(ref) => { (scrollRef as { current: ScrollView | null }).current = ref; registerScroll(ref); }}
          horizontal showsHorizontalScrollIndicator={false}
          onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
          onScroll={(e) => { const x = e.nativeEvent.contentOffset.x; setScrollX(x); onScrollX(x); }}
          scrollEventThrottle={100} style={{ flex: 1 }}
        >
          <Svg width={totalW} height={SVG_H}>
            <Rect x={0} y={0} width={totalW} height={SVG_H} fill={colorPair[0]} />
            <Line x1={0} y1={baseY} x2={totalW} y2={baseY}
              stroke="rgba(255,255,255,0.25)" strokeWidth={1} />

            {binaryDays.map((d, i) => {
              const cx  = xOf(i);
              const bw2 = Math.max(1, colWidth - 2);
              if (d.active) {
                return (
                  <Rect key={d.key} x={cx - bw2 / 2} y={PT} width={bw2} height={plotH}
                    fill="rgba(255,255,255,0.85)" rx={1} />
                );
              }
              if (d.zeroOnly) {
                return (
                  <Circle key={d.key} cx={cx} cy={baseY - dotR} r={dotR}
                    fill="rgba(255,255,255,0.85)" stroke="#fff" strokeWidth={1.5} />
                );
              }
              return null;
            })}

            {rangeKeys.map((key, i) => {
              if (i % labelEvery !== 0) return null;
              return (
                <SvgText key={key} x={xOf(i)} y={SVG_H - 5}
                  fontSize={9} fill="rgba(255,255,255,0.8)" textAnchor="middle">
                  {new Date(key + 'T12:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                </SvgText>
              );
            })}
          </Svg>
        </ScrollView>
      </View>
    );
  };

  // ── Render: standard line chart ───────────────────────────────────────────

  const renderLineChart = () => (
    <View style={{ flexDirection: 'row' }}>
      <Svg width={YW} height={SVG_H}>
        <Rect x={0} y={0} width={YW} height={SVG_H} fill={colorPair[0]} />
        {yTickVals.map((v, i) => (
          <SvgText key={i} x={YW - 4} y={yOf(v) + 4}
            fontSize={9} fill="rgba(255,255,255,0.75)" textAnchor="end">
            {formatY(v)}
          </SvgText>
        ))}
      </Svg>
      <ScrollView
        ref={(ref) => { (scrollRef as { current: ScrollView | null }).current = ref; registerScroll(ref); }}
        horizontal showsHorizontalScrollIndicator={false}
        onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
        onScroll={(e) => { const x = e.nativeEvent.contentOffset.x; setScrollX(x); onScrollX(x); }}
        scrollEventThrottle={100} style={{ flex: 1 }}
      >
        <Svg width={totalChartW} height={SVG_H}>
          <Rect x={0} y={0} width={totalChartW} height={SVG_H} fill={colorPair[0]} />

          {!hasRangeData && (
            <SvgText x={totalChartW / 2} y={SVG_H / 2 + 5}
              fontSize={12} fill="rgba(255,255,255,0.6)" textAnchor="middle">
              No data in this range
            </SvgText>
          )}

          {/* Grid lines */}
          {yTickVals.map((v, i) => (
            <Line key={i} x1={0} y1={yOf(v)} x2={totalChartW} y2={yOf(v)}
              stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          ))}

          {/* Mean line (dashed) */}
          {meanY !== null && (
            <Line x1={0} y1={meanY} x2={totalChartW} y2={meanY}
              stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeDasharray="4 3" />
          )}

          {/* Line path (duration / qty / time-of-day modes) */}
          {((!useCountMode && (hasDuration || hasQuantity)) || isTimeLineMode) && segments.map((s, si) => {
            const d = s.map((p, pi) => `${pi === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            return <Path key={si} d={d} stroke="rgba(255,255,255,0.9)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
          })}

          {/* Dots for line modes */}
          {((!useCountMode && (hasDuration || hasQuantity)) || isTimeLineMode) && days.map((d, i) => {
            if (d.value === null) return null;
            const v = isTimeLineMode ? d.value : dv(d.value);
            const selected = tooltip?.idx === i;
            const dotProps = Platform.OS === 'web'
              ? { onMouseEnter: () => { cancelHide(); setTooltip({ idx: i }); }, onMouseLeave: hideTipDelayed }
              : { onPressIn: () => setTooltip({ idx: i }), onPressOut: () => setTooltip(null) };
            return (
              <Circle key={i} cx={xOf(i)} cy={yOf(v)}
                r={selected ? dotR + 1 : dotR}
                fill={selected ? '#fff' : 'rgba(255,255,255,0.85)'}
                stroke="#fff" strokeWidth={selected ? 2 : 1.5}
                // @ts-ignore
                {...dotProps} />
            );
          })}

          {/* Lollipops for count / boolean modes */}
          {(useCountMode || (!hasDuration && !hasQuantity && !isTimeLineMode)) && days.map((d, i) => {
            if (d.value === null) return null;
            const v = dv(d.value);
            const cx = xOf(i), cy = yOf(v);
            const selected = tooltip?.idx === i;
            const dotProps = Platform.OS === 'web'
              ? { onMouseEnter: () => { cancelHide(); setTooltip({ idx: i }); }, onMouseLeave: hideTipDelayed }
              : { onPressIn: () => setTooltip({ idx: i }), onPressOut: () => setTooltip(null) };
            return (
              <G key={i}>
                <Line x1={cx} y1={baseY} x2={cx} y2={cy} stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} />
                <Circle cx={cx} cy={cy} r={selected ? 5 : 4}
                  fill={selected ? '#fff' : 'rgba(255,255,255,0.9)'}
                  stroke="#fff" strokeWidth={selected ? 2 : 1.5}
                  // @ts-ignore
                  {...dotProps} />
              </G>
            );
          })}

          {/* Misaligned days (qty entries without a quantity value) */}
          {[...misalignedDays].map(key => {
            const idx = days.findIndex(d => d.key === key);
            if (idx < 0) return null;
            return (
              <Circle key={`mis-${key}`} cx={xOf(idx)} cy={baseY - dotR} r={dotR}
                fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} />
            );
          })}

          {/* Zero days */}
          {[...zeroDays].map(key => {
            const idx = days.findIndex(d => d.key === key);
            if (idx < 0) return null;
            if (days[idx].value !== null && days[idx].value! > 0) return null;
            return (
              <Circle key={`zero-${key}`} cx={xOf(idx)} cy={baseY - dotR} r={dotR}
                fill="rgba(255,255,255,0.85)" stroke="#fff" strokeWidth={1.5} />
            );
          })}

          {/* Date labels */}
          {days.map((d, i) => {
            if (i % labelEvery !== 0) return null;
            return (
              <SvgText key={i} x={xOf(i)} y={SVG_H - 5}
                fontSize={9} fill="rgba(255,255,255,0.8)" textAnchor="middle">
                {new Date(d.key + 'T12:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
              </SvgText>
            );
          })}

          {/* Tooltip */}
          {tooltip !== null && tipVal !== null && (
            <G>
              <Rect x={tipX} y={tipY} width={TIP_W} height={TIP_H} rx={5} fill="#1f2937" />
              <SvgText x={tipX + TIP_W / 2} y={tipY + 14}
                fontSize={11} fontWeight="700" fill="#fff" textAnchor="middle">
                {tipLabel}
              </SvgText>
            </G>
          )}
        </Svg>
      </ScrollView>
    </View>
  );

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <View style={styles.chartPanelItem}>
      {/* Header */}
      <View style={styles.chartHeader}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onToggleCollapsed} activeOpacity={0.7}>
          <Text style={styles.chartTitle}>{type}</Text>
          {!collapsed && summaryStr !== '' && (
            <Text style={styles.chartMean}>{summaryStr}</Text>
          )}
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {canSwitchMode && !collapsed && (
            <ModeDropdown
              mode={effectiveMode}
              opts={availableModes}
              onChange={m => { setViewMode(m); setTooltip(null); }}
            />
          )}
          <TouchableOpacity onPress={onToggleCollapsed} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Chart body */}
      {!collapsed && (
        isDistMode ? (
          <View onLayout={e => setHistContainerW(e.nativeEvent.layout.width)}>
            {renderHistogram(histContainerW)}
          </View>
        ) : isBinaryMode ? (
          renderBinary()
        ) : (
          renderLineChart()
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chartPanelItem: { padding: 12, overflow: 'hidden' },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  chartTitle: { fontSize: 13, fontWeight: '600', color: '#374151' },
  chartMean: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  chartEmpty: { fontSize: 13, color: '#9ca3af', paddingBottom: 4 },
});
