'use client';

// The /admin/login and /admin/signup forms: one card, two modes.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Logo from '../Header/Logo';
import ThemeToggle from '../Header/ThemeToggle';
import { adminApi, AdminApiError, getToken, saveSession } from '../../lib/admin-api';
import { Alert, Button, TextInput } from './ui';

export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', signup_code: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverConfig, setServerConfig] = useState<{ login_enabled: boolean; signup_enabled: boolean } | null>(null);

  useEffect(() => {
    if (getToken()) {
      router.replace('/admin/dashboard');
      return;
    }
    adminApi.config().then(setServerConfig).catch(() => setServerConfig(null));
  }, [router]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && form.password !== form.confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const auth =
        mode === 'signup'
          ? await adminApi.signup({ email: form.email, name: form.name, password: form.password, signup_code: form.signup_code })
          : await adminApi.login({ email: form.email, password: form.password });
      saveSession(auth);
      router.replace('/admin/dashboard');
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  const off =
    serverConfig && !serverConfig.login_enabled
      ? 'Admin login is not configured on the server yet (ADMIN_JWT_SECRET in backend/.env).'
      : serverConfig && mode === 'signup' && !serverConfig.signup_enabled
        ? 'Admin signup is turned off on this server (ADMIN_SIGNUP_CODE in backend/.env).'
        : '';

  return (
    <div className="hero-radial flex min-h-screen flex-col bg-canvas text-fg">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" aria-label="YaaraLabs Playground home">
          <Logo size="sm" />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-2xl border border-fg/10 bg-card p-6 shadow-xl sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-pink-brand">Admin</p>
          <h1 className="mt-1 text-2xl font-bold">{mode === 'login' ? 'Log in to the admin console' : 'Create an admin account'}</h1>
          <p className="mt-2 text-sm text-fg/60">
            {mode === 'login'
              ? 'Manage projects, guest sessions and stored models.'
              : 'You need the admin signup code from the server configuration.'}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {off && <Alert tone="error">{off}</Alert>}
            {mode === 'signup' && (
              <TextInput label="Name" value={form.name} onChange={set('name')} autoComplete="name" required maxLength={80} />
            )}
            <TextInput label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
            <TextInput
              label="Password"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              maxLength={72}
            />
            {mode === 'signup' && (
              <>
                <p className="-mt-2 text-xs text-fg/50">At least 8 characters, with a letter and a number.</p>
                <TextInput label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
                <TextInput label="Signup code" type="password" value={form.signup_code} onChange={set('signup_code')} autoComplete="off" required />
              </>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" variant="primary" className="w-full py-2.5" disabled={busy || Boolean(off)}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-fg/60">
            {mode === 'login' ? (
              <>
                New admin?{' '}
                <Link href="/admin/signup" className="font-medium text-pink-brand hover:underline">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already an admin?{' '}
                <Link href="/admin/login" className="font-medium text-pink-brand hover:underline">
                  Log in
                </Link>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
