import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessaoInvalida } from '../api';
import { unregisterPushNotifications } from '../notifications';
import { clearSession, getServerUrl, getToken, getUsername, setServerUrl as saveServerUrl, setToken, setUsername } from '../storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [checking, setChecking] = useState(true);
  const [serverUrl, setServerUrlState] = useState('');
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      const url = await getServerUrl();
      setServerUrlState(url);
      const token = await getToken();
      const username = await getUsername();
      if (url && token && username) {
        try {
          await api.me();
          setUser(username);
        } catch (err) {
          // Este era o motivo de deslogar "do nada". Qualquer erro aqui apagava
          // a sessao: abrir o app com sinal fraco, com timeout, ou com o
          // servidor devolvendo 502 jogava fora um token perfeitamente valido.
          // So 401 significa sessao invalida. Nos outros casos o usuario entra
          // normalmente e as telas mostram o cache offline com o aviso.
          if (err?.status === 401) {
            await clearSession();
          } else {
            setUser(username);
          }
        }
      }
      setChecking(false);
    })();
  }, []);

  // Token expirou durante o uso (401 em qualquer tela): volta pro login em vez
  // de deixar o usuario olhando telas que so dao erro.
  useEffect(() => {
    onSessaoInvalida(async () => {
      await clearSession();
      setUser(null);
    });
    return () => onSessaoInvalida(null);
  }, []);

  const updateServerUrl = useCallback(async (url) => {
    await saveServerUrl(url);
    setServerUrlState(url.trim().replace(/\/+$/, ''));
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password);
    await setToken(res.token);
    await setUsername(res.user);
    setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(async () => {
    // Tira o token do servidor ANTES de derrubar a sessão: a rota de unregister
    // exige autenticação, e sem isso o aparelho deslogado continuaria recebendo
    // os alertas de queda.
    await unregisterPushNotifications();
    try {
      await api.logout();
    } catch {
      // segue mesmo se falhar
    }
    await clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ checking, serverUrl, updateServerUrl, user, login, logout }),
    [checking, serverUrl, updateServerUrl, user, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return ctx;
}
