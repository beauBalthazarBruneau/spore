import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL_KEY = 'spore.baseUrl';
const DEFAULT_BASE_URL = 'http://localhost:3100';

let cachedBaseUrl: string | null = null;
const listeners: ((url: string) => void)[] = [];

export async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const stored = await AsyncStorage.getItem(BASE_URL_KEY);
  cachedBaseUrl = stored || DEFAULT_BASE_URL;
  return cachedBaseUrl;
}

export async function setBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/$/, '');
  await AsyncStorage.setItem(BASE_URL_KEY, trimmed);
  cachedBaseUrl = trimmed;
  for (const fn of listeners) fn(trimmed);
}

export function onBaseUrlChange(fn: (url: string) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export const DEFAULT_BASE = DEFAULT_BASE_URL;
