import { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform,
  PanResponder, Modal, TouchableOpacity,
} from 'react-native';
import { Svg, Rect, Text as SvgText, Line, G, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { ActivityLog } from '@/lib/api';
import { ActivityChart } from '@/components/ActivityChart';
import {
  dayKey, formatTimeRange, formatDuration, timeOverlap,
  TIME_LABEL_W, DATE_LABEL_H, CHART_H, CHART_H_EXPANDED, HOUR_TICKS, BAR_PADDING,
  MIN_COL_W, MAX_COL_W, EXTEND_BY, TOOLTIP_W, TOOLTIP_PAD, FLIPPED_ROW_H, HMAP_SLOTS,
  SCREEN_W, TYPE_COLORS,
} from '@/lib/chartUtils';

type DropdownOpt = { label: string; value: string };

function PanelDropdown({ value, options, onChange }: {
  value: string; options: DropdownOpt[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = options.find(o => o.value === value)?.label ?? value;
  if (Platform.OS === 'web') {
    return (
      // @ts-ignore
      <select value={value} onChange={(e: any) => onChange(e.target.value)}
        style={{ fontSize: 12, fontWeight: '500', color: '#374151', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', outline: 'none' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <>
      <TouchableOpacity style={dd.trigger} onPress={() => setOpen(true)}>
        <Text style={dd.triggerText}>{label}</Text>
        <Ionicons name="chevron-down" size={12} color="#6b7280" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={dd.sheet}>
            {options.map(o => (
              <TouchableOpacity key={o.value} style={[dd.option, o.value === value && dd.optionOn]}
                onPress={() => { onChange(o.value); setOpen(false); }}>
                <Text style={[dd.optionText, o.value === value && dd.optionTextOn]}>{o.label}</Text>
                {o.value === value && <Ionicons name="checkmark" size={16} color="#6366f1" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const dd = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f3f4f6', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 10, paddingVertical: 5 },
  triggerText: { fontSize: 12, fontWeight: '500', color: '#374151' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, paddingBottom: 24 },
  option: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  optionOn: { backgroundColor: '#eef2ff' },
  optionText: { fontSize: 15, color: '#374151' },
  optionTextOn: { color: '#6366f1', fontWeight: '600' },
});

interface TooltipState {
  logs: ActivityLog[];
  barX: number;
  barY: number;
  barH: number;
}

export function PublicTimeline({
  logs,
  colorMap,
  visibleTypes,
  typeOrder,
  colWidth,
  setColWidth,
  numDays,
  setNumDays,
  colWidthRef,
  numDaysRef,
  onScrollX,
  registerScroll,
  charts = [],
}: {
  logs: ActivityLog[];
  colorMap: Map<string, string[]>;
  visibleTypes: Set<string>;
  typeOrder: string[];
  colWidth: number;
  setColWidth: (v: number | ((prev: number) => number)) => void;
  numDays: number;
  setNumDays: (v: number | ((prev: number) => number)) => void;
  colWidthRef: { current: number };
  numDaysRef: { current: number };
  onScrollX: (x: number) => void;
  registerScroll: (ref: ScrollView | null) => void;
  charts?: string[];
}) {
  const scrollRef = useRef<ScrollView>(null);
  const chartWrapRef = useRef<View>(null);
  const chartBodyRef = useRef<View>(null);
  const flippedBodyRef = useRef<View>(null);


  const [expanded, setExpanded] = useState(false);
  const [modalPage, setModalPage] = useState(0);
  useEffect(() => { if (!expanded) setModalPage(0); }, [expanded]);
  const [isPinching, setIsPinching] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [crosshairY, setCrosshairY] = useState<number | null>(null);
  const [crosshairX, setCrosshairX] = useState<number | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const isFlippedRef = useRef(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [hmapType, setHmapType] = useState('');
  const [viewportW, setViewportW] = useState(SCREEN_W - TIME_LABEL_W - 32);
  const [scrollXSnap, setScrollXSnap] = useState(Number.MAX_SAFE_INTEGER);
  const [scrollYSnap, setScrollYSnap] = useState(Number.MAX_SAFE_INTEGER);
  const [flippedW, setFlippedW] = useState(SCREEN_W - 94);
  const scrollYRef = useRef(0);

  const chartH = expanded ? CHART_H_EXPANDED : CHART_H;

  useEffect(() => { isFlippedRef.current = isFlipped; }, [isFlipped]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  // Infinite scroll
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

  useEffect(() => {
    setTooltip(null);
    setCrosshairX(null);
    setCrosshairY(null);
    scrollXRef.current = 0;
    scrollYRef.current = 0;
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

  // Web ctrl+wheel zoom
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const el = chartWrapRef.current as unknown as HTMLElement;
      if (!el?.contains(e.target as Node)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setColWidth(prev => Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(prev * factor))));
    };
    document.addEventListener('wheel', handler, { passive: false });
    return () => document.removeEventListener('wheel', handler);
  }, []);

  // Web crosshair tracks mouse Y (normal) or X (flipped) over the chart body
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onMove = (e: MouseEvent) => {
      if (isFlippedRef.current) {
        const el = flippedBodyRef.current as unknown as HTMLElement;
        if (!el) { setCrosshairX(null); return; }
        const rect = el.getBoundingClientRect();
        if (e.clientX < rect.left + TIME_LABEL_W || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) { setCrosshairX(null); return; }
        setCrosshairX(e.clientX - rect.left - TIME_LABEL_W);
        return;
      }
      const el = chartBodyRef.current as unknown as HTMLElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right) { setCrosshairY(null); return; }
      const y = e.clientY - rect.top;
      setCrosshairY(y >= 0 && y <= chartH ? y : null);
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [chartH]);

  // Native pinch
  const pinchState = useRef<{ initialDistance: number; initialColW: number } | null>(null);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: evt => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponderCapture: evt => evt.nativeEvent.touches.length === 2,
      onPanResponderGrant: evt => {
        const [t0, t1] = evt.nativeEvent.touches;
        pinchState.current = {
          initialDistance: Math.hypot(t1.pageX - t0.pageX, t1.pageY - t0.pageY),
          initialColW: colWidthRef.current,
        };
        setIsPinching(true);
      },
      onPanResponderMove: evt => {
        if (!pinchState.current || evt.nativeEvent.touches.length !== 2) return;
        const [t0, t1] = evt.nativeEvent.touches;
        const dist = Math.hypot(t1.pageX - t0.pageX, t1.pageY - t0.pageY);
        const scale = dist / pinchState.current.initialDistance;
        setColWidth(Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(pinchState.current.initialColW * scale))));
      },
      onPanResponderRelease: () => { pinchState.current = null; setIsPinching(false); },
      onPanResponderTerminate: () => { pinchState.current = null; setIsPinching(false); },
    })
  ).current;

  const svgH = chartH + DATE_LABEL_H;
  const totalChartW = colWidth * numDays;
  const labelEvery = colWidth < 10 ? 14 : colWidth < 20 ? 7 : 1;

  const today = new Date();
  const days: string[] = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(dayKey(d));
  }

  const byDay = new Map<string, ActivityLog[]>();
  days.forEach(d => byDay.set(d, []));
  logs.forEach(l => {
    const startKey = dayKey(new Date(l.started_at));
    if (byDay.has(startKey)) byDay.get(startKey)!.push(l);
    if (l.ended_at) {
      const endKey = dayKey(new Date(l.ended_at));
      if (endKey !== startKey && byDay.has(endKey)) byDay.get(endKey)!.push(l);
    }
  });

  const hmapDensity = useMemo(() => {
    if (!showHeatmap) return null;
    const today = new Date();
    const daySet = new Set<string>();
    if (isFlipped) {
      const maxScrollY = Math.max(0, numDays * FLIPPED_ROW_H - chartH);
      const clampedY = Math.min(scrollYSnap, maxScrollY);
      const visStart = Math.max(0, Math.floor(clampedY / FLIPPED_ROW_H));
      const visEnd = Math.min(numDays, visStart + Math.ceil(chartH / FLIPPED_ROW_H) + 1);
      for (let i = visStart; i < visEnd; i++) {
        const d = new Date(today); d.setDate(today.getDate() - (numDays - 1 - i)); daySet.add(dayKey(d));
      }
    } else {
      const maxScrollX = Math.max(0, numDays * colWidth - viewportW);
      const clampedX = Math.min(scrollXSnap, maxScrollX);
      const visStart = Math.max(0, Math.floor(clampedX / colWidth));
      const visEnd = Math.min(numDays, visStart + Math.ceil(viewportW / colWidth) + 1);
      for (let i = visStart; i < visEnd; i++) {
        const d = new Date(today); d.setDate(today.getDate() - (numDays - 1 - i)); daySet.add(dayKey(d));
      }
    }
    const windowLogs = logs.filter(l => {
      if (daySet.has(dayKey(new Date(l.started_at)))) return true;
      if (l.ended_at) return daySet.has(dayKey(new Date(l.ended_at)));
      return false;
    });
    const raw = new Float32Array(HMAP_SLOTS);
    windowLogs.forEach(l => {
      const typeMatch = hmapType ? l.activity_type === hmapType : visibleTypes.has(l.activity_type);
      if (!typeMatch) return;
      const start = new Date(l.started_at);
      const startMOD = start.getHours() * 60 + start.getMinutes();
      if (!l.ended_at || l.duration_minutes === 0) {
        raw[Math.min(Math.floor((startMOD / 1440) * HMAP_SLOTS), HMAP_SLOTS - 1)] += 1;
        return;
      }
      const end = new Date(l.ended_at);
      const endMOD = end.getHours() * 60 + end.getMinutes();
      const crossMidnight = dayKey(start) !== dayKey(end);
      const seg1End = crossMidnight ? 1440 : endMOD;
      const s1 = Math.floor((startMOD / 1440) * HMAP_SLOTS);
      const e1 = Math.min(Math.ceil((seg1End / 1440) * HMAP_SLOTS), HMAP_SLOTS);
      for (let s = s1; s < e1; s++) raw[s] += 1;
      if (crossMidnight) { const e2 = Math.ceil((endMOD / 1440) * HMAP_SLOTS); for (let s = 0; s < e2; s++) raw[s] += 1; }
    });
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
  }, [showHeatmap, isFlipped, logs, visibleTypes, numDays, colWidth, viewportW, scrollXSnap, scrollYSnap, hmapType, chartH]);

  if (hmapType && !visibleTypes.has(hmapType)) setHmapType('');
  const hmapOpts: DropdownOpt[] = [
    { label: 'All', value: '' },
    ...typeOrder.filter(t => visibleTypes.has(t)).map(t => ({ label: t, value: t })),
  ];

  const header = (
    <View style={s.chartHeader}>
      <Text style={s.chartTitle}>Activity Timeline</Text>
      <View style={s.zoomRow}>
        {!isFlipped && (
          <>
            <TouchableOpacity style={s.zoomBtn} onPress={() => setColWidth(w => Math.min(MAX_COL_W, Math.round(w * 1.4)))}>
              <Text style={s.zoomBtnText}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.zoomBtn} onPress={() => setColWidth(w => Math.max(MIN_COL_W, Math.round(w * 0.7)))}>
              <Text style={s.zoomBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.zoomBtn, s.zoomBtnToday]} onPress={() => scrollRef.current?.scrollToEnd({ animated: false })}>
              <Text style={[s.zoomBtnText, s.zoomBtnTodayText]}>Today</Text>
            </TouchableOpacity>
          </>
        )}
        {isFlipped && (
          <TouchableOpacity style={[s.zoomBtn, s.zoomBtnToday]} onPress={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            <Text style={[s.zoomBtnText, s.zoomBtnTodayText]}>Today</Text>
          </TouchableOpacity>
        )}
        {showHeatmap && <PanelDropdown value={hmapType} options={hmapOpts} onChange={setHmapType} />}
        <TouchableOpacity style={[s.zoomBtn, s.zoomBtnIcon, showHeatmap && s.zoomBtnOn]} onPress={() => setShowHeatmap(h => !h)}>
          <Ionicons name="flame" size={13} color={showHeatmap ? '#fff' : '#6366f1'} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.zoomBtn, s.zoomBtnIcon, isFlipped && s.zoomBtnOn]} onPress={() => setIsFlipped(f => !f)}>
          <Ionicons name={isFlipped ? 'swap-horizontal' : 'swap-vertical'} size={13} color={isFlipped ? '#fff' : '#6366f1'} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.zoomBtn, s.zoomBtnIcon, expanded && s.zoomBtnOn]} onPress={() => setExpanded(e => !e)}>
          <Ionicons name={expanded ? 'contract-outline' : 'expand-outline'} size={13} color={expanded ? '#fff' : '#6366f1'} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const chartBody = (
    <View style={[s.card, expanded && s.cardExpanded]} ref={chartWrapRef}>
      {header}

      {isFlipped ? (
        <View ref={flippedBodyRef} style={{ position: 'relative' }} onLayout={e => setFlippedW(e.nativeEvent.layout.width - TIME_LABEL_W)}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: TIME_LABEL_W }} />
            <Svg width={flippedW} height={DATE_LABEL_H}>
              {HOUR_TICKS.filter(h => h < 24).map(h => {
                const x = (h / 24) * flippedW;
                const label = h === 0 ? '12am' : h === 12 ? '12pm' : `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
                return <SvgText key={h} x={x} y={DATE_LABEL_H - 6} fontSize={9} fill="#9ca3af" textAnchor="middle">{label}</SvgText>;
              })}
              <Line x1={0} y1={DATE_LABEL_H - 1} x2={flippedW} y2={DATE_LABEL_H - 1} stroke="#d1d5db" strokeWidth={1} />
            </Svg>
          </View>
          <ScrollView ref={scrollRef} style={{ maxHeight: chartH }} showsVerticalScrollIndicator={false}
            onScroll={e => setScrollYSnap(e.nativeEvent.contentOffset.y)} scrollEventThrottle={100}>
            {days.map((day, rowIdx) => {
              const entries = (byDay.get(day) ?? [])
                .filter(l => visibleTypes.has(l.activity_type))
                .sort((a, b) => {
                  const ai = typeOrder.indexOf(a.activity_type);
                  const bi = typeOrder.indexOf(b.activity_type);
                  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                });
              const d = new Date(day + 'T12:00:00');
              return (
                <View key={day} style={{ flexDirection: 'row', height: FLIPPED_ROW_H }}>
                  <View style={s.flippedDateLabel}>
                    <Text style={s.flippedDateText}>{d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</Text>
                  </View>
                  <Svg width={flippedW} height={FLIPPED_ROW_H}>
                    <Rect x={0} y={0} width={flippedW} height={FLIPPED_ROW_H} fill={rowIdx % 2 === 0 ? '#f9fafb' : '#f3f4f6'} />
                    {HOUR_TICKS.map(h => {
                      const x = (h / 24) * flippedW;
                      return <Line key={h} x1={x} y1={0} x2={x} y2={FLIPPED_ROW_H} stroke="#d1d5db" strokeWidth={h === 0 || h === 24 ? 1 : 0.5} strokeDasharray={h === 0 || h === 24 ? undefined : '3,3'} />;
                    })}
                    {hmapDensity && (() => {
                      const slotW = flippedW / HMAP_SLOTS;
                      return (
                        <G>
                          {Array.from(hmapDensity.values).map((val, i) => {
                            const t = val / hmapDensity.maxVal;
                            if (t < 0.025) return null;
                            return <Rect key={i} x={i * slotW} y={0} width={slotW + 0.5} height={FLIPPED_ROW_H} fill="#f97316" opacity={t * 0.45} />;
                          })}
                        </G>
                      );
                    })()}
                    {entries.map(log => {
                      const start = new Date(log.started_at);
                      const isContinuation = dayKey(start) !== day;
                      const startFrac = isContinuation ? 0 : (start.getHours() * 60 + start.getMinutes()) / (24 * 60);
                      const barX = startFrac * flippedW;
                      const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
                      const showTip = () => {
                        const overlapping = entries.filter(other => timeOverlap(log, other, day));
                        setTooltip({ logs: overlapping.length > 0 ? overlapping : [log], barX, barY: 0, barH: FLIPPED_ROW_H });
                      };
                      const tipProps = Platform.OS === 'web'
                        ? { onMouseEnter: showTip, onMouseLeave: () => setTooltip(null) }
                        : { onPressIn: showTip, onPressOut: () => setTooltip(null) };
                      if (log.ended_at) {
                        const end = new Date(log.ended_at);
                        const endsToday = dayKey(end) === day;
                        const endFrac = endsToday ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60) : 1.0;
                        const barW = Math.max((endFrac - startFrac) * flippedW, 3);
                        return <Rect key={log.id + (isContinuation ? '-cont' : '')} x={barX} y={BAR_PADDING} width={barW} height={FLIPPED_ROW_H - BAR_PADDING * 2} fill={color} rx={2} opacity={0.85} // @ts-ignore
                          {...tipProps} />;
                      }
                      const isTimeless = log.extra_data?.untimed === true || log.extra_data?.zero === true;
                      const r = Math.min(3, (FLIPPED_ROW_H - BAR_PADDING * 2) / 2);
                      return <Circle key={log.id} cx={isTimeless ? flippedW / 2 : barX} cy={FLIPPED_ROW_H / 2} r={r} fill={isTimeless ? 'none' : color} stroke={isTimeless ? color : 'none'} strokeWidth={isTimeless ? 1.5 : 0} opacity={log.extra_data?.untimed ? 0.4 : 0.85} // @ts-ignore
                        {...tipProps} />;
                    })}
                    <Line x1={0} y1={FLIPPED_ROW_H - 1} x2={flippedW} y2={FLIPPED_ROW_H - 1} stroke="#e5e7eb" strokeWidth={0.5} />
                  </Svg>
                </View>
              );
            })}
          </ScrollView>
          {crosshairX !== null && (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, height: DATE_LABEL_H + chartH, left: 0, right: 0 }}>
              <View style={{ position: 'absolute', top: 0, bottom: 0, left: TIME_LABEL_W + crosshairX - 0.5, width: 1, backgroundColor: 'rgba(99,102,241,0.45)' }} />
              <View style={{ position: 'absolute', top: 2, left: crosshairX > flippedW - 44 ? TIME_LABEL_W + crosshairX - 40 : TIME_LABEL_W + crosshairX + 4, backgroundColor: '#6366f1', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 }}>
                <Text style={{ fontSize: 9, color: '#fff', fontWeight: '600' }}>
                  {(() => {
                    const totalMins = Math.round((crosshairX / flippedW) * 24 * 60);
                    const h = Math.min(23, Math.floor(totalMins / 60));
                    const m = totalMins % 60;
                    const dh = h % 12 === 0 ? 12 : h % 12;
                    return `${dh}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
                  })()}
                </Text>
              </View>
            </View>
          )}
        </View>
      ) : (
        <View style={{ position: 'relative' }}>
          <View ref={chartBodyRef} style={{ flexDirection: 'row' }} {...(Platform.OS !== 'web' ? panResponder.panHandlers : {})}>
            <Svg width={TIME_LABEL_W} height={svgH}>
              {HOUR_TICKS.map(h => {
                const y = (h / 24) * chartH;
                const label = h === 0 ? '12am' : h === 12 ? '12pm' : h === 24 ? '' : `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
                return <SvgText key={h} x={TIME_LABEL_W - 4} y={y + 4} fontSize={9} fill="#9ca3af" textAnchor="end">{label}</SvgText>;
              })}
            </Svg>
            <ScrollView
              ref={ref => { (scrollRef as any).current = ref; registerScroll(ref); }}
              horizontal showsHorizontalScrollIndicator={false}
              scrollEnabled={!isPinching}
              onLayout={e => setViewportW(e.nativeEvent.layout.width)}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              style={{ flex: 1 }}
            >
              <Svg width={totalChartW} height={svgH}>
                {days.map((day, colIdx) => (
                  <Rect key={day + '-bg'} x={colIdx * colWidth} y={0} width={colWidth} height={chartH} fill={colIdx % 2 === 0 ? '#f9fafb' : '#f3f4f6'} />
                ))}
                {HOUR_TICKS.map(h => {
                  const y = (h / 24) * chartH;
                  return <Line key={h} x1={0} y1={y} x2={totalChartW} y2={y} stroke="#d1d5db" strokeWidth={h === 0 ? 1 : 0.5} strokeDasharray={h === 0 ? undefined : '3,3'} />;
                })}
                {hmapDensity && (() => {
                  const slotH = chartH / HMAP_SLOTS;
                  return (
                    <G>
                      {Array.from(hmapDensity.values).map((d, i) => {
                        const t = d / hmapDensity.maxVal;
                        if (t < 0.025) return null;
                        return <Rect key={i} x={0} y={i * slotH} width={totalChartW} height={slotH + 0.5} fill="#f97316" opacity={t * 0.45} />;
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
                          <SvgText x={colX + colWidth / 2} y={chartH + 12} fontSize={9} fill="#6b7280" textAnchor="middle">{d.toLocaleDateString(undefined, { weekday: 'short' })}</SvgText>
                          <SvgText x={colX + colWidth / 2} y={chartH + 23} fontSize={8} fill="#9ca3af" textAnchor="middle">{d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</SvgText>
                        </>
                      )}
                      {entries.map(log => {
                        const start = new Date(log.started_at);
                        const isContinuation = dayKey(start) !== day;
                        const startFrac = isContinuation ? 0 : (start.getHours() * 60 + start.getMinutes()) / (24 * 60);
                        const barY = startFrac * chartH;
                        const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
                        const barX = colX + BAR_PADDING;
                        const showTip = () => {
                          let barH = 6;
                          if (log.ended_at) {
                            const end = new Date(log.ended_at);
                            const endsToday = dayKey(end) === day;
                            const endFrac = endsToday ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60) : 1.0;
                            barH = Math.max((endFrac - startFrac) * chartH, 3);
                          }
                          const overlapping = entries.filter(other => timeOverlap(log, other, day));
                          setTooltip({ logs: overlapping.length > 0 ? overlapping : [log], barX, barY, barH });
                        };
                        const tipProps = Platform.OS === 'web'
                          ? { onMouseEnter: showTip, onMouseLeave: () => setTooltip(null) }
                          : { onPressIn: showTip, onPressOut: () => setTooltip(null) };
                        if (log.ended_at) {
                          const end = new Date(log.ended_at);
                          const endsToday = dayKey(end) === day;
                          const endFrac = endsToday ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60) : 1.0;
                          const barH = Math.max((endFrac - startFrac) * chartH, 3);
                          return (
                            <G key={log.id + (isContinuation ? '-cont' : '')}>
                              <Rect x={barX} y={barY} width={barW} height={barH} fill={color} rx={2} opacity={0.85} // @ts-ignore
                                {...tipProps} />
                            </G>
                          );
                        }
                        const isTimeless = log.extra_data?.untimed === true || log.extra_data?.zero === true;
                        const r = Math.max(3, Math.min(5, barW / 2));
                        return (
                          <G key={log.id}>
                            <Circle cx={barX + barW / 2} cy={isTimeless ? chartH / 2 : barY} r={r} fill={isTimeless ? 'none' : color} stroke={isTimeless ? color : 'none'} strokeWidth={isTimeless ? 1.5 : 0} opacity={log.extra_data?.untimed ? 0.4 : 0.85} // @ts-ignore
                              {...tipProps} />
                          </G>
                        );
                      })}
                    </G>
                  );
                })}
                <Line x1={totalChartW} y1={0} x2={totalChartW} y2={chartH} stroke="#d1d5db" strokeWidth={1} />
                <Line x1={0} y1={chartH} x2={totalChartW} y2={chartH} stroke="#d1d5db" strokeWidth={1} />

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
                    const lines = [timeStr, dur, qty, noteSnippet].filter(Boolean) as string[];
                    return { tlog, lines };
                  });
                  const ENTRY_H = (e: { lines: string[] }) => 15 + e.lines.length * 13;
                  const tipH = entryData.reduce((sum, e, i) => sum + ENTRY_H(e) + (i > 0 ? 6 : 0), 0) + 12;
                  const tx = Math.max(0, Math.min(tooltip.barX, totalChartW - TOOLTIP_W));
                  const spaceAbove = tooltip.barY >= tipH + TOOLTIP_PAD;
                  const ty = spaceAbove ? tooltip.barY - tipH - TOOLTIP_PAD : tooltip.barY + tooltip.barH + TOOLTIP_PAD;
                  let curY = ty + 10;
                  return (
                    <G key="tooltip">
                      <Rect x={tx} y={ty} width={TOOLTIP_W} height={tipH} fill="white" stroke="#d1d5db" strokeWidth={1} rx={6} />
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
                              <SvgText key={i} x={tx + 10} y={entryY + 23 + i * 13} fontSize={9} fill="#6b7280">{line}</SvgText>
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
              <View style={{ position: 'absolute', top: Math.max(0, crosshairY - 10), left: 2, backgroundColor: '#6366f1', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 }}>
                <Text style={{ fontSize: 9, color: '#fff', fontWeight: '600' }}>
                  {(() => {
                    const totalMins = Math.round((crosshairY / chartH) * 24 * 60);
                    const h = Math.min(23, Math.floor(totalMins / 60));
                    const m = totalMins % 60;
                    const dh = h % 12 === 0 ? 12 : h % 12;
                    return `${dh}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
                  })()}
                </Text>
              </View>
            </View>
          )}

          {tooltip && Platform.OS === 'web' && (() => {
            const tx = Math.max(0, Math.min(tooltip.barX, totalChartW - TOOLTIP_W));
            const rawLeft = tx - scrollXSnap + TIME_LABEL_W;
            const overlayLeft = Math.max(0, Math.min(rawLeft, TIME_LABEL_W + viewportW - TOOLTIP_W));
            const spaceAbove = tooltip.barY >= 120 + TOOLTIP_PAD;
            const overlayTop = spaceAbove ? tooltip.barY - 120 - TOOLTIP_PAD : tooltip.barY + tooltip.barH + TOOLTIP_PAD;
            return (
              <View style={[s.tipOverlay, { left: overlayLeft, top: overlayTop }]}
                // @ts-ignore
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
                  const lines = [timeStr, dur, qty, noteSnippet].filter(Boolean) as string[];
                  const color = colorMap.get(tlog.activity_type)?.[0] ?? '#6366f1';
                  return (
                    <View key={tlog.id}>
                      {ei > 0 && <View style={s.tipDivider} />}
                      <Text style={[s.tipType, { color }]}>{tlog.activity_type}</Text>
                      {lines.map((line, i) => <Text key={i} style={s.tipLine}>{line}</Text>)}
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
    const totalPages = 1 + charts.length;
    const modalContent = modalPage === 0 ? chartBody : (
      <View style={s.chartPage}>
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
        <View style={s.card}>
          {header}
          <View style={{ height: CHART_H, backgroundColor: '#f3f4f6', borderRadius: 6, margin: 8 }} />
        </View>
        <Modal visible transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setExpanded(false)}>
            <TouchableOpacity activeOpacity={1} style={s.modalPanel}>
              {modalContent}
              {totalPages > 1 && (
                <View style={s.modalNav}>
                  <TouchableOpacity onPress={() => setModalPage(p => Math.max(0, p - 1))} disabled={modalPage === 0}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="chevron-back" size={22} color={modalPage === 0 ? 'rgba(255,255,255,0.3)' : '#fff'} />
                  </TouchableOpacity>
                  <View style={s.modalDots}>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <TouchableOpacity key={i} onPress={() => setModalPage(i)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                        <View style={[s.modalDot, modalPage === i && s.modalDotActive]} />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity onPress={() => setModalPage(p => Math.min(totalPages - 1, p + 1))} disabled={modalPage === totalPages - 1}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="chevron-forward" size={22} color={modalPage === totalPages - 1 ? 'rgba(255,255,255,0.3)' : '#fff'} />
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </>
    );
  }

  return chartBody;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#e5e7eb',
    overflow: 'hidden', position: 'relative',
  },
  cardExpanded: { marginBottom: 0 },
  chartHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  chartTitle: { fontSize: 13, fontWeight: '600', color: '#374151' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  zoomBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  zoomBtnText: { fontSize: 16, fontWeight: '600', color: '#374151', lineHeight: 20 },
  zoomBtnToday: { width: 'auto' as any, paddingHorizontal: 8, borderRadius: 13, backgroundColor: '#6366f1' },
  zoomBtnTodayText: { fontSize: 11, fontWeight: '700', color: '#fff', lineHeight: 20 },
  zoomBtnIcon: { borderWidth: 1, borderColor: '#6366f1', backgroundColor: 'transparent' },
  zoomBtnOn: { backgroundColor: '#6366f1' },
  flippedDateLabel: { width: TIME_LABEL_W, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 4 },
  flippedDateText: { fontSize: 8, color: '#9ca3af' },
  tipOverlay: {
    position: 'absolute', width: TOOLTIP_W,
    backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db',
    paddingHorizontal: 10, paddingVertical: 7, zIndex: 20,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  tipDivider: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 6 },
  tipType: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  tipLine: { fontSize: 10, color: '#6b7280', lineHeight: 13 },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 24,
  },
  modalPanel: { width: '100%' },
  modalNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, paddingVertical: 10,
  },
  modalDots: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    flexWrap: 'wrap', gap: 6, flex: 1, marginHorizontal: 8,
  },
  modalDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(255,255,255,0.45)' },
  modalDotActive: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#fff' },
  chartPage: {
    backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
});
