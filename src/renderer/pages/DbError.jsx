export default function DbError({ message }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div role="alert" className="w-full max-w-lg space-y-3 rounded-md bg-white p-8 shadow-[0_4px_6px_hsla(0,0%,0%,.1)]">
        <h1 className="text-xl font-semibold text-slate-900">Cannot connect to the database</h1>
        <p className="text-sm text-slate-600">Check that MySQL (WAMP) is running and the connection settings are correct, then restart the app.</p>
        <p className="break-words rounded-md bg-slate-100 px-3 py-2 font-mono text-xs text-slate-800">{message}</p>
      </div>
    </main>
  );
}
