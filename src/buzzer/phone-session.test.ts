import {
  clearPhoneIdentity,
  getOrCreateDeviceId,
  getReconnectDelayMs,
  loadLastPlayerName,
  loadPhoneIdentity,
  reconcileBuzzerPlayers,
  rotateDeviceId,
  savePhoneIdentity,
  updatePhoneIdentityGamePlayerId,
  type StorageLike,
} from './phone-session';
import type { Player } from '../types';
import type { BuzzerPlayer } from './types';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function runTests() {
  console.log('Running phone-session & reconnection unit tests...\n');
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (e) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${e}`);
      failed++;
    }
  }

  function assertEquals<T>(actual: T, expected: T, message?: string) {
    if (actual !== expected) {
      throw new Error(
        `${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }

  test('savePhoneIdentity and loadPhoneIdentity persist per room (case-insensitive)', () => {
    const storage = createMemoryStorage();
    savePhoneIdentity(
      {
        roomCode: 'ab12',
        name: 'Alice',
        deviceId: 'dev-1',
        gamePlayerId: 'p1',
      },
      storage,
    );

    const loaded = loadPhoneIdentity('AB12', storage);
    assertEquals(loaded?.roomCode, 'AB12');
    assertEquals(loaded?.name, 'Alice');
    assertEquals(loaded?.deviceId, 'dev-1');
    assertEquals(loaded?.gamePlayerId, 'p1');
    assertEquals(loadLastPlayerName(storage), 'Alice');

    // Different room has no identity
    assertEquals(loadPhoneIdentity('WXYZ', storage), null);
  });

  test('updatePhoneIdentityGamePlayerId updates saved gamePlayerId in place', () => {
    const storage = createMemoryStorage();
    savePhoneIdentity(
      { roomCode: 'ROOM', name: 'Bob', deviceId: 'dev-bob' },
      storage,
    );
    assertEquals(loadPhoneIdentity('ROOM', storage)?.gamePlayerId, undefined);

    updatePhoneIdentityGamePlayerId('room', 'p-bob', storage);
    const updated = loadPhoneIdentity('ROOM', storage);
    assertEquals(updated?.gamePlayerId, 'p-bob');
    assertEquals(updated?.name, 'Bob');
    assertEquals(updated?.deviceId, 'dev-bob');
  });

  test('clearPhoneIdentity clears only that room', () => {
    const storage = createMemoryStorage();
    savePhoneIdentity({ roomCode: 'AAA1', name: 'Alice', deviceId: 'dev-1' }, storage);
    savePhoneIdentity({ roomCode: 'BBB2', name: 'Alice', deviceId: 'dev-1' }, storage);

    clearPhoneIdentity('aaa1', storage);
    assertEquals(loadPhoneIdentity('AAA1', storage), null);
    assertEquals(loadPhoneIdentity('BBB2', storage)?.name, 'Alice');
  });

  test('getOrCreateDeviceId stays stable until rotateDeviceId is called', () => {
    const storage = createMemoryStorage();
    const id1 = getOrCreateDeviceId(storage);
    const id2 = getOrCreateDeviceId(storage);
    assertEquals(id1, id2);

    const rotated = rotateDeviceId(storage);
    assertEquals(rotated !== id1, true, 'rotateDeviceId must issue a new ID');
    assertEquals(getOrCreateDeviceId(storage), rotated);
  });

  test('getReconnectDelayMs uses exponential backoff 0.5s, 1s, 2s, 4s, capped at 5s', () => {
    assertEquals(getReconnectDelayMs(0), 500);
    assertEquals(getReconnectDelayMs(1), 1000);
    assertEquals(getReconnectDelayMs(2), 2000);
    assertEquals(getReconnectDelayMs(3), 4000);
    assertEquals(getReconnectDelayMs(4), 5000);
    assertEquals(getReconnectDelayMs(10), 5000);
  });

  test('reconcileBuzzerPlayers reattaches same deviceId without duplicate even before stale peer closes', () => {
    const deviceMap = new Map<string, string>();
    const initialPlayers: Player[] = [
      { id: 'p1', name: 'Alice', score: 1200, buzzerPeerId: 'peer-old', buzzerDeviceId: 'dev-a' },
    ];
    deviceMap.set('dev-a', 'p1');

    const prevBuzzer: BuzzerPlayer[] = [
      { peerId: 'peer-old', name: 'Alice', gamePlayerId: 'p1', deviceId: 'dev-a' },
    ];
    // Reconnected peer arrives with new peerId, same deviceId
    const nextBuzzer: BuzzerPlayer[] = [
      { peerId: 'peer-new', name: 'Alice', gamePlayerId: 'p1', deviceId: 'dev-a' },
    ];

    const res = reconcileBuzzerPlayers(initialPlayers, nextBuzzer, prevBuzzer, deviceMap);
    assertEquals(res.players.length, 1, 'Must not create a duplicate player');
    assertEquals(res.players[0].id, 'p1');
    assertEquals(res.players[0].score, 1200, 'Must preserve score');
    assertEquals(res.players[0].buzzerPeerId, 'peer-new', 'Must replace stale peerId');
    assertEquals(res.players[0].buzzerDeviceId, 'dev-a');
  });

  test('reconcileBuzzerPlayers matches via persisted Player.buzzerDeviceId or gamePlayerId when map is cold', () => {
    const coldMap = new Map<string, string>();
    const initialPlayers: Player[] = [
      { id: 'p1', name: 'Alice', score: 800, buzzerPeerId: 'peer-stale', buzzerDeviceId: 'dev-a' },
      { id: 'p2', name: 'Bob', score: 400, buzzerPeerId: 'peer-stale-2' },
    ];

    const res = reconcileBuzzerPlayers(
      initialPlayers,
      [
        { peerId: 'peer-a2', name: 'Alice', deviceId: 'dev-a' },
        { peerId: 'peer-b2', name: 'Bob', gamePlayerId: 'p2', deviceId: 'dev-b' },
      ],
      [],
      coldMap,
    );

    assertEquals(res.players.length, 2, 'No duplicates when map is cold');
    assertEquals(res.players[0].buzzerPeerId, 'peer-a2');
    assertEquals(res.players[0].score, 800);
    assertEquals(res.players[1].buzzerPeerId, 'peer-b2');
    assertEquals(res.players[1].score, 400);
    assertEquals(res.players[1].buzzerDeviceId, 'dev-b');
  });

  test('reconcileBuzzerPlayers creates a separate player when deviceId was rotated for a new name', () => {
    const deviceMap = new Map<string, string>([['dev-alice', 'p1']]);
    const initialPlayers: Player[] = [
      { id: 'p1', name: 'Alice', score: 600, buzzerDeviceId: 'dev-alice' },
    ];

    const res = reconcileBuzzerPlayers(
      initialPlayers,
      [{ peerId: 'peer-dana', name: 'Dana', deviceId: 'dev-dana' }],
      [],
      deviceMap,
      () => 'p-new',
    );

    assertEquals(res.players.length, 2);
    assertEquals(res.players[0].name, 'Alice');
    assertEquals(res.players[0].score, 600);
    assertEquals(res.players[1].id, 'p-new');
    assertEquals(res.players[1].name, 'Dana');
    assertEquals(res.players[1].buzzerPeerId, 'peer-dana');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
  }
}

runTests();
