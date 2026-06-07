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

      onAuthSuccess(result.token, result.user?.role || 'user');
    } catch (err) {
      setBanner?.({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-bg">
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
          <GoogleIcon />
          Sign in with Google
        </a>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
