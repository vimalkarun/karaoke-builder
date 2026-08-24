import { useState } from 'react';
import { api } from '../api/client';

export function YoutubeImportButton({ onImportStarted }: { onImportStarted: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setUrl('');
    setConfirmed(false);
    setError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.importYoutube(url);
      onImportStarted();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button className="button" onClick={() => setOpen(true)}>
        Import from YouTube
      </button>

      {open && (
        <div className="modal-backdrop" onClick={reset}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import from YouTube</h2>

            <label className="field">
              Video URL
              <input type="text" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>

            <div className="callout-inline">
              <label className="checkbox-field">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>
                  This is for my own personal/household use. I will not redistribute the downloaded audio, and I understand
                  this may be against YouTube's Terms of Service.
                </span>
              </label>
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="modal-actions">
              <button className="button" onClick={reset}>
                Cancel
              </button>
              <button className="button primary" onClick={submit} disabled={!url || !confirmed || submitting}>
                {submitting ? 'Starting…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
