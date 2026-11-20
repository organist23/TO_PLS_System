export const btn = {
  primary:
    'rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60',
  secondary:
    'rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60',
  danger:
    'rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-60',
  link: 'text-sm font-medium text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-700',
};

export const inputClass =
  'mt-1 block w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-2 focus:outline-blue-700 aria-invalid:border-red-700';

export function Field({ label, error, id, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Banner({ kind = 'error', children, action }) {
  const styles = kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-center justify-between gap-4 rounded-md border px-4 py-3 text-sm ${styles}`}>
      <span>{children}</span>
      {action}
    </div>
  );
}
