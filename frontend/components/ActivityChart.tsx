import { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { Svg, Rect, Text as SvgText, Line, G, Path, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { ActivityLog } from '@/lib/api';
import { dayKey, SCREEN_W } from '@/lib/chartUtils';

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
  const [tooltip, setTooltip] = useState<{ idx: number } | null>(null);
  const hideDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTipDelayed = () => { hideDelayRef.current = setTimeout(() => setTooltip(null), 200); };
  const cancelHide = () => { if (hideDelayRef.current) { clearTimeout(hideDelayRef.current); hideDelayRef.current = null; } };
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX, setScrollX] = useState(colWidth * numDays);
  const [viewportW, setViewportW] = useState(SCREEN_W - 68);
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
        if (hasQuantity) return typeof l.extra_data?.quantity === 'number' && l.extra_data.quantity !== 0;
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

  const zeroDays = new Set<string>();
  if (!useCountMode) {
    logs
      .filter((l) => {
        if (l.activity_type !== type) return false;
        if (hasDuration) return l.extra_data?.zero === true || l.extra_data?.untimed === true;
        if (hasQuantity) return l.extra_data?.quantity === 0;
        return false;
      })
      .forEach((l) => zeroDays.add(dayKey(new Date(l.started_at))));
  }

  if (byDate.size === 0 && misalignedDays.size === 0 && zeroDays.size === 0) {
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

  const today = new Date();
  const days: Array<{ key: string; value: number | null }> = [];
  if (fromDate && toDate) {
    const from = new Date(fromDate + 'T12:00:00');
    const to = new Date(toDate + 'T12:00:00');
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = dayKey(new Date(d));
      days.push({ key, value: byDate.get(key) ?? null });
    }
  } else {
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dayKey(d);
      days.push({ key, value: byDate.get(key) ?? null });
    }
  }

  const dataPoints = days.filter((d) => d.value !== null);
  const hasRangeData = (!useCountMode && (hasDuration || hasQuantity)) ? dataPoints.length >= 2 : dataPoints.length >= 1;

  const derivedQuantityUnit = (() => {
    if (!hasQuantity) return '';
    const unitCounts = new Map<string, number>();
    logs
      .filter((l) => l.activity_type === type && typeof l.extra_data?.quantity === 'number')
      .forEach((l) => {
        const u = String(l.extra_data?.unit ?? '');
        unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1);
      });
    let best = '', bestCount = 0;
    unitCounts.forEach((c, u) => { if (c > bestCount) { bestCount = c; best = u; } });
    return best;
  })();

  const useHours = hasDuration && !useCountMode && byDate.size > 0
    && ([...byDate.values()].reduce((s, v) => s + v, 0) / byDate.size > 60);
  const unit = useCountMode ? 'entries' : hasDuration ? (useHours ? 'hrs' : 'min') : hasQuantity ? (derivedQuantityUnit || 'qty') : 'times';
  const dv = (rawVal: number) => {
    if (hasDuration && !useCountMode) return useHours ? parseFloat((rawVal / 60).toFixed(1)) : Math.round(rawVal);
    return rawVal;
  };

  const maxScrollX = Math.max(0, colWidth * numDays - viewportW);
  const clampedX = Math.min(scrollX, maxScrollX);
  const visStartIdx = Math.max(0, Math.floor(clampedX / colWidth));
  const visEndIdx = Math.min(numDays - 1, Math.ceil((clampedX + viewportW) / colWidth));
  const windowDays = days.slice(visStartIdx, visEndIdx + 1);
  const windowDataPoints = windowDays.filter(d => d.value !== null);
  const windowZeroCount = (!useCountMode && hasQuantity)
    ? windowDays.filter(d => d.value === null && zeroDays.has(d.key)).length
    : 0;
  const chartVals = windowDataPoints.map(d => dv(d.value!));
  const totalDaysForMean = chartVals.length + windowZeroCount;
  const mean = totalDaysForMean > 0 ? chartVals.reduce((s, v) => s + v, 0) / totalDaysForMean : null;
  const meanStr = mean !== null ? `${mean % 1 === 0 ? mean.toFixed(0) : mean.toFixed(1)} ${unit} / day` : '';

  const avgEntryVal = (() => {
    if (useCountMode) return null;
    if (hasDuration) {
      const validLogs = logs.filter(l =>
        l.activity_type === type &&
        l.duration_minutes != null &&
        l.extra_data?.zero !== true &&
        l.extra_data?.untimed !== true
      );
      if (validLogs.length === 0) return null;
      return dv(validLogs.reduce((s, l) => s + l.duration_minutes!, 0) / validLogs.length);
    }
    if (hasQuantity) {
      const validLogs = logs.filter(l =>
        l.activity_type === type &&
        typeof l.extra_data?.quantity === 'number'
      );
      if (validLogs.length === 0) return null;
      return validLogs.reduce((s, l) => s + (l.extra_data!.quantity as number), 0) / validLogs.length;
    }
    return null;
  })();
  const avgEntryStr = avgEntryVal !== null
    ? `${avgEntryVal % 1 === 0 ? avgEntryVal.toFixed(0) : avgEntryVal.toFixed(1)} ${unit} / entry`
    : '';

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
  const TIP_H = 22;
  const dotY = tooltip !== null && tipVal !== null ? yOf(tipVal) : 0;
  const tipAbove = dotY - TIP_H - 4 >= 0;
  const tipX = tooltip !== null
    ? Math.max(2, Math.min(xOf(tooltip.idx) - TIP_W / 2, totalChartW - TIP_W - 2))
    : 0;
  const tipY = tooltip !== null
    ? (tipAbove ? dotY - TIP_H - 4 : Math.min(dotY + dotR + 4, SVG_H - TIP_H))
    : 0;

  return (
    <View style={styles.chartPanelItem}>
      <View style={styles.chartHeader}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onToggleCollapsed} activeOpacity={0.7}>
          <Text style={styles.chartTitle}>{type}</Text>
          {!collapsed && (meanStr !== '' || avgEntryStr !== '') && (
            <Text style={styles.chartMean}>
              {[meanStr !== '' ? `avg ${meanStr}` : null, avgEntryStr || null].filter(Boolean).join(', ')}
            </Text>
          )}
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
                countBtnHovered && styles.countModeBtnExpanded,
                useCountMode && styles.countModeBtnOn,
              ]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.75}
            >
              <Text style={[styles.countModeBtnIcon, useCountMode && styles.countModeBtnIconOn]}>123</Text>
              {countBtnHovered && (
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
        <Svg width={YW} height={SVG_H}>
          <Rect x={0} y={0} width={YW} height={SVG_H} fill={colorPair[0]} />
          {yTickVals.map((v, i) => (
            <SvgText key={i} x={YW - 4} y={yOf(v) + 4} fontSize={9} fill="rgba(255,255,255,0.75)" textAnchor="end">
              {formatY(v)}
            </SvgText>
          ))}
        </Svg>
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
                ? { onMouseEnter: () => { cancelHide(); setTooltip({ idx: i }); }, onMouseLeave: hideTipDelayed }
                : { onPressIn: () => setTooltip({ idx: i }), onPressOut: () => setTooltip(null) };
              return (
                <Circle key={i} cx={xOf(i)} cy={yOf(v)} r={selected ? dotR + 1 : dotR}
                  fill={selected ? '#fff' : 'rgba(255,255,255,0.85)'}
                  stroke="#fff" strokeWidth={selected ? 2 : 1.5}
                  // @ts-ignore
                  {...dotProps}
                />
              );
            })}
            {(useCountMode || (!hasDuration && !hasQuantity)) && days.map((d, i) => {
              if (d.value === null) return null;
              const v = dv(d.value);
              const cx = xOf(i);
              const cy = yOf(v);
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
                    {...dotProps}
                  />
                </G>
              );
            })}
            {[...misalignedDays].map((key) => {
              const idx = days.findIndex(d => d.key === key);
              if (idx < 0) return null;
              return (
                <Circle key={`mis-${key}`} cx={xOf(idx)} cy={baseY - dotR} r={dotR}
                  fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5}
                />
              );
            })}
            {[...zeroDays].map((key) => {
              const idx = days.findIndex(d => d.key === key);
              if (idx < 0) return null;
              if (days[idx].value !== null && days[idx].value! > 0) return null;
              return (
                <Circle key={`zero-${key}`} cx={xOf(idx)} cy={baseY - dotR} r={dotR}
                  fill="rgba(255,255,255,0.85)" stroke="#fff" strokeWidth={1.5}
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
                <Rect x={tipX} y={tipY} width={TIP_W} height={TIP_H} rx={5} fill="#1f2937" />
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

const styles = StyleSheet.create({
  chartPanelItem: { padding: 12, overflow: 'hidden' },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  chartTitle: { fontSize: 13, fontWeight: '600', color: '#374151' },
  chartMean: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  countModeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 10, backgroundColor: '#f3f4f6' },
  countModeBtnExpanded: { paddingHorizontal: 8, backgroundColor: '#e5e7eb' },
  countModeBtnOn: { backgroundColor: '#6366f1' },
  countModeBtnIcon: { fontSize: 11, fontWeight: '700', color: '#6b7280', letterSpacing: -0.5 },
  countModeBtnIconOn: { color: '#fff' },
  countModeBtnText: { fontSize: 10, fontWeight: '600', color: '#6b7280' },
  countModeBtnTextOn: { color: '#fff' },
  chartEmpty: { fontSize: 13, color: '#9ca3af', paddingBottom: 4 },
});
