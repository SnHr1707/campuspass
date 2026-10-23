import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';

export default function LoginPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body =
        mode === 'login'
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password, inviteCode: form.inviteCode || undefined };
      const session = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
      signIn(session);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel auth-panel">
      <h1>{mode === 'login' ? 'Log in to book seats' : 'Create your CampusPass account'}</h1>
      <form onSubmit={submit} className="form">
        {mode === 'register' && (
          <label>
            Full name
            <input value={form.name} onChange={update('name')} required maxLength={80} autoComplete="name" />
          </label>
        )}
        <label>
          College email
          <input type="email" value={form.email} onChange={update('email')} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            required
            minLength={mode === 'register' ? 8 : 1}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mode === 'register' && (
          <details className="invite">
            <summary>I have an organiser or volunteer code</summary>
            <label>
              Invite code
              <input value={form.inviteCode} onChange={update('inviteCode')} autoComplete="off" />
            </label>
          </details>
        )}
        {error && <p className="notice err" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
      <p className="switch">
        {mode === 'login' ? 'New here? ' : 'Already have an account? '}
        <button type="button" className="link-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'Create an account' : 'Log in instead'}
        </button>
      </p>
    </section>
  );
}
