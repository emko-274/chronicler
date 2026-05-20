import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { getCategories, getLogs, ActivityLog } from '@/lib/api';
import {
  EXPORT_COLUMNS,
  DEFAULT_COLUMNS,
  buildCSV,
  downloadCSV,
  downloadXLSX,
} from '@/lib/exportUtils';

const dateInputStyle: React.CSSProperties = {
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  backgroundColor: '#fff',
  color: '#111827',
  width: '100%',
  boxSizing: 'border-box',
};

export default function ExportScreen() {
  const [allLogs, setAllLogs] = useState<ActivityLog[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set(DEFAULT_COLUMNS));
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv');

  useEffect(() => {
    getCategories()
      .then((cats) => {
        const active = cats.filter((c) => !c.is_hidden).map((c) => c.name);
        setCategories(active);
        setSelectedTypes(new Set(active));
      })
      .catch(() => {});

    getLogs(undefined, 5000)
      .then(setAllLogs)
      .catch(() => {});
  }, []);

  const filteredLogs = allLogs.filter((log) => {
    if (!selectedTypes.has(log.activity_type)) return false;
    if (startDate && new Date(log.started_at) < new Date(startDate)) return false;
    if (endDate && new Date(log.started_at) > new Date(endDate + 'T23:59:59')) return false;
    return true;
  });

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const allTypesSelected = categories.every((t) => selectedTypes.has(t));
  const toggleAllTypes = () =>
    setSelectedTypes(allTypesSelected ? new Set() : new Set(categories));

  const cols = EXPORT_COLUMNS.filter((c) => selectedColumns.has(c.key));
  const filename = `activity_logs_${new Date().toISOString().slice(0, 10)}`;

  const handleExport = async () => {
    if (filteredLogs.length === 0) {
      Alert.alert('No data', 'No entries match the current filters.');
      return;
    }
    if (cols.length === 0) {
      Alert.alert('No columns', 'Select at least one column to export.');
      return;
    }
    if (Platform.OS !== 'web') {
      Alert.alert('Web only', 'Open the app in a browser to download files.');
      return;
    }
    if (exportFormat === 'xlsx') {
      await downloadXLSX(filteredLogs, cols, `${filename}.xlsx`);
    } else {
      downloadCSV(buildCSV(filteredLogs, cols), `${filename}.csv`);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Export Data</Text>

      {/* ── Activity types ── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionHeading}>Activity Types</Text>
        <TouchableOpacity onPress={toggleAllTypes}>
          <Text style={styles.toggleAll}>{allTypesSelected ? 'Deselect all' : 'Select all'}</Text>
        </TouchableOpacity>
      </View>
      {categories.length === 0 ? (
        <Text style={styles.hint}>No categories found.</Text>
      ) : (
        <View style={styles.chips}>
          {categories.map((type) => {
            const on = selectedTypes.has(type);
            return (
              <TouchableOpacity
                key={type}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => toggleType(type)}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{type}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── Date range ── */}
      <Text style={styles.sectionHeading}>Date Range</Text>
      {Platform.OS === 'web' ? (
        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <Text style={styles.dateLabel}>From</Text>
            {/* @ts-ignore */}
            <input
              type="date"
              value={startDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)}
              style={dateInputStyle}
            />
          </View>
          <View style={styles.dateField}>
            <Text style={styles.dateLabel}>To</Text>
            {/* @ts-ignore */}
            <input
              type="date"
              value={endDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndDate(e.target.value)}
              style={dateInputStyle}
            />
          </View>
        </View>
      ) : (
        <Text style={styles.hint}>Date filtering is available on web.</Text>
      )}

      {/* ── Columns ── */}
      <Text style={styles.sectionHeading}>Columns</Text>
      {EXPORT_COLUMNS.map((col) => {
        const on = selectedColumns.has(col.key);
        return (
          <TouchableOpacity key={col.key} style={styles.checkRow} onPress={() => toggleColumn(col.key)}>
            <View style={[styles.checkbox, on && styles.checkboxOn]}>
              {on && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>{col.label}</Text>
            {!col.defaultOn && (
              <Text style={styles.checkHint}>advanced</Text>
            )}
          </TouchableOpacity>
        );
      })}

      {/* ── Format + Export ── */}
      <View style={styles.footer}>
        <Text style={styles.previewText}>
          {filteredLogs.length} {filteredLogs.length === 1 ? 'entry' : 'entries'}
        </Text>
        <View style={styles.footerActions}>
          <View style={styles.formatToggle}>
            {(['csv', 'xlsx'] as const).map(fmt => (
              <TouchableOpacity
                key={fmt}
                style={[styles.formatBtn, exportFormat === fmt && styles.formatBtnOn]}
                onPress={() => setExportFormat(fmt)}
              >
                <Text style={[styles.formatBtnText, exportFormat === fmt && styles.formatBtnTextOn]}>
                  {fmt.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.exportBtn, filteredLogs.length === 0 && styles.exportBtnOff]}
            onPress={handleExport}
            disabled={filteredLogs.length === 0}
          >
            <Text style={styles.exportBtnText}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 48 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 20, color: '#111827' },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 },
  sectionHeading: { fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
  toggleAll: { fontSize: 13, color: '#6366f1', fontWeight: '600', marginTop: 20 },
  hint: { fontSize: 13, color: '#9ca3af' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  chipOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  chipText: { fontSize: 13, color: '#6b7280', textTransform: 'capitalize' },
  chipTextOn: { color: '#fff', fontWeight: '600' },

  dateRow: { flexDirection: 'row', gap: 12 },
  dateField: { flex: 1 },
  dateLabel: { fontSize: 12, color: '#6b7280', marginBottom: 4 },

  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  checkLabel: { fontSize: 15, color: '#111827', flex: 1 },
  checkHint: { fontSize: 11, color: '#d1d5db', fontWeight: '500' },

  footer: { marginTop: 28, gap: 10 },
  previewText: { fontSize: 14, color: '#6b7280' },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  formatToggle: {
    flexDirection: 'row', borderRadius: 8, borderWidth: 1,
    borderColor: '#e5e7eb', overflow: 'hidden', backgroundColor: '#f3f4f6',
  },
  formatBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  formatBtnOn: { backgroundColor: '#6366f1' },
  formatBtnText: { fontSize: 13, fontWeight: '700', color: '#6b7280' },
  formatBtnTextOn: { color: '#fff' },

  exportBtn: { flex: 1, backgroundColor: '#6366f1', padding: 12, borderRadius: 10, alignItems: 'center' },
  exportBtnOff: { backgroundColor: '#c7d2fe' },
  exportBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
