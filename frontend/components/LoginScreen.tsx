import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import axios from 'axios';
import { UserInfo } from '../lib/auth';

WebBrowser.maybeCompleteAuthSession();

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

interface Props {
  onSignIn: (token: string, user: UserInfo) => void;
}

export default function LoginScreen({ onSignIn }: Props) {
  const redirectUri = makeRedirectUri({ useProxy: true });

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    redirectUri,
    scopes: ['profile', 'email'],
  });

  useEffect(() => {
    if (response?.type !== 'success') return;
    const accessToken = response.authentication?.accessToken;
    if (!accessToken) return;

    axios
      .post(`${API_BASE_URL}/auth/google`, { access_token: accessToken })
      .then((r) => onSignIn(r.data.token, r.data.user))
      .catch((err) => console.error('Auth error:', err));
  }, [response]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Activity Tracker</Text>
      <Text style={styles.subtitle}>Sign in to access your data</Text>

      {request ? (
        <TouchableOpacity style={styles.button} onPress={() => promptAsync()}>
          <Text style={styles.buttonText}>Sign in with Google</Text>
        </TouchableOpacity>
      ) : (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 32 }} />
      )}

      {!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID && (
        <Text style={styles.warning}>
          EXPO_PUBLIC_GOOGLE_CLIENT_ID is not set.{'\n'}See frontend/.env.example.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 48,
  },
  button: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  warning: {
    marginTop: 24,
    fontSize: 13,
    color: '#ef4444',
    textAlign: 'center',
    lineHeight: 20,
  },
});
