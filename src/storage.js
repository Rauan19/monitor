import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SERVER_URL } from './defaultServer';

const KEYS = {
  serverUrl: 'monitorzcnet:serverUrl',
  token: 'monitorzcnet:token',
  username: 'monitorzcnet:username',
  pushToken: 'monitorzcnet:pushToken',
};

// Tuneis ngrok eram o endereco antigo do backend e sao efemeros: o link morre
// quando o tunel cai. Se ficou um salvo no aparelho, ele tem prioridade sobre o
// padrao e o app trava num endereco que nao existe mais. Descarta e volta pro
// dominio fixo, sem o usuario precisar reinstalar nem mexer em Ajustes.
function isEnderecoObsoleto(url) {
  return /ngrok(-free)?\.(app|io|dev)/i.test(url || '');
}

export async function getServerUrl() {
  const saved = await AsyncStorage.getItem(KEYS.serverUrl);
  if (saved && isEnderecoObsoleto(saved)) {
    await AsyncStorage.removeItem(KEYS.serverUrl);
    return DEFAULT_SERVER_URL;
  }
  return saved || DEFAULT_SERVER_URL;
}

export async function setServerUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (isEnderecoObsoleto(clean)) {
    await AsyncStorage.removeItem(KEYS.serverUrl);
    return;
  }
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
