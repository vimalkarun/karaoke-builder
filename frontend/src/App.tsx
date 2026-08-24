import { useEffect, useState } from 'react';
import { api, type Track } from './api/client';
import { UploadButton } from './components/UploadButton';
import { YoutubeImportButton } from './components/YoutubeImportButton';
import { BackupButton } from './components/BackupButton';
import { TrackList } from './components/TrackList';
import { Player } from './components/Player';
import './App.css';

function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const list = await api.listTracks();
      setTracks(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const hasActiveJob = tracks.some((t) => t.status === 'separating' || t.status === 'importing');
    if (!hasActiveJob) return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [tracks]);

  const selected = tracks.find((t) => t.id === selectedId) ?? null;

  const handleUploaded = (track: Track) => {
    setTracks((prev) => [track, ...prev]);
    setSelectedId(track.id);
  };

  const handleTrackChanged = (track: Track) => {
    setTracks((prev) => prev.map((t) => (t.id === track.id ? track : t)));
  };

  const handleDelete = async (track: Track) => {
    if (!confirm(`Delete "${track.title}"? This removes the imported file and any separated stems.`)) return;
    await api.deleteTrack(track.id);
    setTracks((prev) => prev.filter((t) => t.id !== track.id));
    if (selectedId === track.id) setSelectedId(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Karaoke Builder</h1>
        <div className="header-actions">
          <UploadButton onUploaded={handleUploaded} />
          <YoutubeImportButton onImportStarted={refresh} />
          <BackupButton onRestored={refresh} />
        </div>
      </header>

      {loadError && <p className="error-text">Couldn't reach the backend: {loadError}</p>}

      <div className="app-body">
        <aside className="library-panel">
          <TrackList tracks={tracks} selectedId={selectedId} onSelect={(t) => setSelectedId(t.id)} onDelete={handleDelete} />
        </aside>
        <main className="player-panel">
          {selected ? (
            <Player track={selected} onTrackChanged={handleTrackChanged} />
          ) : (
            <p className="empty-state">Select a track from the library, or import one to get started.</p>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
