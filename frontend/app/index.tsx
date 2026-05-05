import { useState, useCallback, useRef, useEffect } from 'react';
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
import { Svg, Rect, Text as SvgText, Line, G, Circle } from 'react-native-svg';
import { LineChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { getLogs, deleteLog, updateLog, ActivityLog } from '@/lib/api';

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

// ── Edit modal helpers (module-level so React reuses the same DOM nodes) ───

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

type PickerState = { target: 'start' | 'end'; mode: 'date' | 'time' } | null;

// Must be at module level — if defined inside EditLogModal, React remounts the
// <input> on every render, closing the browser's native date picker immediately.
function EditDateInput({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  if (Platform.OS !== 'web') return null;
  return (
    // @ts-ignore — plain HTML input is valid on web
    <input
      type="datetime-local"
      value={toLocalInputValue(value)}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(new Date(e.target.value))}
      style={{
        fontSize: 15, padding: 12, borderRadius: 8,
        border: '1px solid #d1d5db', backgroundColor: '#fff',
        color: '#111827', width: '100%', boxSizing: 'border-box',
      }}
    />
  );
}

function EditLogModal({
  log,
  onClose,
  onSave,
}: {
  log: ActivityLog | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [activityType, setActivityType] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<PickerState>(null);

  useEffect(() => {
    if (!log) return;
    setActivityType(log.activity_type);
    setStartDate(new Date(log.started_at));
    setEndDate(log.ended_at ? new Date(log.ended_at) : null);
    setNotes(log.notes ?? '');
  }, [log?.id]);

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (!picker || !selected) { setPicker(null); return; }
    if (event.type === 'dismissed') { setPicker(null); return; }
    if (picker.target === 'start') setStartDate(selected);
    else setEndDate(selected);
    if (Platform.OS === 'android' && picker.mode === 'date') {
      setPicker({ target: picker.target, mode: 'time' });
    } else {
      setPicker(null);
    }
  };

  const handleSave = async () => {
    if (!log) return;
    setSaving(true);
    try {
      await updateLog(log.id, {
        activity_type: activityType,
        started_at: startDate.toISOString(),
        ended_at: endDate ? endDate.toISOString() : null,
        notes: notes.trim() || null,
      });
      onSave();
    } catch {
      Alert.alert('Error', 'Could not save changes. Is the backend running?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!log} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={editStyles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={editStyles.sheet}>
          {/* Header */}
          <View style={editStyles.header}>
            <Text style={editStyles.title}>Edit Entry</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#374151" />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={editStyles.label}>Activity Type</Text>
            <TextInput
              style={editStyles.input}
              value={activityType}
              onChangeText={setActivityType}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={editStyles.label}>Start Time</Text>
            {Platform.OS === 'web' ? (
              <EditDateInput value={startDate} onChange={setStartDate} />
            ) : (
              <TouchableOpacity
                style={editStyles.dateBtn}
                onPress={() => setPicker({ target: 'start', mode: 'date' })}
              >
                <Text style={editStyles.dateBtnText}>{formatDateTime(startDate)}</Text>
              </TouchableOpacity>
            )}

            <Text style={editStyles.label}>End Time</Text>
            {endDate !== null ? (
              <View style={editStyles.endRow}>
                {Platform.OS === 'web' ? (
                  <View style={{ flex: 1 }}>
                    <EditDateInput value={endDate} onChange={setEndDate} />
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[editStyles.dateBtn, { flex: 1 }]}
                    onPress={() => setPicker({ target: 'end', mode: 'date' })}
                  >
                    <Text style={editStyles.dateBtnText}>{formatDateTime(endDate)}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setEndDate(null)}
                  style={editStyles.removeEndBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={20} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEndDate(new Date())}>
                <Text style={editStyles.addEndText}>+ Add end time</Text>
              </TouchableOpacity>
            )}

            <Text style={editStyles.label}>Notes</Text>
            <TextInput
              style={[editStyles.input, editStyles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Optional notes..."
              placeholderTextColor="#9ca3af"
            />
          </ScrollView>

          <TouchableOpacity style={editStyles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={editStyles.saveBtnText}>Save Changes</Text>}
          </TouchableOpacity>

          {picker && Platform.OS !== 'web' && (
            <DateTimePicker
              value={picker.target === 'start' ? startDate : (endDate ?? new Date())}
              mode={picker.mode}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={onPickerChange}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Timeline chart ─────────────────────────────────────────────────────────

const TIME_LABEL_W = 38;
const DATE_LABEL_H = 30;
const CHART_H = 216;
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
  log: ActivityLog;
  barX: number;
  barY: number;
  barH: number;
}

const TOOLTIP_W = 152;
const TOOLTIP_PAD = 8;
const FLIPPED_ROW_H = 24; // height of each date row in flipped mode

function TimelineChart({
  logs,
  colorMap,
  visibleTypes,
  onEdit,
}: {
  logs: ActivityLog[];
  colorMap: Map<string, string[]>;
  visibleTypes: Set<string>;
  onEdit: (log: ActivityLog) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [isPinching, setIsPinching] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const isFlippedRef = useRef(false);
  useEffect(() => { isFlippedRef.current = isFlipped; }, [isFlipped]);
  // Width of the time-of-day axis in flipped mode (measured on layout)
  const [flippedW, setFlippedW] = useState(SCREEN_W - 94);
  const scrollYRef = useRef(0);

  // colWidth = zoom level (wider = more detail, fewer days on screen)
  const [colWidth, setColWidth] = useState(DEFAULT_COL_W);
  const colWidthRef = useRef(DEFAULT_COL_W);
  useEffect(() => { colWidthRef.current = colWidth; }, [colWidth]);

  // numDays = how far back history is loaded (grows as user scrolls left)
  const [numDays, setNumDays] = useState(DEFAULT_HISTORY);
  const numDaysRef = useRef(DEFAULT_HISTORY);
  useEffect(() => { numDaysRef.current = numDays; }, [numDays]);

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
      scrollRef.current?.scrollTo({ x: scrollXRef.current + comp, animated: false });
      isExtending.current = false;
    }
  }, [numDays]);

  // Reset scroll and tooltip when switching between normal / flipped view
  useEffect(() => {
    setTooltip(null);
    scrollXRef.current = 0;
    scrollYRef.current = 0;
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
  }, [isFlipped]);

  const handleScroll = (e: any) => {
    scrollXRef.current = e.nativeEvent.contentOffset.x;
    const threshold = colWidthRef.current * 14;
    if (scrollXRef.current < threshold && !isExtending.current) {
      isExtending.current = true;
      pendingCompensation.current = EXTEND_BY * colWidthRef.current;
      setNumDays(prev => prev + EXTEND_BY);
    }
  };

  // Web: ctrl+wheel (trackpad pinch) adjusts column width
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1; // pinch = narrower cols, spread = wider
      setColWidth(prev => Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(prev * factor))));
    };
    document.addEventListener('wheel', handler, { passive: false });
    return () => document.removeEventListener('wheel', handler);
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

  const svgH = CHART_H + DATE_LABEL_H;
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

  // Sparse date labels so text doesn't overlap at small column widths
  const labelEvery = colWidth < 10 ? 14 : colWidth < 20 ? 7 : 1;

  return (
    <View style={styles.chartCard}>
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
                onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}>
                <Text style={[styles.zoomBtnText, styles.zoomBtnTodayText]}>Today</Text>
              </TouchableOpacity>
            </>
          )}
          {isFlipped && (
            <TouchableOpacity style={[styles.zoomBtn, styles.zoomBtnToday]}
              onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}>
              <Text style={[styles.zoomBtnText, styles.zoomBtnTodayText]}>Today</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.zoomBtn, styles.zoomBtnFlip, isFlipped && styles.zoomBtnFlipOn]}
            onPress={() => setIsFlipped(f => !f)}
          >
            <Ionicons name={isFlipped ? 'swap-horizontal' : 'swap-vertical'} size={13} color={isFlipped ? '#fff' : '#6366f1'} />
          </TouchableOpacity>
        </View>
      </View>

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
          <ScrollView ref={scrollRef} style={{ maxHeight: CHART_H }} showsVerticalScrollIndicator={false}>
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
                        const r = Math.min(3, (FLIPPED_ROW_H - BAR_PADDING * 2) / 2);
                        return (
                          <Circle key={log.id}
                            cx={barX} cy={FLIPPED_ROW_H / 2} r={r}
                            fill={color} opacity={0.85}
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
        <View
          style={{ flexDirection: 'row' }}
          {...(Platform.OS !== 'web' ? panResponder.panHandlers : {})}
        >
          {/* Pinned time-of-day axis */}
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

          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!isPinching}
            onScroll={handleScroll}
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
                      // This column may be rendering the entry's start day or its end day (continuation)
                      const isContinuation = logStartDay !== day;
                      const startFrac = isContinuation
                        ? 0
                        : (start.getHours() * 60 + start.getMinutes()) / (24 * 60);
                      const barY = startFrac * CHART_H;
                      const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
                      const barX = colX + BAR_PADDING;
                      const isHovered = tooltip?.log.id === log.id;

                      const showTip = () => {
                        if (log.ended_at) {
                          const end = new Date(log.ended_at);
                          const endsToday = dayKey(end) === day;
                          const endFrac = endsToday
                            ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60)
                            : 1.0;
                          const barH = Math.max((endFrac - startFrac) * CHART_H, 3);
                          setTooltip({ log, barX, barY, barH });
                        } else {
                          setTooltip({ log, barX, barY, barH: 6 });
                        }
                      };
                      const hideTip = () => setTooltip(null);
                      const toggleTip = () => isHovered ? hideTip() : showTip();
                      // Mouse events (web only) — passing these to native SVG elements causes freezes
                      const interactionProps = Platform.OS === 'web'
                        ? { onMouseEnter: showTip, onMouseLeave: hideTip, onClick: () => onEdit(log) }
                        : { onPressIn: showTip, onPressOut: hideTip, onPress: () => onEdit(log) };

                      if (log.ended_at) {
                        const end = new Date(log.ended_at);
                        // If this entry ends on a different day, clip bar to bottom of this column
                        const endsToday = dayKey(end) === day;
                        const endFrac = endsToday
                          ? (end.getHours() * 60 + end.getMinutes()) / (24 * 60)
                          : 1.0;
                        const barH = Math.max((endFrac - startFrac) * CHART_H, 3);
                        return (
                          <G key={log.id + (isContinuation ? '-cont' : '')}>
                            <Rect
                              x={barX} y={barY} width={barW} height={barH}
                              fill={color} rx={2} opacity={isHovered ? 1 : 0.85}
                              // @ts-ignore — onMouseEnter/Leave valid on web SVG
                              {...interactionProps}
                            />
                          </G>
                        );
                      } else {
                        const r = Math.min(3, barW / 2);
                        return (
                          <G key={log.id}>
                            <Circle
                              cx={barX + barW / 2} cy={barY} r={r}
                              fill={color} opacity={isHovered ? 1 : 0.85}
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

              <Line x1={totalChartW} y1={0} x2={totalChartW} y2={CHART_H} stroke="#d1d5db" strokeWidth={1} />
              <Line x1={0} y1={CHART_H} x2={totalChartW} y2={CHART_H} stroke="#d1d5db" strokeWidth={1} />

              {/* Tooltip — rendered last so it appears on top */}
              {tooltip && (() => {
                const timeStr = new Date(tooltip.log.started_at).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                });
                const dur = tooltip.log.duration_minutes
                  ? formatDuration(tooltip.log.duration_minutes) : null;
                const noteSnippet = tooltip.log.notes
                  ? (tooltip.log.notes.length > 22 ? tooltip.log.notes.slice(0, 22) + '…' : tooltip.log.notes)
                  : null;
                const lines = [timeStr, dur, noteSnippet].filter(Boolean) as string[];
                const tipH = 18 + lines.length * 13 + 8;
                const tx = Math.max(0, Math.min(tooltip.barX, totalChartW - TOOLTIP_W));
                const spaceAbove = tooltip.barY >= tipH + TOOLTIP_PAD;
                const ty = spaceAbove
                  ? tooltip.barY - tipH - TOOLTIP_PAD
                  : tooltip.barY + tooltip.barH + TOOLTIP_PAD;
                return (
                  <G key="tooltip">
                    <Rect x={tx} y={ty} width={TOOLTIP_W} height={tipH}
                      fill="white" stroke="#d1d5db" strokeWidth={1} rx={6} />
                    <SvgText x={tx + 10} y={ty + 14} fontSize={11} fontWeight="bold" fill="#111827">
                      {tooltip.log.activity_type.charAt(0).toUpperCase() + tooltip.log.activity_type.slice(1)}
                    </SvgText>
                    {lines.map((line, i) => (
                      <SvgText key={i} x={tx + 10} y={ty + 26 + i * 13} fontSize={9} fill="#6b7280">
                        {line}
                      </SvgText>
                    ))}
                  </G>
                );
              })()}
            </Svg>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ── Per-type chart ─────────────────────────────────────────────────────────

