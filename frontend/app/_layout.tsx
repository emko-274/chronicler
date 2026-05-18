import { useState, useEffect } from 'react';
import { Tabs, Stack, usePathname } from 'expo-router';
import {
  View, Modal, TouchableOpacity, Text, StyleSheet,
  Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NotesScreen from './notes';
import LoginScreen from '../components/LoginScreen';
import { getStoredToken, storeToken, clearToken, storeUser, getStoredUser, UserInfo } from '../lib/auth';
import { setApiToken } from '../lib/api';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IoniconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
}

const { width: SW, height: SH } = Dimensions.get('window');
const INIT_W = Math.min(600, SW - 16);
const INIT_H = Math.round(SH * 0.74);
const INIT_X = SW - INIT_W - 8;
const INIT_Y = SH - INIT_H;          // bottom edge flush with viewport — tab bar overlaps it
const FAB_BOTTOM = Platform.OS === 'ios' ? 90 : 68;
const MIN_W = 320;
const MIN_H = 300;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export default function Layout() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    Promise.all([getStoredToken(), getStoredUser()]).then(([token, storedUser]) => {
      if (token) setApiToken(token);
      if (token && storedUser) setUser(storedUser);
      setAuthReady(true);
    });
  }, []);

  async function handleSignIn(token: string, userInfo: UserInfo) {
    await Promise.all([storeToken(token), storeUser(userInfo)]);
    setApiToken(token);
    setUser(userInfo);
  }

  async function handleSignOut() {
    await clearToken();
    setApiToken(null);
    setUser(null);
  }

  const [open, setOpen] = useState(false);
  const [panelW, setPanelW] = useState(INIT_W);
  const [panelH, setPanelH] = useState(INIT_H);
  const [panelX, setPanelX] = useState(INIT_X);
  const [panelY, setPanelY] = useState(INIT_Y);
  const pathname = usePathname();
  const onDashboard = pathname === '/' || pathname === '/index';
  const isPublicView = pathname.startsWith('/view/');

  function closePanel() {
    setOpen(false);
    setPanelW(INIT_W);
    setPanelH(INIT_H);
    setPanelX(INIT_X);
    setPanelY(INIT_Y);
  }

  function togglePanel() { open ? closePanel() : setOpen(true); }

  function startMove(e: MouseEvent) {
    e.preventDefault();
    const mx0 = e.clientX, my0 = e.clientY, x0 = panelX, y0 = panelY, w = panelW, h = panelH;
    const onMove = (ev: MouseEvent) => {
      setPanelX(clamp(x0 + ev.clientX - mx0, 0, SW - w));
      setPanelY(clamp(y0 + ev.clientY - my0, 0, SH - h));
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startResize(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const mx0 = e.clientX, my0 = e.clientY, w0 = panelW, h0 = panelH, x0 = panelX, y0 = panelY;
    const onMove = (ev: MouseEvent) => {
      const newW = clamp(w0 - (ev.clientX - mx0), MIN_W, SW - 16);
      const newH = clamp(h0 - (ev.clientY - my0), MIN_H, SH - 80);
      setPanelW(newW);
      setPanelH(newH);
      setPanelX(x0 + w0 - newW);
      setPanelY(y0 + h0 - newH);
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  if (!authReady) return <View style={{ flex: 1, backgroundColor: '#fff' }} />;

  // Public view pages don't require login
  if (isPublicView) {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  if (!user) return <LoginScreen onSignIn={handleSignIn} />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{
        tabBarActiveTintColor: '#6366f1',
        headerRight: () => (
          <TouchableOpacity onPress={handleSignOut} style={{ marginRight: 16 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="log-out-outline" size={22} color="#6366f1" />
          </TouchableOpacity>
        ),
      }}>
        <Tabs.Screen name="index"    options={{ title: 'Dashboard',    tabBarIcon: tabIcon('home-outline') }} />
        <Tabs.Screen name="log"      options={{ title: 'Log Activity', tabBarIcon: tabIcon('add-circle-outline') }} />
        <Tabs.Screen name="insights" options={{ title: 'Insights',     tabBarIcon: tabIcon('analytics-outline') }} />
        <Tabs.Screen name="notes"    options={{ title: 'Notes',        tabBarIcon: tabIcon('journal-outline') }} />
        <Tabs.Screen name="manage"   options={{ title: 'Manage',       tabBarIcon: tabIcon('pricetag-outline') }} />
        <Tabs.Screen name="export"   options={{ title: 'Export',       tabBarIcon: tabIcon('download-outline') }} />
        <Tabs.Screen name="view/[token]" options={{ href: null }} />
      </Tabs>

      {Platform.OS === 'web' ? (
        /* ── Web: absolute-positioned layers so FAB stays on top ── */
        onDashboard && (
          <>
            {/* Darkened backdrop */}
            {open && (
              <TouchableOpacity
                style={[StyleSheet.absoluteFill, styles.webBackdrop]}
                activeOpacity={1}
                onPress={closePanel}
              />
            )}

            {/* Draggable + resizable panel */}
            {open && (
              <View style={[styles.panel, styles.panelWeb, { width: panelW, height: panelH, left: panelX, top: panelY }]}>
                {/* @ts-ignore */}
                <View style={styles.resizeHandle} onMouseDown={startResize}>
                  <View style={styles.resizePip} />
                </View>
                <View style={styles.panelHandle} />
                {/* @ts-ignore */}
                <View style={[styles.panelHeader, { cursor: 'grab' as any }]} onMouseDown={startMove}>
                  <Ionicons name="journal-outline" size={15} color="#6366f1" />
                  <Text style={styles.panelTitle}>Journal</Text>
                  <TouchableOpacity onPress={closePanel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={18} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
                <NotesScreen />
              </View>
            )}

            {/* FAB — hidden while journal is open */}
            {!open && (
              <TouchableOpacity style={[styles.fab, styles.fabWeb, { bottom: FAB_BOTTOM }]} onPress={togglePanel}>
                <Ionicons name="journal-outline" size={19} color="#fff" />
              </TouchableOpacity>
            )}
          </>
        )
      ) : (
        /* ── Mobile: standard centered modal ── */
        onDashboard && (
          <>
            {!open && (
              <TouchableOpacity style={[styles.fab, { bottom: FAB_BOTTOM }]} onPress={() => setOpen(true)}>
                <Ionicons name="journal-outline" size={19} color="#fff" />
              </TouchableOpacity>
            )}
            <Modal visible={open} transparent animationType="slide" onRequestClose={closePanel}>
              <View style={styles.overlayMobile}>
                <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closePanel} />
                <View style={[styles.panel, styles.panelMobile]}>
                  <View style={styles.panelHandle} />
                  <View style={styles.panelHeader}>
                    <Ionicons name="journal-outline" size={15} color="#6366f1" />
                    <Text style={styles.panelTitle}>Journal</Text>
                    <TouchableOpacity onPress={closePanel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={18} color="#9ca3af" />
                    </TouchableOpacity>
                  </View>
                  <NotesScreen />
                </View>
              </View>
            </Modal>
          </>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  fabWeb: {
    zIndex: 300,
  },
  webBackdrop: {
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  overlayMobile: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  panel: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 12,
  },
  panelWeb: {
    position: 'absolute',
    borderRadius: 16,
    zIndex: 200,
  },
  panelMobile: {
    width: Math.min(500, SW - 32),
    height: Math.round(SH * 0.78),
    borderRadius: 16,
  },
  resizeHandle: {
    position: 'absolute',
    top: 0, left: 0,
    width: 28, height: 28,
    zIndex: 10,
    cursor: 'nwse-resize' as any,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resizePip: {
    width: 10, height: 10,
    borderTopWidth: 2, borderLeftWidth: 2,
    borderColor: '#d1d5db',
    borderTopLeftRadius: 3,
  },
  panelHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#e5e7eb',
    alignSelf: 'center',
    marginTop: 8, marginBottom: 4,
  },
  panelHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  panelTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#111827' },
});
