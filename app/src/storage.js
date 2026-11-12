import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SERVER_URL } from './defaultServer';

const KEYS = {
  serverUrl: 'monitorzcnet:serverUrl',
  token: 'monitorzcnet:token',
  username: 'monitorzcnet:username',
  pushToken: 'monitorzcnet:pushToken',
};

// Cache em memoria RAM para evitar ir ao AsyncStorage (disco nativo do Android)
// em toda requisicao HTTP do app. Undefined = ainda nao lido do disco.
const mem = {
  serverUrl: undefined,
  token: undefined,
  username: undefined,
  pushToken: undefined,
};

// Tuneis ngrok eram o endereco antigo do backend e sao efemeros: o link morre
// quando o tunel cai. Se ficou um salvo no aparelho, ele tem prioridade sobre o
// padrao e o app trava num endereco que nao existe mais. Descarta e volta pro
// dominio fixo, sem o usuario precisar reinstalar nem mexer em Ajustes.
function isEnderecoObsoleto(url) {
  return /ngrok(-free)?\.(app|io|dev)/i.test(url || '');
}

export async function getServerUrl() {
  if (mem.serverUrl !== undefined) return mem.serverUrl;
  const saved = await AsyncStorage.getItem(KEYS.serverUrl);
  if (saved && isEnderecoObsoleto(saved)) {
    await AsyncStorage.removeItem(KEYS.serverUrl);
    mem.serverUrl = DEFAULT_SERVER_URL;
    return DEFAULT_SERVER_URL;
  }
  mem.serverUrl = saved || DEFAULT_SERVER_URL;
  return mem.serverUrl;
}

export async function setServerUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (isEnderecoObsoleto(clean)) {
    mem.serverUrl = DEFAULT_SERVER_URL;
    await AsyncStorage.removeItem(KEYS.serverUrl);
    return;
  }
  mem.serverUrl = clean || DEFAULT_SERVER_URL;
  await AsyncStorage.setItem(KEYS.serverUrl, clean);
}

export async function getToken() {
  if (mem.token !== undefined) return mem.token;
  mem.token = await AsyncStorage.getItem(KEYS.token);
  return mem.token;
}

export async function setToken(token) {
  mem.token = token || null;
  if (token) await AsyncStorage.setItem(KEYS.token, token);
  else await AsyncStorage.removeItem(KEYS.token);
}

export async function getUsername() {
  if (mem.username !== undefined) return mem.username;
  mem.username = await AsyncStorage.getItem(KEYS.username);
  return mem.username;
}

export async function setUsername(username) {
  mem.username = username || null;
  if (username) await AsyncStorage.setItem(KEYS.username, username);
  else await AsyncStorage.removeItem(KEYS.username);
}

export async function getStoredPushToken() {
  if (mem.pushToken !== undefined) return mem.pushToken;
  mem.pushToken = await AsyncStorage.getItem(KEYS.pushToken);
  return mem.pushToken;
}

export async function setStoredPushToken(token) {
  mem.pushToken = token || null;
  if (token) await AsyncStorage.setItem(KEYS.pushToken, token);
  else await AsyncStorage.removeItem(KEYS.pushToken);
}

export async function clearSession() {
  mem.token = null;
  mem.username = null;
  await AsyncStorage.multiRemove([KEYS.token, KEYS.username]);
}
