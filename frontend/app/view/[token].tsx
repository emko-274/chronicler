import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator,
  StyleSheet, TouchableOpacity, Platform, Alert, Modal,
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
import { Ionicons } from '@expo/vector-icons';
import {
  EXPORT_COLUMNS, DEFAULT_COLUMNS,
  buildCSV, downloadCSV, downloadXLSX,
} from '@/lib/exportUtils';

const exportDateInputStyle: React.CSSProperties = {
  fontSize: 14, padding: '8px 10px', borderRadius: 8,
  border: '1px solid #d1d5db', backgroundColor: '#fff',
  color: '#111827', width: '100%', boxSizing: 'border-box',
};

type Tab = 'stream' | 'charts' | 'notes';
type NoteSubTab = 'daily' | 'general';

// ── Markdown renderer (read-only) ─────────────────────────────────────────────

function parseInline(text: string, baseStyle: object): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const bi = remaining.search(/\*\*.+?\*\*/);
    const ii = remaining.search(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    if (bi === -1 && ii === -1) { parts.push(remaining); break; }
    const useBold = bi !== -1 && (ii === -1 || bi <= ii);
    if (useBold) {
      if (bi > 0) parts.push(remaining.slice(0, bi));
      const m = remaining.slice(bi).match(/\*\*(.+?)\*\*/);
      if (!m) { parts.push(remaining); break; }
      parts.push(<Text key={key++} style={[baseStyle, { fontWeight: '700' }]}>{m[1]}</Text>);
      remaining = remaining.slice(bi + m[0].length);
    } else {
      if (ii > 0) parts.push(remaining.slice(0, ii));
      const m = remaining.slice(ii).match(/\*(.+?)\*/);
      if (!m) { parts.push(remaining); break; }
      parts.push(<Text key={key++} style={[baseStyle, { fontStyle: 'italic' }]}>{m[1]}</Text>);
      remaining = remaining.slice(ii + m[0].length);
    }
  }
  if (parts.length === 0) return null;
  if (parts.length === 1 && typeof parts[0] === 'string') return <Text style={baseStyle}>{parts[0]}</Text>;
  return <Text style={baseStyle}>{parts}</Text>;
}

function MarkdownView({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <View style={{ gap: 3 }}>
      {content.split('\n').map((line, i) => {
        if (line.startsWith('# '))  return <Text key={i} style={md.h1}>{line.slice(2)}</Text>;
        if (line.startsWith('## ')) return <Text key={i} style={md.h2}>{line.slice(3)}</Text>;
        if (line.startsWith('### ')) return <Text key={i} style={md.h3}>{line.slice(4)}</Text>;
        if (line === '---') return <View key={i} style={md.hr} />;
        if (line === '') return <View key={i} style={{ height: 6 }} />;
        const bulletMatch = line.match(/^[-*] (.+)/);
        if (bulletMatch) return (
          <View key={i} style={md.listRow}>
            <Text style={md.listDot}>•</Text>
            <Text style={md.listText}>{parseInline(bulletMatch[1], md.listText)}</Text>
          </View>
        );
        const numMatch = line.match(/^(\d+)\. (.+)/);
        if (numMatch) return (
          <View key={i} style={md.listRow}>
            <Text style={md.listDot}>{numMatch[1]}.</Text>
            <Text style={md.listText}>{parseInline(numMatch[2], md.listText)}</Text>
          </View>
        );
        return <Text key={i} style={md.body}>{parseInline(line, md.body)}</Text>;
      })}
    </View>
  );
}

const md = StyleSheet.create({
  h1:      { fontSize: 18, fontWeight: '800', color: '#111827', marginTop: 8, marginBottom: 2 },
  h2:      { fontSize: 15, fontWeight: '700', color: '#1f2937', marginTop: 6 },
  h3:      { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 4 },
  body:    { fontSize: 14, color: '#374151', lineHeight: 21 },
  hr:      { height: 1, backgroundColor: '#e5e7eb', marginVertical: 8 },
  listRow: { flexDirection: 'row', gap: 8, paddingLeft: 4 },
  listDot: { fontSize: 14, color: '#6b7280', minWidth: 18 },
  listText: { fontSize: 14, color: '#374151', lineHeight: 21, flex: 1 },
});

