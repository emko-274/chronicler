import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  PanResponder,
  Platform,
  Dimensions,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Svg, Rect, Text as SvgText, Line, G, Circle, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { getLogs, deleteLog, ActivityLog, getAcceptedSharedWithMe, Share } from '@/lib/api';
import SharePanel from '@/components/SharePanel';
import EditLogModal from '@/components/EditLogModal';

const SCREEN_W = Dimensions.get('window').width;

// One color per activity type (cycles if more types than colors)
const TYPE_COLORS = [
  ['#6366f1', '#818cf8'], // indigo
  ['#10b981', '#34d399'], // emerald
  ['#f59e0b', '#fbbf24'], // amber
  ['#ef4444', '#f87171'], // red
  ['#8b5cf6', '#a78bfa'], // violet
  ['#0ea5e9', '#38bdf8'], // sky
  ['#ec4899', '#f472b6'], // pink
  ['#14b8a6', '#2dd4bf'], // teal
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTimeRange(startIso: string, endIso: string | null): string {
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

// hours for sleep/work, minutes for everything else
function toChartValue(type: string, minutes: number): number {
  if (type === 'sleep' || type === 'work') {
    return parseFloat((minutes / 60).toFixed(1));
  }
  return Math.round(minutes);
}

function chartUnit(type: string): string {
  return type === 'sleep' || type === 'work' ? 'hrs' : 'min';
}

function toLocalDateValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function lightenHex(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const b2 = (c: number) => Math.round(c + (255 - c) * 0.4).toString(16).padStart(2, '0');
  return `#${b2(r)}${b2(g)}${b2(b)}`;
}

// ── Timeline chart ─────────────────────────────────────────────────────────

const TIME_LABEL_W = 38;
const DATE_LABEL_H = 30;
const CHART_H = 216;
const CHART_H_EXPANDED = 280;
const HOUR_TICKS = [0, 6, 12, 18, 24];
const BAR_PADDING = 2;
const MIN_COL_W = 4;
const MAX_COL_W = 80;
const DEFAULT_COL_W = 24; // ~13 days visible on a 320px-wide chart
const DEFAULT_HISTORY = 90;
const EXTEND_BY = 60;

function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface TooltipState {
  logs: ActivityLog[];
  barX: number;
  barY: number;
  barH: number;
}

function timeOverlap(a: ActivityLog, b: ActivityLog, day: string): boolean {
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

const TOOLTIP_W = 210;
const TOOLTIP_PAD = 8;
const FLIPPED_ROW_H = 24; // height of each date row in flipped mode
const HMAP_SLOTS = 48;    // 30-min buckets for the heatmap density layer

function TimelineChart({
  logs,
  colorMap,
  visibleTypes,
  typeOrder,
  onEdit,
  onDelete,
  colWidth,
  setColWidth,
  numDays,
  setNumDays,
  colWidthRef,
  numDaysRef,
  onScrollX,
  registerScroll,
  charts,
}: {
  logs: ActivityLog[];
  colorMap: Map<string, string[]>;
  visibleTypes: Set<string>;
  typeOrder: string[];
  onEdit: (log: ActivityLog) => void;
  onDelete: () => void;
  colWidth: number;
  setColWidth: (v: number | ((prev: number) => number)) => void;
  numDays: number;
  setNumDays: (v: number | ((prev: number) => number)) => void;
  colWidthRef: { current: number };
  numDaysRef: { current: number };
  onScrollX: (x: number) => void;
  registerScroll: (ref: ScrollView | null) => void;
  charts: string[];
}) {
  const scrollRef = useRef<ScrollView>(null);
  const chartWrapRef = useRef<View>(null);
  const chartBodyRef = useRef<View>(null);
  const hideDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [modalPage, setModalPage] = useState(0);
  const chartH = expanded ? CHART_H_EXPANDED : CHART_H;
  useEffect(() => { if (!expanded) setModalPage(0); }, [expanded]);
  const [isPinching, setIsPinching] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [crosshairY, setCrosshairY] = useState<number | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const isFlippedRef = useRef(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [hmapType, setHmapType] = useState('');
  const [viewportW, setViewportW] = useState(SCREEN_W - TIME_LABEL_W - 32);
  const [scrollXSnap, setScrollXSnap] = useState(Number.MAX_SAFE_INTEGER);
  const [scrollYSnap, setScrollYSnap] = useState(Number.MAX_SAFE_INTEGER);
  useEffect(() => { isFlippedRef.current = isFlipped; }, [isFlipped]);
  // Width of the time-of-day axis in flipped mode (measured on layout)
  const [flippedW, setFlippedW] = useState(SCREEN_W - 94);
  const scrollYRef = useRef(0);

  // colWidth and numDays are lifted to DashboardScreen and passed as props

  // Scroll to today on initial mount
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  // Infinite scroll: when near left edge, prepend more days and compensate scroll position
  const scrollXRef = useRef(0);
  const pendingCompensation = useRef(0);
  const isExtending = useRef(false);

  useEffect(() => {
    if (pendingCompensation.current > 0) {
      const comp = pendingCompensation.current;
      pendingCompensation.current = 0;
      const newX = scrollXRef.current + comp;
      scrollRef.current?.scrollTo({ x: newX, animated: false });
      onScrollX(newX);
      isExtending.current = false;
    }
  }, [numDays]);

  // Reset scroll and tooltip when switching between normal / flipped view
  useEffect(() => {
    setTooltip(null);
    scrollXRef.current = 0;
    scrollYRef.current = 0;
    // Reset snap states to large sentinels so they clamp to max-scroll (most recent
    // days/columns) before the first real onScroll event fires after scrollToEnd.
    setScrollXSnap(Number.MAX_SAFE_INTEGER);
    setScrollYSnap(Number.MAX_SAFE_INTEGER);
    setTimeout(() => {
      if (isFlippedRef.current) {
        scrollRef.current?.scrollTo({ y: 1_000_000, animated: false });
      } else {
        scrollRef.current?.scrollTo({ x: 1_000_000, animated: false });
      }
    }, 50);
  }, [isFlipped]);

  const hideTipDelayed = () => {
    if (hideDelayRef.current) clearTimeout(hideDelayRef.current);
    hideDelayRef.current = setTimeout(() => setTooltip(null), 800);
  };
  const cancelHide = () => {
    if (hideDelayRef.current) clearTimeout(hideDelayRef.current);
  };

  const handleScroll = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    scrollXRef.current = x;
    setScrollXSnap(x);
    onScrollX(x);
    const threshold = colWidthRef.current * 14;
    if (x < threshold && !isExtending.current) {
      isExtending.current = true;
      pendingCompensation.current = EXTEND_BY * colWidthRef.current;
      setNumDays(prev => prev + EXTEND_BY);
    }
  };

  // Web: ctrl+wheel (trackpad pinch) adjusts column width — only when over this chart
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const el = chartWrapRef.current as unknown as HTMLElement;
      if (!el?.contains(e.target as Node)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1; // pinch = narrower cols, spread = wider
      setColWidth(prev => Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(prev * factor))));
    };
    document.addEventListener('wheel', handler, { passive: false });
    return () => document.removeEventListener('wheel', handler);
  }, []);

  // Web: crosshair line tracks mouse Y over the chart body (normal view only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onMove = (e: MouseEvent) => {
      if (isFlippedRef.current) return;
      const el = chartBodyRef.current as unknown as HTMLElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right) { setCrosshairY(null); return; }
      const y = e.clientY - rect.top;
      setCrosshairY(y >= 0 && y <= chartH ? y : null);
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

  // Native: 2-finger pinch adjusts column width
  const pinchState = useRef<{ initialDistance: number; initialColW: number } | null>(null);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length === 2,
      onPanResponderGrant: (evt) => {
        const [t0, t1] = evt.nativeEvent.touches;
        pinchState.current = {
          initialDistance: Math.hypot(t1.pageX - t0.pageX, t1.pageY - t0.pageY),
          initialColW: colWidthRef.current,
        };
        setIsPinching(true);
      },
      onPanResponderMove: (evt) => {
        if (!pinchState.current || evt.nativeEvent.touches.length !== 2) return;
        const [t0, t1] = evt.nativeEvent.touches;
        const dist = Math.hypot(t1.pageX - t0.pageX, t1.pageY - t0.pageY);
        const scale = dist / pinchState.current.initialDistance; // spread = scale > 1 = wider
        const newW = Math.round(pinchState.current.initialColW * scale);
        setColWidth(Math.max(MIN_COL_W, Math.min(MAX_COL_W, newW)));
      },
      onPanResponderRelease: () => { pinchState.current = null; setIsPinching(false); },
      onPanResponderTerminate: () => { pinchState.current = null; setIsPinching(false); },
    })
  ).current;

  const svgH = chartH + DATE_LABEL_H;
  const totalChartW = colWidth * numDays;

  // Build days oldest → newest
  const today = new Date();
  const days: string[] = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(dayKey(d));
  }

  // Group logs by start day; multi-day entries also appear on their end day
  const byDay = new Map<string, ActivityLog[]>();
  days.forEach((d) => byDay.set(d, []));
  logs.forEach((l) => {
    const startKey = dayKey(new Date(l.started_at));
    if (byDay.has(startKey)) byDay.get(startKey)!.push(l);
    if (l.ended_at) {
      const endKey = dayKey(new Date(l.ended_at));
      if (endKey !== startKey && byDay.has(endKey)) byDay.get(endKey)!.push(l);
    }
  });

  // Heatmap density: how many log-minutes fall in each 30-min time-of-day bucket,
  // scoped to only the days currently visible in the scroll viewport.
  const hmapDensity = useMemo(() => {
    if (!showHeatmap) return null;
    const today = new Date();
    const daySet = new Set<string>();
    if (isFlipped) {
      // Flipped: use only the rows visible in the vertical scroll viewport
      const maxScrollY = Math.max(0, numDays * FLIPPED_ROW_H - chartH);
      const clampedY = Math.min(scrollYSnap, maxScrollY);
      const visStartRowIdx = Math.max(0, Math.floor(clampedY / FLIPPED_ROW_H));
      const visEndRowIdx = Math.min(numDays, visStartRowIdx + Math.ceil(chartH / FLIPPED_ROW_H) + 1);
      for (let i = visStartRowIdx; i < visEndRowIdx; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - (numDays - 1 - i));
        daySet.add(dayKey(d));
      }
    } else {
      // Normal: use only the columns visible in the horizontal scroll viewport
      const maxScrollX = Math.max(0, numDays * colWidth - viewportW);
      const clampedX = Math.min(scrollXSnap, maxScrollX);
      const visStartIdx = Math.max(0, Math.floor(clampedX / colWidth));
      const visEndIdx = Math.min(numDays, visStartIdx + Math.ceil(viewportW / colWidth) + 1);
      for (let i = visStartIdx; i < visEndIdx; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - (numDays - 1 - i));
        daySet.add(dayKey(d));
      }
    }
    const windowLogs = logs.filter((l) => {
      if (daySet.has(dayKey(new Date(l.started_at)))) return true;
      if (l.ended_at) return daySet.has(dayKey(new Date(l.ended_at)));
      return false;
    });
    const raw = new Float32Array(HMAP_SLOTS);
    windowLogs.forEach((l) => {
      const typeMatch = hmapType ? l.activity_type === hmapType : visibleTypes.has(l.activity_type);
      if (!typeMatch) return;
      const start = new Date(l.started_at);
      const startMOD = start.getHours() * 60 + start.getMinutes(); // minute-of-day
      if (!l.ended_at || l.duration_minutes === 0) {
        raw[Math.min(Math.floor((startMOD / 1440) * HMAP_SLOTS), HMAP_SLOTS - 1)] += 1;
        return;
      }
      const end = new Date(l.ended_at);
      const endMOD = end.getHours() * 60 + end.getMinutes();
      const crossMidnight = dayKey(start) !== dayKey(end);
      // Segment on start day: startMOD → midnight (or endMOD if same day)
      const seg1End = crossMidnight ? 1440 : endMOD;
      const s1 = Math.floor((startMOD / 1440) * HMAP_SLOTS);
      const e1 = Math.min(Math.ceil((seg1End / 1440) * HMAP_SLOTS), HMAP_SLOTS);
      for (let s = s1; s < e1; s++) raw[s] += 1;
      // Segment on end day: midnight → endMOD
      if (crossMidnight) {
        const e2 = Math.ceil((endMOD / 1440) * HMAP_SLOTS);
        for (let s = 0; s < e2; s++) raw[s] += 1;
      }
    });
    // Gaussian smooth with wrap-around at midnight (σ ≈ 1.5 slots = 45 min)
    const smoothed = new Float32Array(HMAP_SLOTS);
    const sigma = 1.5;
    for (let i = 0; i < HMAP_SLOTS; i++) {
      let sum = 0, wt = 0;
      for (let j = -5; j <= 5; j++) {
        const idx = (i + j + HMAP_SLOTS) % HMAP_SLOTS;
        const w = Math.exp(-(j * j) / (2 * sigma * sigma));
        sum += raw[idx] * w; wt += w;
      }
      smoothed[i] = wt > 0 ? sum / wt : 0;
    }
    const maxVal = Math.max(...smoothed, 1);
    return { values: smoothed, maxVal };
  }, [showHeatmap, isFlipped, logs, visibleTypes, numDays, colWidth, viewportW, scrollXSnap, scrollYSnap, hmapType]);

  // Sparse date labels so text doesn't overlap at small column widths
  const labelEvery = colWidth < 10 ? 14 : colWidth < 20 ? 7 : 1;

  const chartHeaderJSX = (
    <View style={styles.chartHeader}>
      <Text style={styles.chartTitle}>Activity Timeline</Text>
      <View style={styles.zoomRow}>
        {!isFlipped && (
          <>
            <TouchableOpacity style={styles.zoomBtn}
              onPress={() => setColWidth(w => Math.min(MAX_COL_W, Math.round(w * 1.4)))}>
              <Text style={styles.zoomBtnText}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn}
              onPress={() => setColWidth(w => Math.max(MIN_COL_W, Math.round(w * 0.7)))}>
              <Text style={styles.zoomBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.zoomBtn, styles.zoomBtnToday]}
              onPress={() => scrollRef.current?.scrollTo({ x: 1_000_000, animated: true })}>
              <Text style={[styles.zoomBtnText, styles.zoomBtnTodayText]}>Today</Text>
            </TouchableOpacity>
          </>
        )}
        {isFlipped && (
          <TouchableOpacity style={[styles.zoomBtn, styles.zoomBtnToday]}
            onPress={() => scrollRef.current?.scrollTo({ y: 1_000_000, animated: true })}>
            <Text style={[styles.zoomBtnText, styles.zoomBtnTodayText]}>Today</Text>
          </TouchableOpacity>
        )}
        {(() => {
          const typesSeen = new Set<string>();
          const chartTypes: string[] = [];
          logs.forEach(l => { if (!typesSeen.has(l.activity_type)) { typesSeen.add(l.activity_type); chartTypes.push(l.activity_type); } });
          const hmapOpts: DropdownOpt[] = [
            { label: 'All', value: '' },
            ...chartTypes.map(t => ({ label: t, value: t })),
          ];
          return (
            <>
              {showHeatmap && (
                <PanelDropdown value={hmapType} options={hmapOpts} onChange={setHmapType} />
              )}
              <TouchableOpacity
                style={[styles.zoomBtn, styles.zoomBtnFlip, showHeatmap && styles.zoomBtnFlipOn]}
                onPress={() => setShowHeatmap(h => !h)}
              >
                <Ionicons name="flame" size={13} color={showHeatmap ? '#fff' : '#6366f1'} />
              </TouchableOpacity>
            </>
          );
        })()}
        <TouchableOpacity
          style={[styles.zoomBtn, styles.zoomBtnFlip, isFlipped && styles.zoomBtnFlipOn]}
          onPress={() => setIsFlipped(f => !f)}
        >
          <Ionicons name={isFlipped ? 'swap-horizontal' : 'swap-vertical'} size={13} color={isFlipped ? '#fff' : '#6366f1'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.zoomBtn, styles.zoomBtnFlip, expanded && styles.zoomBtnFlipOn]}
          onPress={() => setExpanded(e => !e)}
        >
          <Ionicons name={expanded ? 'contract-outline' : 'expand-outline'} size={13} color={expanded ? '#fff' : '#6366f1'} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const card = (
    <View style={[styles.chartCard, expanded && styles.chartCardExpanded]} ref={chartWrapRef}>
      {chartHeaderJSX}

      {isFlipped ? (
        // ── Flipped: dates = rows (Y), time-of-day = columns (X) ─────────────
        <View
          onLayout={e => setFlippedW(e.nativeEvent.layout.width - TIME_LABEL_W)}
        >
          {/* Pinned time-of-day header */}
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: TIME_LABEL_W }} />
            <Svg width={flippedW} height={DATE_LABEL_H}>
              {HOUR_TICKS.filter(h => h < 24).map(h => {
                const x = (h / 24) * flippedW;
                const label = h === 0 ? '12am' : h === 12 ? '12pm' : `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
                return (
                  <SvgText key={h} x={x} y={DATE_LABEL_H - 6} fontSize={9} fill="#9ca3af" textAnchor="middle">
                    {label}
                  </SvgText>
                );
              })}
              <Line x1={0} y1={DATE_LABEL_H - 1} x2={flippedW} y2={DATE_LABEL_H - 1} stroke="#d1d5db" strokeWidth={1} />
            </Svg>
          </View>

          {/* Scrollable date rows — today at the bottom */}
          <ScrollView ref={scrollRef} style={{ maxHeight: chartH }} showsVerticalScrollIndicator={false}
            onScroll={e => setScrollYSnap(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={100}>
            {days.map((day, rowIdx) => {
              const entries = (byDay.get(day) ?? []).filter(l => visibleTypes.has(l.activity_type));
              const d = new Date(day + 'T12:00:00');
              return (
                <View key={day} style={{ flexDirection: 'row', height: FLIPPED_ROW_H }}>
                  {/* Date label */}
                  <View style={styles.flippedDateLabel}>
                    <Text style={styles.flippedDateText}>
                      {d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                    </Text>
                  </View>
                  {/* Activity bar row */}
                  <Svg width={flippedW} height={FLIPPED_ROW_H}>
                    <Rect x={0} y={0} width={flippedW} height={FLIPPED_ROW_H}
                      fill={rowIdx % 2 === 0 ? '#f9fafb' : '#f3f4f6'} />
                    {HOUR_TICKS.map(h => {
                      const x = (h / 24) * flippedW;
                      return (
                        <Line key={h} x1={x} y1={0} x2={x} y2={FLIPPED_ROW_H}
                          stroke="#d1d5db" strokeWidth={h === 0 || h === 24 ? 1 : 0.5}
                          strokeDasharray={h === 0 || h === 24 ? undefined : '3,3'} />
                      );
                    })}
                    {hmapDensity && (() => {
                      const slotW = flippedW / HMAP_SLOTS;
                      return (
                        <G>
                          {Array.from(hmapDensity.values).map((val, i) => {
                            const t = val / hmapDensity.maxVal;
                            if (t < 0.025) return null;
                            return (
                              <Rect key={i} x={i * slotW} y={0} width={slotW + 0.5} height={FLIPPED_ROW_H}
                                fill="#f97316" opacity={t * 0.45} />
                            );
                          })}
                        </G>
                      );
                    })()}
                    {entries.map(log => {
                      const start = new Date(log.started_at);
                      const logStartDay = dayKey(start);
                      const isContinuation = logStartDay !== day;
                      const startFrac = isContinuation
                        ? 0
                        : (start.getHours() * 60 + start.getMinutes()) / (24 * 60);
                      const barX = startFrac * flippedW;
                      const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
                      const interactionProps = Platform.OS === 'web'
                        ? { onClick: () => onEdit(log) }
                        : { onPress: () => onEdit(log) };
                      if (log.ended_at) {
                        const end = new Date(log.ended_at);
                        const endsToday = dayKey(end) === day;
                        const endFrac = endsToday
                          ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60)
                          : 1.0;
                        const barW = Math.max((endFrac - startFrac) * flippedW, 3);
                        return (
                          <Rect key={log.id + (isContinuation ? '-cont' : '')}
                            x={barX} y={BAR_PADDING} width={barW} height={FLIPPED_ROW_H - BAR_PADDING * 2}
                            fill={color} rx={2} opacity={0.85}
                            // @ts-ignore
                            {...interactionProps}
                          />
                        );
                      } else {
                        const isUntimed = log.extra_data?.untimed === true;
                        const isZero = log.extra_data?.zero === true;
                        const isTimeless = isUntimed || isZero;
                        const r = Math.min(3, (FLIPPED_ROW_H - BAR_PADDING * 2) / 2);
                        return (
                          <Circle key={log.id}
                            cx={isTimeless ? flippedW / 2 : barX}
                            cy={FLIPPED_ROW_H / 2}
                            r={r}
                            fill={isTimeless ? 'none' : color}
                            stroke={isTimeless ? color : 'none'}
                            strokeWidth={isTimeless ? 1.5 : 0}
                            opacity={isUntimed ? 0.4 : 0.85}
                            // @ts-ignore
                            {...interactionProps}
                          />
                        );
                      }
                    })}
                    <Line x1={0} y1={FLIPPED_ROW_H - 1} x2={flippedW} y2={FLIPPED_ROW_H - 1}
                      stroke="#e5e7eb" strokeWidth={0.5} />
                  </Svg>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        // ── Normal: dates = columns (X), time-of-day = rows (Y) ──────────────
        <View style={{ position: 'relative' }}>
        <View
          ref={chartBodyRef}
          style={{ flexDirection: 'row' }}
          {...(Platform.OS !== 'web' ? panResponder.panHandlers : {})}
        >
          {/* Pinned time-of-day axis */}
          <Svg width={TIME_LABEL_W} height={svgH}>
            {HOUR_TICKS.map((h) => {
              const y = (h / 24) * chartH;
              const label = h === 0 ? '12am' : h === 12 ? '12pm' : h === 24 ? '' : `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
              return (
                <SvgText key={h} x={TIME_LABEL_W - 4} y={y + 4} fontSize={9} fill="#9ca3af" textAnchor="end">
                  {label}
                </SvgText>
              );
            })}
          </Svg>

          <ScrollView
            ref={(ref) => { (scrollRef as { current: ScrollView | null }).current = ref; registerScroll(ref); }}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!isPinching}
            onLayout={e => setViewportW(e.nativeEvent.layout.width)}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            style={{ flex: 1 }}
          >
            <Svg width={totalChartW} height={svgH}>
              {days.map((day, colIdx) => (
                <Rect key={day + '-bg'} x={colIdx * colWidth} y={0} width={colWidth} height={chartH}
                  fill={colIdx % 2 === 0 ? '#f9fafb' : '#f3f4f6'} />
              ))}

              {HOUR_TICKS.map((h) => {
                const y = (h / 24) * chartH;
                return (
                  <Line key={h} x1={0} y1={y} x2={totalChartW} y2={y}
                    stroke="#d1d5db" strokeWidth={h === 0 ? 1 : 0.5}
                    strokeDasharray={h === 0 ? undefined : '3,3'} />
                );
              })}

              {/* Heatmap density overlay — rendered before bars so bars stay on top */}
              {hmapDensity && (() => {
                const slotH = chartH / HMAP_SLOTS;
                return (
                  <G>
                    {Array.from(hmapDensity.values).map((d, i) => {
                      const t = d / hmapDensity.maxVal;
                      if (t < 0.025) return null;
                      return (
                        <Rect
                          key={i}
                          x={0} y={i * slotH}
                          width={totalChartW} height={slotH + 0.5}
                          fill="#f97316"
                          opacity={t * 0.45}
                        />
                      );
                    })}
                  </G>
                );
              })()}

              {days.map((day, colIdx) => {
                const colX = colIdx * colWidth;
                const entries = (byDay.get(day) ?? [])
                  .filter(l => visibleTypes.has(l.activity_type))
                  .sort((a, b) => {
                    const ai = typeOrder.indexOf(a.activity_type);
                    const bi = typeOrder.indexOf(b.activity_type);
                    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                  });
                const d = new Date(day + 'T12:00:00');
                const showLabel = colIdx % labelEvery === 0;
                const barW = Math.max(1, colWidth - BAR_PADDING * 2);

                return (
                  <G key={day}>
                    {showLabel && (
                      <>
                        <SvgText x={colX + colWidth / 2} y={chartH + 12} fontSize={9} fill="#6b7280" textAnchor="middle">
                          {d.toLocaleDateString(undefined, { weekday: 'short' })}
                        </SvgText>
                        <SvgText x={colX + colWidth / 2} y={chartH + 23} fontSize={8} fill="#9ca3af" textAnchor="middle">
                          {d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                        </SvgText>
                      </>
                    )}
                    {entries.map((log) => {
                      const start = new Date(log.started_at);
                      const logStartDay = dayKey(start);
                      // This column may be rendering the entry's start day or its end day (continuation)
                      const isContinuation = logStartDay !== day;
                      const startFrac = isContinuation
                        ? 0
                        : (start.getHours() * 60 + start.getMinutes()) / (24 * 60);
                      const barY = startFrac * chartH;
                      const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
                      const barX = colX + BAR_PADDING;
                      const isHovered = tooltip?.logs.some(l => l.id === log.id) ?? false;

                      const showTip = () => {
                        let barH = 6;
                        if (log.ended_at) {
                          const end = new Date(log.ended_at);
                          const endsToday = dayKey(end) === day;
                          const endFrac = endsToday
                            ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60)
                            : 1.0;
                          barH = Math.max((endFrac - startFrac) * chartH, 3);
                        }
                        const overlapping = entries.filter(other => timeOverlap(log, other, day));
                        setTooltip({ logs: overlapping.length > 0 ? overlapping : [log], barX, barY, barH });
                      };
                      const hideTip = () => setTooltip(null);
                      const toggleTip = () => isHovered ? hideTip() : showTip();
                      // Mouse events (web only) — passing these to native SVG elements causes freezes
                      const interactionProps = Platform.OS === 'web'
                        ? { onMouseEnter: showTip, onMouseLeave: hideTipDelayed, onClick: () => onEdit(log) }
                        : { onPressIn: showTip, onPressOut: hideTip, onPress: () => onEdit(log) };

                      if (log.ended_at) {
                        const end = new Date(log.ended_at);
                        // If this entry ends on a different day, clip bar to bottom of this column
                        const endsToday = dayKey(end) === day;
                        const endFrac = endsToday
                          ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60)
                          : 1.0;
                        const barH = Math.max((endFrac - startFrac) * chartH, 3);
                        return (
                          <G key={log.id + (isContinuation ? '-cont' : '')}>
                            <Rect
                              x={barX} y={barY} width={barW} height={barH}
                              fill={color} rx={2} opacity={0.85}
                              // @ts-ignore — onMouseEnter/Leave valid on web SVG
                              {...interactionProps}
                            />
                          </G>
                        );
                      } else {
                        const isUntimed = log.extra_data?.untimed === true;
                        const isZero = log.extra_data?.zero === true;
                        const isTimeless = isUntimed || isZero;
                        const r = Math.max(3, Math.min(5, barW / 2));
                        return (
                          <G key={log.id}>
                            <Circle
                              cx={barX + barW / 2}
                              cy={isTimeless ? chartH / 2 : barY}
                              r={r}
                              fill={isTimeless ? 'none' : color}
                              stroke={isTimeless ? color : 'none'}
                              strokeWidth={isTimeless ? 1.5 : 0}
                              opacity={isUntimed ? 0.4 : 0.85}
                              // @ts-ignore
                              {...interactionProps}
                            />
                          </G>
                        );
                      }
                    })}
                  </G>
                );
              })}

              <Line x1={totalChartW} y1={0} x2={totalChartW} y2={chartH} stroke="#d1d5db" strokeWidth={1} />
              <Line x1={0} y1={chartH} x2={totalChartW} y2={chartH} stroke="#d1d5db" strokeWidth={1} />

              {/* Tooltip — native only; web uses a View overlay below */}
              {tooltip && Platform.OS !== 'web' && (() => {
                const entryData = tooltip.logs.map(tlog => {
                  const isTimeless = tlog.extra_data?.zero === true || tlog.extra_data?.untimed === true;
                  const timeStr = isTimeless
                    ? new Date(tlog.started_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                    : formatTimeRange(tlog.started_at, tlog.ended_at);
                  const dur = tlog.duration_minutes ? formatDuration(tlog.duration_minutes) : null;
                  const rawQty = tlog.extra_data?.quantity;
                  const qty = typeof rawQty === 'number'
                    ? `${rawQty % 1 === 0 ? rawQty.toFixed(0) : rawQty.toFixed(1)}${tlog.extra_data?.unit ? ` ${tlog.extra_data.unit}` : ''}`
                    : null;
                  const noteSnippet = tlog.notes ? (tlog.notes.length > 22 ? tlog.notes.slice(0, 22) + '…' : tlog.notes) : null;
                  const tags = Array.isArray(tlog.extra_data?.tags) ? (tlog.extra_data!.tags as string[]).join(', ') : null;
                  const lines = [timeStr, dur, qty, noteSnippet, tags].filter(Boolean) as string[];
                  return { tlog, lines };
                });
                const ENTRY_H = (e: { lines: string[] }) => 15 + e.lines.length * 13;
                const tipH = entryData.reduce((sum, e, i) => sum + ENTRY_H(e) + (i > 0 ? 6 : 0), 0) + 12;
                const tx = Math.max(0, Math.min(tooltip.barX, totalChartW - TOOLTIP_W));
                const spaceAbove = tooltip.barY >= tipH + TOOLTIP_PAD;
                const ty = spaceAbove
                  ? tooltip.barY - tipH - TOOLTIP_PAD
                  : tooltip.barY + tooltip.barH + TOOLTIP_PAD;
                let curY = ty + 10;
                return (
                  <G key="tooltip">
                    <Rect x={tx} y={ty} width={TOOLTIP_W} height={tipH}
                      fill="white" stroke="#d1d5db" strokeWidth={1} rx={6} />
                    {entryData.map(({ tlog, lines }, ei) => {
                      const color = colorMap.get(tlog.activity_type)?.[0] ?? '#111827';
                      const entryY = curY;
                      curY += ENTRY_H({ lines }) + (ei < entryData.length - 1 ? 6 : 0);
                      return (
                        <G key={tlog.id}>
                          {ei > 0 && <Line x1={tx + 6} y1={entryY - 3} x2={tx + TOOLTIP_W - 6} y2={entryY - 3} stroke="#e5e7eb" strokeWidth={1} />}
                          <SvgText x={tx + 10} y={entryY + 11} fontSize={10} fontWeight="bold" fill={color}>
                            {tlog.activity_type.charAt(0).toUpperCase() + tlog.activity_type.slice(1)}
                          </SvgText>
                          {lines.map((line, i) => (
                            <SvgText key={i} x={tx + 10} y={entryY + 23 + i * 13} fontSize={9} fill="#6b7280">
                              {line}
                            </SvgText>
                          ))}
                        </G>
                      );
                    })}
                  </G>
                );
              })()}
            </Svg>
          </ScrollView>
        </View>
        {crosshairY !== null && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: chartH }}>
            <View style={{ position: 'absolute', top: crosshairY - 0.5, left: 0, right: 0, height: 1, backgroundColor: 'rgba(99,102,241,0.45)' }} />
            <View style={{
              position: 'absolute',
              top: Math.max(0, crosshairY - 10),
              left: 2,
              backgroundColor: '#6366f1',
              borderRadius: 3,
              paddingHorizontal: 4,
              paddingVertical: 1,
            }}>
              <Text style={{ fontSize: 9, color: '#fff', fontWeight: '600' }}>
                {(() => {
                  const totalMins = Math.round((crosshairY / chartH) * 24 * 60);
                  const h = Math.min(23, Math.floor(totalMins / 60));
                  const m = totalMins % 60;
                  const period = h >= 12 ? 'pm' : 'am';
                  const dh = h % 12 === 0 ? 12 : h % 12;
                  return `${dh}:${m.toString().padStart(2, '0')} ${period}`;
                })()}
              </Text>
            </View>
          </View>
        )}
        {/* Web tooltip overlay — positioned absolute, stays visible while hovered */}
        {tooltip && Platform.OS === 'web' && (() => {
          const tx = Math.max(0, Math.min(tooltip.barX, totalChartW - TOOLTIP_W));
          const rawLeft = tx - scrollXSnap + TIME_LABEL_W;
          const overlayLeft = Math.max(0, Math.min(rawLeft, TIME_LABEL_W + viewportW - TOOLTIP_W));
          const spaceAbove = tooltip.barY >= 120 + TOOLTIP_PAD;
          const overlayTop = spaceAbove
            ? tooltip.barY - 120 - TOOLTIP_PAD
            : tooltip.barY + tooltip.barH + TOOLTIP_PAD;
          return (
            <View
              style={{
                position: 'absolute',
                left: overlayLeft,
                top: overlayTop,
                width: TOOLTIP_W,
                backgroundColor: '#fff',
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#d1d5db',
                paddingHorizontal: 10,
                paddingVertical: 7,
                zIndex: 20,
                shadowColor: '#000',
                shadowOpacity: 0.08,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
              }}
              // @ts-ignore — web mouse events
              onMouseEnter={cancelHide}
              onMouseLeave={() => setTooltip(null)}
            >
              {tooltip.logs.map((tlog, ei) => {
                const isTimeless = tlog.extra_data?.zero === true || tlog.extra_data?.untimed === true;
                const timeStr = isTimeless
                  ? new Date(tlog.started_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                  : formatTimeRange(tlog.started_at, tlog.ended_at);
                const dur = tlog.duration_minutes ? formatDuration(tlog.duration_minutes) : null;
                const rawQty = tlog.extra_data?.quantity;
                const qty = typeof rawQty === 'number'
                  ? `${rawQty % 1 === 0 ? rawQty.toFixed(0) : rawQty.toFixed(1)}${tlog.extra_data?.unit ? ` ${tlog.extra_data.unit}` : ''}`
                  : null;
                const noteSnippet = tlog.notes ? (tlog.notes.length > 40 ? tlog.notes.slice(0, 40) + '…' : tlog.notes) : null;
                const tlogTags = Array.isArray(tlog.extra_data?.tags) ? (tlog.extra_data!.tags as string[]) : [];
                const lines = [timeStr, dur, qty, noteSnippet].filter(Boolean) as string[];
                const color = colorMap.get(tlog.activity_type)?.[0] ?? '#6366f1';
                return (
                  <View key={tlog.id}>
                    {ei > 0 && <View style={{ height: 1, backgroundColor: '#e5e7eb', marginVertical: 6 }} />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color }}>
                        {tlog.activity_type.charAt(0).toUpperCase() + tlog.activity_type.slice(1)}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        <TouchableOpacity
                          onPress={() => { setTooltip(null); onEdit(tlog); }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons name="pencil-outline" size={12} color="#9ca3af" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={async () => {
                            const ok = window.confirm(`Delete this ${tlog.activity_type} entry?`);
                            if (!ok) return;
                            setTooltip(null);
                            await deleteLog(tlog.id);
                            onDelete();
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Ionicons name="trash-outline" size={12} color="#9ca3af" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    {lines.map((line, i) => (
                      <Text key={i} style={{ fontSize: 10, color: '#6b7280', lineHeight: 13 }}>{line}</Text>
                    ))}
                    {tlogTags.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                        {tlogTags.map(tag => (
                          <View key={tag} style={{ backgroundColor: '#eef2ff', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ fontSize: 9, color: '#4f46e5', fontWeight: '600' }}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })()}
        </View>
      )}
    </View>
  );

  if (expanded) {
    const totalModalPages = 1 + charts.length;
    const modalContent = modalPage === 0 ? card : (
      <View style={styles.activityChartsPanel}>
        <ActivityChart
          type={charts[modalPage - 1]}
          logs={logs}
          colorPair={colorMap.get(charts[modalPage - 1]) ?? TYPE_COLORS[0]}
          colWidth={colWidth}
          numDays={numDays}
          onScrollX={() => {}}
          registerScroll={() => {}}
          collapsed={false}
          onToggleCollapsed={() => {}}
          svgHeight={CHART_H_EXPANDED}
        />
      </View>
    );
    return (
      <>
        <View style={styles.chartCard}>
          {chartHeaderJSX}
          <View style={{ height: CHART_H, backgroundColor: '#f3f4f6', borderRadius: 6 }} />
        </View>
        <Modal visible transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
          <TouchableOpacity
            style={styles.timelineModalBackdrop}
            activeOpacity={1}
            onPress={() => setExpanded(false)}
          >
            <TouchableOpacity activeOpacity={1} style={styles.timelineModalPanel}>
              {modalContent}
              {totalModalPages > 1 && (
                <View style={styles.modalNav}>
                  <TouchableOpacity
                    onPress={() => setModalPage(p => Math.max(0, p - 1))}
                    disabled={modalPage === 0}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="chevron-back" size={22} color={modalPage === 0 ? 'rgba(255,255,255,0.3)' : '#fff'} />
                  </TouchableOpacity>
                  <View style={styles.modalDots}>
                    {Array.from({ length: totalModalPages }, (_, i) => (
                      <TouchableOpacity key={i} onPress={() => setModalPage(i)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                        <View style={[styles.modalDot, modalPage === i && styles.modalDotActive]} />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    onPress={() => setModalPage(p => Math.min(totalModalPages - 1, p + 1))}
                    disabled={modalPage === totalModalPages - 1}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="chevron-forward" size={22} color={modalPage === totalModalPages - 1 ? 'rgba(255,255,255,0.3)' : '#fff'} />
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </>
    );
  }
  return card;
}

// ── Per-type chart ─────────────────────────────────────────────────────────


function ActivityChart({
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
}) {
  const [tooltip, setTooltip] = useState<{ idx: number } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX, setScrollX] = useState(colWidth * numDays); // start at rightmost (today)
  const [viewportW, setViewportW] = useState(SCREEN_W - 68);  // approx; refined on layout
  const [showCount, setShowCount] = useState(false);
  const [countBtnHovered, setCountBtnHovered] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  const hasDuration = logs.some((l) => l.activity_type === type && l.duration_minutes != null && l.extra_data?.zero !== true && l.extra_data?.untimed !== true);
  const hasQuantity = !hasDuration && logs.some((l) => l.activity_type === type && typeof l.extra_data?.quantity === 'number');
  const canToggleCount = hasDuration || hasQuantity;
  const useCountMode = showCount && canToggleCount;
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
      .filter((l) => {
        if (l.activity_type !== type) return false;
        if (hasDuration) return l.extra_data?.zero !== true && l.extra_data?.untimed !== true;
        if (hasQuantity) return typeof l.extra_data?.quantity === 'number';
        if (l.extra_data?.quantity === 0) return false;
        return true;
      })
      .forEach((l) => {
        if (hasDuration) {
          const start = new Date(l.started_at);
          const startKey = dayKey(start);
          if (l.ended_at) {
            const end = new Date(l.ended_at);
            const endKey = dayKey(end);
            if (endKey !== startKey) {
              // Split at midnight: each day gets the minutes that fell on it
              const midnight = new Date(start);
              midnight.setDate(midnight.getDate() + 1);
              midnight.setHours(0, 0, 0, 0);
              const startMins = Math.round((midnight.getTime() - start.getTime()) / 60000);
              const endMins = l.duration_minutes! - startMins;
              if (startMins > 0) byDate.set(startKey, (byDate.get(startKey) ?? 0) + startMins);
              if (endMins > 0) byDate.set(endKey, (byDate.get(endKey) ?? 0) + endMins);
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

  // Days that have at least one entry missing the primary attribute for this type
  // (e.g. untimed entries when the type generally has duration, or entries without quantity)
  const misalignedDays = new Set<string>();
  if (!useCountMode && hasQuantity) {
    logs
      .filter((l) => {
        if (l.activity_type !== type) return false;
        if (l.extra_data?.zero === true || l.extra_data?.untimed === true) return false;
        return typeof l.extra_data?.quantity !== 'number';
      })
      .forEach((l) => misalignedDays.add(dayKey(new Date(l.started_at))));
  }

  if (byDate.size === 0 && misalignedDays.size === 0) {
    return (
      <View style={styles.chartPanelItem}>
        <TouchableOpacity style={styles.chartHeader} onPress={onToggleCollapsed} activeOpacity={0.7}>
          <Text style={styles.chartTitle}>
            {type} — not enough data yet
          </Text>
          <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#9ca3af" />
        </TouchableOpacity>
        {!collapsed && <Text style={styles.chartEmpty}>Log at least 2 days to see a chart.</Text>}
      </View>
    );
  }

  // Same day range as the timeline (oldest → newest)
  const today = new Date();
  const days: Array<{ key: string; value: number | null }> = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = dayKey(d);
    days.push({ key, value: byDate.get(key) ?? null });
  }

  const dataPoints = days.filter((d) => d.value !== null);
  const hasRangeData = (!useCountMode && (hasDuration || hasQuantity)) ? dataPoints.length >= 2 : dataPoints.length >= 1;

  // Derive the most-used quantity unit from the logs for this type
  const derivedQuantityUnit = (() => {
    if (!hasQuantity) return '';
    const unitCounts = new Map<string, number>();
    logs
      .filter((l) => l.activity_type === type && typeof l.extra_data?.quantity === 'number')
      .forEach((l) => {
        const u = String(l.extra_data?.unit ?? '');
        unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1);
      });
    let best = '';
    let bestCount = 0;
    unitCounts.forEach((c, u) => { if (c > bestCount) { bestCount = c; best = u; } });
    return best;
  })();

  const unit = useCountMode ? 'entries' : hasDuration ? chartUnit(type) : hasQuantity ? (derivedQuantityUnit || 'qty') : 'times';
  // Duration needs unit conversion; count mode and quantity/count charts use raw values
  const dv = (rawVal: number) => (hasDuration && !useCountMode) ? toChartValue(type, rawVal) : rawVal;

  // Mean is scoped to the currently visible window, not all history
  const maxScrollX = Math.max(0, colWidth * numDays - viewportW);
  const clampedX = Math.min(scrollX, maxScrollX);
  const visStartIdx = Math.max(0, Math.floor(clampedX / colWidth));
  const visEndIdx = Math.min(numDays - 1, Math.ceil((clampedX + viewportW) / colWidth));
  const windowDataPoints = days.slice(visStartIdx, visEndIdx + 1).filter(d => d.value !== null);
  const chartVals = windowDataPoints.map(d => dv(d.value!));
  const mean = chartVals.length > 0 ? chartVals.reduce((s, v) => s + v, 0) / chartVals.length : null;
  const meanStr = mean !== null ? `${mean % 1 === 0 ? mean.toFixed(0) : mean.toFixed(1)} ${unit}` : '';

  // Layout: pinned Y-axis (YW) + scrollable body (colWidth per day)
  const YW = 36;
  const SVG_H = svgHeight ?? 160;
  const PT = 14, PB = 22;
  const plotH = SVG_H - PT - PB;
  const totalChartW = colWidth * numDays;
  const xOf = (i: number) => i * colWidth + colWidth / 2;

  const maxVal = hasRangeData ? Math.max(...dataPoints.map((d) => dv(d.value!))) : 1;
  const yMax = maxVal > 0 ? maxVal * 1.15 : 1;
  const yOf = (v: number) => PT + plotH * (1 - v / yMax);
  const meanY = mean !== null ? yOf(mean) : null;
  const baseY = PT + plotH;

  const yTickVals = hasRangeData
    ? (!useCountMode && (hasDuration || hasQuantity)) ? [0, yMax / 2, yMax] : [0, maxVal]
    : [];
  const formatY = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1));

  const segments: Array<Array<{ x: number; y: number }>> = [];
  if (!useCountMode && (hasDuration || hasQuantity) && hasRangeData) {
    let seg: Array<{ x: number; y: number }> = [];
    days.forEach((d, i) => {
      if (d.value !== null) {
        seg.push({ x: xOf(i), y: yOf(dv(d.value)) });
      } else if (seg.length > 0) {
        segments.push(seg);
        seg = [];
      }
    });
    if (seg.length > 0) segments.push(seg);
  }

  const labelEvery = colWidth < 10 ? 14 : colWidth < 20 ? 7 : 1;
  const dotR = Math.max(1.5, Math.min(4, colWidth / 2 - 1));

  const tipDay = tooltip !== null ? days[tooltip.idx] : null;
  const tipVal = tipDay?.value != null ? dv(tipDay.value) : null;
  const TIP_W = 68;
  const tipX = tooltip !== null
    ? Math.max(2, Math.min(xOf(tooltip.idx) - TIP_W / 2, totalChartW - TIP_W - 2))
    : 0;
  const tipY = tooltip !== null ? Math.max(PT + 2, yOf(tipVal!) - 30) : 0;

  return (
    <View style={styles.chartPanelItem}>
      <View style={styles.chartHeader}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onToggleCollapsed} activeOpacity={0.7}>
          <Text style={styles.chartTitle}>{type}</Text>
          {!collapsed && meanStr !== '' && <Text style={styles.chartMean}>avg {meanStr}</Text>}
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {canToggleCount && (
            <TouchableOpacity
              onPress={() => { setShowCount(c => !c); setTooltip(null); }}
              {...(Platform.OS === 'web' ? {
                onMouseEnter: () => setCountBtnHovered(true),
                onMouseLeave: () => setCountBtnHovered(false),
              } : {})}
              style={[
                styles.countModeBtn,
                (countBtnHovered || useCountMode) && styles.countModeBtnExpanded,
                useCountMode && styles.countModeBtnOn,
              ]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.75}
            >
              <Ionicons
                name="list-outline"
                size={13}
                color={useCountMode ? '#fff' : '#6b7280'}
              />
              {(countBtnHovered || useCountMode) && (
                <Text style={[styles.countModeBtnText, useCountMode && styles.countModeBtnTextOn]}>
                  {useCountMode ? 'counts on' : 'show counts'}
                </Text>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onToggleCollapsed} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      </View>
      {!collapsed && <View style={{ flexDirection: 'row' }}>
        {/* Pinned Y-axis */}
        <Svg width={YW} height={SVG_H}>
          <Rect x={0} y={0} width={YW} height={SVG_H} fill={colorPair[0]} />
          {yTickVals.map((v, i) => (
            <SvgText key={i} x={YW - 4} y={yOf(v) + 4} fontSize={9} fill="rgba(255,255,255,0.75)" textAnchor="end">
              {formatY(v)}
            </SvgText>
          ))}
        </Svg>

        {/* Scrollable chart body — same colWidth per day as the timeline */}
        <ScrollView
          ref={(ref) => { (scrollRef as { current: ScrollView | null }).current = ref; registerScroll(ref); }}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
          onScroll={(e) => { const x = e.nativeEvent.contentOffset.x; setScrollX(x); onScrollX(x); }}
          scrollEventThrottle={100}
          style={{ flex: 1 }}
        >
          <Svg width={totalChartW} height={SVG_H}>
            <Rect x={0} y={0} width={totalChartW} height={SVG_H} fill={colorPair[0]} />

            {!hasRangeData && (
              <SvgText x={totalChartW / 2} y={SVG_H / 2 + 5} fontSize={12} fill="rgba(255,255,255,0.6)" textAnchor="middle">
                No data in this range
              </SvgText>
            )}

            {yTickVals.map((v, i) => (
              <Line key={i} x1={0} y1={yOf(v)} x2={totalChartW} y2={yOf(v)} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            ))}

            {meanY !== null && (
              <Line x1={0} y1={meanY} x2={totalChartW} y2={meanY}
                stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeDasharray="4 3" />
            )}

            {/* Duration/quantity (non-count mode): straight segments + dots */}
            {!useCountMode && (hasDuration || hasQuantity) && segments.map((s, si) => {
              const d = s.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
              return (
                <Path key={si} d={d} stroke="rgba(255,255,255,0.9)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              );
            })}

            {!useCountMode && (hasDuration || hasQuantity) && days.map((d, i) => {
              if (d.value === null) return null;
              const v = dv(d.value);
              const selected = tooltip?.idx === i;
              const dotProps = Platform.OS === 'web'
                ? { onMouseEnter: () => setTooltip({ idx: i }), onMouseLeave: () => setTooltip(null) }
                : { onPressIn: () => setTooltip({ idx: i }), onPressOut: () => setTooltip(null) };
              return (
                <Circle
                  key={i}
                  cx={xOf(i)} cy={yOf(v)} r={selected ? dotR + 1 : dotR}
                  fill={selected ? '#fff' : 'rgba(255,255,255,0.85)'}
                  stroke="#fff" strokeWidth={selected ? 2 : 1.5}
                  // @ts-ignore — onMouseEnter/Leave valid on web SVG
                  {...dotProps}
                />
              );
            })}

            {/* Count/lollipop: native count charts and duration charts in count mode */}
            {(useCountMode || (!hasDuration && !hasQuantity)) && days.map((d, i) => {
              if (d.value === null) return null;
              const v = dv(d.value);
              const cx = xOf(i);
              const cy = yOf(v);
              const selected = tooltip?.idx === i;
              const dotProps = Platform.OS === 'web'
                ? { onMouseEnter: () => setTooltip({ idx: i }), onMouseLeave: () => setTooltip(null) }
                : { onPressIn: () => setTooltip({ idx: i }), onPressOut: () => setTooltip(null) };
              return (
                <G key={i}>
                  <Line x1={cx} y1={baseY} x2={cx} y2={cy} stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} />
                  <Circle
                    cx={cx} cy={cy} r={selected ? 5 : 4}
                    fill={selected ? '#fff' : 'rgba(255,255,255,0.9)'}
                    stroke="#fff" strokeWidth={selected ? 2 : 1.5}
                    // @ts-ignore — onMouseEnter/Leave valid on web SVG
                    {...dotProps}
                  />
                </G>
              );
            })}

            {/* Hollow markers for days that have entries missing the primary attribute */}
            {[...misalignedDays].map((key) => {
              const idx = days.findIndex(d => d.key === key);
              if (idx < 0) return null;
              return (
                <Circle key={`mis-${key}`}
                  cx={xOf(idx)} cy={baseY - dotR} r={dotR}
                  fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5}
                />
              );
            })}

            {days.map((d, i) => {
              if (i % labelEvery !== 0) return null;
              return (
                <SvgText key={i} x={xOf(i)} y={SVG_H - 5} fontSize={9} fill="rgba(255,255,255,0.8)" textAnchor="middle">
                  {new Date(d.key + 'T12:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                </SvgText>
              );
            })}

            {tooltip !== null && tipVal !== null && (
              <G>
                <Rect x={tipX} y={tipY} width={TIP_W} height={22} rx={5} fill="#1f2937" />
                <SvgText x={tipX + TIP_W / 2} y={tipY + 14} fontSize={11} fontWeight="700" fill="#fff" textAnchor="middle">
                  {`${tipVal % 1 === 0 ? tipVal.toFixed(0) : tipVal.toFixed(1)} ${unit}`}
                </SvgText>
              </G>
            )}
          </Svg>
        </ScrollView>
      </View>}
    </View>
  );
}

// ── Toggle chips ───────────────────────────────────────────────────────────

function TypeToggles({
  types,
  visible,
  colorMap,
  onToggle,
  onReorder,
}: {
  types: string[];
  visible: Set<string>;
  colorMap: Map<string, string[]>;
  onToggle: (type: string) => void;
  onReorder: (newOrder: string[]) => void;
}) {
  const [reordering, setReordering] = useState(false);

  const move = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= types.length) return;
    const arr = [...types];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    onReorder(arr);
  };

  if (types.length === 0) return null;
  return (
    <View style={styles.toggleSection}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={styles.sectionLabel}>Show / Hide</Text>
        <TouchableOpacity
          onPress={() => setReordering(r => !r)}
          style={[styles.reorderBtn, reordering && styles.reorderBtnOn]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name={reordering ? 'checkmark' : 'layers-outline'} size={13} color={reordering ? '#fff' : '#6366f1'} />
          <Text style={[styles.reorderBtnText, reordering && styles.reorderBtnTextOn]}>
            {reordering ? 'Done' : 'Reorder'}
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {types.map((type, idx) => {
          const active = visible.has(type);
          const color = colorMap.get(type)?.[0] ?? '#6366f1';
          if (reordering) {
            return (
              <View
                key={type}
                style={[styles.toggleChip, active ? { backgroundColor: color } : styles.toggleChipOff, { flexDirection: 'row', alignItems: 'center', gap: 2 }]}
              >
                <TouchableOpacity onPress={() => move(idx, -1)} disabled={idx === 0} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                  <Ionicons name="chevron-back" size={12} color={idx === 0 ? 'rgba(255,255,255,0.25)' : (active ? '#fff' : '#9ca3af')} />
                </TouchableOpacity>
                <Text style={[styles.toggleChipText, !active && styles.toggleChipTextOff]}>{type}</Text>
                <TouchableOpacity onPress={() => move(idx, 1)} disabled={idx === types.length - 1} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                  <Ionicons name="chevron-forward" size={12} color={idx === types.length - 1 ? 'rgba(255,255,255,0.25)' : (active ? '#fff' : '#9ca3af')} />
                </TouchableOpacity>
              </View>
            );
          }
          return (
            <TouchableOpacity
              key={type}
              onPress={() => onToggle(type)}
              style={[styles.toggleChip, active ? { backgroundColor: color } : styles.toggleChipOff]}
            >
              <Text style={[styles.toggleChipText, !active && styles.toggleChipTextOff]}>{type}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Log item ───────────────────────────────────────────────────────────────

function LogItem({
  log,
  isLast,
  onDelete,
  onEdit,
}: {
  log: ActivityLog;
  isLast: boolean;
  onDelete: () => void;
  onEdit: (log: ActivityLog) => void;
}) {
  const confirmDelete = async () => {
    const ok = Platform.OS === 'web'
      ? window.confirm('Delete this entry?')
      : await new Promise<boolean>((resolve) =>
          Alert.alert('Delete entry?', undefined, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
          ])
        );
    if (!ok) return;
    await deleteLog(log.id);
    onDelete();
  };

  return (
    <TouchableOpacity
      style={[styles.logRow, isLast && styles.logRowLast]}
      onPress={() => onEdit(log)}
      activeOpacity={0.6}
    >
      <View style={styles.logRowMain}>
        <View style={styles.logRowLeft}>
          <Text style={styles.activityType}>{log.activity_type}</Text>
          <Text style={styles.date}>
            {(log.extra_data?.zero === true || log.extra_data?.untimed === true)
              ? new Date(log.started_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
              : formatTimeRange(log.started_at, log.ended_at)}
          </Text>
          {log.notes ? (
            <Text style={styles.notes} numberOfLines={1}>{log.notes}</Text>
          ) : null}
          {Array.isArray(log.extra_data?.tags) && (log.extra_data.tags as string[]).length > 0 && (
            <View style={styles.tagsRow}>
              {(log.extra_data.tags as string[]).map(tag => (
                <View key={tag} style={styles.tagPill}>
                  <Text style={styles.tagPillText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={styles.logRowRight}>
          {log.extra_data?.quantity != null ? (
            <Text style={styles.duration}>
              {`${Number(log.extra_data.quantity) % 1 === 0 ? Number(log.extra_data.quantity).toFixed(0) : Number(log.extra_data.quantity).toFixed(1)}${log.extra_data.unit ? ` ${log.extra_data.unit}` : ''}`}
            </Text>
          ) : (log.extra_data?.zero === true || log.extra_data?.untimed === true) ? null : (
            <Text style={styles.duration}>{formatDuration(log.duration_minutes)}</Text>
          )}
          <TouchableOpacity onPress={confirmDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={15} color="#d1d5db" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Dropdown ───────────────────────────────────────────────────────────────

type DropdownOpt = { label: string; value: string };

function PanelDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: DropdownOpt[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = options.find((o) => o.value === value)?.label ?? value;

  if (Platform.OS === 'web') {
    return (
      // @ts-ignore — native <select> on web
      <select
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        style={{
          fontSize: 12, fontWeight: '500', color: '#374151',
          backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb',
          borderRadius: 8, padding: '4px 8px', cursor: 'pointer', outline: 'none',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <>
      <TouchableOpacity style={dropdownStyles.trigger} onPress={() => setOpen(true)}>
        <Text style={dropdownStyles.triggerText}>{label}</Text>
        <Ionicons name="chevron-down" size={12} color="#6b7280" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dropdownStyles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={dropdownStyles.sheet}>
            {options.map((o) => (
              <TouchableOpacity
                key={o.value}
                style={[dropdownStyles.option, o.value === value && dropdownStyles.optionOn]}
                onPress={() => { onChange(o.value); setOpen(false); }}
              >
                <Text style={[dropdownStyles.optionText, o.value === value && dropdownStyles.optionTextOn]}>
                  {o.label}
                </Text>
                {o.value === value && <Ionicons name="checkmark" size={16} color="#6366f1" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const dropdownStyles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f3f4f6', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 10, paddingVertical: 5,
  },
  triggerText: { fontSize: 12, fontWeight: '500', color: '#374151' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingVertical: 8, paddingBottom: 24,
  },
  option: {
    paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  optionOn: { backgroundColor: '#eef2ff' },
  optionText: { fontSize: 15, color: '#374151' },
  optionTextOn: { color: '#6366f1', fontWeight: '600' },
});

// ── Screen ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

const SORT_OPTIONS: DropdownOpt[] = [
  { label: 'Start: newest', value: 'start_desc' },
  { label: 'Start: oldest', value: 'start_asc' },
  { label: 'End: newest',   value: 'end_desc' },
  { label: 'End: oldest',   value: 'end_asc' },
];

export default function DashboardScreen() {
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [viewingUserName, setViewingUserName] = useState<string | null>(null);
  const viewingUserIdRef = useRef<string | null>(null);
  const [sharedWithMe, setSharedWithMe] = useState<Share[]>([]);
  const [showSharePanel, setShowSharePanel] = useState(false);

  const loadSharedWithMe = async () => {
    try {
      const data = await getAcceptedSharedWithMe();
      setSharedWithMe(data);
    } catch {}
  };

  useEffect(() => { loadSharedWithMe(); }, []);

  const switchUser = (userId: string | null, userName: string | null) => {
    viewingUserIdRef.current = userId;
    setViewingUserId(userId);
    setViewingUserName(userName);
  };

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  const [typeOrder, setTypeOrder] = useState<string[]>([]);
  const [customTypeColors, setCustomTypeColors] = useState<Record<string, string>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('activity-tracker:type-colors') : null;
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [editingLog, setEditingLog] = useState<ActivityLog | null>(null);
  const [collapsedCharts, setCollapsedCharts] = useState<Set<string>>(new Set());

  const toggleChartCollapse = (type: string) => {
    setCollapsedCharts((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  // Shared timeline state lifted here so all charts use the same scale + history
  const [colWidth, setColWidth] = useState(DEFAULT_COL_W);
  const [numDays, setNumDays] = useState(DEFAULT_HISTORY);
  const colWidthRef = useRef(DEFAULT_COL_W);
  const numDaysRef = useRef(DEFAULT_HISTORY);
  useEffect(() => { colWidthRef.current = colWidth; }, [colWidth]);
  useEffect(() => { numDaysRef.current = numDays; }, [numDays]);

  // Scroll sync: all chart ScrollViews are registered here by key
  const scrollNodeRefs = useRef<Map<string, ScrollView | null>>(new Map());
  const isSyncingScroll = useRef(false);

  const syncScrollX = useCallback((x: number, sourceKey: string) => {
    if (Platform.OS === 'web') {
      scrollNodeRefs.current.forEach((ref, key) => {
        if (key === sourceKey || !ref) return;
        (ref as unknown as HTMLElement).scrollLeft = x;
      });
    } else {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      scrollNodeRefs.current.forEach((ref, key) => {
        if (key === sourceKey || !ref) return;
        (ref as ScrollView).scrollTo({ x, animated: false });
      });
      setTimeout(() => { isSyncingScroll.current = false; }, 50);
    }
  }, []);

  const [logPage, setLogPage] = useState(0);
  const [logFilter, setLogFilter] = useState('');
  const [logSort, setLogSort] = useState('start_desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await getLogs(undefined, 500, viewingUserIdRef.current ?? undefined);
      setLogs(data);
      setLogPage(0);
      // Show all types by default (preserve any manual toggles by only adding new ones)
      setVisibleTypes((prev) => {
        const next = new Set(prev);
        data.forEach((l) => next.add(l.activity_type));
        return next;
      });
      // Restore saved order, then append any new types not yet in the saved list
      setTypeOrder((prev) => {
        const savedRaw = typeof window !== 'undefined' ? localStorage.getItem('activity-tracker:type-order') : null;
        const saved: string[] = savedRaw ? JSON.parse(savedRaw) : prev;
        const allTypes = new Set(data.map(l => l.activity_type));
        const base = saved.filter(t => allTypes.has(t));
        const existing = new Set(base);
        [...data].reverse().forEach((l) => {
          if (!existing.has(l.activity_type)) { existing.add(l.activity_type); base.push(l.activity_type); }
        });
        return base;
      });
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => {
    fetchLogs();
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('activity-tracker:type-colors') : null;
      setCustomTypeColors(raw ? JSON.parse(raw) : {});
    } catch { /* ignore */ }
  }, []));

  useEffect(() => { fetchLogs(); }, [viewingUserId]);

  // Derive unique types in the order they first appear (API returns desc, so reverse for order)
  const uniqueTypes: string[] = [];
  const seen = new Set<string>();
  [...logs].reverse().forEach((l) => {
    if (!seen.has(l.activity_type)) {
      seen.add(l.activity_type);
      uniqueTypes.push(l.activity_type);
    }
  });

  // Assign a stable color to each type, preferring user-picked custom colors
  const colorMap = new Map<string, string[]>();
  uniqueTypes.forEach((t) => {
    const custom = customTypeColors[t];
    const idx = typeOrder.indexOf(t);
    colorMap.set(t, custom ? [custom, lightenHex(custom)] : TYPE_COLORS[(idx >= 0 ? idx : uniqueTypes.indexOf(t)) % TYPE_COLORS.length]);
  });

  const toggleType = (type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (loading) return <ActivityIndicator style={styles.centered} size="large" color="#6366f1" />;

  const charts = typeOrder.filter((t) => uniqueTypes.includes(t) && visibleTypes.has(t));

  // Filter + sort the log list independently of the charts
  const [sortField, sortDir] = logSort.split('_') as ['start' | 'end', 'desc' | 'asc'];
  const filteredLogs = logs
    .filter((l) => !logFilter || l.activity_type === logFilter)
    .filter((l) => {
      const t = new Date(l.started_at).getTime();
      if (dateFrom && t < new Date(dateFrom + 'T00:00:00').getTime()) return false;
      if (dateTo   && t > new Date(dateTo   + 'T23:59:59').getTime()) return false;
      return true;
    })
    .sort((a, b) => {
      const sign = sortDir === 'desc' ? -1 : 1;
      if (sortField === 'start') {
        return sign * (new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
      }
      // sort by end — entries without an end time sink to the bottom
      if (!a.ended_at && !b.ended_at) return 0;
      if (!a.ended_at) return 1;
      if (!b.ended_at) return -1;
      return sign * (new Date(a.ended_at).getTime() - new Date(b.ended_at).getTime());
    });

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const pagedLogs = filteredLogs.slice(logPage * PAGE_SIZE, (logPage + 1) * PAGE_SIZE);

  return (
    <>
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        data={[]}
        keyExtractor={() => ''}
        renderItem={null}
        ListHeaderComponent={
          <>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>
                {viewingUserName ? `${viewingUserName}'s Dashboard` : 'Dashboard'}
              </Text>
              <TouchableOpacity onPress={() => setShowSharePanel(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="people-outline" size={22} color="#6366f1" />
              </TouchableOpacity>
            </View>

            {/* Dashboard switcher — own + accepted shared dashboards */}
            {sharedWithMe.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.switcherRow} contentContainerStyle={styles.switcherContent}>
                <TouchableOpacity
                  style={[styles.switcherPill, !viewingUserId && styles.switcherPillActive]}
                  onPress={() => switchUser(null, null)}
                >
                  <Text style={[styles.switcherPillText, !viewingUserId && styles.switcherPillTextActive]}>Mine</Text>
                </TouchableOpacity>
                {sharedWithMe.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.switcherPill, viewingUserId === s.user.id && styles.switcherPillActive]}
                    onPress={() => switchUser(s.user.id, s.user.name)}
                  >
                    <Text style={[styles.switcherPillText, viewingUserId === s.user.id && styles.switcherPillTextActive]}>
                      {s.user.name || s.user.email}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {viewingUserId && (
              <View style={styles.readOnlyBanner}>
                <Ionicons name="eye-outline" size={13} color="#6b7280" />
                <Text style={styles.readOnlyText}>Read-only view</Text>
              </View>
            )}

            <SharePanel
              visible={showSharePanel}
              onClose={() => setShowSharePanel(false)}
              onSharesChanged={loadSharedWithMe}
            />

            <TypeToggles
              types={typeOrder.filter(t => uniqueTypes.includes(t))}
              visible={visibleTypes}
              colorMap={colorMap}
              onToggle={toggleType}
              onReorder={(order) => {
                setTypeOrder(order);
                if (typeof window !== 'undefined') localStorage.setItem('activity-tracker:type-order', JSON.stringify(order));
              }}
            />

            <TimelineChart
              logs={logs}
              colorMap={colorMap}
              visibleTypes={visibleTypes}
              typeOrder={typeOrder}
              onEdit={setEditingLog}
              onDelete={fetchLogs}
              colWidth={colWidth}
              setColWidth={setColWidth}
              numDays={numDays}
              setNumDays={setNumDays}
              colWidthRef={colWidthRef}
              numDaysRef={numDaysRef}
              onScrollX={(x) => syncScrollX(x, 'timeline')}
              registerScroll={(ref) => scrollNodeRefs.current.set('timeline', ref)}
              charts={charts}
            />

            {charts.length > 0 && (
              <View style={styles.activityChartsPanel}>
                {charts.flatMap((type, idx) => {
                  const chart = (
                    <ActivityChart
                      key={type}
                      type={type}
                      logs={logs}
                      colorPair={colorMap.get(type) ?? TYPE_COLORS[0]}
                      colWidth={colWidth}
                      numDays={numDays}
                      onScrollX={(x) => syncScrollX(x, type)}
                      registerScroll={(ref) => scrollNodeRefs.current.set(type, ref)}
                      collapsed={collapsedCharts.has(type)}
                      onToggleCollapsed={() => toggleChartCollapse(type)}
                    />
                  );
                  if (idx === 0) return [chart];
                  return [<View key={`d-${type}`} style={styles.chartPanelDivider} />, chart];
                })}
              </View>
            )}

            {logs.length === 0 && (
              <Text style={styles.empty}>No entries yet. Tap "Log Activity" to get started.</Text>
            )}

            {logs.length > 0 && (() => {
              const filterOptions: DropdownOpt[] = [
                { label: 'All types', value: '' },
                ...uniqueTypes.map((t) => ({ label: t, value: t })),
              ];
              return (
                <View style={styles.logPanel}>
                  {/* Panel header: title + dropdowns */}
                  <View style={styles.panelHead}>
                    <Text style={styles.panelHeadTitle}>Activity Log</Text>
                    <View style={styles.panelHeadControls}>
                      <PanelDropdown
                        value={logFilter}
                        options={filterOptions}
                        onChange={(v) => { setLogFilter(v); setLogPage(0); }}
                      />
                      <PanelDropdown
                        value={logSort}
                        options={SORT_OPTIONS}
                        onChange={(v) => { setLogSort(v); setLogPage(0); }}
                      />
                    </View>
                  </View>

                  {/* Date range row */}
                  <View style={styles.panelDateRow}>
                    {Platform.OS === 'web' ? (
                      <>
                        {/* @ts-ignore */}
                        <input type="date" value={dateFrom} max={toLocalDateValue(new Date())}
                          onChange={(e: any) => { setDateFrom(e.target.value); setLogPage(0); }}
                          style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid #e5e7eb', color: dateFrom ? '#374151' : '#9ca3af', backgroundColor: '#f9fafb', width: 112 }} />
                        <Text style={styles.dateRangeSep}>–</Text>
                        {/* @ts-ignore */}
                        <input type="date" value={dateTo} max={toLocalDateValue(new Date())}
                          onChange={(e: any) => { setDateTo(e.target.value); setLogPage(0); }}
                          style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid #e5e7eb', color: dateTo ? '#374151' : '#9ca3af', backgroundColor: '#f9fafb', width: 112 }} />
                      </>
                    ) : (
                      <>
                        <TextInput style={styles.dateRangeInput} placeholder="From" placeholderTextColor="#9ca3af"
                          value={dateFrom} onChangeText={(v) => { setDateFrom(v); setLogPage(0); }} />
                        <Text style={styles.dateRangeSep}>–</Text>
                        <TextInput style={styles.dateRangeInput} placeholder="To" placeholderTextColor="#9ca3af"
                          value={dateTo} onChangeText={(v) => { setDateTo(v); setLogPage(0); }} />
                      </>
                    )}
                    {(dateFrom || dateTo) && (
                      <TouchableOpacity onPress={() => { setDateFrom(''); setDateTo(''); setLogPage(0); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={14} color="#9ca3af" />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Log items */}
                  {pagedLogs.length === 0 ? (
                    <Text style={styles.panelEmpty}>No entries match your filters.</Text>
                  ) : (
                    pagedLogs.map((item, index) => (
                      <LogItem
                        key={item.id}
                        log={item}
                        isLast={index === pagedLogs.length - 1 && filteredLogs.length <= PAGE_SIZE}
                        onDelete={() => fetchLogs()}
                        onEdit={setEditingLog}
                      />
                    ))
                  )}

                  {/* Pagination */}
                  {filteredLogs.length > PAGE_SIZE && (
                    <View style={styles.panelPagination}>
                      <Text style={styles.pageLabel}>
                        {logPage * PAGE_SIZE + 1}–{Math.min((logPage + 1) * PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length}
                      </Text>
                      <View style={styles.pagination}>
                        <TouchableOpacity
                          style={[styles.pageBtn, logPage === 0 && styles.pageBtnDisabled]}
                          onPress={() => setLogPage((p) => Math.max(0, p - 1))}
                          disabled={logPage === 0}
                        >
                          <Ionicons name="chevron-back" size={16} color={logPage === 0 ? '#d1d5db' : '#6366f1'} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.pageBtn, logPage >= totalPages - 1 && styles.pageBtnDisabled]}
                          onPress={() => setLogPage((p) => Math.min(totalPages - 1, p + 1))}
                          disabled={logPage >= totalPages - 1}
                        >
                          <Ionicons name="chevron-forward" size={16} color={logPage >= totalPages - 1 ? '#d1d5db' : '#6366f1'} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })()}
          </>
        }
      />
      <EditLogModal
        log={editingLog}
        onClose={() => setEditingLog(null)}
        onSave={() => { setEditingLog(null); fetchLogs(); }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1 },
  heading: { fontSize: 22, fontWeight: '700', color: '#111827' },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  switcherRow: { marginBottom: 12 },
  switcherContent: { gap: 8, paddingRight: 4 },
  switcherPill: {
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#f9fafb',
  },
  switcherPillActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  switcherPillText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  switcherPillTextActive: { color: '#fff' },
  readOnlyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f3f4f6', borderRadius: 6,
    paddingVertical: 5, paddingHorizontal: 10, marginBottom: 12, alignSelf: 'flex-start',
  },
  readOnlyText: { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 8,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 40 },

  // Toggles
  toggleSection: { marginBottom: 16 },
  toggleChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    marginRight: 8,
  },
  toggleChipOff: { backgroundColor: '#e5e7eb' },
  toggleChipText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  toggleChipTextOff: { color: '#6b7280' },
  reorderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f1',
  },
  reorderBtnOn: { backgroundColor: '#6366f1' },
  reorderBtnText: { fontSize: 11, fontWeight: '600', color: '#6366f1' },
  reorderBtnTextOn: { color: '#fff' },

  // Charts
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  chartCardExpanded: {
    marginBottom: 0,
  },
  timelineModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 24,
  },
  timelineModalPanel: {
    width: '100%',
  },
  modalNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  modalDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
    marginHorizontal: 8,
  },
  modalDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  modalDotActive: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#fff',
  },
  activityChartsPanel: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  chartPanelItem: {
    padding: 12,
    overflow: 'hidden',
  },
  chartPanelDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e7eb',
  },
  countModeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 4, borderRadius: 10,
  },
  countModeBtnExpanded: {
    paddingHorizontal: 8, backgroundColor: '#e5e7eb',
  },
  countModeBtnOn: { backgroundColor: '#6366f1' },
  countModeBtnText: { fontSize: 10, fontWeight: '600', color: '#6b7280' },
  countModeBtnTextOn: { color: '#fff' },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  chartTitle: { fontSize: 13, fontWeight: '600', color: '#374151' },
  chartMean: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  zoomRow: { flexDirection: 'row', gap: 6 },
  zoomBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  zoomBtnText: { fontSize: 16, fontWeight: '600', color: '#374151', lineHeight: 20 },
  zoomBtnDisabled: { opacity: 0.35 },
  zoomBtnToday: { width: 'auto' as any, paddingHorizontal: 8, borderRadius: 13, backgroundColor: '#6366f1' },
  zoomBtnTodayText: { fontSize: 11, fontWeight: '700', color: '#fff', lineHeight: 20 },
  chartEmpty: { fontSize: 13, color: '#9ca3af', paddingBottom: 4 },

  zoomBtnFlip: { borderWidth: 1, borderColor: '#6366f1', backgroundColor: 'transparent' },
  zoomBtnFlipOn: { backgroundColor: '#6366f1' },

  // Flipped timeline
  flippedDateLabel: {
    width: TIME_LABEL_W, alignItems: 'flex-end' as const, justifyContent: 'center' as const,
    paddingRight: 4, borderRightWidth: 1, borderRightColor: '#e5e7eb',
  },
  flippedDateText: { fontSize: 8, color: '#6b7280' },

  // Log panel
  logPanel: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
    marginBottom: 16,
    marginTop: 4,
  },
  panelHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  panelHeadTitle: { fontSize: 13, fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 },
  panelHeadControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  panelDateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
    backgroundColor: '#f9fafb',
  },
  panelPagination: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  panelEmpty: { fontSize: 13, color: '#9ca3af', textAlign: 'center', paddingVertical: 24 },
  logRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  logRowLast: { borderBottomWidth: 0 },
  logRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  logRowLeft: { flex: 1 },
  logRowRight: { alignItems: 'flex-end', gap: 6 },
  activityType: { fontSize: 14, fontWeight: '600', color: '#6366f1' },
  duration: { fontSize: 13, color: '#374151', fontWeight: '500' },
  date: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  notes: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tagPill: { backgroundColor: '#eef2ff', borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 },
  tagPillText: { fontSize: 11, color: '#4f46e5', fontWeight: '500' },

  // Date range (inside panel)
  dateRangeSep: { fontSize: 11, color: '#9ca3af' },
  dateRangeInput: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 3, fontSize: 11, color: '#374151',
    backgroundColor: '#fff', width: 80,
  },

  // Pagination
  pagination: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10,
  },
  pageBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    alignItems: 'center', justifyContent: 'center',
  },
  pageBtnDisabled: { borderColor: '#f3f4f6', backgroundColor: '#f9fafb' },
  pageLabel: { fontSize: 12, color: '#6b7280', fontWeight: '500' },
});

