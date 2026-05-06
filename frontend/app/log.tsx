import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { createLog, deleteLog, getCategories, getLogs, restoreCategory, ActivityLog } from '@/lib/api';

const BUILTIN_TYPES = ['sleep', 'exercise', 'caffeine'];

// Returns true if the new entry's time overlaps with an existing log.
// Entries with no end time are treated as points in time.
function overlapsLog(
  newStart: Date, newEnd: Date | null,
  log: ActivityLog,
): boolean {
  const eStart = new Date(log.started_at);
  const eEnd = log.ended_at ? new Date(log.ended_at) : null;
  if (newEnd && eEnd) return newStart < eEnd && eStart < newEnd;
  if (newEnd)         return eStart >= newStart && eStart < newEnd;
  if (eEnd)           return newStart >= eStart && newStart < eEnd;
  // Both are point-in-time — flag if within the same minute
  return Math.abs(newStart.getTime() - eStart.getTime()) < 60_000;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

type PickerState = { target: 'start' | 'end' | 'zero'; mode: 'date' | 'time' } | null;

// Defined at module level so React reuses the same DOM node across re-renders.
// If defined inside LogScreen, every render creates a new component reference,
// causing React to unmount/remount the <input> and close the browser's date picker.
function WebDateInput({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
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

function WebDateOnlyInput({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  if (Platform.OS !== 'web') return null;
  return (
    // @ts-ignore
    <input
      type="date"
      value={toLocalDateValue(value)}
      max={toLocalDateValue(new Date())}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        const d = new Date(e.target.value + 'T12:00:00');
        if (!isNaN(d.getTime())) onChange(d);
      }}
      style={{
        fontSize: 15, padding: 12, borderRadius: 8,
        border: '1px solid #d1d5db', backgroundColor: '#fff',
        color: '#111827', width: '100%', boxSizing: 'border-box',
      }}
    />
  );
}

export default function LogScreen() {
  const [activityType, setActivityType] = useState('');
  const [typeQuery, setTypeQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [knownTypes, setKnownTypes] = useState<string[]>(BUILTIN_TYPES);

  const [isDurationZero, setIsDurationZero] = useState(false);
  const [zeroDate, setZeroDate] = useState(new Date());

  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [hasEnd, setHasEnd] = useState(false);
  const [notes, setNotes] = useState('');
  const [quantityText, setQuantityText] = useState('');
  const [quantityUnit, setQuantityUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<PickerState>(null);

  type ConfirmState = {
    title: string;
    message: string;
    confirmLabel: string;
    destructive?: boolean;
    resolve: (v: boolean) => void;
  };
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  function showConfirm(title: string, message: string, confirmLabel: string, destructive = false): Promise<boolean> {
    return new Promise((resolve) => setConfirm({ title, message, confirmLabel, destructive, resolve }));
  }

  const typeInputRef = useRef<TextInput>(null);

  // Load active (non-hidden) categories from the backend on mount
  useEffect(() => {
    getCategories()
      .then((cats) => {
        const active = cats.filter((c) => !c.is_hidden).map((c) => c.name);
        const merged = [...new Set([...BUILTIN_TYPES, ...active])]
          .sort((a, b) => a.localeCompare(b));
        setKnownTypes(merged);
      })
      .catch(() => {}); // keep builtins if backend is unreachable
  }, []);

  // ── Category search logic ───────────────────────────────────────────────────

  const normalizedQuery = typeQuery.trim().toLowerCase();
  const filtered = normalizedQuery
    ? knownTypes.filter((t) => t.toLowerCase().includes(normalizedQuery))
    : knownTypes;
  const exactMatch = knownTypes.some((t) => t.toLowerCase() === normalizedQuery);
  const isNew = normalizedQuery.length > 0 && !exactMatch;

  const selectType = (type: string) => {
    setActivityType(type);
    setTypeQuery('');
    setShowDropdown(false);
  };

  const addNewType = () => {
    const name = typeQuery.trim();
    if (!name) return;
    if (knownTypes.some((t) => t.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Already exists', `"${knownTypes.find(t => t.toLowerCase() === name.toLowerCase())}" is already a category.`);
      return;
    }
    setKnownTypes(prev => [...prev, name].sort((a, b) => a.localeCompare(b)));
    selectType(name);
  };

  // ── Native picker handlers ──────────────────────────────────────────────────

  const openPicker = (target: 'start' | 'end') => {
    if (target === 'end' && !hasEnd) setEndDate(startDate);
    setPicker({ target, mode: 'date' });
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (!picker || !selected) { setPicker(null); return; }
    if (event.type === 'dismissed') { setPicker(null); return; }
    if (picker.target === 'zero') {
      // Keep the time at noon to avoid timezone edge cases
      const d = new Date(selected);
      d.setHours(12, 0, 0, 0);
      setZeroDate(d);
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

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!activityType) return Alert.alert('Please select an activity type.');

    // If this category was previously hidden, unhide it so it shows on the dashboard
    try { await restoreCategory(activityType); } catch {}

    const now = new Date();

    if (isDurationZero) {
      if (zeroDate > now) return Alert.alert('Invalid date', 'Date cannot be in the future.');
      // 0-min path: no overlap check, use zeroDate at noon for both start and end
      setSaving(true);
      try {
        await createLog({
          activity_type: activityType,
          started_at: zeroDate.toISOString(),
          ended_at: zeroDate.toISOString(),
          notes: notes.trim() || undefined,
          extra_data: quantityText.trim() ? { quantity: parseFloat(quantityText), unit: quantityUnit.trim() } : undefined,
        });
        Alert.alert('Saved!', 'Your activity has been logged.');
        setActivityType('');
        setIsDurationZero(false);
        setZeroDate(new Date());
        setNotes('');
        setQuantityText('');
        setQuantityUnit('');
      } catch {
        Alert.alert('Error', 'Could not save. Is the backend running?');
      } finally {
        setSaving(false);
      }
      return;
    }

    // ── Timed path: overlap check then save ────────────────────────────────
    if (startDate > now) return Alert.alert('Invalid time', 'Start time cannot be in the future.');
    if (hasEnd && endDate && endDate <= startDate) return Alert.alert('Invalid time', 'End time must be after start time.');

    try {
      const existing = await getLogs(activityType, 200);

      // ── 0-min override check ────────────────────────────────────────────
      const startDay = toLocalDateValue(startDate);
      const zeroEntry = existing.find(
        (log) => log.duration_minutes === 0 &&
          toLocalDateValue(new Date(log.started_at)) === startDay
      );
      if (zeroEntry) {
        const msg = `There's already a 0-min "${activityType}" entry on ${startDay}. Replace it with this timed entry?`;
        const replace = await showConfirm('0-min record exists', msg, 'Replace', true);
        if (!replace) return;
        try { await deleteLog(zeroEntry.id); } catch {}
      }

      // ── Time-overlap check ──────────────────────────────────────────────
      const newEnd = hasEnd ? endDate : null;
      const conflict = existing.find(
        (log) => log.duration_minutes !== 0 && overlapsLog(startDate, newEnd, log)
      );
      if (conflict) {
        const conflictTime = formatDateTime(new Date(conflict.started_at));
        const msg = `You already have a "${activityType}" entry at ${conflictTime} that overlaps with this time.`;
        const proceed = await showConfirm('Overlapping entry', msg, 'Replace');
        if (!proceed) return;
        try { await deleteLog(conflict.id); } catch {}
      }
    } catch {
      // If the check fails, proceed silently — don't block the save
    }

    setSaving(true);
    try {
      await createLog({
        activity_type: activityType,
        started_at: startDate.toISOString(),
        ended_at: hasEnd ? endDate?.toISOString() : undefined,
        notes: notes.trim() || undefined,
        extra_data: quantityText.trim() ? { quantity: parseFloat(quantityText), unit: quantityUnit.trim() } : undefined,
      });
      Alert.alert('Saved!', 'Your activity has been logged.');
      setActivityType('');
      setStartDate(new Date());
      setEndDate(null);
      setHasEnd(false);
      setNotes('');
      setQuantityText('');
      setQuantityUnit('');
    } catch {
      Alert.alert('Error', 'Could not save. Is the backend running?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Log an Activity</Text>

      {/* ── Activity type search ── */}
      <Text style={styles.label}>Activity Type</Text>

      {activityType ? (
        <View style={styles.selectedRow}>
          <View style={styles.selectedChip}>
            <Text style={styles.selectedChipText}>{activityType}</Text>
          </View>
          <TouchableOpacity onPress={() => { setActivityType(''); setShowDropdown(true); typeInputRef.current?.focus(); }}>
            <Text style={styles.changeText}>Change</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TextInput
          ref={typeInputRef}
          style={styles.input}
          placeholder="Search or type a new category..."
          placeholderTextColor="#9ca3af"
          value={typeQuery}
          onChangeText={(t) => { setTypeQuery(t); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => { setTimeout(() => setShowDropdown(false), 150); }}
          autoCorrect={false}
          autoCapitalize="none"
        />
      )}

      {showDropdown && !activityType && (
        <>
          {/* @ts-ignore — onMouseDown is web-only; preventDefault stops the input losing focus */}
          <View style={styles.dropdown} onMouseDown={(e: MouseEvent) => e.preventDefault()}>
            {/* Header row with X button */}
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownHeaderText}>Select category</Text>
              <TouchableOpacity onPress={() => setShowDropdown(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={18} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            {isNew && (
              <TouchableOpacity style={styles.dropdownNewRow} onPress={addNewType}>
                <Text style={styles.dropdownNewText}>Add "{typeQuery.trim()}"</Text>
              </TouchableOpacity>
            )}
            {filtered.length === 0 && !isNew && (
              <Text style={styles.dropdownEmpty}>No categories match.</Text>
            )}
            {filtered.map((type) => (
              <TouchableOpacity key={type} style={styles.dropdownRow} onPress={() => selectType(type)}>
                <Text style={styles.dropdownRowText}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* ── Timed / 0 min segmented control ── */}
      {activityType ? (
        <View style={styles.segmentedRow}>
          <TouchableOpacity
            style={[styles.segBtn, !isDurationZero && styles.segBtnOn]}
            onPress={() => setIsDurationZero(false)}
          >
            <Text style={[styles.segBtnText, !isDurationZero && styles.segBtnTextOn]}>Timed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segBtn, isDurationZero && styles.segBtnOn]}
            onPress={() => setIsDurationZero(true)}
          >
            <Text style={[styles.segBtnText, isDurationZero && styles.segBtnTextOn]}>0 min</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isDurationZero ? (
        /* ── 0-min path: date only ── */
        <>
          <Text style={styles.label}>Date</Text>
          {Platform.OS === 'web' ? (
            <WebDateOnlyInput value={zeroDate} onChange={setZeroDate} />
          ) : (
            <TouchableOpacity style={styles.dateBtn} onPress={() => setPicker({ target: 'zero', mode: 'date' })}>
              <Text style={styles.dateBtnText}>
                {zeroDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        /* ── Timed path ── */
        <>
          <Text style={styles.label}>Start Time</Text>
          {Platform.OS === 'web' ? (
            <WebDateInput value={startDate} onChange={setStartDate} />
          ) : (
            <TouchableOpacity style={styles.dateBtn} onPress={() => openPicker('start')}>
              <Text style={styles.dateBtnText}>{formatDateTime(startDate)}</Text>
            </TouchableOpacity>
          )}

          <View style={styles.endRow}>
            <Text style={styles.label}>End Time</Text>
            {!hasEnd && (
              <TouchableOpacity onPress={() => { setHasEnd(true); setEndDate(startDate); }} style={styles.toggle}>
                <Text style={styles.toggleText}>+ Add</Text>
              </TouchableOpacity>
            )}
          </View>
          {hasEnd && (
            <View style={styles.endInputRow}>
              {Platform.OS === 'web' ? (
                <WebDateInput value={endDate ?? new Date()} onChange={setEndDate} />
              ) : (
                <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => openPicker('end')}>
                  <Text style={styles.dateBtnText}>
                    {endDate ? formatDateTime(endDate) : 'Tap to set'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => { setHasEnd(false); setEndDate(null); }}
                style={styles.endRemoveBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={20} color="#9ca3af" />
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {/* ── Quantity ── */}
      <Text style={styles.label}>Quantity (optional)</Text>
      <View style={styles.quantityRow}>
        <TextInput
          style={[styles.input, styles.quantityInput]}
          placeholder="Amount"
          placeholderTextColor="#9ca3af"
          value={quantityText}
          onChangeText={setQuantityText}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.input, styles.unitInput]}
          placeholder="Unit"
          placeholderTextColor="#9ca3af"
          value={quantityUnit}
          onChangeText={setQuantityUnit}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <View style={styles.unitChips}>
        {['mg', 'g', 'ml', 'L', 'tablets', 'capsules', 'cups', 'oz'].map((u) => (
          <TouchableOpacity
            key={u}
            style={[styles.unitChip, quantityUnit === u && styles.unitChipOn]}
            onPress={() => setQuantityUnit((prev) => (prev === u ? '' : u))}
          >
            <Text style={[styles.unitChipText, quantityUnit === u && styles.unitChipTextOn]}>{u}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Notes ── */}
      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        placeholder=""
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Entry</Text>}
      </TouchableOpacity>

      {picker && Platform.OS !== 'web' && (
        <DateTimePicker
          value={picker.target === 'zero' ? zeroDate : picker.target === 'start' ? startDate : (endDate ?? new Date())}
          mode={picker.mode}
          maximumDate={new Date()}
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={onPickerChange}
        />
      )}

      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => { confirm?.resolve(false); setConfirm(null); }}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>{confirm?.title}</Text>
            <Text style={styles.confirmMessage}>{confirm?.message}</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => { confirm?.resolve(false); setConfirm(null); }}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmActionBtn, confirm?.destructive ? styles.confirmDestructive : styles.confirmPrimary]}
                onPress={() => { confirm?.resolve(true); setConfirm(null); }}
              >
                <Text style={styles.confirmActionText}>{confirm?.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 20, color: '#111827' },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 16 },

  // Category selector
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectedChip: { backgroundColor: '#6366f1', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  selectedChipText: { color: '#fff', fontWeight: '600', textTransform: 'capitalize' },
  changeText: { color: '#6366f1', fontWeight: '600', fontSize: 13 },

  dropdown: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    marginTop: 4,
    maxHeight: 220,
    overflow: 'hidden',
    zIndex: 10,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  dropdownHeaderText: { fontSize: 12, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 },
  dropdownRow: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  dropdownRowText: { fontSize: 15, color: '#111827', textTransform: 'capitalize' },
  dropdownNewRow: { paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#eef2ff', borderBottomWidth: 1, borderBottomColor: '#d1d5db' },
  dropdownNewText: { fontSize: 15, color: '#6366f1', fontWeight: '600' },
  dropdownEmpty: { padding: 14, color: '#9ca3af', fontSize: 14 },

  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    padding: 12,
    fontSize: 15,
    color: '#111827',
  },
  notesInput: { height: 90, textAlignVertical: 'top' },
  dateBtn: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', padding: 12 },
  dateBtnText: { fontSize: 15, color: '#111827' },
  endRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  endInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  endRemoveBtn: { paddingLeft: 4 },
  toggle: { marginTop: 16 },
  toggleText: { fontSize: 13, color: '#6366f1', fontWeight: '600' },
  saveBtn: { backgroundColor: '#6366f1', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 28 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Quantity input
  quantityRow: { flexDirection: 'row', gap: 8 },
  quantityInput: { flex: 2 },
  unitInput: { flex: 1 },
  unitChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  unitChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb',
  },
  unitChipOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  unitChipText: { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  unitChipTextOn: { color: '#fff' },

  // Timed / 0 min segmented control
  segmentedRow: {
    flexDirection: 'row', marginTop: 14, marginBottom: 2,
    backgroundColor: '#f3f4f6', borderRadius: 7, padding: 2,
    alignSelf: 'flex-start',
  },
  segBtn: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 5, alignItems: 'center' },
  segBtnOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 1, elevation: 1 },
  segBtnText: { fontSize: 12, fontWeight: '500', color: '#9ca3af' },
  segBtnTextOn: { color: '#374151', fontWeight: '600' },

  // Confirm modal
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmBox: { backgroundColor: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 360 },
  confirmTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  confirmMessage: { fontSize: 14, color: '#4b5563', lineHeight: 21, marginBottom: 24 },
  confirmButtons: { flexDirection: 'row', gap: 10 },
  confirmCancelBtn: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  confirmCancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  confirmActionBtn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  confirmPrimary: { backgroundColor: '#6366f1' },
  confirmDestructive: { backgroundColor: '#ef4444' },
  confirmActionText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