// ── Read-only log card (like journal's LogNoteCard, no edit button) ───────────

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function ReadOnlyLogCard({ log, colorMap }: { log: ActivityLog; colorMap: Map<string, string[]> }) {
  const [expanded, setExpanded] = useState(false);
  const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
  const tags = Array.isArray(log.extra_data?.tags) ? (log.extra_data!.tags as string[]) : [];
  const rawQty = log.extra_data?.quantity;
  const qtyStr = typeof rawQty === 'number'
    ? `${rawQty % 1 === 0 ? rawQty.toFixed(0) : rawQty.toFixed(1)}${log.extra_data?.unit ? ` ${log.extra_data.unit}` : ''}`
    : null;
  const durStr = log.duration_minutes != null ? formatDuration(log.duration_minutes) : null;
  const summary = qtyStr ?? durStr;
  const isTimeless = log.extra_data?.zero === true || log.extra_data?.untimed === true;
  const timeStr = isTimeless
    ? new Date(log.started_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : timeLabel(log.started_at) + (log.ended_at ? ` – ${timeLabel(log.ended_at)}` : '');

  return (
    <TouchableOpacity style={styles.logCard} onPress={() => setExpanded(e => !e)} activeOpacity={0.8}>
      <View style={styles.logCardRow}>
        <Text style={[styles.logCardType, { color }]}>{log.activity_type}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {log.notes ? <Ionicons name="document-text-outline" size={13} color="#a5b4fc" /> : null}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-forward'} size={13} color="#9ca3af" />
        </View>
      </View>
      {expanded && (
        <View style={styles.logCardAttrs}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.logCardMeta}>{timeStr}</Text>
            {summary != null && <Text style={styles.logCardQty}>{summary}</Text>}
          </View>
          {log.notes ? <Text style={styles.logCardNote}>{log.notes}</Text> : null}
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {tags.map(tag => (
                <View key={tag} style={styles.logTag}>
                  <Text style={styles.logTagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function valueLabel(log: ActivityLog): string | null {
  if (log.duration_minutes) return formatDuration(log.duration_minutes);
  const qty = log.extra_data?.quantity;
  if (qty != null && qty !== 0) {
    const unit = log.extra_data?.unit as string | undefined;
    return `${qty}${unit ? ' ' + unit : ''}`;
  }
  return null;
}

// ── Main screen ───────────────────────────────────────────────────────────────

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
  const [typeColorOrder, setTypeColorOrder] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('stream');
  const [noteSubTab, setNoteSubTab] = useState<NoteSubTab>('daily');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportTypes, setExportTypes] = useState<Set<string>>(new Set());
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exportColumns, setExportColumns] = useState<Set<string>>(new Set(DEFAULT_COLUMNS));
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv');
  const [colorOverrides, setColorOverrides] = useState<Map<string, string>>(new Map());

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
        if (info.colors && Object.keys(info.colors).length > 0) {
          setColorOverrides(new Map(Object.entries(info.colors)));
        }
        setLogs(data);
        const seen = new Set<string>();
        const order: string[] = [];
        data.forEach(l => { if (!seen.has(l.activity_type)) { seen.add(l.activity_type); order.push(l.activity_type); } });
        setTypeOrder(order);
        setTypeColorOrder(order);
        setVisibleTypes(new Set(order));
        setExportTypes(new Set(order));
        if (info.include_notes) return getPublicNotes(token);
        return [];
      })
      .then(noteData => setNotes(noteData as NoteRecord[]))
      .catch(() => setError('This link is invalid or has been revoked.'))
      .finally(() => setLoading(false));
  }, [token]);

  const colorMap = useMemo(() => {
    const m = new Map<string, string[]>();
    typeOrder.forEach((t) => {
      const override = colorOverrides.get(t);
      const colorIdx = typeColorOrder.indexOf(t);
      const primary = override ?? TYPE_COLORS[(colorIdx >= 0 ? colorIdx : 0) % TYPE_COLORS.length][0];
      m.set(t, [primary, lightenHex(primary)]);
    });
    return m;
  }, [typeOrder, typeColorOrder, colorOverrides]);

  // Notes indexed by date for stream inline notes
  const notesByDate = useMemo(() => {
    const m = new Map<string, NoteRecord[]>();
    notes.forEach(n => {
      if (n.note_type === 'daily' && n.date) {
        if (!m.has(n.date)) m.set(n.date, []);
        m.get(n.date)!.push(n);
      }
    });
    return m;
  }, [notes]);

  const dailyNotes = useMemo(() =>
    notes.filter(n => n.note_type === 'daily' && n.date).sort((a, b) => b.date!.localeCompare(a.date!)),
    [notes]);

  const generalNotes = useMemo(() =>
    notes.filter(n => n.note_type === 'general'),
    [notes]);

  // All logs grouped by day (for notes tab activity section)
  const logsByDay = useMemo(() => {
    const m = new Map<string, ActivityLog[]>();
    logs.forEach(l => {
      const d = dayKey(new Date(l.started_at));
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(l);
    });
    return m;
  }, [logs]);

  // Activity types logged per day (for notes tab color badges)
  const logTypesByDay = useMemo(() => {
    const m = new Map<string, Set<string>>();
    logs.forEach(l => {
      const d = dayKey(new Date(l.started_at));
      if (!m.has(d)) m.set(d, new Set());
      m.get(d)!.add(l.activity_type);
    });
    return m;
  }, [logs]);

  const [logsOpenByDate, setLogsOpenByDate] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const filtered = logs.filter(l => visibleTypes.has(l.activity_type));
    const byDay = new Map<string, ActivityLog[]>();
    filtered.forEach(l => {
      const key = dayKey(new Date(l.started_at));
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(l);
    });
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 90);
  }, [logs, visibleTypes]);

  const exportFiltered = useMemo(() => logs.filter(log => {
    if (!exportTypes.has(log.activity_type)) return false;
    if (exportStartDate && new Date(log.started_at) < new Date(exportStartDate)) return false;
    if (exportEndDate && new Date(log.started_at) > new Date(exportEndDate + 'T23:59:59')) return false;
    return true;
  }), [logs, exportTypes, exportStartDate, exportEndDate]);

  async function handleExport() {
    if (exportFiltered.length === 0 || exportColumns.size === 0) return;
    if (Platform.OS !== 'web') {
      Alert.alert('Web only', 'Open in a browser to download files.');
      return;
    }
    const cols = EXPORT_COLUMNS.filter(c => exportColumns.has(c.key));
    const base = `activity_export_${new Date().toISOString().slice(0, 10)}`;
    if (exportFormat === 'xlsx') {
      await downloadXLSX(exportFiltered, cols, `${base}.xlsx`);
    } else {
      downloadCSV(buildCSV(exportFiltered, cols), `${base}.csv`);
    }
  }

  function moveType(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= typeOrder.length) return;
    const arr = [...typeOrder];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setTypeOrder(arr);
  }

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
    { key: 'stream', label: 'Stream' },
    { key: 'charts', label: 'Charts' },
    ...(includeNotes ? [{ key: 'notes' as Tab, label: 'Notes' }] : []),
  ];

  const visibleTypeList = typeOrder.filter(t => visibleTypes.has(t));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.heading}>{ownerName ? `${ownerName}'s Dashboard` : 'Dashboard'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Read-only</Text>
          </View>
          <TouchableOpacity
            style={[styles.exportIconBtn, showExport && styles.exportIconBtnOn]}
            onPress={() => setShowExport(e => !e)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="download-outline" size={15} color={showExport ? '#fff' : '#6366f1'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Export modal */}
      <Modal
        visible={showExport}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExport(false)}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowExport(false)}>
          <TouchableOpacity style={styles.modalCard} activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.exportPanelTitle}>Export Data</Text>
              <TouchableOpacity onPress={() => setShowExport(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.exportSectionRow}>
                <Text style={styles.exportLabel}>Activity Types</Text>
                <TouchableOpacity onPress={() => {
                  const allSel = typeOrder.every(t => exportTypes.has(t));
                  setExportTypes(allSel ? new Set() : new Set(typeOrder));
                }}>
                  <Text style={styles.exportToggleAll}>
                    {typeOrder.every(t => exportTypes.has(t)) ? 'Deselect all' : 'Select all'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.exportChips}>
                {typeOrder.map(type => {
                  const on = exportTypes.has(type);
                  const color = colorMap.get(type)?.[0] ?? '#6366f1';
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.exportChip, on ? { backgroundColor: color, borderColor: color } : styles.exportChipOff]}
                      onPress={() => {
                        const next = new Set(exportTypes);
                        on ? next.delete(type) : next.add(type);
                        setExportTypes(next);
                      }}
                    >
                      <Text style={[styles.exportChipText, !on && styles.exportChipTextOff]}>{type}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.exportLabel, { marginTop: 14 }]}>Date Range</Text>
              {Platform.OS === 'web' ? (
                <View style={styles.exportDateRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exportDateLabel}>From</Text>
                    {/* @ts-ignore */}
                    <input type="date" value={exportStartDate}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportStartDate(e.target.value)}
                      style={exportDateInputStyle} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exportDateLabel}>To</Text>
                    {/* @ts-ignore */}
                    <input type="date" value={exportEndDate}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportEndDate(e.target.value)}
                      style={exportDateInputStyle} />
                  </View>
                </View>
              ) : (
                <Text style={styles.exportHint}>Date filtering available on web.</Text>
              )}

              <Text style={[styles.exportLabel, { marginTop: 14 }]}>Columns</Text>
              {EXPORT_COLUMNS.map(col => {
                const on = exportColumns.has(col.key);
                return (
                  <TouchableOpacity key={col.key} style={styles.exportCheckRow}
                    onPress={() => {
                      const next = new Set(exportColumns);
                      on ? next.delete(col.key) : next.add(col.key);
                      setExportColumns(next);
                    }}
                  >
                    <View style={[styles.exportCheckbox, on && styles.exportCheckboxOn]}>
                      {on && <Text style={styles.exportCheckmark}>✓</Text>}
                    </View>
                    <Text style={styles.exportCheckLabel}>{col.label}</Text>
                    {!col.defaultOn && (
                      <Text style={styles.exportCheckHint}>advanced</Text>
                    )}
                  </TouchableOpacity>
                );
              })}

              <View style={styles.exportFooter}>
                <Text style={styles.exportCount}>
                  {exportFiltered.length} {exportFiltered.length === 1 ? 'entry' : 'entries'}
                </Text>
                <View style={styles.exportFooterActions}>
                  <View style={styles.exportFormatToggle}>
                    {(['csv', 'xlsx'] as const).map(fmt => (
                      <TouchableOpacity
                        key={fmt}
                        style={[styles.exportFormatBtn, exportFormat === fmt && styles.exportFormatBtnOn]}
                        onPress={() => setExportFormat(fmt)}
                      >
                        <Text style={[styles.exportFormatBtnText, exportFormat === fmt && styles.exportFormatBtnTextOn]}>
                          {fmt.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={[styles.exportBtn, (exportFiltered.length === 0 || exportColumns.size === 0) && styles.exportBtnOff]}
                    onPress={handleExport}
                    disabled={exportFiltered.length === 0 || exportColumns.size === 0}
                  >
                    <Ionicons name="download-outline" size={14} color="#fff" style={{ marginRight: 5 }} />
                    <Text style={styles.exportBtnText}>Export</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Color picker panel */}
      {settingsOpen && (
        <View style={styles.colorPanel}>
          <Text style={styles.colorPanelTitle}>Label Colors</Text>
          {typeOrder.map(type => {
            const currentColor = colorMap.get(type)?.[0] ?? '#6366f1';
            const hasOverride = colorOverrides.has(type);
            return (
              <View key={type} style={styles.colorRow}>
                <View style={[styles.colorRowDot, { backgroundColor: currentColor }]} />
                <Text style={styles.colorRowType} numberOfLines={1}>{type}</Text>
                <View style={styles.colorSwatches}>
                  {TYPE_COLORS.map(([color]) => (
                    <TouchableOpacity
                      key={color}
                      style={[styles.colorSwatch, { backgroundColor: color }]}
                      onPress={() => setColorOverrides(prev => new Map(prev).set(type, color))}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                    >
                      {currentColor === color && (
                        <Ionicons name="checkmark" size={13} color="#fff" />
                      )}
                    </TouchableOpacity>
                  ))}
                  {hasOverride && (
                    <TouchableOpacity
                      style={styles.colorResetBtn}
                      onPress={() => setColorOverrides(prev => { const next = new Map(prev); next.delete(type); return next; })}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="refresh-outline" size={13} color="#9ca3af" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Type filter chips + reorder */}
      <View style={styles.chipSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {typeOrder.map((type, idx) => {
            const active = visibleTypes.has(type);
            const color = colorMap.get(type)?.[0] ?? '#6366f1';
            if (settingsOpen) {
              return (
                <View key={type} style={[styles.chip, active ? { backgroundColor: color } : styles.chipOff, { flexDirection: 'row', alignItems: 'center', gap: 2 }]}>
                  <TouchableOpacity onPress={() => moveType(idx, -1)} disabled={idx === 0} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                    <Ionicons name="chevron-back" size={12} color={idx === 0 ? 'rgba(255,255,255,0.25)' : (active ? '#fff' : '#9ca3af')} />
                  </TouchableOpacity>
                  <Text style={[styles.chipText, !active && styles.chipTextOff]}>{type}</Text>
                  <TouchableOpacity onPress={() => moveType(idx, 1)} disabled={idx === typeOrder.length - 1} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                    <Ionicons name="chevron-forward" size={12} color={idx === typeOrder.length - 1 ? 'rgba(255,255,255,0.25)' : (active ? '#fff' : '#9ca3af')} />
                  </TouchableOpacity>
                </View>
              );
            }
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
        <TouchableOpacity
          style={[styles.reorderBtn, settingsOpen && styles.reorderBtnOn]}
          onPress={() => setSettingsOpen(s => !s)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="settings-outline" size={14} color={settingsOpen ? '#fff' : '#6366f1'} />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {tabs.map(t => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[styles.tabBtn, activeTab === t.key && styles.tabBtnActive]}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Stream ── */}
      {activeTab === 'stream' && (
        grouped.length === 0 ? (
          <Text style={styles.empty}>No activity to show.</Text>
        ) : (
          grouped.map(([dayStr, dayLogs]) => {
            const date = new Date(dayStr + 'T12:00:00');
            const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            const dayNotes = includeNotes ? (notesByDate.get(dayStr) ?? []) : [];
            return (
              <View key={dayStr} style={styles.dayBlock}>
                <Text style={styles.dayLabel}>{label}</Text>
                {dayLogs.map(log => {
                  const color = colorMap.get(log.activity_type)?.[0] ?? '#6366f1';
                  const val = valueLabel(log);
                  const timeStr = log.ended_at
                    ? formatTimeRange(log.started_at, log.ended_at)
                    : formatTimeRange(log.started_at, null);
                  const tags = Array.isArray(log.extra_data?.tags) ? (log.extra_data!.tags as string[]) : [];
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
                        {tags.length > 0 && (
                          <View style={styles.logTagRow}>
                            {tags.map(tag => (
                              <View key={tag} style={styles.logTag}>
                                <Text style={styles.logTagText}>{tag}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
                {dayNotes.map(note => (
                  <View key={note.id} style={styles.inlineNote}>
                    <Text style={styles.inlineNoteText}>{note.content}</Text>
                  </View>
                ))}
              </View>
            );
          })
        )
      )}

      {/* ── Charts ── */}
      {activeTab === 'charts' && (
        <View style={{ gap: 12 }}>
          <PublicTimeline
            logs={logs}
            colorMap={colorMap}
            visibleTypes={visibleTypes}
            typeOrder={typeOrder}
            colWidth={colWidth}
            setColWidth={setColWidth}
            numDays={numDays}
            setNumDays={setNumDays}
            colWidthRef={colWidthRef}
            numDaysRef={numDaysRef}
            onScrollX={x => syncScrollX(x, 'timeline')}
            registerScroll={ref => scrollNodeRefs.current.set('timeline', ref)}
            charts={visibleTypeList}
          />
          {visibleTypeList.length === 0 ? (
            <Text style={styles.empty}>No activity types visible.</Text>
          ) : (
            visibleTypeList.map(type => (
              <ActivityChart
                key={type}
                type={type}
                logs={logs}
                colorPair={colorMap.get(type) ?? TYPE_COLORS[0]}
                colWidth={colWidth}
                numDays={numDays}
                onScrollX={x => syncScrollX(x, type)}
                registerScroll={ref => scrollNodeRefs.current.set(type, ref)}
                collapsed={collapsed[type] ?? false}
                onToggleCollapsed={() => setCollapsed(c => ({ ...c, [type]: !c[type] }))}
              />
            ))
          )}
        </View>
      )}

      {/* ── Notes ── */}
      {activeTab === 'notes' && includeNotes && (
        <View>
          {/* Sub-tab bar */}
          <View style={styles.noteTabBar}>
            {(['daily', 'general'] as NoteSubTab[]).map(st => (
              <TouchableOpacity key={st} style={[styles.noteTabBtn, noteSubTab === st && styles.noteTabBtnOn]}
                onPress={() => setNoteSubTab(st)}>
                <Text style={[styles.noteTabText, noteSubTab === st && styles.noteTabTextOn]}>
                  {st === 'daily' ? 'Daily' : 'General'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Daily notes */}
          {noteSubTab === 'daily' && (
            dailyNotes.length === 0 ? (
              <Text style={styles.empty}>No daily journal entries to show.</Text>
            ) : (
              <View style={{ gap: 12, marginTop: 4 }}>
                {dailyNotes.map(note => {
                  const dateLabel = new Date(note.date! + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                  });
                  const dayTypes = [...(logTypesByDay.get(note.date!) ?? [])];
                  const dayLogs = logsByDay.get(note.date!) ?? [];
                  const logsOpen = logsOpenByDate[note.date!] ?? false;
                  return (
                    <View key={note.id} style={styles.noteCard}>
                      <Text style={styles.noteDate}>{dateLabel}</Text>
                      {dayTypes.length > 0 && (
                        <View style={styles.noteBadgeRow}>
                          {dayTypes.map(t => {
                            const color = colorMap.get(t)?.[0] ?? '#6366f1';
                            return (
                              <View key={t} style={[styles.noteBadge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                                <Text style={[styles.noteBadgeText, { color }]}>{t}</Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                      {dayLogs.length > 0 && (
                        <View style={styles.logsSection}>
                          <TouchableOpacity
                            style={styles.logsToggle}
                            onPress={() => setLogsOpenByDate(s => ({ ...s, [note.date!]: !logsOpen }))}
                          >
                            <Ionicons name={logsOpen ? 'chevron-down' : 'chevron-forward'} size={13} color="#9ca3af" />
                            <Text style={styles.logsToggleText}>
                              {dayLogs.length} activity log{dayLogs.length !== 1 ? 's' : ''}
                            </Text>
                          </TouchableOpacity>
                          {logsOpen && dayLogs.map(log => (
                            <ReadOnlyLogCard key={log.id} log={log} colorMap={colorMap} />
                          ))}
                        </View>
                      )}
                      <MarkdownView content={note.content} />
                    </View>
                  );
                })}
              </View>
            )
          )}

          {/* General notes */}
          {noteSubTab === 'general' && (
            generalNotes.length === 0 ? (
              <Text style={styles.empty}>No general notes to show.</Text>
            ) : (
              <View style={{ gap: 12, marginTop: 4 }}>
                {generalNotes.map(note => {
                  const title = note.content.split('\n')[0].replace(/^#+\s/, '') || 'Untitled';
                  const preview = note.content.replace(/#+\s|[-*]\s|\*\*/g, '').split('\n').filter(Boolean).slice(1, 3).join(' ');
                  const updatedDate = note.updated_at.slice(0, 10);
                  const updated = new Date(updatedDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                  return (
                    <View key={note.id} style={styles.noteCard}>
                      <Text style={styles.noteCardTitle}>{title}</Text>
                      {preview ? <Text style={styles.noteCardPreview} numberOfLines={2}>{preview}</Text> : null}
                      <Text style={styles.noteCardDate}>{updated}</Text>
                    </View>
                  );
                })}
              </View>
            )
          )}
        </View>
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

  chipSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  chipRow: { gap: 6 },
  chip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipOff: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  chipTextOff: { color: '#6b7280' },
  reorderBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  reorderBtnOn: { backgroundColor: '#6366f1' },

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
  logTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  logTag: { backgroundColor: '#eef2ff', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  logTagText: { fontSize: 11, color: '#4f46e5', fontWeight: '500' },

  inlineNote: {
    marginHorizontal: 14, marginVertical: 10,
    backgroundColor: '#fefce8', borderRadius: 8,
    borderWidth: 1, borderColor: '#fef08a',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  inlineNoteText: { fontSize: 13, color: '#854d0e', lineHeight: 18 },

  noteTabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff', marginBottom: 4,
  },
  noteTabBtn: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  noteTabBtnOn: { borderBottomColor: '#6366f1' },
  noteTabText: { fontSize: 14, fontWeight: '600', color: '#9ca3af' },
  noteTabTextOn: { color: '#6366f1' },

  noteCard: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1,
    borderColor: '#e5e7eb', padding: 14,
  },
  noteDate: {
    fontSize: 11, fontWeight: '700', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  noteBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 },
  noteBadge: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  noteBadgeText: { fontSize: 11, fontWeight: '600' },
  noteCardTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
  noteCardPreview: { fontSize: 13, color: '#6b7280', lineHeight: 19, marginBottom: 4 },
  noteCardDate: { fontSize: 11, color: '#9ca3af', marginTop: 2 },

  logsSection: { marginBottom: 12 },
  logsToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, marginBottom: 4 },
  logsToggleText: { fontSize: 12, fontWeight: '600', color: '#9ca3af' },

  colorPanel: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb',
    padding: 16, marginBottom: 14,
  },
  colorPanelTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },
  colorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  colorRowDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  colorRowType: { fontSize: 13, fontWeight: '600', color: '#374151', width: 90, flexShrink: 1 },
  colorSwatches: { flexDirection: 'row', gap: 6, flex: 1, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' },
  colorSwatch: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  colorResetBtn: { padding: 2 },

  exportIconBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center',
  },
  exportIconBtnOn: { backgroundColor: '#6366f1' },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 20, width: '100%', maxWidth: 480,
    maxHeight: 600,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  exportPanelTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  exportSectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  exportLabel: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  exportToggleAll: { fontSize: 12, color: '#6366f1', fontWeight: '600' },
  exportChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  exportChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  exportChipOff: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb' },
  exportChipText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  exportChipTextOff: { color: '#6b7280' },
  exportDateRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  exportDateLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  exportHint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  exportCheckRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  exportCheckbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  exportCheckboxOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  exportCheckmark: { color: '#fff', fontSize: 10, fontWeight: '700' },
  exportCheckLabel: { fontSize: 14, color: '#111827', flex: 1 },
  exportCheckHint: { fontSize: 11, color: '#d1d5db', fontWeight: '500' },
  exportFooter: { flexDirection: 'column', gap: 10, marginTop: 14 },
  exportFooterActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exportCount: { fontSize: 13, color: '#6b7280' },
  exportFormatToggle: {
    flexDirection: 'row', borderRadius: 8, borderWidth: 1,
    borderColor: '#e5e7eb', overflow: 'hidden', backgroundColor: '#f3f4f6',
  },
  exportFormatBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  exportFormatBtnOn: { backgroundColor: '#6366f1' },
  exportFormatBtnText: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  exportFormatBtnTextOn: { color: '#fff' },
  exportBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#6366f1', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8 },
  exportBtnOff: { backgroundColor: '#c7d2fe' },
  exportBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  logCard: { backgroundColor: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e5e7eb' },
  logCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logCardType: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  logCardMeta: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  logCardQty: { fontSize: 13, fontWeight: '500', color: '#374151' },
  logCardNote: { fontSize: 12, color: '#6b7280', lineHeight: 18, marginTop: 2 },
  logCardAttrs: { marginTop: 6, gap: 4, borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 6 },
});
