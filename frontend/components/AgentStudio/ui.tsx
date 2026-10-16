'use client';

import type { ReactNode } from 'react';

/** Small building blocks shared by the Agent Studio panels. */

export function PanelHeader({ icon, title, subtitle, action }: { icon: string; title: string; subtitle: string; action?: ReactNode }) {
  return (
    // scrolls with the panel; the Save button lives in the SaveBar at the bottom
    <div className="-mx-6 px-6 py-3 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-magenta-brand/15">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-9 h-9 rounded-lg bg-purple-brand/15 flex items-center justify-center flex-shrink-0" aria-hidden="true">
          <svg className="w-[18px] h-[18px] text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-tight text-fg">{title}</h2>
          <p className="text-xs text-fg/60">{subtitle}</p>
        </div>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function PrimaryButton({ children, onClick, busy, disabled, type = 'button' }: {
  children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className="px-5 py-2.5 bg-purple-brand text-white rounded-lg font-medium hover:bg-[#a855c7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-4 py-2.5 rounded-lg border border-magenta-brand/30 text-sm font-medium text-fg hover:bg-raised transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
    >
      {children}
    </button>
  );
}

/**
 * The bar at the bottom of a panel that saves: where things stand on the left ("All changes saved",
 * "Unsaved changes", or the last message), Discard and Save on the right. It stays at the bottom while
 * the panel scrolls (sticky inside the panel's scroll area), so the Save button is always in reach.
 */
export function SaveBar({ dirty, saving, onSave, onDiscard, label, msg, disabled, loading }: {
  dirty: boolean;
  /** The saved values have not arrived yet: nothing to compare with. */
  loading?: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  label: string;
  msg?: { type: 'success' | 'error'; text: string } | null;
  disabled?: boolean;
}) {
  const status = loading ? 'Loading…' : saving ? 'Saving…' : msg ? msg.text : dirty ? 'Unsaved changes' : 'All changes saved';
  const tone = msg?.type === 'error' ? 'text-red-500' : dirty && !msg ? 'text-pink-brand' : 'text-fg/60';
  return (
    <div className="sticky bottom-0 z-20 -mx-6 -mb-6 mt-auto px-6 py-3 flex flex-wrap items-center justify-between gap-3 bg-canvas border-t border-magenta-brand/15">
      <p className={`text-sm min-w-0 flex items-center gap-2 ${tone}`} role={msg?.type === 'error' ? 'alert' : 'status'}>
        {dirty && !msg && !saving && <span className="w-2 h-2 rounded-full bg-pink-brand flex-shrink-0" aria-hidden="true" />}
        {status}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onDiscard}
          disabled={loading || !dirty || saving}
          className="px-3 py-2 text-sm font-medium text-fg/70 hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Discard
        </button>
        <PrimaryButton onClick={onSave} busy={saving} disabled={loading || disabled || !dirty}>{label}</PrimaryButton>
      </div>
    </div>
  );
}

export function Notice({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  return (
    <div
      role={msg.type === 'error' ? 'alert' : 'status'}
      className={`mb-4 px-4 py-3 rounded-lg border text-fg ${msg.type === 'success' ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}
    >
      {msg.text}
    </div>
  );
}

export function Toggle({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-brand disabled:opacity-50 ${
        on ? 'bg-purple-brand' : 'bg-fg/20'
      }`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function Block({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="bg-card/40 border border-magenta-brand/20 rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-base font-semibold text-fg">{title}</h3>
          {subtitle && <p className="text-sm text-fg/60 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A small grey chip under a reply. */
export function Chip({ children, tone = 'neutral', onClick, title }: { children: ReactNode; tone?: 'neutral' | 'guard'; onClick?: () => void; title?: string }) {
  const cls = `as-chip ${tone === 'guard' ? 'as-chip-guard' : ''}`;
  return onClick ? (
    <button type="button" className={`${cls} as-chip-button`} onClick={onClick} title={title}>{children}</button>
  ) : (
    <span className={cls} title={title}>{children}</span>
  );
}
