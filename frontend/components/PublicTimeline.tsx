import { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { Svg, Rect, Text as SvgText, Line, G, Circle } from 'react-native-svg';
import { ActivityLog } from '@/lib/api';
import {
  dayKey, formatTimeRange, formatDuration, timeOverlap,
  TIME_LABEL_W, DATE_LABEL_H, CHART_H, HOUR_TICKS, BAR_PADDING,
  TOOLTIP_W, TOOLTIP_PAD,
} from '@/lib/chartUtils';

const FLIPPED_ROW_H = 24;

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
  colWidth,
  numDays,
  onScrollX,
  registerScroll,
}: {
  logs: ActivityLog[];
  colorMap: Map<string, string[]>;
  visibleTypes: Set<string>;
  colWidth: number;
  numDays: number;
  onScrollX: (x: number) => void;
  registerScroll: (ref: ScrollView | null) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [scrollXSnap, setScrollXSnap] = useState(Number.MAX_SAFE_INTEGER);
  const [viewportW, setViewportW] = useState(300);
  const hideDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  const hideTipDelayed = () => {
    if (hideDelayRef.current) clearTimeout(hideDelayRef.current);
    hideDelayRef.current = setTimeout(() => setTooltip(null), 800);
  };
  const cancelHide = () => {
    if (hideDelayRef.current) clearTimeout(hideDelayRef.current);
  };

  const svgH = CHART_H + DATE_LABEL_H;
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
  days.forEach((d) => byDay.set(d, []));
  logs.forEach((l) => {
    const startKey = dayKey(new Date(l.started_at));
    if (byDay.has(startKey)) byDay.get(startKey)!.push(l);
    if (l.ended_at) {
      const endKey = dayKey(new Date(l.ended_at));
      if (endKey !== startKey && byDay.has(endKey)) byDay.get(endKey)!.push(l);
    }
  });

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row' }}>
        {/* Pinned time axis */}
        <Svg width={TIME_LABEL_W} height={svgH}>
          {HOUR_TICKS.map((h) => {
            const y = (h / 24) * CHART_H;
            const label = h === 0 ? '12am' : h === 12 ? '12pm' : h === 24 ? '' : `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
            return (
              <SvgText key={h} x={TIME_LABEL_W - 4} y={y + 4} fontSize={9} fill="#9ca3af" textAnchor="end">
                {label}
              </SvgText>
            );
          })}
        </Svg>

        {/* Scrollable chart body */}
        <ScrollView
          ref={(ref) => { (scrollRef as any).current = ref; registerScroll(ref); }}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
          onScroll={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            setScrollXSnap(x);
            onScrollX(x);
          }}
          scrollEventThrottle={100}
          style={{ flex: 1 }}
        >
          <Svg width={totalChartW} height={svgH}>
            {days.map((day, colIdx) => (
              <Rect key={day + '-bg'} x={colIdx * colWidth} y={0} width={colWidth} height={CHART_H}
                fill={colIdx % 2 === 0 ? '#f9fafb' : '#f3f4f6'} />
            ))}

            {HOUR_TICKS.map((h) => {
              const y = (h / 24) * CHART_H;
              return (
                <Line key={h} x1={0} y1={y} x2={totalChartW} y2={y}
                  stroke="#d1d5db" strokeWidth={h === 0 ? 1 : 0.5}
                  strokeDasharray={h === 0 ? undefined : '3,3'} />
              );
            })}

            {days.map((day, colIdx) => {
              const colX = colIdx * colWidth;
              const entries = (byDay.get(day) ?? []).filter(l => visibleTypes.has(l.activity_type));
              const d = new Date(day + 'T12:00:00');
              const showLabel = colIdx % labelEvery === 0;
              const barW = Math.max(1, colWidth - BAR_PADDING * 2);

              return (
                <G key={day}>
                  {showLabel && (
                    <>
                      <SvgText x={colX + colWidth / 2} y={CHART_H + 12} fontSize={9} fill="#6b7280" textAnchor="middle">
                        {d.toLocaleDateString(undefined, { weekday: 'short' })}
                      </SvgText>
                      <SvgText x={colX + colWidth / 2} y={CHART_H + 23} fontSize={8} fill="#9ca3af" textAnchor="middle">
                        {d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                      </SvgText>
                    </>
                  )}
                  {entries.map((log) => {
                    const start = new Date(log.started_at);
                    const logStartDay = dayKey(start);
                    const isContinuation = logStartDay !== day;
                    const startFrac = isContinuation ? 0 : (start.getHours() * 60 + start.getMinutes()) / (24 * 60);
                    const barY = startFrac * CHART_H;
                    const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
                    const barX = colX + BAR_PADDING;

                    const showTip = () => {
                      let barH = 6;
                      if (log.ended_at) {
                        const end = new Date(log.ended_at);
                        const endsToday = dayKey(end) === day;
                        const endFrac = endsToday ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60) : 1.0;
                        barH = Math.max((endFrac - startFrac) * CHART_H, 3);
                      }
                      const overlapping = entries.filter(other => timeOverlap(log, other, day));
                      setTooltip({ logs: overlapping.length > 0 ? overlapping : [log], barX, barY, barH });
                    };
                    const tipProps = Platform.OS === 'web'
                      ? { onMouseEnter: showTip, onMouseLeave: hideTipDelayed }
                      : { onPressIn: showTip, onPressOut: () => setTooltip(null) };

                    if (log.ended_at) {
                      const end = new Date(log.ended_at);
                      const endsToday = dayKey(end) === day;
                      const endFrac = endsToday ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60) : 1.0;
                      const barH = Math.max((endFrac - startFrac) * CHART_H, 3);
                      return (
                        <G key={log.id + (isContinuation ? '-cont' : '')}>
                          <Rect x={barX} y={barY} width={barW} height={barH}
                            fill={color} rx={2} opacity={0.85}
                            // @ts-ignore
                            {...tipProps}
                          />
                        </G>
                      );
                    } else {
                      const isTimeless = log.extra_data?.untimed === true || log.extra_data?.zero === true;
                      const r = Math.max(3, Math.min(5, barW / 2));
                      return (
                        <G key={log.id}>
                          <Circle
                            cx={barX + barW / 2}
                            cy={isTimeless ? CHART_H / 2 : barY}
                            r={r}
                            fill={isTimeless ? 'none' : color}
                            stroke={isTimeless ? color : 'none'}
                            strokeWidth={isTimeless ? 1.5 : 0}
                            opacity={log.extra_data?.untimed ? 0.4 : 0.85}
                            // @ts-ignore
                            {...tipProps}
                          />
                        </G>
                      );
                    }
                  })}
                </G>
              );
            })}

            <Line x1={totalChartW} y1={0} x2={totalChartW} y2={CHART_H} stroke="#d1d5db" strokeWidth={1} />
            <Line x1={0} y1={CHART_H} x2={totalChartW} y2={CHART_H} stroke="#d1d5db" strokeWidth={1} />
          </Svg>
        </ScrollView>
      </View>

      {/* Web tooltip overlay */}
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
            style={[styles.tipOverlay, { left: overlayLeft, top: overlayTop }]}
            // @ts-ignore
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
              const lines = [timeStr, dur, qty, noteSnippet].filter(Boolean) as string[];
              const color = colorMap.get(tlog.activity_type)?.[0] ?? '#6366f1';
              return (
                <View key={tlog.id}>
                  {ei > 0 && <View style={styles.tipDivider} />}
                  <Text style={[styles.tipType, { color }]}>{tlog.activity_type}</Text>
                  {lines.map((line, i) => (
                    <Text key={i} style={styles.tipLine}>{line}</Text>
                  ))}
                </View>
              );
            })}
          </View>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#e5e7eb',
    overflow: 'hidden', position: 'relative',
  },
  tipOverlay: {
    position: 'absolute',
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
  },
  tipDivider: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 6 },
  tipType: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  tipLine: { fontSize: 10, color: '#6b7280', lineHeight: 13 },
});
