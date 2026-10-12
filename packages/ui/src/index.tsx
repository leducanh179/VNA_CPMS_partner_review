import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

export { CpmsIcon } from './icons/cpms-icon';
export type { CpmsIconProps } from './icons/cpms-icon';
export type { CpmsIconName } from './icons/icon-registry';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
};

export function Button({ className = '', variant = 'primary', size = 'md', ...props }: ButtonProps) {
  const variants = {
    primary: 'bg-vna-blue text-white hover:bg-vna-blue/90 focus-visible:ring-vna-gold',
    secondary: 'bg-white text-vna-blue border border-slate-200 hover:border-vna-blue/40',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
  };
  const sizes = {
    sm: 'min-h-8 rounded-lg px-3 py-1.5 text-xs',
    md: 'min-h-10 rounded-xl px-4 py-2 text-sm',
  };

  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5 ${className}`}
      {...props}
    />
  );
}

export function SectionHeading({ eyebrow, children }: PropsWithChildren<{ eyebrow?: string }>) {
  return (
    <div>
      {eyebrow ? <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-vna-gold-dark">{eyebrow}</p> : null}
      <h2 className="text-xl font-semibold tracking-tight text-slate-950">{children}</h2>
    </div>
  );
}

export function StatusBadge({ tone = 'neutral', children }: PropsWithChildren<{ tone?: 'positive' | 'warning' | 'neutral' }>) {
  const tones = {
    positive: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  };

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
};

export function Field({ label, hint, error, className = '', id, ...props }: FieldProps) {
  const fieldId = id ?? props.name;
  return (
    <label className="block text-sm font-medium text-slate-800" htmlFor={fieldId}>
      <span>{label}</span>
      <input
        id={fieldId}
        className={`mt-2 min-h-11 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-vna-blue focus:ring-4 focus:ring-cyan-100 ${error ? 'border-rose-300' : 'border-slate-200'} ${className}`}
        {...props}
      />
      {error ? <span className="mt-1.5 block text-xs text-rose-700">{error}</span> : null}
      {!error && hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string | undefined;
};

export function SelectField({ label, hint, className = '', id, children, ...props }: SelectFieldProps) {
  const fieldId = id ?? props.name;
  return (
    <label className="block text-sm font-medium text-slate-800" htmlFor={fieldId}>
      <span>{label}</span>
      <select
        id={fieldId}
        className={`mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition focus:border-vna-blue focus:ring-4 focus:ring-cyan-100 ${className}`}
        {...props}
      >
        {children}
      </select>
      {hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Tooltip({ label, children }: PropsWithChildren<{ label: string }>) {
  return <span title={label}>{children}</span>;
}

export function LoadingBlock({ label = 'Đang tải dữ liệu…' }: { label?: string }) {
  return (
    <div className="grid min-h-40 place-items-center px-6 py-10 text-sm text-slate-500" role="status">
      <div className="flex items-center gap-3">
        <span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-vna-blue" />
        {label}
      </div>
    </div>
  );
}

export function Toast({ children, tone = 'positive' }: PropsWithChildren<{ tone?: 'positive' | 'warning' }>) {
  const color = tone === 'positive' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <div className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border px-4 py-3 text-sm font-medium shadow-panel ${color}`} role="status">
      {children}
    </div>
  );
}

export function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
