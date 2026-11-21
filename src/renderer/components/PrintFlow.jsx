import { useEffect, useRef, useState } from 'react';
import { btn } from './ui.jsx';
import FormPreview from './FormPreview.jsx';

const IDLE = { pending: false, path: '', error: '' };

// The one print path (US-15): print(rec) opens the preview, "Save as Excel" continues to the save dialog.
// Render `dialog` once in the page.
export function usePrint() {
  const [printing, setPrinting] = useState(IDLE);
  const [preview, setPreview] = useState(null); // { id, number, formType, model }
  const previewRef = useRef(null);
  const previewSeq = useRef(0); // a preview closed while loading must not reopen when its result arrives
  const saveButtonRef = useRef(null);

  useEffect(() => {
    const d = previewRef.current;
    if (!d) return;
    if (preview && !d.open) d.showModal();
    if (!preview && d.open) d.close();
    if (preview?.model) saveButtonRef.current?.focus(); // the button was disabled while loading, so autoFocus missed it
  }, [preview]);

  async function print(rec) {
    setPrinting({ pending: true, path: '', error: '' });
    const seq = ++previewSeq.current;
    setPreview({ ...rec, model: null });
    const res = await window.api.invoke('records:preview', { id: rec.id });
    if (seq !== previewSeq.current) return;
    if (!res.ok) {
      setPreview(null);
      return setPrinting({ pending: false, path: '', error: res.error });
    }
    setPreview({ ...rec, model: res.data });
  }

  // The dialog's own close event is the one place a closed preview is noticed: Chromium can close a modal
  // dialog on Escape without firing cancel. A print error set before closing is kept.
  function onPreviewClosed() {
    previewSeq.current++;
    setPreview(null);
    setPrinting((p) => (p.error ? p : IDLE));
  }

  async function saveFromPreview() {
    const { id, ids } = preview;
    previewRef.current.close();
    const res = await window.api.invoke('records:print', ids?.length > 1 ? { ids } : { id });
    if (!res.ok) return setPrinting({ pending: false, path: '', error: res.error });
    setPrinting({ pending: false, path: res.data.canceled ? '' : res.data.path, error: '' });
  }

  async function openFile() {
    const res = await window.api.invoke('records:openExport');
    if (!res.ok) setPrinting((p) => ({ ...p, error: res.error }));
  }

  const dialog = (
    <dialog
      ref={previewRef}
      aria-labelledby="preview-title"
      onClose={onPreviewClosed}
      className="m-auto max-h-[90vh] w-full max-w-4xl overflow-auto rounded-md p-6 shadow-[0_15px_35px_hsla(0,0%,0%,.2)] backdrop:bg-slate-900/40"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="preview-title" className="text-lg font-semibold text-slate-900">
            Preview {preview?.formType} {preview?.number}
          </h2>
          {preview?.ids?.length > 1 && (
            <p className="text-sm text-slate-600">Showing {preview.number}. The file has {preview.ids.length} forms.</p>
          )}
        </div>
        {preview && (
          <div className="flex gap-3">
            <button type="button" className={btn.secondary} onClick={() => previewRef.current.close()}>Close</button>
            <button type="button" ref={saveButtonRef} className={btn.primary} disabled={!preview.model} onClick={saveFromPreview}>
              Save as Excel
            </button>
          </div>
        )}
      </div>
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-100 p-4">
        {preview?.model ? <FormPreview model={preview.model} /> : <p className="text-sm text-slate-600">Preparing preview…</p>}
      </div>
    </dialog>
  );

  return { print, printing, resetPrinting: () => setPrinting(IDLE), openFile, dialog };
}