const AC_WINDOW_STEPS = [7, 14, 30, 60, 90];

function ActivityChart({
  type,
  logs,
  colorPair,
}: {
  type: string;
  logs: ActivityLog[];
  colorPair: string[];
}) {
  const [stepIdx, setStepIdx] = useState(1); // default: 14 days
  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number } | null>(null);

  // Aggregate duration by calendar date
  const byDate = new Map<string, number>();
  logs
    .filter((l) => l.activity_type === type && l.duration_minutes != null)
    .forEach((l) => {
      const key = dayKey(new Date(l.started_at));
      byDate.set(key, (byDate.get(key) ?? 0) + l.duration_minutes!);
    });

  // Sort ascending, then take the last N days
  const allDays = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const windowSize = AC_WINDOW_STEPS[stepIdx];
  const visible = allDays.slice(-windowSize);

  if (visible.length < 2) {
    return (
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>
          {type.charAt(0).toUpperCase() + type.slice(1)} — not enough data yet
        </Text>
        <Text style={styles.chartEmpty}>Log at least 2 days to see a chart.</Text>
      </View>
    );
  }

  // Thin out date labels so they don't overlap
  const labelEvery = visible.length <= 7 ? 1 : visible.length <= 14 ? 2 : Math.ceil(visible.length / 7);
  const labels = visible.map(([date], i) =>
    i % labelEvery === 0
      ? new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
      : ''
  );
  const data = visible.map(([, mins]) => toChartValue(type, mins));
  const unit = chartUnit(type);
  const mean = data.reduce((s, v) => s + v, 0) / data.length;
  const meanStr = `${mean % 1 === 0 ? mean.toFixed(0) : mean.toFixed(1)} ${unit}`;

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeader}>
        <View>
          <Text style={styles.chartTitle}>
            {type.charAt(0).toUpperCase() + type.slice(1)} — last {visible.length} days
          </Text>
          <Text style={styles.chartMean}>avg {meanStr}</Text>
        </View>
        <View style={styles.zoomRow}>
          <TouchableOpacity
            style={[styles.zoomBtn, stepIdx === 0 && styles.zoomBtnDisabled]}
            onPress={() => { setStepIdx((i) => Math.max(0, i - 1)); setTooltip(null); }}
            disabled={stepIdx === 0}
          >
            <Text style={styles.zoomBtnText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.zoomBtn, stepIdx === AC_WINDOW_STEPS.length - 1 && styles.zoomBtnDisabled]}
            onPress={() => { setStepIdx((i) => Math.min(AC_WINDOW_STEPS.length - 1, i + 1)); setTooltip(null); }}
            disabled={stepIdx === AC_WINDOW_STEPS.length - 1}
          >
            <Text style={styles.zoomBtnText}>−</Text>
          </TouchableOpacity>
        </View>
      </View>
      <LineChart
        data={{
          labels,
          datasets: [
            { data, strokeWidth: 2 },
            {
              // Mean reference line: transparent fill (low-opacity calls → transparent),
              // visible stroke (full-opacity calls → semi-transparent white)
              data: Array(visible.length).fill(parseFloat(mean.toFixed(2))),
              strokeWidth: 1,
              color: (opacity = 1) => opacity > 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0)',
              withDots: false,
            },
          ],
        }}
        width={SCREEN_W - 32}
        height={160}
        chartConfig={{
          backgroundGradientFrom: colorPair[0],
          backgroundGradientTo: colorPair[1],
          decimalPlaces: type === 'sleep' || type === 'work' ? 1 : 0,
          color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
          propsForDots: { r: '4', strokeWidth: '2', stroke: '#fff' },
        }}
        bezier
        style={{ borderRadius: 10 }}
        onDataPointClick={({ x, y, value }) => {
          // tap/click same point again to dismiss
          setTooltip((prev) => (prev && Math.abs(prev.x - x) < 2 ? null : { x, y, value }));
        }}
        decorator={() => {
          if (!tooltip) return null;
          const val = tooltip.value;
          const valStr = `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)} ${unit}`;
          // Keep tooltip inside chart bounds
          const TW = 72;
          const left = Math.max(4, Math.min(tooltip.x - TW / 2, SCREEN_W - 32 - TW - 4));
          return (
            <View
              style={{
                position: 'absolute',
                left,
                top: tooltip.y - 38,
                backgroundColor: '#1f2937',
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 5,
                width: TW,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{valStr}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

// ── Toggle chips ───────────────────────────────────────────────────────────

function TypeToggles({
  types,
  visible,
  colorMap,
  onToggle,
}: {
  types: string[];
  visible: Set<string>;
  colorMap: Map<string, string[]>;
  onToggle: (type: string) => void;
}) {
  if (types.length === 0) return null;
  return (
    <View style={styles.toggleSection}>
      <Text style={styles.sectionLabel}>Show / Hide</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {types.map((type) => {
          const active = visible.has(type);
          const color = colorMap.get(type)?.[0] ?? '#6366f1';
          return (
            <TouchableOpacity
              key={type}
              onPress={() => onToggle(type)}
              style={[
                styles.toggleChip,
                active ? { backgroundColor: color } : styles.toggleChipOff,
              ]}
            >
              <Text style={[styles.toggleChipText, !active && styles.toggleChipTextOff]}>
                {type}
              </Text>
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
          <Text style={styles.date}>{formatTimeRange(log.started_at, log.ended_at)}</Text>
          {log.notes ? (
            <Text style={styles.notes} numberOfLines={1}>{log.notes}</Text>
          ) : null}
        </View>
        <View style={styles.logRowRight}>
          <Text style={styles.duration}>{formatDuration(log.duration_minutes)}</Text>
          <TouchableOpacity onPress={confirmDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={15} color="#d1d5db" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

type SortField = 'start' | 'end';
type SortDir   = 'desc' | 'asc';

export default function DashboardScreen() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  const [editingLog, setEditingLog] = useState<ActivityLog | null>(null);
  const [logPage, setLogPage] = useState(0);
  const [logFilter, setLogFilter] = useState<string | null>(null);
  const [logSortField, setLogSortField] = useState<SortField>('start');
  const [logSortDir,   setLogSortDir]   = useState<SortDir>('desc');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await getLogs(undefined, 500);
      setLogs(data);
      setLogPage(0);
      // Show all types by default (preserve any manual toggles by only adding new ones)
      setVisibleTypes((prev) => {
        const next = new Set(prev);
        data.forEach((l) => next.add(l.activity_type));
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { fetchLogs(); }, []));

  // Derive unique types in the order they first appear (API returns desc, so reverse for order)
  const uniqueTypes: string[] = [];
  const seen = new Set<string>();
  [...logs].reverse().forEach((l) => {
    if (!seen.has(l.activity_type)) {
      seen.add(l.activity_type);
      uniqueTypes.push(l.activity_type);
    }
  });

  // Assign a stable color to each type
  const colorMap = new Map<string, string[]>();
  uniqueTypes.forEach((t, i) => colorMap.set(t, TYPE_COLORS[i % TYPE_COLORS.length]));

  const toggleType = (type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (loading) return <ActivityIndicator style={styles.centered} size="large" color="#6366f1" />;

  const charts = uniqueTypes.filter((t) => visibleTypes.has(t));

  // Filter + sort the log list independently of the charts
  const filteredLogs = logs
    .filter((l) => logFilter === null || l.activity_type === logFilter)
    .sort((a, b) => {
      if (logSortField === 'start') {
        const diff = new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
        return logSortDir === 'desc' ? -diff : diff;
      }
      // sort by end — entries without an end time sink to the bottom
      if (!a.ended_at && !b.ended_at) return 0;
      if (!a.ended_at) return 1;
      if (!b.ended_at) return -1;
      const diff = new Date(a.ended_at).getTime() - new Date(b.ended_at).getTime();
      return logSortDir === 'desc' ? -diff : diff;
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
            <Text style={styles.heading}>Dashboard</Text>

            <TypeToggles
              types={uniqueTypes}
              visible={visibleTypes}
              colorMap={colorMap}
              onToggle={toggleType}
            />

            <TimelineChart
              logs={logs}
              colorMap={colorMap}
              visibleTypes={visibleTypes}
              onEdit={setEditingLog}
            />

            {charts.map((type) => (
              <ActivityChart
                key={type}
                type={type}
                logs={logs}
                colorPair={colorMap.get(type) ?? TYPE_COLORS[0]}
              />
            ))}

            {logs.length === 0 && (
              <Text style={styles.empty}>No entries yet. Tap "Log Activity" to get started.</Text>
            )}

            {logs.length > 0 && (
              <>
                <View style={styles.logPanelHeader}>
                  <Text style={styles.sectionLabel}>Activity Log</Text>
                  <View style={styles.sortRow}>
                    <Text style={styles.sortLabel}>Sort by:</Text>
                    {(['start', 'end'] as SortField[]).map((field) => {
                      const active = logSortField === field;
                      const arrow = active ? (logSortDir === 'desc' ? ' ↓' : ' ↑') : '';
                      return (
                        <TouchableOpacity
                          key={field}
                          style={[styles.sortBtn, active && styles.sortBtnActive]}
                          onPress={() => {
                            if (active) {
                              setLogSortDir((d) => d === 'desc' ? 'asc' : 'desc');
                            } else {
                              setLogSortField(field);
                              setLogSortDir('desc');
                            }
                            setLogPage(0);
                          }}
                        >
                          <Text style={[styles.sortBtnText, active && styles.sortBtnTextActive]}>
                            {field === 'start' ? 'Start' : 'End'}{arrow}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Filter chips */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                  <TouchableOpacity
                    style={[styles.filterChip, logFilter === null && styles.filterChipOn]}
                    onPress={() => { setLogFilter(null); setLogPage(0); }}
                  >
                    <Text style={[styles.filterChipText, logFilter === null && styles.filterChipTextOn]}>All</Text>
                  </TouchableOpacity>
                  {uniqueTypes.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.filterChip, logFilter === type && styles.filterChipOn]}
                      onPress={() => { setLogFilter(logFilter === type ? null : type); setLogPage(0); }}
                    >
                      <Text style={[styles.filterChipText, logFilter === type && styles.filterChipTextOn]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Pagination */}
                {filteredLogs.length > PAGE_SIZE && (
                  <View style={[styles.logPanelHeader, { marginTop: 8 }]}>
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

                <View style={styles.logPanel}>
                  {pagedLogs.map((item, index) => (
                    <LogItem
                      key={item.id}
                      log={item}
                      isLast={index === pagedLogs.length - 1}
                      onDelete={() => fetchLogs()}
                      onEdit={setEditingLog}
                    />
                  ))}
                </View>
              </>
            )}
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
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 12, color: '#111827' },
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
  toggleChipText: { color: '#fff', fontWeight: '600', fontSize: 13, textTransform: 'capitalize' },
  toggleChipTextOff: { color: '#6b7280' },

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
  logPanelHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8, marginTop: 4,
  },
  logPanel: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
    marginBottom: 16,
  },
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
  activityType: { fontSize: 14, fontWeight: '600', color: '#6366f1', textTransform: 'capitalize' },
  duration: { fontSize: 13, color: '#374151', fontWeight: '500' },
  date: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  notes: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  // Log filter + sort
  filterScroll: { marginBottom: 10 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
    backgroundColor: '#f3f4f6', marginRight: 6,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  filterChipOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  filterChipText: { fontSize: 12, color: '#6b7280', fontWeight: '500', textTransform: 'capitalize' },
  filterChipTextOn: { color: '#fff', fontWeight: '700' },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortLabel: { fontSize: 12, color: '#9ca3af', fontWeight: '500' },
  sortBtn: {
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12,
    backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb',
  },
  sortBtnActive: { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' },
  sortBtnText: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  sortBtnTextActive: { color: '#6366f1' },

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

const editStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36, maxHeight: '85%',
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1,
    borderColor: '#d1d5db', padding: 12, fontSize: 15, color: '#111827',
  },
  notesInput: { height: 80, textAlignVertical: 'top' },
  dateBtn: {
    backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1,
    borderColor: '#d1d5db', padding: 12,
  },
  dateBtnText: { fontSize: 15, color: '#111827' },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeEndBtn: { paddingLeft: 4 },
  addEndText: { fontSize: 14, color: '#6366f1', fontWeight: '600', paddingVertical: 10 },
  saveBtn: {
    backgroundColor: '#6366f1', padding: 16, borderRadius: 10,
    alignItems: 'center', marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
