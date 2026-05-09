import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'auth_token';

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
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
}
