import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator,
  StyleSheet, TouchableOpacity, Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  getPublicLogs, getPublicInfo, getPublicNotes,
  ActivityLog, NoteRecord,
} from '@/lib/api';
import { ActivityChart } from '@/components/ActivityChart';
import { PublicTimeline } from '@/components/PublicTimeline';
import {
  TYPE_COLORS, DEFAULT_COL_W, DEFAULT_HISTORY,
  dayKey, formatDuration, formatTimeRange, lightenHex,
} from '@/lib/chartUtils';

type Tab = 'feed' | 'charts' | 'timeline' | 'notes';

function valueLabel(log: ActivityLog): string | null {
  if (log.duration_minutes) return formatDuration(log.duration_minutes);
  const qty = log.extra_data?.quantity;
  if (qty != null && qty !== 0) {
    const unit = log.extra_data?.unit as string | undefined;
    return `${qty}${unit ? ' ' + unit : ''}`;
  }
  return null;
}

export default function PublicView() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [ownerName, setOwnerName] = useState('');
  const [includeNotes, setIncludeNotes] = useState(false);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  const [typeOrder, setTypeOrder] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('feed');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [colWidth, setColWidth] = useState(DEFAULT_COL_W);
  const [numDays, setNumDays] = useState(DEFAULT_HISTORY);
  const colWidthRef = useRef(DEFAULT_COL_W);
  const numDaysRef = useRef(DEFAULT_HISTORY);
  useEffect(() => { colWidthRef.current = colWidth; }, [colWidth]);
  useEffect(() => { numDaysRef.current = numDays; }, [numDays]);

  const scrollNodeRefs = useRef<Map<string, ScrollView | null>>(new Map());
  const isSyncingScroll = useRef(false);

  const syncScrollX = useCallback((x: number, sourceKey: string) => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (Platform.OS === 'web') {
      scrollNodeRefs.current.forEach((ref, key) => {
        if (key === sourceKey || !ref) return;
        (ref as unknown as HTMLElement).scrollLeft = x;
      });
    } else {
      scrollNodeRefs.current.forEach((ref, key) => {
        if (key === sourceKey || !ref) return;
        (ref as ScrollView).scrollTo({ x, animated: false });
      });
    }
    setTimeout(() => { isSyncingScroll.current = false; }, 50);
  }, []);

  useEffect(() => {
    if (!token) return;
    Promise.all([getPublicInfo(token), getPublicLogs(token)])
      .then(([info, data]) => {
        setOwnerName(info.name);
        setIncludeNotes(info.include_notes ?? false);
        setLogs(data);
        const seen = new Set<string>();
        const order: string[] = [];
        data.forEach((l) => {
          if (!seen.has(l.activity_type)) { seen.add(l.activity_type); order.push(l.activity_type); }
        });
        setTypeOrder(order);
        setVisibleTypes(new Set(order));
        if (info.include_notes) {
          return getPublicNotes(token);
        }
        return [];
      })
      .then((noteData) => setNotes(noteData as NoteRecord[]))
      .catch(() => setError('This link is invalid or has been revoked.'))
      .finally(() => setLoading(false));
  }, [token]);

  const colorMap = useMemo(() => {
    const m = new Map<string, string[]>();
    typeOrder.forEach((t, i) => {
      const pair = TYPE_COLORS[i % TYPE_COLORS.length];
      m.set(t, [pair[0], lightenHex(pair[0])]);
    });
    return m;
  }, [typeOrder]);

  const grouped = useMemo(() => {
    const filtered = logs.filter((l) => visibleTypes.has(l.activity_type));
    const byDay = new Map<string, ActivityLog[]>();
    filtered.forEach((l) => {
      const key = dayKey(new Date(l.started_at));
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(l);
    });
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 90);
  }, [logs, visibleTypes]);

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#6366f1" />
    </View>
  );

  if (error) return (
    <View style={styles.center}>
      <Text style={styles.errorText}>{error}</Text>
    </View>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'feed', label: 'Feed' },
    { key: 'charts', label: 'Charts' },
    { key: 'timeline', label: 'Timeline' },
    ...(includeNotes ? [{ key: 'notes' as Tab, label: 'Journal' }] : []),
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.heading}>{ownerName ? `${ownerName}'s Dashboard` : 'Dashboard'}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Read-only</Text>
        </View>
      </View>

      {/* Type filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {typeOrder.map((type) => {
          const active = visibleTypes.has(type);
          const color = colorMap.get(type)?.[0] ?? '#6366f1';
          return (
            <TouchableOpacity
              key={type}
              onPress={() => {
                const next = new Set(visibleTypes);
                if (next.has(type)) next.delete(type); else next.add(type);
                setVisibleTypes(next);
              }}
              style={[styles.chip, active ? { backgroundColor: color } : styles.chipOff]}
            >
              <Text style={[styles.chipText, !active && styles.chipTextOff]}>{type}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[styles.tabBtn, activeTab === t.key && styles.tabBtnActive]}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Feed tab */}
      {activeTab === 'feed' && (
        grouped.length === 0 ? (
          <Text style={styles.empty}>No activity to show.</Text>
        ) : (
          grouped.map(([dayStr, dayLogs]) => {
            const date = new Date(dayStr + 'T12:00:00');
            const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <View key={dayStr} style={styles.dayBlock}>
                <Text style={styles.dayLabel}>{label}</Text>
                {dayLogs.map((log) => {
                  const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
                  const val = valueLabel(log);
                  const timeStr = log.ended_at
                    ? formatTimeRange(log.started_at, log.ended_at)
                    : formatTimeRange(log.started_at, null);
                  return (
                    <View key={log.id} style={styles.logRow}>
                      <View style={[styles.dot, { backgroundColor: color }]} />
                      <View style={styles.logContent}>
                        <View style={styles.logTopRow}>
                          <Text style={[styles.logType, { color }]}>{log.activity_type}</Text>
                          {val && <Text style={styles.logValue}>{val}</Text>}
                        </View>
                        <Text style={styles.logTime}>{timeStr}</Text>
                        {log.notes ? <Text style={styles.logNotes}>{log.notes}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })
        )
      )}

      {/* Charts tab */}
      {activeTab === 'charts' && (
        typeOrder.filter((t) => visibleTypes.has(t)).length === 0 ? (
          <Text style={styles.empty}>No activity types visible.</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {typeOrder.filter((t) => visibleTypes.has(t)).map((type) => (
              <ActivityChart
                key={type}
                type={type}
                logs={logs}
                colorPair={colorMap.get(type) ?? TYPE_COLORS[0]}
                colWidth={colWidth}
                numDays={numDays}
                onScrollX={(x) => syncScrollX(x, type)}
                registerScroll={(ref) => scrollNodeRefs.current.set(type, ref)}
                collapsed={collapsed[type] ?? false}
                onToggleCollapsed={() => setCollapsed((c) => ({ ...c, [type]: !c[type] }))}
              />
            ))}
          </View>
        )
      )}

      {/* Timeline tab */}
      {activeTab === 'timeline' && (
        <PublicTimeline
          logs={logs}
          colorMap={colorMap}
          visibleTypes={visibleTypes}
          colWidth={colWidth}
          numDays={numDays}
          onScrollX={(x) => syncScrollX(x, 'timeline')}
          registerScroll={(ref) => scrollNodeRefs.current.set('timeline', ref)}
        />
      )}

      {/* Notes/Journal tab */}
      {activeTab === 'notes' && includeNotes && (
        notes.length === 0 ? (
          <Text style={styles.empty}>No journal entries to show.</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {notes.map((note) => {
              const dateLabel = note.date
                ? new Date(note.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                : 'General';
              return (
                <View key={note.id} style={styles.noteCard}>
                  <Text style={styles.noteDate}>{dateLabel}</Text>
                  <Text style={styles.noteContent}>{note.content}</Text>
                </View>
              );
            })}
          </View>
        )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 15, color: '#9ca3af', textAlign: 'center' },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  heading: { fontSize: 22, fontWeight: '700', color: '#111827', flexShrink: 1 },
  badge: { backgroundColor: '#eef2ff', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#6366f1' },

  chipRow: { paddingBottom: 14, gap: 6 },
  chip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipOff: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  chipTextOff: { color: '#6b7280' },

  tabBar: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb',
    marginBottom: 14, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#6366f1' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: '#fff' },

  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 48, fontSize: 15 },

  dayBlock: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1,
    borderColor: '#e5e7eb', marginBottom: 10, overflow: 'hidden',
  },
  dayLabel: {
    fontSize: 11, fontWeight: '700', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
    backgroundColor: '#f9fafb',
  },
  logRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  logContent: { flex: 1 },
  logTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  logType: { fontSize: 14, fontWeight: '600' },
  logValue: { fontSize: 13, color: '#374151' },
  logTime: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  logNotes: { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  noteCard: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1,
    borderColor: '#e5e7eb', padding: 14,
  },
  noteDate: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  noteContent: { fontSize: 14, color: '#374151', lineHeight: 20 },
});
