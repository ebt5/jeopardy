import type { PeerOptions } from 'peerjs';

/**
 * Reliable public STUN servers used for direct NAT traversal.
 * Verified live (no dead/timing-out relays that slow down ICE gathering).
 */
export const STATIC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.relay.metered.ca:80' },
];

/**
 * Baseline PeerJS configuration with STUN servers and pre-gathered ICE candidate pool.
 */
export const PEER_CONFIG: PeerOptions = {
  debug: 0,
  config: {
    iceServers: STATIC_ICE_SERVERS,
    iceCandidatePoolSize: 4,
  },
};

const PUBLIC_TURN_REST_ENDPOINT =
  'https://turn.elixir-webrtc.org/?service=turn&username=jeopardy';
const TURN_FETCH_TIMEOUT_MS = 2500;
const MAX_CACHE_MS = 10 * 60 * 1000;
const TURN_SESSION_CACHE_KEY = 'jeopardy-turn-ice-cache-v1';

interface TurnRestResponse {
  username?: string;
  password?: string;
  ttl?: number;
  uris?: string[];
}

interface CachedTurnEntry {
  servers: RTCIceServer[];
  expiresAt: number;
}

let cachedTurn: CachedTurnEntry | null = null;
let inFlightTurnFetch: Promise<RTCIceServer[]> | null = null;

function readSessionTurnCache(now: number): RTCIceServer[] | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(TURN_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedTurnEntry>;
    if (
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > now &&
      Array.isArray(parsed.servers) &&
      parsed.servers.length > 0
    ) {
      cachedTurn = { servers: parsed.servers, expiresAt: parsed.expiresAt };
      return parsed.servers;
    }
  } catch {
    /* ignore storage errors */
  }
  return null;
}

function writeSessionTurnCache(entry: CachedTurnEntry): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(TURN_SESSION_CACHE_KEY, JSON.stringify(entry));
    }
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Requests short-lived TURN relay credentials from a verified CORS-enabled public
 * TURN REST endpoint so cellular/carrier-NAT and isolated guest Wi-Fi phones can
 * connect via TURN relay when direct P2P WebRTC is blocked.
 * Never throws: returns [] if offline or timed out.
 */
export async function fetchTurnIceServers(
  timeoutMs: number = TURN_FETCH_TIMEOUT_MS,
): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cachedTurn && cachedTurn.expiresAt > now) {
    return cachedTurn.servers;
  }

  const fromSession = readSessionTurnCache(now);
  if (fromSession) {
    return fromSession;
  }

  if (inFlightTurnFetch) {
    return inFlightTurnFetch;
  }

  inFlightTurnFetch = (async () => {
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const res = await fetch(PUBLIC_TURN_REST_ENDPOINT, {
        method: 'POST',
        signal: controller?.signal,
      });
      if (!res.ok) return [];

      const data = (await res.json()) as TurnRestResponse;
      if (
        !Array.isArray(data.uris) ||
        data.uris.length === 0 ||
        typeof data.username !== 'string' ||
        typeof data.password !== 'string'
      ) {
        return [];
      }

      const servers: RTCIceServer[] = [
        {
          urls: data.uris,
          username: data.username,
          credential: data.password,
        },
      ];

      const ttlMs =
        typeof data.ttl === 'number' && data.ttl > 0
          ? Math.min(Math.floor((data.ttl * 1000) / 2), MAX_CACHE_MS)
          : MAX_CACHE_MS;

      const entry: CachedTurnEntry = {
        servers,
        expiresAt: Date.now() + Math.max(ttlMs, 30_000),
      };
      cachedTurn = entry;
      writeSessionTurnCache(entry);
      return servers;
    } catch {
      return [];
    } finally {
      if (timer !== null) clearTimeout(timer);
      inFlightTurnFetch = null;
    }
  })();

  return inFlightTurnFetch;
}

/**
 * Returns PeerOptions populated with STUN + live TURN relay ICE servers.
 * Falls back cleanly to PEER_CONFIG (STUN-only) if the TURN REST fetch fails.
 */
export async function getPeerConfig(
  overrideConfig?: RTCConfiguration,
): Promise<PeerOptions> {
  const turnServers = await fetchTurnIceServers();
  const iceServers = [...STATIC_ICE_SERVERS, ...turnServers];
  return {
    ...PEER_CONFIG,
    config: {
      ...PEER_CONFIG.config,
      ...overrideConfig,
      iceServers,
      iceCandidatePoolSize: 4,
    },
  };
}
