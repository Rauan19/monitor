import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
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
        } catch {
          await clearSession();
        }
      }
      setChecking(false);
    })();
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
