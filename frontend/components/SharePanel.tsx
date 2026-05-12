import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Modal, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getSentShares, getReceivedShares, sendShareInvite,
  acceptShare, declineShare, revokeShare, Share,
} from '../lib/api';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSharesChanged: () => void; // notify parent to refresh accepted list
}

export default function SharePanel({ visible, onClose, onSharesChanged }: Props) {
  const [sent, setSent] = useState<Share[]>([]);
  const [received, setReceived] = useState<Share[]>([]);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([getSentShares(), getReceivedShares()]);
      setSent(s);
      setReceived(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) { load(); setEmail(''); setError(''); }
  }, [visible]);

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setSending(true);
    setError('');
    try {
      await sendShareInvite(trimmed);
      setEmail('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Failed to send invite');
    } finally {
      setSending(false);
    }
  };

  const handleAccept = async (share: Share) => {
    await acceptShare(share.id);
    await load();
    onSharesChanged();
  };

  const handleDecline = async (share: Share) => {
    await declineShare(share.id);
    await load();
  };

  const handleRevoke = async (share: Share) => {
    const label = share.status === 'accepted' ? share.user.name : share.user.email;
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Remove access for ${label}?`)
      : await new Promise<boolean>((res) =>
          Alert.alert('Remove access', `Remove access for ${label}?`, [
            { text: 'Cancel', onPress: () => res(false) },
            { text: 'Remove', style: 'destructive', onPress: () => res(true) },
          ])
        );
    if (!confirmed) return;
    await revokeShare(share.id);
    await load();
    onSharesChanged();
  };

  const pendingReceived = received.filter((s) => s.status === 'pending');
  const activeSent = sent.filter((s) => s.status !== 'declined');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="people-outline" size={16} color="#6366f1" />
            <Text style={styles.title}>Share Dashboard</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {/* Invite */}
            <Text style={styles.sectionLabel}>Invite someone</Text>
            <View style={styles.inviteRow}>
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor="#9ca3af"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="send"
                onSubmitEditing={handleSend}
                editable={!sending}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!email.trim() || sending) && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!email.trim() || sending}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="send" size={15} color="#fff" />}
              </TouchableOpacity>
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}

            {loading ? (
              <ActivityIndicator color="#6366f1" style={{ marginTop: 24 }} />
            ) : (
              <>
                {/* Pending invites received */}
                {pendingReceived.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Pending invites</Text>
                    {pendingReceived.map((s) => (
                      <View key={s.id} style={styles.card}>
                        <View style={styles.cardInfo}>
                          <Text style={styles.cardName}>{s.user.name}</Text>
                          <Text style={styles.cardEmail}>{s.user.email}</Text>
                          <Text style={styles.cardSub}>wants to view your dashboard</Text>
                        </View>
                        <View style={styles.cardActions}>
                          <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(s)}>
                            <Text style={styles.acceptBtnText}>Accept</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.declineBtn} onPress={() => handleDecline(s)}>
                            <Text style={styles.declineBtnText}>Decline</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {/* Sent invites */}
                {activeSent.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Sharing with</Text>
                    {activeSent.map((s) => (
                      <View key={s.id} style={styles.card}>
                        <View style={styles.cardInfo}>
                          <Text style={styles.cardName}>{s.user.name || s.user.email}</Text>
                          <Text style={styles.cardEmail}>{s.user.email}</Text>
                          <View style={[styles.badge, s.status === 'accepted' ? styles.badgeAccepted : styles.badgePending]}>
                            <Text style={[styles.badgeText, s.status === 'accepted' ? styles.badgeAcceptedText : styles.badgePendingText]}>
                              {s.status === 'accepted' ? 'Active' : 'Pending'}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity onPress={() => handleRevoke(s)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle-outline" size={20} color="#9ca3af" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </>
                )}

                {pendingReceived.length === 0 && activeSent.length === 0 && (
                  <Text style={styles.empty}>No active shares yet.</Text>
                )}
              </>
            )}
          </ScrollView>
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
    maxHeight: '80%',
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111827' },
  body: { padding: 16 },

  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 16, marginBottom: 8,
  },
  inviteRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827',
  },
  sendBtn: {
    backgroundColor: '#6366f1', borderRadius: 8,
    paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#c7d2fe' },
  error: { fontSize: 13, color: '#ef4444', marginTop: 6 },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f9fafb', borderRadius: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
    padding: 12, marginBottom: 8,
  },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  cardEmail: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  cardSub: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 6 },

  acceptBtn: {
    backgroundColor: '#6366f1', borderRadius: 6,
    paddingVertical: 6, paddingHorizontal: 12,
  },
  acceptBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  declineBtn: {
    backgroundColor: '#f3f4f6', borderRadius: 6,
    paddingVertical: 6, paddingHorizontal: 12,
  },
  declineBtnText: { color: '#374151', fontSize: 13, fontWeight: '600' },

  badge: { alignSelf: 'flex-start', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  badgeAccepted: { backgroundColor: '#dcfce7' },
  badgePending: { backgroundColor: '#fef9c3' },
  badgeText: { fontSize: 11, fontWeight: '600' },
  badgeAcceptedText: { color: '#16a34a' },
  badgePendingText: { color: '#ca8a04' },

  empty: { color: '#9ca3af', fontSize: 14, textAlign: 'center', marginTop: 24 },
});
