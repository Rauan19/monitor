import { useState } from 'react';
import { api } from './api';

function IconArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12h13M13 6l6 6-6 6"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="login-spinner">
      <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="34 100" />
    </svg>
  );
}

export default function Login({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.login(username, password);
      onSuccess(res.user);
    } catch (err) {
      setError(err.message || 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-waves" aria-hidden="true">
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="login-wave login-wave-1">
          <path d="M0,224L60,213.3C120,203,240,181,360,181.3C480,181,600,203,720,208C840,213,960,203,1080,186.7C1200,171,1320,149,1380,138.7L1440,128L1440,320L0,320Z" />
        </svg>
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="login-wave login-wave-2">
          <path d="M0,256L80,245.3C160,235,320,213,480,213.3C640,213,800,235,960,240C1120,245,1280,235,1360,229.3L1440,224L1440,320L0,320Z" />
        </svg>
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="login-wave login-wave-3">
          <path d="M0,288L120,282.7C240,277,480,267,720,272C960,277,1200,299,1320,309.3L1440,320L1440,320L0,320Z" />
        </svg>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="7.5" fill="none" strokeWidth="1.8" />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
          </svg>
        </div>

        <div className="login-copy">
          <h1>Monitor Zcnet</h1>
          <p>Entra pra ver o status da rede em tempo real.</p>
        </div>

        <label className="login-field">
          <span>Usuário</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </label>

        <label className="login-field">
          <span>Senha</span>
          <div className="login-password-row">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" className="login-go" disabled={loading} aria-label="Entrar">
              {loading ? <IconSpinner /> : <IconArrow />}
            </button>
          </div>
        </label>

        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}
