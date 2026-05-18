import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator,
  StyleSheet, TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getPublicLogs, getPublicInfo, ActivityLog } from '@/lib/api';

const TYPE_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6',
];

function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

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
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  const [typeOrder, setTypeOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    Promise.all([getPublicInfo(token), getPublicLogs(token)])
      .then(([info, data]) => {
        setOwnerName(info.name);
        setLogs(data);
        const seen = new Set<string>();
        const order: string[] = [];
        data.forEach((l) => { if (!seen.has(l.activity_type)) { seen.add(l.activity_type); order.push(l.activity_type); } });
        setTypeOrder(order);
        setVisibleTypes(new Set(order));
      })
      .catch(() => setError('This link is invalid or has been revoked.'))
      .finally(() => setLoading(false));
  }, [token]);

  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    typeOrder.forEach((t, i) => m.set(t, TYPE_COLORS[i % TYPE_COLORS.length]));
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
          const color = colorMap.get(type) ?? '#6366f1';
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

      {grouped.length === 0 ? (
        <Text style={styles.empty}>No activity to show.</Text>
      ) : (
        grouped.map(([dayStr, dayLogs]) => {
          const date = new Date(dayStr + 'T12:00:00');
          const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
          return (
            <View key={dayStr} style={styles.dayBlock}>
              <Text style={styles.dayLabel}>{label}</Text>
              {dayLogs.map((log) => {
                const color = colorMap.get(log.activity_type) ?? '#6366f1';
                const val = valueLabel(log);
                return (
                  <View key={log.id} style={styles.logRow}>
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <View style={styles.logContent}>
                      <View style={styles.logTopRow}>
                        <Text style={[styles.logType, { color }]}>{log.activity_type}</Text>
                        {val && <Text style={styles.logValue}>{val}</Text>}
                      </View>
                      {log.notes ? <Text style={styles.logNotes}>{log.notes}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 15, color: '#9ca3af', textAlign: 'center' },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  heading: { fontSize: 22, fontWeight: '700', color: '#111827', flexShrink: 1 },
  badge: { backgroundColor: '#eef2ff', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#6366f1' },

  chipRow: { paddingBottom: 16, gap: 6 },
  chip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipOff: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  chipTextOff: { color: '#6b7280' },

  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 48, fontSize: 15 },

  dayBlock: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1,
    borderColor: '#e5e7eb', marginBottom: 12, overflow: 'hidden',
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
  logNotes: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
});
