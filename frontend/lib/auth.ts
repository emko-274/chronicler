import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'auth_token';
const USER_KEY  = 'auth_user';

export async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function storeToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  }
}

export async function storeUser(user: UserInfo): Promise<void> {
  const val = JSON.stringify(user);
  if (Platform.OS === 'web') {
    localStorage.setItem(USER_KEY, val);
  } else {
    await SecureStore.setItemAsync(USER_KEY, val);
  }
}

export async function getStoredUser(): Promise<UserInfo | null> {
  try {
    const raw = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? localStorage.getItem(USER_KEY) : null)
      : await SecureStore.getItemAsync(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
}
