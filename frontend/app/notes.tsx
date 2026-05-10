import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getNotes, getDailyLogs, createNote, updateNote, deleteNote, getLogs,
  Note, LinkedLog,
} from '@/lib/api';

const TODAY = new Date().toISOString().slice(0, 10);

function formatDate(d: string) {
  const [year, month, day] = d.split('-');
  return `${month}/${day}/${year}`;
}

function dateLabel(d: string) {
  if (d === TODAY) return 'Today';
  if (d === shiftDate(TODAY, -1)) return 'Yesterday';
  return formatDate(d);
}

function shiftDate(d: string, days: number) {
  const date = new Date(d + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

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
  h1:      { fontSize: 20, fontWeight: '800', color: '#111827', marginTop: 8, marginBottom: 2 },
  h2:      { fontSize: 17, fontWeight: '700', color: '#1f2937', marginTop: 6 },
  h3:      { fontSize: 15, fontWeight: '700', color: '#374151', marginTop: 4 },
  body:    { fontSize: 14, color: '#374151', lineHeight: 21 },
  hr:      { height: 1, backgroundColor: '#e5e7eb', marginVertical: 8 },
  listRow: { flexDirection: 'row', gap: 8, paddingLeft: 4 },
  listDot: { fontSize: 14, color: '#6b7280', minWidth: 18 },
  listText:{ fontSize: 14, color: '#374151', lineHeight: 21, flex: 1 },
});

// ── Formatting toolbar ────────────────────────────────────────────────────────

