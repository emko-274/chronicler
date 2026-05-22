import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCategories, hideCategory, deleteCategoryData, restoreCategory, renameCategory, markPrivate, unmarkPrivate, updatePublicLinkColors, Category } from '@/lib/api';

const BUILTIN_TYPES = ['sleep'];

const COLOR_OPTIONS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#64748b', // slate
];

const TYPE_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6',
];

const COLORS_KEY = 'activity-tracker:type-colors';
const ORDER_KEY  = 'activity-tracker:type-order';

function loadColors(): Record<string, string> {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(COLORS_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveColors(colors: Record<string, string>) {
  if (typeof window !== 'undefined') localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
}

function loadTypeOrder(): string[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(ORDER_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTypeOrder(order: string[]) {
  if (typeof window !== 'undefined') localStorage.setItem(ORDER_KEY, JSON.stringify(order));
}

function effectiveColor(name: string, customColors: Record<string, string>, typeOrder: string[]): string {
  if (customColors[name]) return customColors[name];
  const idx = typeOrder.indexOf(name);
  return TYPE_COLORS[(idx >= 0 ? idx : 0) % TYPE_COLORS.length];
}

/** Cross-platform confirmation: window.confirm on web, Alert on native. */
function ask(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function ManageScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [customColors, setCustomColors] = useState<Record<string, string>>({});
  const [typeOrder, setTypeOrder] = useState<string[]>([]);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await getCategories();
      setCategories(data);
      const stored = loadTypeOrder();
      const storedColors = loadColors();
      const names = data.map(c => c.name);
      const merged = [...stored, ...names.filter(n => !stored.includes(n))];
      if (merged.length !== stored.length) {
        setTypeOrder(merged);
        saveTypeOrder(merged);
      }
      // Auto-assign palette colors by name so reordering doesn't change them
      const newColors = { ...storedColors };
      let changed = false;
      merged.forEach((name, idx) => {
        if (!newColors[name]) {
          newColors[name] = TYPE_COLORS[idx % TYPE_COLORS.length];
          changed = true;
        }
      });
      if (changed) {
        setCustomColors(newColors);
        saveColors(newColors);
      }
    } catch {
      Alert.alert('Error', 'Could not load categories.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setCustomColors(loadColors());
      setTypeOrder(loadTypeOrder());
      load();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const setColor = (name: string, color: string) => {
    const next = { ...customColors, [name]: color };
    setCustomColors(next);
    saveColors(next);
    updatePublicLinkColors(next).catch(() => {});
  };

  const togglePrivate = async (cat: Category) => {
    try {
      if (cat.is_private) await unmarkPrivate(cat.name);
      else await markPrivate(cat.name);
      await load();
    } catch {
      Alert.alert('Error', 'Could not update privacy setting.');
    }
  };

  const startRename = (cat: Category) => {
    setRenamingCat(cat.name);
    setRenameText(cat.name);
    setColorPickerOpen(null);
  };

  const cancelRename = () => {
    setRenamingCat(null);
    setRenameText('');
  };

  const doRename = async (oldName: string) => {
    const newName = renameText.trim();
    if (!newName || newName === oldName) { cancelRename(); return; }
    setRenameLoading(true);
    try {
      await renameCategory(oldName, newName);
      // migrate custom color to new name
      if (customColors[oldName]) {
        const next = { ...customColors, [newName]: customColors[oldName] };
        delete next[oldName];
        setCustomColors(next);
        saveColors(next);
      }
      setRenamingCat(null);
      setRenameText('');
      await load();
    } catch {
      Alert.alert('Error', 'Could not rename category.');
    } finally {
      setRenameLoading(false);
    }
  };

  const confirmHide = async (cat: Category) => {
    if (!await ask(
      `Remove label "${cat.name}"?`,
      'The category will be hidden from the app. All log data will be preserved.'
    )) return;
    try {
      await hideCategory(cat.name);
      await load();
    } catch {
      Alert.alert('Error', 'Could not hide category.');
    }
  };

  const confirmDeleteData = async (cat: Category) => {
    if (!await ask(
      `Delete all data for "${cat.name}"?`,
      `This will permanently delete all ${cat.log_count} log ${cat.log_count === 1 ? 'entry' : 'entries'} for this category. This cannot be undone.`
    )) return;
    try {
      await deleteCategoryData(cat.name);
      await load();
    } catch {
      Alert.alert('Error', 'Could not delete category data.');
    }
  };

  const confirmRestore = async (cat: Category) => {
    if (!await ask(
      `Restore "${cat.name}"?`,
      'This category will become visible in the app again.'
    )) return;
    try {
      await restoreCategory(cat.name);
      await load();
    } catch {
      Alert.alert('Error', 'Could not restore category.');
    }
  };

  const visible = categories.filter((c) => !c.is_hidden);
  const hidden = categories.filter(
    (c) => c.is_hidden && (c.log_count > 0 || BUILTIN_TYPES.includes(c.name))
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.heading}>Manage Categories</Text>

      <Text style={styles.sectionHeading}>Active</Text>
      {visible.length === 0 && (
        <Text style={styles.empty}>No active categories.</Text>
      )}
      {visible.map((cat) => {
        const isRenaming = renamingCat === cat.name;
        const currentColor = effectiveColor(cat.name, customColors, typeOrder);
        const pickerOpen = colorPickerOpen === cat.name;
        return (
          <View key={cat.name} style={styles.card}>
            <View style={styles.cardHeader}>
              {isRenaming ? (
                <TextInput
                  style={styles.renameInput}
                  value={renameText}
                  onChangeText={setRenameText}
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={() => doRename(cat.name)}
                />
              ) : (
                <Text style={styles.cardName}>{cat.name}</Text>
              )}
              <View style={styles.cardHeaderRight}>
                {isRenaming ? (
                  <>
                    <TouchableOpacity onPress={cancelRename} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={18} color="#9ca3af" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => doRename(cat.name)} disabled={renameLoading} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      {renameLoading
                        ? <ActivityIndicator size="small" color="#6366f1" />
                        : <Ionicons name="checkmark" size={18} color="#6366f1" />}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.cardCount}>
                      {cat.log_count} {cat.log_count === 1 ? 'entry' : 'entries'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setColorPickerOpen(pickerOpen ? null : cat.name)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <View style={[styles.colorDot, { backgroundColor: currentColor }, pickerOpen && styles.colorDotActive]} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => togglePrivate(cat)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons
                        name={cat.is_private ? 'lock-closed' : 'lock-open-outline'}
                        size={15}
                        color={cat.is_private ? '#6366f1' : '#9ca3af'}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => startRename(cat)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="pencil-outline" size={15} color="#9ca3af" />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
            {pickerOpen && !isRenaming && (
              <View style={styles.swatchRow}>
                {COLOR_OPTIONS.map(color => (
                  <TouchableOpacity
                    key={color}
                    onPress={() => setColor(cat.name, color)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <View style={[styles.swatch, { backgroundColor: color }]}>
                      {currentColor === color && (
                        <Ionicons name="checkmark" size={12} color="#fff" />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {!isRenaming && (
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnSecondary]}
                  onPress={() => confirmHide(cat)}
                >
                  <Text style={styles.actionBtnSecondaryText}>Remove label</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnDanger]}
                  onPress={() => confirmDeleteData(cat)}
                >
                  <Text style={styles.actionBtnDangerText}>Delete data</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {hidden.length > 0 && (
        <>
          <Text style={[styles.sectionHeading, { marginTop: 28 }]}>Hidden</Text>
          <Text style={styles.sectionSubtitle}>
            These categories are hidden from the app. Their data is preserved.
          </Text>
          {hidden.map((cat) => (
            <View key={cat.name} style={[styles.card, styles.cardHidden]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardName, styles.cardNameHidden]}>{cat.name}</Text>
                <Text style={styles.cardCount}>
                  {cat.log_count} {cat.log_count === 1 ? 'entry' : 'entries'}
                </Text>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                  onPress={() => confirmRestore(cat)}
                >
                  <Text style={styles.actionBtnPrimaryText}>Restore</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnDanger]}
                  onPress={() => confirmDeleteData(cat)}
                >
                  <Text style={styles.actionBtnDangerText}>Delete data</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 20, color: '#111827' },
  sectionHeading: { fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  sectionSubtitle: { fontSize: 13, color: '#9ca3af', marginBottom: 10, marginTop: -6 },
  empty: { color: '#9ca3af', fontSize: 14, marginBottom: 12 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
    marginBottom: 10,
  },
  cardHidden: { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardName: { fontSize: 16, fontWeight: '600', color: '#111827', flex: 1 },
  cardNameHidden: { color: '#9ca3af' },
  cardCount: { fontSize: 13, color: '#9ca3af' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  renameInput: {
    flex: 1, fontSize: 16, fontWeight: '600', color: '#111827',
    borderBottomWidth: 1.5, borderBottomColor: '#6366f1',
    paddingVertical: 2, marginRight: 8,
  },

  colorDot: { width: 14, height: 14, borderRadius: 7 },
  colorDotActive: { borderWidth: 2, borderColor: '#111827' },

  swatchRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingVertical: 10, paddingHorizontal: 2, marginBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  swatch: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },

  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  actionBtnSecondary: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  actionBtnSecondaryText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  actionBtnDanger: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  actionBtnDangerText: { fontSize: 13, fontWeight: '600', color: '#dc2626' },
  actionBtnPrimary: { backgroundColor: '#eef2ff', borderWidth: 1, borderColor: '#c7d2fe' },
  actionBtnPrimaryText: { fontSize: 13, fontWeight: '600', color: '#6366f1' },
});
