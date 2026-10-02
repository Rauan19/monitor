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
      // Ler os tres de uma vez. Sao leituras independentes e em sequencia cada
      // uma esperava a anterior sem motivo.
      const [url, token, username] = await Promise.all([getServerUrl(), getToken(), getUsername()]);
      setServerUrlState(url);

      // Abrir o app NAO espera mais o servidor responder.
      //
      // Antes aqui tinha um `await api.me()` antes de liberar a tela, e o
      // RootNavigator nao renderiza nada enquanto `checking` e true. Resultado:
      // em rede ruim o app ficava segundos numa tela preta antes de mostrar
      // qualquer coisa, enquanto o web abria na hora. E a espera nao servia pra
      // nada: o token e local e as telas ja mostram o cache offline sozinhas.
      //
      // Entao entramos direto com a sessao guardada e conferimos por tras. Se o
      // token estiver mesmo morto, o 401 cai no onSessaoInvalida abaixo e o app
      // volta pro login em seguida. Erro de rede nao derruba a sessao.
      if (url && token && username) {
        setUser(username);
        api.me().catch(() => {});
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
