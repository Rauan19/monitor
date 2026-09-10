import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SERVER_URL } from './defaultServer';

const KEYS = {
  serverUrl: 'monitorzcnet:serverUrl',
  token: 'monitorzcnet:token',
  username: 'monitorzcnet:username',
  pushToken: 'monitorzcnet:pushToken',
};

export async function getServerUrl() {
  const saved = await AsyncStorage.getItem(KEYS.serverUrl);
  return saved || DEFAULT_SERVER_URL;
}

export async function setServerUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  await AsyncStorage.setItem(KEYS.serverUrl, clean);
}

export async function getToken() {
  return await AsyncStorage.getItem(KEYS.token);
}

export async function setToken(token) {
  if (token) await AsyncStorage.setItem(KEYS.token, token);
  else await AsyncStorage.removeItem(KEYS.token);
}

export async function getUsername() {
  return await AsyncStorage.getItem(KEYS.username);
}

export async function setUsername(username) {
  if (username) await AsyncStorage.setItem(KEYS.username, username);
  else await AsyncStorage.removeItem(KEYS.username);
}

export async function getStoredPushToken() {
  return await AsyncStorage.getItem(KEYS.pushToken);
}

export async function setStoredPushToken(token) {
  if (token) await AsyncStorage.setItem(KEYS.pushToken, token);
  else await AsyncStorage.removeItem(KEYS.pushToken);
}

export async function clearSession() {
  await AsyncStorage.multiRemove([KEYS.token, KEYS.username]);
}
