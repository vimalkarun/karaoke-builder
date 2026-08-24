import { useRef, useState } from 'react';
import { api, type Track } from '../api/client';

export function UploadButton({ onUploaded }: { onUploaded: (track: Track) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const track = await api.uploadTrack(file);
        onUploaded(track);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="upload-button">
      <label className="button primary">
        {uploading ? 'Uploading…' : 'Import track'}
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac"
          multiple
          onChange={handleChange}
          disabled={uploading}
          hidden
        />
      </label>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
