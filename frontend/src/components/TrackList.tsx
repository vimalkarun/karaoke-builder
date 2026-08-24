import type { Track } from '../api/client';

const STATUS_LABEL: Record<Track['status'], string> = {
  importing: 'Importing…',
  uploaded: 'Not separated',
  separating: 'Separating…',
  separated: 'Ready',
  error: 'Error',
};

function formatDuration(seconds: number | null) {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TrackList({
  tracks,
  selectedId,
  onSelect,
  onDelete,
}: {
  tracks: Track[];
  selectedId: string | null;
  onSelect: (track: Track) => void;
  onDelete: (track: Track) => void;
}) {
  if (tracks.length === 0) {
    return <p className="empty-state">No tracks yet. Import a file to get started.</p>;
  }

  return (
    <ul className="track-list">
      {tracks.map((track) => (
        <li
          key={track.id}
          className={`track-row ${track.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(track)}
        >
          <div className="track-info">
            <span className="track-title">{track.title}</span>
            <span className="track-meta">
              {formatDuration(track.duration_sec)}
              {track.bpm ? ` · ${Math.round(track.bpm)} BPM` : ''}
              {track.musical_key ? ` · ${track.musical_key}` : ''}
            </span>
          </div>
          <span className={`status-badge status-${track.status}`}>{STATUS_LABEL[track.status]}</span>
          <button
            className="icon-button"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(track);
            }}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
