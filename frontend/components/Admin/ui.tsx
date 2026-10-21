'use client';

// Small building blocks shared by the /admin pages: inputs, buttons, badges, pagination, confirm dialog.
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export const inputClass =
  'w-full rounded-lg border border-fg/15 bg-canvas px-3 py-2 text-sm text-fg placeholder:text-fg/40 focus:border-pink-brand focus:outline-none focus:ring-2 focus:ring-pink-brand/30';

export function TextInput({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
  if (!label) return input;
  return (
    <label className="block text-xs font-medium text-fg/70">
      <span className="mb-1 block">{label}</span>
      {input}
    </label>
  );
}

export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block text-xs font-medium text-fg/70">
      <span className="mb-1 block">{label}</span>
      <select {...props} className={inputClass}>
        {children}
      </select>
    </label>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'brand-gradient text-white hover:opacity-90',
  secondary: 'border border-fg/15 bg-card text-fg hover:bg-raised',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-fg/70 hover:bg-raised hover:text-fg',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'green' | 'amber' | 'red' | 'neutral' | 'purple'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
    red: 'bg-red-500/15 text-red-600 border-red-500/30',
    purple: 'bg-purple-brand/15 text-purple-brand border-purple-brand/30',
    neutral: 'bg-fg/5 text-fg/70 border-fg/15',
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const cls = tone === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-600' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-fg/10 bg-card p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Pagination({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return <p className="mt-3 text-xs text-fg/50">{total} result{total === 1 ? '' : 's'}</p>;
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-fg/60">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button disabled={to >= total} onClick={() => onChange(offset + limit)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** Asks before a destructive action. With `phrase`, the button stays off until it is typed exactly. */
export function ConfirmDialog({
  open,
  title,
  body,
  phrase,
  confirmLabel = 'Delete',
  busy,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  phrase?: string;
  confirmLabel?: string;
  busy?: boolean;
  children?: ReactNode;
  onConfirm: (typed: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTyped('');
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const ready = !phrase || typed.trim() === phrase;
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-fg/15 bg-card p-0 text-fg backdrop:bg-black/60"
    >
      <form
        method="dialog"
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onConfirm(typed.trim());
        }}
      >
        <h3 className="text-lg font-semibold text-red-600">{title}</h3>
        <div className="text-sm text-fg/80">{body}</div>
        {children}
        {phrase && (
          <TextInput
            label={`Type "${phrase}" to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!ready || busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function EmptyRow({ cols, loading, text = 'Nothing matches these filters.' }: { cols: number; loading: boolean; text?: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-10 text-center text-sm text-fg/50">
        {loading ? 'Loading…' : text}
      </td>
    </tr>
  );
}

export const thClass = 'whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-fg/55';
export const tdClass = 'px-3 py-2.5 align-top text-sm';
