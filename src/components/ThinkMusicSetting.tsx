import { useEffect, useRef, useState } from 'react';
import {
  clearCustomThinkMusic,
  loadCustomThinkMusic,
  saveCustomThinkMusic,
  subscribeCustomThinkMusicChange,
  type CustomThinkMusicRecord,
} from '../musicStorage';
import { startFinalJeopardyThinkMusic, unlockAudio } from '../sound';

interface ThinkMusicSettingProps {
  compact?: boolean;
  showPreview?: boolean;
  onChange?: (record: CustomThinkMusicRecord | null) => void;
}

export function ThinkMusicSetting({
  compact = false,
  showPreview = false,
  onChange,
}: ThinkMusicSettingProps) {
  const [record, setRecord] = useState<CustomThinkMusicRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewStopRef = useRef<(() => void) | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const stopPreview = () => {
    if (previewStopRef.current) {
      previewStopRef.current();
      previewStopRef.current = null;
    }
    setIsPreviewing(false);
  };

  useEffect(() => {
    let active = true;
    void loadCustomThinkMusic().then((loaded) => {
      if (!active) return;
      setRecord(loaded);
      onChangeRef.current?.(loaded);
    });
    const unsub = subscribeCustomThinkMusicChange((next) => {
      setRecord(next);
      onChangeRef.current?.(next);
    });
    return () => {
      active = false;
      unsub();
      stopPreview();
    };
  }, []);

  const handleFileSelected = async (file: File) => {
    stopPreview();
    setError(null);
    setBusy(true);
    try {
      const saved = await saveCustomThinkMusic(file);
      setRecord(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save music file.');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    stopPreview();
    setError(null);
    setBusy(true);
    try {
      await clearCustomThinkMusic();
      setRecord(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear music file.');
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePreview = () => {
    if (isPreviewing) {
      stopPreview();
      return;
    }
    unlockAudio();
    if (record) {
      const url = URL.createObjectURL(record.blob);
      const audio = new Audio(url);
      audio.loop = true;
      void audio.play().catch(() => {
        setError('Could not play this audio file in your browser.');
        stopPreview();
      });
      previewStopRef.current = () => {
        audio.pause();
        audio.src = '';
        URL.revokeObjectURL(url);
      };
      setIsPreviewing(true);
    } else {
      const stopSynth = startFinalJeopardyThinkMusic(0);
      previewStopRef.current = stopSynth;
      setIsPreviewing(true);
    }
  };

  return (
    <div className={`think-music-setting${compact ? ' compact' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav"
        hidden
        aria-label="Choose custom Final Jeopardy music file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFileSelected(f);
          e.target.value = '';
        }}
      />

      <div className="think-music-row">
        <div className="think-music-info">
          <span className="think-music-label">Think music:</span>{' '}
          {record ? (
            <strong className="think-music-filename" title={record.name}>
              🎵 {record.name}
            </strong>
          ) : (
            <span className="think-music-default">
              Default synthesized tune (60s)
            </span>
          )}
        </div>

        <div className="think-music-actions">
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {record ? 'Change file' : 'Use your own music file'}
          </button>
          {record && (
            <button
              type="button"
              className="btn small danger"
              disabled={busy}
              onClick={() => void handleClear()}
            >
              Clear
            </button>
          )}
          {showPreview && (
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={handleTogglePreview}
            >
              {isPreviewing ? '⏹ Stop' : '▶ Preview'}
            </button>
          )}
        </div>
      </div>

      {!compact && (
        <p className="setup-hint think-music-hint">
          Optional: choose a local .mp3, .m4a, or .wav file to play during the 60-second Final
          Jeopardy countdown. Stored only in this browser (IndexedDB), never uploaded.
        </p>
      )}
      {error && <p className="ai-error think-music-error">{error}</p>}
    </div>
  );
}
