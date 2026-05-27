import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, Platform, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMyPublicLink, enablePublicLink, revokePublicLink, updatePublicLinkSettings } from '../lib/api';

const APP_BASE_URL = process.env.EXPO_PUBLIC_APP_URL || (
  typeof window !== 'undefined' ? window.location.origin : 'https://chronicler-ten.vercel.app'
);

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function SharePanel({ visible, onClose }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareUrl = token ? `${APP_BASE_URL}/view/${token}` : null;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMyPublicLink();
      setToken(data.token);
      setEnabled(data.enabled);
      setIncludeNotes(data.include_notes ?? false);
    } catch {
      setError('Could not load share settings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) { load(); setCopied(false); }
  }, [visible]);

  const handleToggle = async (value: boolean) => {
    setWorking(true);
    setError(null);
    try {
      if (value) {
        // Create link if needed, or re-enable existing one
        const data = await enablePublicLink();
        setToken(data.token);
        setEnabled(true);
      } else {
        await updatePublicLinkSettings({ enabled: false });
        setEnabled(false);
      }
      setCopied(false);
    } catch {
      setError('Failed to update sharing. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const handleReset = async () => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Reset link? The current URL will stop working and a new one will be generated.')
      : true;
    if (!confirmed) return;
    setWorking(true);
    setError(null);
    try {
      await revokePublicLink();
      // Immediately create a fresh link
      const data = await enablePublicLink();
      setToken(data.token);
      setEnabled(true);
      setCopied(false);
    } catch {
      setError('Failed to reset link. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  const handleToggleNotes = async (value: boolean) => {
    setIncludeNotes(value);
    try {
      await updatePublicLinkSettings({ include_notes: value });
    } catch {
      setIncludeNotes(!value);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="link-outline" size={16} color="#6366f1" />
            <Text style={styles.title}>Share Dashboard</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={14} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {loading ? (
              <ActivityIndicator color="#6366f1" style={{ marginVertical: 32 }} />
            ) : (
              <>
                {/* Main sharing toggle */}
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Share publicly</Text>
                    <Text style={styles.toggleDesc}>
                      Anyone with the link can view your dashboard. Private categories are excluded.
                    </Text>
                  </View>
                  {working
                    ? <ActivityIndicator size="small" color="#6366f1" style={{ marginLeft: 8 }} />
                    : (
                      <Switch
                        value={enabled}
                        onValueChange={handleToggle}
                        disabled={working}
                        trackColor={{ false: '#e5e7eb', true: '#818cf8' }}
                        thumbColor={enabled ? '#6366f1' : '#9ca3af'}
                      />
                    )}
                </View>

                {/* Link + options — only shown when enabled */}
                {enabled && shareUrl && (
                  <>
                    <View style={styles.linkBox}>
                      <Text style={styles.linkText} numberOfLines={1} ellipsizeMode="middle">
                        {shareUrl}
                      </Text>
                    </View>

                    <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleCopy}>
                      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color="#fff" />
                      <Text style={styles.btnPrimaryText}>{copied ? 'Copied!' : 'Copy link'}</Text>
                    </TouchableOpacity>

                    <View style={[styles.toggleRow, styles.sectionDivider]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.toggleLabel}>Include journal</Text>
                        <Text style={styles.toggleDesc}>Share your notes and journal entries with viewers</Text>
                      </View>
                      <Switch
                        value={includeNotes}
                        onValueChange={handleToggleNotes}
                        trackColor={{ false: '#e5e7eb', true: '#818cf8' }}
                        thumbColor={includeNotes ? '#6366f1' : '#9ca3af'}
                      />
                    </View>

                    <View style={styles.sectionDivider}>
                      <TouchableOpacity
                        style={[styles.resetBtn, working && styles.btnDisabled]}
                        onPress={handleReset}
                        disabled={working}
                      >
                        <Ionicons name="refresh-outline" size={13} color="#6b7280" />
                        <Text style={styles.resetBtnText}>Reset link</Text>
                      </TouchableOpacity>
                      <Text style={styles.resetHint}>Generates a new URL and invalidates the current one</Text>
                    </View>
                  </>
                )}
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111827' },
  body: { padding: 20 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef2f2', borderRadius: 8, borderWidth: 1, borderColor: '#fecaca',
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12,
  },
  errorText: { fontSize: 13, color: '#dc2626', flex: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionDivider: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 2 },
  toggleDesc: { fontSize: 12, color: '#6b7280', lineHeight: 16 },
  linkBox: {
    backgroundColor: '#f3f4f6', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 14, marginBottom: 10,
  },
  linkText: { fontSize: 13, color: '#374151', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8,
  },
  btnDisabled: { opacity: 0.55 },
  btnPrimary: { backgroundColor: '#6366f1' },
  btnPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  resetBtnText: { fontSize: 13, color: '#6b7280' },
  resetHint: { fontSize: 12, color: '#9ca3af', marginTop: 3 },
});
