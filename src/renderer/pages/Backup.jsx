import { useState } from 'react';
import { btn, Banner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

// US-13 back up, US-14 restore. signOut(message) returns to Login after a restore.
export default function Backup({ signOut, user }) {
  const [backup, setBackup] = useState({ pending: false, path: '', error: '' });
  const [restore, setRestore] = useState({ file: null, pending: false, error: '' });

  async function backUp() {
    setBackup({ pending: true, path: '', error: '' });
    const res = await window.api.invoke('backup:create');
    if (!res.ok) return setBackup({ pending: false, path: '', error: res.error });
    setBackup({ pending: false, path: res.data.canceled ? '' : res.data.path, error: '' });
  }

  async function pick() {
    setRestore({ file: null, pending: false, error: '' });
    const res = await window.api.invoke('backup:pick');
    if (!res.ok) return setRestore({ file: null, pending: false, error: res.error });
    if (!res.data.canceled) setRestore({ file: res.data.file, pending: false, error: '' });
  }

  async function doRestore() {
    setRestore((r) => ({ ...r, pending: true }));
    const res = await window.api.invoke('backup:restore');
    if (!res.ok) return setRestore({ file: null, pending: false, error: res.error });
    signOut(`Data restored from ${res.data.file}. A backup of the previous data was saved to ${res.data.path}. Please log in again.`);
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Backup</h1>

      <section aria-labelledby="backup-heading" className="space-y-4 rounded-md border border-slate-200 bg-white p-6">
        <div>
          <h2 id="backup-heading" className="text-base font-semibold text-slate-900">Back up</h2>
          <p className="mt-1 text-sm text-slate-600">Saves all records, employees, offices, signatories and users to a .sql file in a folder you choose, for example a USB drive.</p>
        </div>
        <button type="button" className={btn.primary} disabled={backup.pending} onClick={backUp}>
          {backup.pending ? 'Saving backup…' : 'Back up now'}
        </button>
        {backup.path && <Banner kind="success">Backup saved to {backup.path}</Banner>}
        {backup.error && <Banner>{backup.error}</Banner>}
      </section>

      {/* US-14 changed: only an admin can restore (the routes refuse encoders too). */}
      {user?.role === 'admin' && (
      <section aria-labelledby="restore-heading" className="space-y-4 rounded-md border border-slate-200 bg-white p-6">
        <div>
          <h2 id="restore-heading" className="text-base font-semibold text-slate-900">Restore</h2>
          <p className="mt-1 text-sm text-slate-600">Replaces all current data with a backup. A backup of the current data is saved first, and everyone has to log in again.</p>
        </div>
        <button type="button" className={btn.secondary} disabled={restore.pending} onClick={pick}>Restore from a backup</button>
        {restore.error && <Banner>{restore.error}</Banner>}
      </section>
      )}

      <ConfirmDialog
        open={!!restore.file}
        title={restore.file ? `Restore ${restore.file}?` : ''}
        message="All current data will be replaced by this backup. A backup of the current data is saved first."
        confirmLabel="Restore"
        pending={restore.pending}
        onConfirm={doRestore}
        onCancel={() => setRestore({ file: null, pending: false, error: '' })}
      />
    </section>
  );
}
