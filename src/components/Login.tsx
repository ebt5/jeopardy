import { useState, type FormEvent } from 'react';
import { authenticate, saveSession, type Session } from '../auth';

interface LoginProps {
  onSuccess: (session: Session) => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const session = authenticate(username, password);
    if (!session) {
      setError('Invalid username or password.');
      return;
    }
    setError(null);
    saveSession(session);
    onSuccess(session);
  };

  return (
    <div className="login">
      <div className="login-card">
        <h1 className="logo">JEOPARDY!</h1>
        <p className="login-subtitle">Host sign-in required</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field-label">
            Username
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
            />
          </label>
          <label className="field-label">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
            />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" className="btn primary large login-submit">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
