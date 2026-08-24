import { useRef, useState } from 'react';
import { api } from '../api/client';

export function BackupButton({ onRestored }: { onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [includeStems, setIncludeStems] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setOpen(false);
    setResult(null);
    setError(null);
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    setError(null);
    setResult(null);
    try {
      const { restored, skipped } = await api.restoreBackup(file);
      setResult(
        `Restored ${restored} track${restored === 1 ? '' : 's'}` +
          (skipped > 0 ? ` (${skipped} already in the library, skipped).` : '.'),
      );
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <button className="button" onClick={() => setOpen(true)}>
        Backup…
      </button>

      {open && (
        <div className="modal-backdrop" onClick={reset}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Backup &amp; restore</h2>
            <p className="lyrics-hint">
              Your library lives only on this machine's disk — a backup protects it, and lets you move it to another
              machine. Stems are excluded by default since they're the bulk of the size and can always be regenerated
              with Separate; include them if you'd rather skip that wait after restoring.
            </p>

            <label className="checkbox-field">
              <input type="checkbox" checked={includeStems} onChange={(e) => setIncludeStems(e.target.checked)} />
              <span>Include separated stems (much larger file)</span>
            </label>

            <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
              <a className="button primary" href={api.backupDownloadUrl(includeStems)} download>
                Download backup
              </a>
            </div>

            <hr className="modal-divider" />

            <label className="field">
              Restore from a backup file
              <input ref={inputRef} type="file" accept=".zip" onChange={handleRestoreFile} disabled={restoring} />
            </label>
            {restoring && <p className="lyrics-hint">Restoring…</p>}
            {result && <p className="success-text">{result}</p>}
            {error && <p className="error-text">{error}</p>}

            <div className="modal-actions">
              <button className="button" onClick={reset}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
