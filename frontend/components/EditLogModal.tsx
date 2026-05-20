import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Modal, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { updateLog } from '@/lib/api';

export interface EditableLog {
  id: string;
  activity_type: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  notes: string | null;
  extra_data: Record<string, unknown> | null;
}

// ── Date/time helpers ──────────────────────────────────────────────────────

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function toLocalDateValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

type PickerState = { target: 'start' | 'end' | 'date_only'; mode: 'date' | 'time' } | null;

// Must be at module level — if defined inside EditLogModal, React remounts the
// <input> on every render, closing the browser's native date picker immediately.
function EditDateInput({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  if (Platform.OS !== 'web') return null;
  return (
    // @ts-ignore — plain HTML input is valid on web
    <input
      type="datetime-local"
      value={toLocalInputValue(value)}
      max={toLocalInputValue(new Date())}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(new Date(e.target.value))}
      style={{
        fontSize: 15, padding: 12, borderRadius: 8,
        border: '1px solid #d1d5db', backgroundColor: '#fff',
        color: '#111827', width: '100%', boxSizing: 'border-box',
      }}
    />
  );
}

function EditDateOnlyInput({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  if (Platform.OS !== 'web') return null;
  return (
    // @ts-ignore
    <input
      type="date"
      value={toLocalDateValue(value)}
      max={toLocalDateValue(new Date())}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        const d = new Date(e.target.value + 'T12:00:00');
        onChange(d);
      }}
      style={{
        fontSize: 15, padding: 12, borderRadius: 8,
        border: '1px solid #d1d5db', backgroundColor: '#fff',
        color: '#111827', width: '100%', boxSizing: 'border-box',
      }}
    />
  );
}

// ── Unit picker ────────────────────────────────────────────────────────────

const PRESET_UNITS = ['µg', 'mg', 'g', 'kg', 'ml', 'L', 'bpm', 'rpm', 'ppm', 'mmHg', '%', 'dB'];