function FormattingBar({ onLinePrefix, onWrap }: {
  onLinePrefix: (p: string) => void;
  onWrap: (before: string, after: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={fmt.bar}
      contentContainerStyle={fmt.barContent}
      keyboardShouldPersistTaps="always"
    >
      {[['H1','# '],['H2','## '],['H3','### ']].map(([label, prefix]) => (
        <TouchableOpacity key={label} style={fmt.btn} onPress={() => onLinePrefix(prefix)}>
          <Text style={fmt.btnLabel}>{label}</Text>
        </TouchableOpacity>
      ))}
      <View style={fmt.sep} />
      <TouchableOpacity style={fmt.btn} onPress={() => onLinePrefix('- ')}>
        <Text style={fmt.btnLabel}>•  List</Text>
      </TouchableOpacity>
      <TouchableOpacity style={fmt.btn} onPress={() => onLinePrefix('1. ')}>
        <Text style={fmt.btnLabel}>1. List</Text>
      </TouchableOpacity>
      <View style={fmt.sep} />
      <TouchableOpacity style={fmt.btn} onPress={() => onWrap('**', '**')}>
        <Text style={[fmt.btnLabel, { fontWeight: '800' }]}>B</Text>
      </TouchableOpacity>
      <TouchableOpacity style={fmt.btn} onPress={() => onWrap('*', '*')}>
        <Text style={[fmt.btnLabel, { fontStyle: 'italic' }]}>I</Text>
      </TouchableOpacity>
      <View style={fmt.sep} />
      <TouchableOpacity style={fmt.btn} onPress={() => onLinePrefix('---')}>
        <Text style={fmt.btnLabel}>― Rule</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const fmt = StyleSheet.create({
  bar: { flexGrow: 0, backgroundColor: '#f9fafb', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#e5e7eb' },
  barContent: { paddingHorizontal: 4, alignItems: 'center' },
  btn: { paddingHorizontal: 12, paddingVertical: 8 },
  btnLabel: { fontSize: 13, color: '#374151', fontWeight: '600' },
  sep: { width: 1, height: 20, backgroundColor: '#e5e7eb', marginHorizontal: 2 },
});

// ── Log note card ─────────────────────────────────────────────────────────────

function LogNoteCard({ log }: { log: LinkedLog }) {
  const [expanded, setExpanded] = useState(false);
  const cardTags = Array.isArray(log.extra_data?.tags) ? (log.extra_data!.tags as string[]) : [];
  return (
    <TouchableOpacity style={s.logCard} onPress={() => setExpanded(e => !e)} activeOpacity={0.8}>
      <View style={s.logCardRow}>
        <Text style={s.logCardType}>{log.activity_type}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={s.logCardMeta}>{timeLabel(log.started_at)}</Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color="#9ca3af" />
        </View>
      </View>
      {!expanded && cardTags.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
          {cardTags.map(tag => (
            <View key={tag} style={s.logTagChip}>
              <Text style={s.logTagText}>#{tag}</Text>
            </View>
          ))}
        </View>
      )}
      {expanded && (
        <View style={s.logCardAttrs}>
          <LogAttr label="Start"    value={new Date(log.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />
          {log.ended_at   && <LogAttr label="End"      value={new Date(log.ended_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />}
          {log.duration_minutes != null && <LogAttr label="Duration" value={`${log.duration_minutes} min`} />}
          {log.notes      && <LogAttr label="Note"     value={log.notes} />}
          {Array.isArray(log.extra_data?.tags) && (log.extra_data!.tags as string[]).length > 0 && (
            <View style={s.logAttrRow}>
              <Text style={s.logAttrLabel}>Tags</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                {(log.extra_data!.tags as string[]).map(tag => (
                  <View key={tag} style={s.logTagChip}>
                    <Text style={s.logTagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

function LogAttr({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.logAttrRow}>
      <Text style={s.logAttrLabel}>{label}</Text>
      <Text style={s.logAttrValue}>{value}</Text>
    </View>
  );
}

// ── Day detail ────────────────────────────────────────────────────────────────

function DayDetail({ date, onDateChange, onBack, onNoteChanged }: {
  date: string;
  onDateChange: (d: string) => void;
  onBack?: () => void;
  onNoteChanged?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [dayLogs, setDayLogs] = useState<LinkedLog[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const noteRef = useRef<Note | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selRef = useRef({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);

  useEffect(() => { load(date); setEditing(false); }, [date]);

  async function load(d: string) {
    const [notes, logs] = await Promise.all([
      getNotes({ note_type: 'daily', date: d }),
      getDailyLogs(d),
    ]);
    const n = notes[0] ?? null;
    noteRef.current = n;
    setTitle(n?.title ?? '');
    setContent(n?.content ?? '');
    setDayLogs(logs);
  }

  const scheduleSave = useCallback((t: string, c: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(t, c), 1000);
  }, [date]);

  async function persist(t: string, c: string) {
    if (!t.trim() && !c.trim()) return;
    setSaving(true);
    try {
      const payload = { title: t.trim() || null, content: c };
      if (noteRef.current) {
        const updated = await updateNote(noteRef.current.id, payload);
        noteRef.current = updated;
      } else {
        const created = await createNote({ note_type: 'daily', date, ...payload });
        noteRef.current = created;
      }
      onNoteChanged?.();
    } finally { setSaving(false); }
  }

  function handleLinePrefix(prefix: string) {
    const lineStart = content.lastIndexOf('\n', selRef.current.start - 1) + 1;
    const next = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    setContent(next);
    scheduleSave(title, next);
    inputRef.current?.focus();
  }

  function handleWrap(before: string, after: string) {
    const { start, end } = selRef.current;
    const next = content.slice(0, start) + before + content.slice(start, end) + after + content.slice(end);
    setContent(next);
    scheduleSave(title, next);
    inputRef.current?.focus();
  }

  const logsWithNotes = dayLogs;
  const otherLogs: typeof dayLogs = [];
  const hasNote = title.trim() || content.trim();
  const [logsVisible, setLogsVisible] = useState(false);

  return (
    <View style={s.detail}>
      {/* Header */}
      <View style={s.detailHeader}>
        {onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={20} color="#374151" />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => onDateChange(shiftDate(date, -1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={18} color="#6b7280" />
        </TouchableOpacity>
        <Text style={s.detailTitle}>{dateLabel(date)}</Text>
        <TouchableOpacity onPress={() => onDateChange(shiftDate(date, 1))} disabled={date >= TODAY} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-forward" size={18} color={date >= TODAY ? '#d1d5db' : '#6b7280'} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {saving && <ActivityIndicator size="small" color="#6366f1" style={{ marginRight: 4 }} />}
        <TouchableOpacity
          style={s.modeBtn}
          onPress={() => { if (!editing) { setEditing(true); } else { if (saveTimer.current) { clearTimeout(saveTimer.current); persist(title, content); } setEditing(false); } }}
        >
          <Ionicons name={editing ? 'checkmark' : 'pencil-outline'} size={15} color="#6366f1" />
          <Text style={s.modeBtnText}>{editing ? 'Done' : 'Edit'}</Text>
        </TouchableOpacity>
      </View>

      {editing && <FormattingBar onLinePrefix={handleLinePrefix} onWrap={handleWrap} />}

      <ScrollView style={s.detailScroll} keyboardShouldPersistTaps="handled">
        {/* Activity logs — hidden by default */}
        {dayLogs.length > 0 && (
          <View style={s.section}>
            <TouchableOpacity style={s.logsToggle} onPress={() => setLogsVisible(v => !v)}>
              <Ionicons name={logsVisible ? 'chevron-down' : 'chevron-forward'} size={13} color="#9ca3af" />
              <Text style={s.logsToggleText}>
                {dayLogs.length} activity log{dayLogs.length !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
            {logsVisible && (
              <>
                {logsWithNotes.map(log => <LogNoteCard key={log.id} log={log} />)}
                {otherLogs.length > 0 && (
                  <View style={[s.chips, { marginTop: logsWithNotes.length > 0 ? 8 : 0 }]}>
                    {otherLogs.map(log => (
                      <View key={log.id} style={s.chip}>
                        <Text style={s.chipType}>{log.activity_type}</Text>
                        {log.duration_minutes != null && <Text style={s.chipMeta}>{log.duration_minutes}m</Text>}
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* Note */}
        <View style={s.section}>
          {(logsWithNotes.length > 0 || otherLogs.length > 0) && (
            <Text style={s.sectionLabel}>Note</Text>
          )}
          {editing ? (
            <>
              <TextInput
                style={s.titleInput}
                placeholder="Title (optional)"
                placeholderTextColor="#9ca3af"
                value={title}
                onChangeText={v => { setTitle(v); scheduleSave(v, content); }}
              />
              <TextInput
                ref={inputRef}
                style={s.contentInput}
                placeholder={'Write your note…\n\nFormatting: # Heading  - Bullet  **Bold**  *Italic*'}
                placeholderTextColor="#c4c9d4"
                value={content}
                onChangeText={v => { setContent(v); scheduleSave(title, v); }}
                multiline
                textAlignVertical="top"
                onSelectionChange={e => { selRef.current = e.nativeEvent.selection; }}
              />
            </>
          ) : hasNote ? (
            <>
              {title.trim() ? <Text style={s.noteViewTitle}>{title}</Text> : null}
              <MarkdownView content={content} />
            </>
          ) : (
            <TouchableOpacity style={s.emptyNoteBtn} onPress={() => setEditing(true)}>
              <Ionicons name="pencil-outline" size={14} color="#9ca3af" />
              <Text style={s.emptyNoteText}>Add a note for this day</Text>
            </TouchableOpacity>
          )}
        </View>

        {dayLogs.length === 0 && !hasNote && (
          <Text style={s.emptyDay}>No activity logged for this day.</Text>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Day list sidebar ──────────────────────────────────────────────────────────

interface DayMeta { date: string; noteCount: number; notePreview: string | null; }

function DayList({ days, selected, onSelect, loading }: {
  days: DayMeta[];
  selected: string;
  onSelect: (d: string) => void;
  loading: boolean;
}) {
  if (loading) return <View style={s.listLoading}><ActivityIndicator color="#6366f1" /></View>;
  return (
    <View style={{ flex: 1 }}>
      {/* Jump to any date */}
      {Platform.OS === 'web' ? (
        // @ts-ignore
        <input
          type="date"
          value={selected}
          max={TODAY}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.value) onSelect(e.target.value); }}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 10px', fontSize: 12,
            borderWidth: 0, borderBottomWidth: 1, borderStyle: 'solid', borderColor: '#e5e7eb',
            backgroundColor: '#f9fafb', color: '#374151', outline: 'none',
          }}
        />
      ) : (
        <TextInput
          style={s.dateJumpInput}
          placeholder="Go to date (YYYY-MM-DD)"
          placeholderTextColor="#9ca3af"
          onSubmitEditing={e => { const v = e.nativeEvent.text.trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onSelect(v); }}
          returnKeyType="go"
        />
      )}
      <ScrollView>
        {days.map(day => {
          const on = day.date === selected;
          return (
            <TouchableOpacity key={day.date} style={[s.listItem, on && s.listItemOn]} onPress={() => onSelect(day.date)}>
              <Text style={[s.listItemDate, on && s.listItemDateOn]}>{dateLabel(day.date)}</Text>
              <Text style={[s.listItemMeta, on && s.listItemMetaOn]} numberOfLines={1}>
                {[
                  day.noteCount > 0 ? `${day.noteCount} entr${day.noteCount !== 1 ? 'ies' : 'y'}` : null,
                  day.notePreview ? day.notePreview.replace(/^#+\s|[-*]\s|\*\*/g, '') : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── General notes tab ─────────────────────────────────────────────────────────

function GeneralTab() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const noteRef = useRef<Note | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selRef = useRef({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);

  useEffect(() => { loadNotes(); }, []);

  async function loadNotes() {
    const ns = await getNotes({ note_type: 'general' });
    setNotes(ns);
  }

  function openNew() {
    noteRef.current = null;
    setTitle(''); setContent('');
    setEditing(true);
  }

  function openEdit(note: Note) {
    noteRef.current = note;
    setTitle(note.title ?? '');
    setContent(note.content);
    setEditing(true);
  }

  const scheduleSave = useCallback((t: string, c: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(t, c), 1000);
  }, []);

  async function persist(t: string, c: string) {
    if (!t.trim() && !c.trim()) return;
    setSaving(true);
    try {
      const payload = { title: t.trim() || null, content: c };
      if (noteRef.current) {
        noteRef.current = await updateNote(noteRef.current.id, payload);
      } else {
        noteRef.current = await createNote({ note_type: 'general', ...payload });
      }
    } finally { setSaving(false); }
  }

  async function closeEditor() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await persist(title, content);
    setEditing(false);
    loadNotes();
  }

  function handleLinePrefix(prefix: string) {
    const lineStart = content.lastIndexOf('\n', selRef.current.start - 1) + 1;
    const next = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    setContent(next); scheduleSave(title, next);
    inputRef.current?.focus();
  }

  function handleWrap(before: string, after: string) {
    const { start, end } = selRef.current;
    const next = content.slice(0, start) + before + content.slice(start, end) + after + content.slice(end);
    setContent(next); scheduleSave(title, next);
    inputRef.current?.focus();
  }

  async function handleDelete(note: Note) {
    const { Alert } = await import('react-native');
    Alert.alert('Delete note', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteNote(note.id);
        if (noteRef.current?.id === note.id) setEditing(false);
        loadNotes();
      }},
    ]);
  }

  if (editing) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={s.detailHeader}>
          <TouchableOpacity onPress={closeEditor} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={20} color="#374151" />
          </TouchableOpacity>
          <Text style={s.detailTitle}>{noteRef.current ? (title || 'Untitled') : 'New note'}</Text>
          <View style={{ flex: 1 }} />
          {saving && <ActivityIndicator size="small" color="#6366f1" style={{ marginRight: 4 }} />}
          <TouchableOpacity style={s.modeBtn} onPress={closeEditor}>
            <Ionicons name="checkmark" size={15} color="#6366f1" />
            <Text style={s.modeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
        <FormattingBar onLinePrefix={handleLinePrefix} onWrap={handleWrap} />
        <ScrollView style={s.detailScroll} keyboardShouldPersistTaps="handled">
          <TextInput
            style={s.titleInput}
            placeholder="Title (optional)"
            placeholderTextColor="#9ca3af"
            value={title}
            onChangeText={v => { setTitle(v); scheduleSave(v, content); }}
          />
          <TextInput
            ref={inputRef}
            style={s.contentInput}
            placeholder={'Write your note…\n\nFormatting: # Heading  - Bullet  **Bold**  *Italic*'}
            placeholderTextColor="#c4c9d4"
            value={content}
            onChangeText={v => { setContent(v); scheduleSave(title, v); }}
            multiline
            textAlignVertical="top"
            onSelectionChange={e => { selRef.current = e.nativeEvent.selection; }}
            autoFocus
          />
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={s.list} keyboardShouldPersistTaps="handled">
        {notes.length === 0 && (
          <Text style={[s.emptyDay, { marginTop: 60 }]}>No general notes yet. Tap + to create one.</Text>
        )}
        {notes.map(note => (
          <TouchableOpacity key={note.id} style={s.noteCard} onPress={() => openEdit(note)}>
            <View style={s.noteCardRow}>
              <Text style={s.noteCardTitle} numberOfLines={1}>{note.title || 'Untitled'}</Text>
              <TouchableOpacity onPress={() => handleDelete(note)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={15} color="#d1d5db" />
              </TouchableOpacity>
            </View>
            {note.content ? <Text style={s.noteCardPreview} numberOfLines={2}>{note.content.replace(/#+\s|[-*]\s|\*\*/g, '')}</Text> : null}
            <Text style={s.noteCardDate}>{formatDate(note.updated_at.slice(0, 10))}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ height: 80 }} />
      </ScrollView>
      <TouchableOpacity style={s.fab} onPress={openNew}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function NotesScreen() {
  const [tab, setTab] = useState<'daily' | 'general'>('daily');
  const [days, setDays] = useState<DayMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(TODAY);
  const [showDetail, setShowDetail] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const isWeb = Platform.OS === 'web';

  function startDrag(e: any) {
    const startX = e.clientX;
    const startW = collapsed ? 0 : sidebarWidth;
    dragRef.current = { startX, startW };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const next = dragRef.current.startW + (ev.clientX - dragRef.current.startX);
      if (next < 60) {
        setCollapsed(true);
      } else {
        setCollapsed(false);
        setSidebarWidth(Math.min(400, Math.max(120, next)));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  useEffect(() => { loadDays(); }, []);

  async function loadDays() {
    setLoading(true);
    try {
      const [logs, notes] = await Promise.all([getLogs(undefined, 500), getNotes({ note_type: 'daily' })]);
      // Count activity logs that have a note, per day
      const logNotesByDay = new Map<string, number>();
      logs.forEach(l => {
        if (!l.notes) return;
        const d = l.started_at.slice(0, 10);
        logNotesByDay.set(d, (logNotesByDay.get(d) ?? 0) + 1);
      });
      const logDays = new Set(logs.map(l => l.started_at.slice(0, 10)));
      const notesByDay = new Map<string, Note>();
      notes.forEach(n => { if (n.date) notesByDay.set(n.date, n); });
      const all = [...new Set([...logDays, ...notesByDay.keys(), TODAY, selected])].sort().reverse();
      setDays(all.map(date => {
        const hasFreeform = notesByDay.has(date) ? 1 : 0;
        return {
          date,
          noteCount: (logNotesByDay.get(date) ?? 0) + hasFreeform,
          notePreview: notesByDay.get(date)?.content?.slice(0, 60) ?? null,
        };
      }));
    } finally { setLoading(false); }
  }

  function handleSelect(d: string) { setSelected(d); if (!isWeb) setShowDetail(true); }

  const detailProps = {
    date: selected,
    onDateChange: (d: string) => { setSelected(d); if (!isWeb) setShowDetail(true); },
    onNoteChanged: loadDays,
  };

  function renderDaily() {
    if (isWeb) {
      return (
        <View style={s.webRow}>
          {!collapsed && (
            <View style={[s.sidebar, { width: sidebarWidth }]}>
              <DayList days={days} selected={selected} onSelect={handleSelect} loading={loading} />
            </View>
          )}
          {/* Draggable divider */}
          <View
            style={s.dragHandle}
            // @ts-ignore — web mouse events
            onMouseDown={startDrag}
          >
            {collapsed ? (
              <TouchableOpacity
                onPress={() => { setCollapsed(false); setSidebarWidth(220); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-forward" size={14} color="#9ca3af" />
              </TouchableOpacity>
            ) : (
              <View style={s.dragHandlePip} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <DayDetail {...detailProps} />
          </View>
        </View>
      );
    }
    if (showDetail) return <DayDetail {...detailProps} onBack={() => setShowDetail(false)} />;
    return <DayList days={days} selected={selected} onSelect={handleSelect} loading={loading} />;
  }

  return (
    <View style={s.container}>
      <View style={s.tabBar}>
        {(['daily', 'general'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnOn]} onPress={() => setTab(t)}>
            <Text style={[s.tabBtnText, tab === t && s.tabBtnTextOn]}>
              {t === 'daily' ? 'Daily' : 'General'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'daily' ? renderDaily() : <GeneralTab />}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  webRow:    { flex: 1, flexDirection: 'row' },
  sidebar:   { backgroundColor: '#fff' },
  dragHandle: {
    width: 14,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#e5e7eb',
    cursor: 'col-resize' as any,
  },
  dragHandlePip: {
    width: 4, height: 32, borderRadius: 2, backgroundColor: '#d1d5db',
  },

  // Day list
  list:         { flex: 1 },
  listLoading:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  dateJumpInput: { borderBottomWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: '#374151' },
  listItem:     { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  listItemOn:   { backgroundColor: '#eef2ff' },
  listItemDate: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 2 },
  listItemDateOn: { color: '#6366f1' },
  listItemMeta: { fontSize: 12, color: '#9ca3af' },
  listItemMetaOn: { color: '#818cf8' },

  // Detail
  detail:       { flex: 1, backgroundColor: '#fff' },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  detailTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  modeBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#eef2ff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  modeBtnText: { fontSize: 13, color: '#6366f1', fontWeight: '600' },
  detailScroll: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },

  section:      { marginBottom: 18 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },

  logCard:     { backgroundColor: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e5e7eb' },
  logCardRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logCardType: { fontSize: 13, fontWeight: '700', color: '#374151', textTransform: 'capitalize' },
  logCardMeta: { fontSize: 11, color: '#9ca3af' },
  logCardNote: { fontSize: 13, color: '#4b5563', lineHeight: 19 },
  logCardAttrs:  { marginTop: 8, gap: 4, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8 },
  logAttrRow:    { flexDirection: 'row', gap: 8 },
  logAttrLabel:  { fontSize: 11, fontWeight: '700', color: '#9ca3af', width: 52, textTransform: 'uppercase' },
  logAttrValue:  { fontSize: 12, color: '#374151', flex: 1, lineHeight: 18 },
  logTagChip:    { backgroundColor: '#eef2ff', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  logTagText:    { fontSize: 11, color: '#4f46e5', fontWeight: '500' },

  logsToggle:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, marginBottom: 4 },
  logsToggleText: { fontSize: 12, fontWeight: '600', color: '#9ca3af' },

  chips:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f3f4f6', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  chipType: { fontSize: 12, color: '#6b7280', textTransform: 'capitalize' },
  chipMeta: { fontSize: 11, color: '#9ca3af' },

  titleInput:    { fontSize: 18, fontWeight: '700', color: '#111827', paddingVertical: 6, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  contentInput:  { fontSize: 14, color: '#374151', lineHeight: 22, minHeight: 200, paddingVertical: 4 },
  noteViewTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 10 },

  emptyNoteBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  emptyNoteText: { fontSize: 13, color: '#9ca3af' },
  emptyDay:      { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginTop: 40 },

  // Top tab bar
  tabBar:       { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingHorizontal: 16, paddingTop: 4 },
  tabBtn:       { paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnOn:     { borderBottomColor: '#6366f1' },
  tabBtnText:   { fontSize: 14, fontWeight: '600', color: '#9ca3af' },
  tabBtnTextOn: { color: '#6366f1' },

  // General notes list
  noteCard:    { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  noteCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  noteCardTitle:   { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1 },
  noteCardPreview: { fontSize: 13, color: '#6b7280', lineHeight: 19, marginBottom: 4 },
  noteCardDate:    { fontSize: 11, color: '#9ca3af' },

  // FAB
  fab: {
    position: 'absolute', bottom: 20, right: 20,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 4, elevation: 5,
  },
});
