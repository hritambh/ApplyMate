import { useState } from 'react';
import { api } from '../api.js';

export default function AuthScreen({ onAuthSuccess, banner, setBanner }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const switchMode = (next) => {
    setMode(next);
    setBanner?.(null);
    setForm({ name: '', email: '', password: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBanner?.(null);

    const email = form.email.trim();
    const password = form.password;

    if (!email || !password) {
      setBanner?.({ kind: 'error', text: 'Email and password are required.' });
      return;
    }

    if (mode === 'signup' && !form.name.trim()) {
      setBanner?.({ kind: 'error', text: 'Name is required.' });
      return;
    }

    if (password.length < 5) {
      setBanner?.({ kind: 'error', text: 'Password must be at least 5 characters.' });
      return;
    }

    setBusy(true);
    try {
      const result =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({ name: form.name.trim(), email, password });

      onAuthSuccess(result.token);
    } catch (err) {
      setBanner?.({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Welcome to ApplyMate</h1>
        <p className="auth-subtitle">
          Automate your job application emails with AI-generated cover letters.
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => switchMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => switchMode('signup')}
          >
            Sign up
          </button>
        </div>

        {banner && <div className={`banner banner-${banner.kind} auth-banner`}>{banner.text}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={form.name}
                onChange={setField('name')}
                disabled={busy}
              />
            </label>
          )}

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete={mode === 'login' ? 'email' : 'email'}
              placeholder="you@example.com"
              value={form.email}
              onChange={setField('email')}
              disabled={busy}
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              value={form.password}
              onChange={setField('password')}
              disabled={busy}
            />
          </label>

          <button type="submit" className="btn primary auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <a href="/api/auth/google" className="btn auth-google">
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