function UnitPicker({ value, onChange }: { value: string; onChange: (u: string) => void }) {
  const [open, setOpen] = useState(false);
  const [customUnits, setCustomUnits] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const allUnits = [...PRESET_UNITS, ...customUnits];

  const addCustom = () => {
    const u = draft.trim();
    if (!u) return;
    if (!allUnits.some((x) => x.toLowerCase() === u.toLowerCase())) {
      setCustomUnits((prev) => [...prev, u]);
    }
    onChange(u);
    setDraft('');
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity style={up.btn} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={value ? up.btnText : up.btnPlaceholder} numberOfLines={1}>
          {value || 'Unit'}
        </Text>
        <Ionicons name="chevron-down" size={13} color="#9ca3af" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={up.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={up.sheet} onStartShouldSetResponder={() => true}>
            <View style={up.sheetHeader}>
              <Text style={up.sheetTitle}>Select Unit</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={18} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                style={[up.option, value === '' && up.optionOn]}
                onPress={() => { onChange(''); setOpen(false); }}
              >
                <Text style={[up.optionText, value === '' && up.optionTextOn]}>None</Text>
                {value === '' && <Ionicons name="checkmark" size={16} color="#6366f1" />}
              </TouchableOpacity>
              {allUnits.map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[up.option, value === u && up.optionOn]}
                  onPress={() => { onChange(u); setOpen(false); }}
                >
                  <Text style={[up.optionText, value === u && up.optionTextOn]}>{u}</Text>
                  {value === u && <Ionicons name="checkmark" size={16} color="#6366f1" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={up.customRow}>
              <TextInput
                style={up.customInput}
                placeholder="Add custom unit…"
                placeholderTextColor="#9ca3af"
                value={draft}
                onChangeText={setDraft}
                autoCorrect={false}
                autoCapitalize="none"
                onSubmitEditing={addCustom}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[up.customAddBtn, !draft.trim() && up.customAddBtnOff]}
                onPress={addCustom}
              >
                <Text style={up.customAddText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const up = StyleSheet.create({
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db',
    paddingHorizontal: 12, paddingVertical: 12, gap: 4,
  },
  btnText: { fontSize: 15, color: '#111827', flex: 1 },
  btnPlaceholder: { fontSize: 15, color: '#9ca3af', flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { backgroundColor: '#fff', borderRadius: 16, width: '100%', maxWidth: 360, overflow: 'hidden' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f9fafb',
  },
  optionOn: { backgroundColor: '#eef2ff' },
  optionText: { fontSize: 15, color: '#374151' },
  optionTextOn: { color: '#6366f1', fontWeight: '600' },
  customRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6', backgroundColor: '#f9fafb',
  },
  customInput: {
    flex: 1, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db',
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: '#111827',
  },
  customAddBtn: { backgroundColor: '#6366f1', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  customAddBtnOff: { backgroundColor: '#e5e7eb' },
  customAddText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});

// ── Modal ──────────────────────────────────────────────────────────────────

export default function EditLogModal({
  log,
  onClose,
  onSave,
}: {
  log: EditableLog | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [activityType, setActivityType] = useState('');
  const [hasStart, setHasStart] = useState(true);
  const [entryDate, setEntryDate] = useState(new Date());
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState('');
  const [showQuantity, setShowQuantity] = useState(false);
  const [quantityText, setQuantityText] = useState('');
  const [quantityUnit, setQuantityUnit] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<PickerState>(null);

  useEffect(() => {
    if (!log) return;
    setActivityType(log.activity_type);
    const timeless = log.extra_data?.untimed === true || log.extra_data?.zero === true;
    setHasStart(!timeless);
    const started = new Date(log.started_at);
    if (timeless) {
      setEntryDate(started);
    } else {
      setStartDate(started);
      setEndDate(log.ended_at ? new Date(log.ended_at) : null);
    }
    setNotes(log.notes ?? '');
    const qty = log.extra_data?.quantity;
    if (typeof qty === 'number') {
      setShowQuantity(true);
      setQuantityText(qty % 1 === 0 ? qty.toFixed(0) : String(qty));
      setQuantityUnit(String(log.extra_data?.unit ?? ''));
    } else {
      setShowQuantity(false);
      setQuantityText('');
      setQuantityUnit('');
    }
    setTags(Array.isArray(log.extra_data?.tags) ? (log.extra_data.tags as string[]) : []);
    setTagInput('');
  }, [log?.id]);

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (!picker || !selected) { setPicker(null); return; }
    if (event.type === 'dismissed') { setPicker(null); return; }
    if (picker.target === 'date_only') {
      const d = new Date(selected);
      d.setHours(12, 0, 0, 0);
      setEntryDate(d);
      setPicker(null);
      return;
    }
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
    if (hasStart && endDate && endDate <= startDate) {
      Alert.alert('Invalid time', 'End time must be after start time.');
      return;
    }
    const quantityExtra = showQuantity && quantityText.trim()
      ? { quantity: parseFloat(quantityText), unit: quantityUnit.trim() }
      : null;
    const tagsExtra = tags.length > 0 ? { tags } : null;
    setSaving(true);
    try {
      if (!hasStart) {
        const d = new Date(entryDate);
        d.setHours(12, 0, 0, 0);
        await updateLog(log.id, {
          activity_type: activityType,
          started_at: d.toISOString(),
          ended_at: null,
          notes: notes.trim() || null,
          extra_data: { zero: true, ...(tagsExtra ?? {}), ...(quantityExtra ?? {}) },
        });
      } else {
        await updateLog(log.id, {
          activity_type: activityType,
          started_at: startDate.toISOString(),
          ended_at: endDate ? endDate.toISOString() : null,
          notes: notes.trim() || null,
          extra_data: (tagsExtra || quantityExtra)
            ? { ...(tagsExtra ?? {}), ...(quantityExtra ?? {}) }
            : null,
        });
      }
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
        style={st.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={st.sheet}>
          <View style={st.header}>
            <Text style={st.title}>Edit Entry</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#374151" />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={st.label}>Activity Type</Text>
            <TextInput
              style={st.input}
              value={activityType}
              onChangeText={setActivityType}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {!hasStart ? (
              <>
                <Text style={st.label}>Date</Text>
                {Platform.OS === 'web' ? (
                  <EditDateOnlyInput value={entryDate} onChange={setEntryDate} />
                ) : (
                  <TouchableOpacity
                    style={st.dateBtn}
                    onPress={() => setPicker({ target: 'date_only', mode: 'date' })}
                  >
                    <Text style={st.dateBtnText}>
                      {entryDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                  </TouchableOpacity>
                )}
                <View style={st.endRow}>
                  <Text style={st.label}>Start Time</Text>
                  <TouchableOpacity onPress={() => setHasStart(true)}>
                    <Text style={st.addEndText}>+ Add</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={st.endRow}>
                  <Text style={st.label}>Start Time</Text>
                </View>
                <View style={[st.endRow, { alignItems: 'stretch' }]}>
                  {Platform.OS === 'web' ? (
                    <View style={{ flex: 1 }}>
                      <EditDateInput value={startDate} onChange={setStartDate} />
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[st.dateBtn, { flex: 1 }]}
                      onPress={() => setPicker({ target: 'start', mode: 'date' })}
                    >
                      <Text style={st.dateBtnText}>{formatDateTime(startDate)}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => { setHasStart(false); setEndDate(null); }}
                    style={st.removeEndBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={20} color="#9ca3af" />
                  </TouchableOpacity>
                </View>

                <Text style={st.label}>End Time</Text>
                {endDate !== null ? (
                  <View style={st.endRow}>
                    {Platform.OS === 'web' ? (
                      <View style={{ flex: 1 }}>
                        <EditDateInput value={endDate} onChange={setEndDate} />
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[st.dateBtn, { flex: 1 }]}
                        onPress={() => setPicker({ target: 'end', mode: 'date' })}
                      >
                        <Text style={st.dateBtnText}>{formatDateTime(endDate)}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => setEndDate(null)}
                      style={st.removeEndBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={20} color="#9ca3af" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setEndDate(new Date())}>
                    <Text style={st.addEndText}>+ Add end time</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            <View style={st.endRow}>
              <Text style={st.label}>Quantity</Text>
              {!showQuantity && (
                <TouchableOpacity onPress={() => setShowQuantity(true)}>
                  <Text style={st.addEndText}>+ Add</Text>
                </TouchableOpacity>
              )}
            </View>
            {showQuantity && (
              <View style={st.quantityRow}>
                <TextInput
                  style={[st.input, { flex: 1 }]}
                  placeholder="Amount"
                  placeholderTextColor="#9ca3af"
                  value={quantityText}
                  onChangeText={setQuantityText}
                  keyboardType="decimal-pad"
                />
                <UnitPicker value={quantityUnit} onChange={setQuantityUnit} />
                <TouchableOpacity
                  onPress={() => { setShowQuantity(false); setQuantityText(''); setQuantityUnit(''); }}
                  style={st.removeEndBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={20} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            )}

            <Text style={st.label}>Tags</Text>
            <View style={st.tagsContainer}>
              {tags.map(tag => (
                <View key={tag} style={st.tagChip}>
                  <Text style={st.tagChipText}>{tag}</Text>
                  <TouchableOpacity onPress={() => setTags(t => t.filter(x => x !== tag))} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
                    <Ionicons name="close" size={11} color="#6366f1" />
                  </TouchableOpacity>
                </View>
              ))}
              <TextInput
                style={st.tagInput}
                placeholder={tags.length === 0 ? 'Type a tag…' : 'Add another…'}
                placeholderTextColor="#9ca3af"
                value={tagInput}
                onChangeText={(t) => {
                  if (t.endsWith(',')) {
                    const tag = t.slice(0, -1).trim();
                    if (tag && !tags.includes(tag)) setTags(prev => [...prev, tag]);
                    setTagInput('');
                    return;
                  }
                  setTagInput(t);
                }}
                onSubmitEditing={() => {
                  const t = tagInput.trim();
                  if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
                  setTagInput('');
                }}
                returnKeyType="done"
                blurOnSubmit={false}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>

            <Text style={st.label}>Notes</Text>
            <TextInput
              style={[st.input, st.notesInput]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Optional notes..."
              placeholderTextColor="#9ca3af"
            />
          </ScrollView>

          <TouchableOpacity style={st.saveBtn} onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={st.saveBtnText}>Save Changes</Text>}
          </TouchableOpacity>

          {picker && Platform.OS !== 'web' && (
            <DateTimePicker
              value={
                picker.target === 'date_only' ? entryDate
                  : picker.target === 'start' ? startDate
                  : (endDate ?? new Date())
              }
              mode={picker.target === 'date_only' ? 'date' : picker.mode}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={onPickerChange}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
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
  quantityRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  addEndText: { fontSize: 14, color: '#6366f1', fontWeight: '600', paddingVertical: 10 },
  saveBtn: {
    backgroundColor: '#6366f1', padding: 16, borderRadius: 10,
    alignItems: 'center', marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  tagsContainer: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db',
    padding: 8, minHeight: 44, alignItems: 'center',
  },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#eef2ff', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  tagChipText: { fontSize: 13, color: '#4f46e5', fontWeight: '500' },
  tagInput: { fontSize: 14, color: '#111827', flex: 1, minWidth: 80, height: 32, paddingVertical: 4 },
});
