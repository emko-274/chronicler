import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMyPublicLink, generatePublicLink, revokePublicLink } from '../lib/api';

const APP_BASE_URL = process.env.EXPO_PUBLIC_APP_URL || (
  typeof window !== 'undefined' ? window.location.origin : 'https://chronicler-ten.vercel.app'
);

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function SharePanel({ visible, onClose }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = token ? `${APP_BASE_URL}/view/${token}` : null;

  const load = async () => {
    setLoading(true);
    try {
      const data = await getMyPublicLink();
      setToken(data.token);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) { load(); setCopied(false); }
  }, [visible]);

  const handleGenerate = async () => {
    setWorking(true);
    try {
      const data = await generatePublicLink();
      setToken(data.token);
      setCopied(false);
    } finally {
      setWorking(false);
    }
  };

  const handleRevoke = async () => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Revoke this link? Anyone with the current link will lose access.')
      : true;
    if (!confirmed) return;
    setWorking(true);
    try {
      await revokePublicLink();
      setToken(null);
      setCopied(false);
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
            {loading ? (
              <ActivityIndicator color="#6366f1" style={{ marginVertical: 32 }} />
            ) : token ? (
              <>
                <Text style={styles.desc}>
                  Anyone with this link can view your dashboard. Private categories are excluded.
                </Text>
                <View style={styles.linkBox}>
                  <Text style={styles.linkText} numberOfLines={1} ellipsizeMode="middle">
                    {shareUrl}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary, working && styles.btnDisabled]}
                    onPress={handleCopy}
                    disabled={working}
                  >
                    <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color="#fff" />
                    <Text style={styles.btnPrimaryText}>{copied ? 'Copied!' : 'Copy link'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnDanger, working && styles.btnDisabled]}
                    onPress={handleRevoke}
                    disabled={working}
                  >
                    {working
                      ? <ActivityIndicator size="small" color="#dc2626" />
                      : <Text style={styles.btnDangerText}>Revoke</Text>}
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary, { marginTop: 8 }, working && styles.btnDisabled]}
                  onPress={handleGenerate}
                  disabled={working}
                >
                  <Text style={styles.btnSecondaryText}>Generate new link</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.desc}>
                  Generate a shareable link so anyone can view your dashboard without an account.
                  Private categories will not be included.
                </Text>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, working && styles.btnDisabled]}
                  onPress={handleGenerate}
                  disabled={working}
                >
                  {working
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="link-outline" size={15} color="#fff" />}
                  <Text style={styles.btnPrimaryText}>Generate link</Text>
                </TouchableOpacity>
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
  desc: { fontSize: 14, color: '#6b7280', lineHeight: 20, marginBottom: 16 },
  linkBox: {
    backgroundColor: '#f3f4f6', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  linkText: { fontSize: 13, color: '#374151', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8,
  },
  btnDisabled: { opacity: 0.55 },
  btnPrimary: { flex: 1, backgroundColor: '#6366f1' },
  btnPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnDanger: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  btnDangerText: { color: '#dc2626', fontWeight: '600', fontSize: 14 },
  btnSecondary: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  btnSecondaryText: { color: '#374151', fontWeight: '600', fontSize: 14 },
});
