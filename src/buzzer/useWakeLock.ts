import { useCallback, useEffect, useRef } from 'react';

interface WakeLockSentinelLike {
  readonly released?: boolean;
  release(): Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
}

export interface UseWakeLockResult {
  requestWakeLock: () => Promise<boolean>;
  releaseWakeLock: () => void;
}

/**
 * Keeps the phone screen awake using the Screen Wake Lock API while active.
 * - Call `requestWakeLock()` directly inside the Join tap user gesture so it activates immediately.
 * - Also requests automatically when `active` becomes true (for auto-rejoin on load) and on
 *   first pointer/touch interaction if a browser required a user gesture.
 * - Re-acquires automatically on `visibilitychange` -> visible and `pageshow`.
 * - Fails silently on unsupported browsers (older iOS Safari, etc.).
 */
export function useWakeLock(active: boolean): UseWakeLockResult {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const inFlightRef = useRef(false);
  const wantActiveRef = useRef(active);

  const releaseWakeLock = useCallback(() => {
    wantActiveRef.current = false;
    const current = sentinelRef.current;
    sentinelRef.current = null;
    if (current) {
      try {
        void current.release().catch(() => {
          /* ignore release errors */
        });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const requestWakeLock = useCallback(async (): Promise<boolean> => {
    wantActiveRef.current = true;
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as unknown as NavigatorWithWakeLock;
    if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
      return false;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return false;
    }
    if (sentinelRef.current && sentinelRef.current.released !== true) {
      return true;
    }
    if (inFlightRef.current) {
      return false;
    }

    inFlightRef.current = true;
    try {
      const sentinel = await nav.wakeLock.request('screen');
      if (!wantActiveRef.current) {
        try {
          void sentinel.release().catch(() => {
            /* ignore */
          });
        } catch {
          /* ignore */
        }
        return false;
      }
      sentinelRef.current = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
        }
      });
      return true;
    } catch {
      // Fail silently on unsupported devices, low battery, or gesture-gated environments
      return false;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      releaseWakeLock();
      return;
    }

    wantActiveRef.current = true;
    // Request immediately on activation (handles auto-rejoin on page load)
    void requestWakeLock();

    const handleVisibilityOrShow = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
      }
    };

    const handleFirstGesture = () => {
      if (!sentinelRef.current || sentinelRef.current.released === true) {
        void requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrShow);
    window.addEventListener('pageshow', handleVisibilityOrShow);
    window.addEventListener('pointerdown', handleFirstGesture, { passive: true });
    window.addEventListener('touchstart', handleFirstGesture, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrShow);
      window.removeEventListener('pageshow', handleVisibilityOrShow);
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('touchstart', handleFirstGesture);
    };
  }, [active, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  return { requestWakeLock, releaseWakeLock };
}
