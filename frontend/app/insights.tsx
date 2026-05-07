import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { analyzeData, analyzeCorrelations, getCategories, CorrelationsResponse } from '@/lib/api';

const EXAMPLE_QUESTIONS = [
  'How much sleep did I average this week?',
  'Is there a correlation between my exercise and sleep duration?',
  'What time do I usually go to sleep?',
  'Which days do I exercise the most?',
];

const dateInputStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  backgroundColor: '#fff',
  color: '#374151',
  boxSizing: 'border-box',
};

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

// ── Correlation panel ───────────────────────────────────────────────────────

function CorrelationPanel() {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [lagDays, setLagDays] = useState(0);
  const [windows, setWindows] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const getWindow = (type: string) => windows[type] ?? 1;
  const setWindow = (type: string, w: number) =>
    setWindows(prev => ({ ...prev, [type]: Math.max(1, Math.min(30, w)) }));
  const [result, setResult] = useState<CorrelationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories()
      .then((cats) => setCategories(cats.filter((c) => !c.is_hidden).map((c) => c.name)))
      .catch(() => {});
  }, []);

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const run = async () => {
    if (selectedTypes.size < 2) {
      setError('Select at least 2 activity types.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const activeWindows = Object.fromEntries(
        Object.entries(windows).filter(([t, w]) => selectedTypes.has(t) && w > 1)
      );
      const res = await analyzeCorrelations({
        types: Array.from(selectedTypes),
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        lag_days: lagDays || undefined,
        windows: Object.keys(activeWindows).length ? activeWindows : undefined,
      });
      setResult(res);
    } catch {
      setError('Could not compute correlations. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.corrPanel}>
      <TouchableOpacity style={styles.corrHeader} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.corrTitle}>Correlation Analysis</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#6b7280" />
      </TouchableOpacity>

      {open && (
        <View style={styles.corrBody}>
          {/* Type chips */}
          <Text style={styles.corrLabel}>Activity types (pick 2+)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {categories.map((cat) => {
              const on = selectedTypes.has(cat);
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => toggleType(cat)}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{cat}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Rolling windows — one stepper per selected type */}
          {selectedTypes.size >= 2 && (
            <View style={styles.windowsSection}>
              <Text style={styles.corrLabel}>Rolling window (optional)</Text>
              {Array.from(selectedTypes).map(type => {
                const w = getWindow(type);
                return (
                  <View key={type} style={styles.windowRow}>
                    <Text style={styles.windowLabel}>{type}</Text>
                    <TouchableOpacity
                      onPress={() => setWindow(type, w - 1)}
                      disabled={w <= 1}
                      style={[styles.lagBtn, w <= 1 && styles.lagBtnDisabled]}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="remove" size={14} color={w <= 1 ? '#d1d5db' : '#374151'} />
                    </TouchableOpacity>
                    <Text style={styles.windowValue}>{w === 1 ? 'none' : `${w}d sum`}</Text>
                    <TouchableOpacity
                      onPress={() => setWindow(type, w + 1)}
                      disabled={w >= 30}
                      style={[styles.lagBtn, w >= 30 && styles.lagBtnDisabled]}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="add" size={14} color={w >= 30 ? '#d1d5db' : '#374151'} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Date range */}
          <Text style={styles.corrLabel}>Date range (optional)</Text>
          {Platform.OS === 'web' ? (
            <View style={styles.dateRow}>
              {/* @ts-ignore */}
              <input
                type="date"
                value={startDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)}
                style={{ ...dateInputStyle, marginRight: 8 }}
                placeholder="Start"
              />
              {/* @ts-ignore */}
              <input
                type="date"
                value={endDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndDate(e.target.value)}
                style={dateInputStyle}
                placeholder="End"
              />
            </View>
          ) : (
            <View style={styles.dateRow}>
              <TextInput
                style={[styles.dateInput, { marginRight: 8 }]}
                placeholder="Start YYYY-MM-DD"
                value={startDate}
                onChangeText={setStartDate}
              />
              <TextInput
                style={styles.dateInput}
                placeholder="End YYYY-MM-DD"
                value={endDate}
                onChangeText={setEndDate}
              />
            </View>
          )}

          {/* Lag stepper */}
          <Text style={styles.corrLabel}>Lag (days)</Text>
          <View style={styles.lagRow}>
            <TouchableOpacity
              style={[styles.lagBtn, lagDays === 0 && styles.lagBtnDisabled]}
              onPress={() => setLagDays(d => Math.max(0, d - 1))}
              disabled={lagDays === 0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="remove" size={16} color={lagDays === 0 ? '#d1d5db' : '#374151'} />
            </TouchableOpacity>
            <Text style={styles.lagValue}>{lagDays}</Text>
            <TouchableOpacity
              style={[styles.lagBtn, lagDays === 14 && styles.lagBtnDisabled]}
              onPress={() => setLagDays(d => Math.min(14, d + 1))}
              disabled={lagDays === 14}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="add" size={16} color={lagDays === 14 ? '#d1d5db' : '#374151'} />
            </TouchableOpacity>
            {lagDays > 0 && (
              <Text style={styles.lagHint}>B from {lagDays}d ago → today's A</Text>
            )}
          </View>

          {/* Run button */}
          <TouchableOpacity
            style={[styles.runBtn, (loading || selectedTypes.size < 2) && styles.runBtnOff]}
            onPress={run}
            disabled={loading || selectedTypes.size < 2}
          >
            {loading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.runBtnText}>Find Correlations</Text>}
          </TouchableOpacity>

          {error && <Text style={styles.corrError}>{error}</Text>}

          {/* Results */}
          {result && (
            <View style={styles.results}>
              {lagDays > 0 && (
                <Text style={styles.lagResultNote}>Lag: {lagDays}d — B values shifted {lagDays} day{lagDays !== 1 ? 's' : ''} into the past</Text>
              )}
              {Object.entries(windows).some(([t, w]) => selectedTypes.has(t) && w > 1) && (
                <Text style={styles.lagResultNote}>
                  {'Windows: ' + Array.from(selectedTypes)
                    .filter(t => getWindow(t) > 1)
                    .map(t => `${t} ${getWindow(t)}d sum`)
                    .join(', ')}
                </Text>
              )}
              {/* Table header */}
              <View style={[styles.tableRow, styles.tableHeaderRow]}>
                <Text style={[styles.cell, styles.cellPair, styles.headerText]}>Pair</Text>
                <Text style={[styles.cell, styles.headerText]}>r</Text>
                <Text style={[styles.cell, styles.headerText]}>p</Text>
                <Text style={[styles.cell, styles.headerText]}>n</Text>
                <Text style={[styles.cell, styles.headerText]}>Sig.</Text>
              </View>

              {result.pairs.map((pair, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.cell, styles.cellPair]} numberOfLines={2}>
                    {pair.type_a} / {pair.type_b}
                  </Text>
                  <Text style={styles.cell}>{pair.r !== null ? pair.r.toFixed(2) : '—'}</Text>
                  <Text style={styles.cell}>{pair.p_value !== null ? pair.p_value.toFixed(3) : '—'}</Text>
                  <Text style={styles.cell}>{pair.n}</Text>
                  <View style={styles.cell}>
                    {pair.warning
                      ? <Text style={styles.badgeWarn}>LOW</Text>
                      : pair.significant
                        ? <Text style={styles.badgeYes}>YES</Text>
                        : <Text style={styles.badgeNo}>NO</Text>}
                  </View>
                </View>
              ))}

              <View style={styles.interpretBox}>
                <Text style={styles.interpretText}>{result.interpretation}</Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);
    try {
      const { answer } = await analyzeData(question);
      setMessages((prev) => [...prev, { role: 'assistant', text: answer }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Could not reach the backend. Is it running?' },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
      >
        <CorrelationPanel />

        {messages.length === 0 && (
          <View>
            <Text style={styles.heading}>Ask about your data</Text>
            <Text style={styles.subheading}>Examples:</Text>
            {EXAMPLE_QUESTIONS.map((q) => (
              <TouchableOpacity key={q} style={styles.exampleChip} onPress={() => ask(q)}>
                <Text style={styles.exampleText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {messages.map((msg, i) => (
          <View
            key={i}
            style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}
          >
            <Text style={msg.role === 'user' ? styles.userText : styles.aiText}>{msg.text}</Text>
          </View>
        ))}

        {loading && (
          <View style={[styles.bubble, styles.aiBubble]}>
            <ActivityIndicator size="small" color="#6366f1" />
          </View>
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Ask a question about your data..."
          value={input}
          onChangeText={setInput}
          multiline
          onSubmitEditing={() => ask(input)}
          returnKeyType="send"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={() => ask(input)} disabled={loading}>
          <Text style={styles.sendText}>Ask</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  messages: { flex: 1 },
  messagesContent: { padding: 16, paddingBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 8 },
  subheading: { fontSize: 13, color: '#9ca3af', marginBottom: 8 },
  exampleChip: { backgroundColor: '#e0e7ff', borderRadius: 8, padding: 12, marginBottom: 8 },
  exampleText: { color: '#4338ca', fontSize: 14 },
  bubble: { maxWidth: '85%', borderRadius: 12, padding: 12, marginBottom: 10 },
  userBubble: { backgroundColor: '#6366f1', alignSelf: 'flex-end' },
  aiBubble: { backgroundColor: '#fff', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#e5e7eb' },
  userText: { color: '#fff', fontSize: 15 },
  aiText: { color: '#111827', fontSize: 15, lineHeight: 22 },
  inputRow: {
    flexDirection: 'row', padding: 12, borderTopWidth: 1,
    borderTopColor: '#e5e7eb', backgroundColor: '#fff', alignItems: 'flex-end', gap: 8,
  },
  input: {
    flex: 1, backgroundColor: '#f3f4f6', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 100,
  },
  sendBtn: { backgroundColor: '#6366f1', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  sendText: { color: '#fff', fontWeight: '700' },

  // Correlation panel
  corrPanel: {
    backgroundColor: '#fff', borderRadius: 12, marginBottom: 16,
    borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden',
  },
  corrHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 14,
  },
  corrTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  corrBody: { paddingHorizontal: 14, paddingBottom: 14 },
  corrLabel: { fontSize: 12, color: '#6b7280', marginBottom: 8, fontWeight: '600' },
  chipScroll: { marginBottom: 14 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#f3f4f6', marginRight: 8, borderWidth: 1, borderColor: '#e5e7eb',
  },
  chipOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  chipText: { fontSize: 13, color: '#6b7280', textTransform: 'capitalize' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  dateRow: { flexDirection: 'row', marginBottom: 12 },
  windowsSection: { marginBottom: 12 },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  windowLabel: { fontSize: 13, color: '#374151', fontWeight: '500', width: 90, textTransform: 'capitalize' },
  windowValue: { fontSize: 13, color: '#111827', fontWeight: '600', minWidth: 52, textAlign: 'center' },
  lagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  lagBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center',
  },
  lagBtnDisabled: { backgroundColor: '#f9fafb' },
  lagValue: { fontSize: 16, fontWeight: '700', color: '#111827', minWidth: 24, textAlign: 'center' },
  lagHint: { fontSize: 11, color: '#9ca3af', flex: 1 },
  lagResultNote: {
    fontSize: 11, color: '#6b7280', fontStyle: 'italic',
    marginBottom: 8, paddingHorizontal: 2,
  },
  dateInput: {
    flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#374151',
  },
  runBtn: {
    backgroundColor: '#6366f1', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', marginBottom: 4,
  },
  runBtnOff: { backgroundColor: '#a5b4fc' },
  runBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  corrError: { color: '#ef4444', fontSize: 13, marginTop: 8 },

  // Results table
  results: { marginTop: 12 },
  tableHeaderRow: { backgroundColor: '#f9fafb' },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  headerText: { fontWeight: '700', color: '#374151' },
  cell: { flex: 1, fontSize: 12, color: '#374151' },
  cellPair: { flex: 2 },
  badgeYes: {
    fontSize: 10, fontWeight: '700', color: '#059669',
    backgroundColor: '#d1fae5', paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 4, overflow: 'hidden',
  },
  badgeNo: {
    fontSize: 10, color: '#6b7280', backgroundColor: '#f3f4f6',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden',
  },
  badgeWarn: {
    fontSize: 10, color: '#d97706', backgroundColor: '#fef3c7',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden',
  },
  interpretBox: { marginTop: 12, padding: 12, backgroundColor: '#eef2ff', borderRadius: 8 },
  interpretText: { fontSize: 13, color: '#1e1b4b', lineHeight: 20 },
});
