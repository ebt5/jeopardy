import {
  advanceToClue,
  advanceToDone,
  advanceToReveal,
  areAllPlayersRevealed,
  clearPlayerVerdict,
  computeRevealOrder,
  createFinalJeopardySession,
  formatScore,
  getPhoneStateForPlayer,
  handlePhoneResponse,
  handlePhoneWager,
  judgePlayer,
  MAX_FJ_RESPONSE_LENGTH,
  nextUnrevealedIndex,
  revealPlayerWager,
  setCorrectResponseShown,
  setHostResponse,
  setHostWager,
  setRevealIndex,
  syncPlayersIntoSession,
} from './final-jeopardy';
import type { FinalJeopardy, Player } from '../types';

const SAMPLE_FJ: FinalJeopardy = {
  category: 'WORLD CAPITALS',
  answer: 'This European capital sits on the Tiber River.',
  question: 'What is Rome?',
};

const SAMPLE_PLAYERS: Player[] = [
  { id: 'p1', name: 'Alice', score: 2400, buzzerPeerId: 'peer-1' },
  { id: 'p2', name: 'Bob', score: -400, buzzerPeerId: 'peer-2' },
  { id: 'p3', name: 'Charlie', score: 1200, isManual: true },
  { id: 'p4', name: 'Dana', score: 1200, buzzerPeerId: 'peer-4' },
];

function runTests() {
  console.log('Running Final Jeopardy message & state flow tests...\n');
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

  function assertDeepEquals(actual: unknown, expected: unknown, message?: string) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(`${message || 'Assertion failed'}: expected ${b}, got ${a}`);
    }
  }

  test('computeRevealOrder sorts lowest score first and preserves tie order', () => {
    const order = computeRevealOrder(SAMPLE_PLAYERS);
    assertDeepEquals(order, ['p2', 'p3', 'p4', 'p1']);
  });

  test('createFinalJeopardySession starts in wager phase with correct response hidden', () => {
    const session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS);
    assertEquals(session.phase, 'wager');
    assertEquals(session.correctResponseShown, false);
    assertEquals(session.category, 'WORLD CAPITALS');
    assertDeepEquals(session.revealOrder, ['p2', 'p3', 'p4', 'p1']);
  });

  test('phone wager validation accepts valid range and rejects invalid values', () => {
    let session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS);

    // Over max rejected
    const over = handlePhoneWager(session, 'p1', 2401);
    assertEquals(typeof over.error, 'string');
    assertEquals(over.session.entries.p1.wagerLocked, false);

    // Negative wager rejected
    const neg = handlePhoneWager(session, 'p1', -10);
    assertEquals(typeof neg.error, 'string');

    // Non-integer wager rejected
    const frac = handlePhoneWager(session, 'p1', 100.5);
    assertEquals(typeof frac.error, 'string');

    // Valid wager accepted
    const ok = handlePhoneWager(session, 'p1', 1500);
    assertEquals(ok.error, undefined);
    session = ok.session;
    assertEquals(session.entries.p1.wager, 1500);
    assertEquals(session.entries.p1.wagerLocked, true);
    assertEquals(session.entries.p1.wagerSource, 'phone');

    // Second submission after lock rejected
    const dup = handlePhoneWager(session, 'p1', 500);
    assertEquals(typeof dup.error, 'string');
    assertEquals(dup.session.entries.p1.wager, 1500);
  });

  test('negative score player has maxWager 0 and can only lock $0', () => {
    const session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS);
    const bobState = getPhoneStateForPlayer(session, SAMPLE_PLAYERS[1]);
    assertEquals(bobState.score, -400);
    assertEquals(bobState.maxWager, 0);

    const bad = handlePhoneWager(session, 'p2', 1);
    assertEquals(typeof bad.error, 'string');

    const ok = handlePhoneWager(session, 'p2', 0);
    assertEquals(ok.error, undefined);
    assertEquals(ok.session.entries.p2.wager, 0);
    assertEquals(ok.session.entries.p2.wagerLocked, true);
  });

  test('phone state strictly isolates players and hides clue during wager phase', () => {
    let session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS);
    session = handlePhoneWager(session, 'p1', 2000).session;

    const aliceState = getPhoneStateForPlayer(session, SAMPLE_PLAYERS[0]);
    const danaState = getPhoneStateForPlayer(session, SAMPLE_PLAYERS[3]);

    assertEquals(aliceState.wagerLocked, true);
    assertEquals(aliceState.wager, 2000);
    assertEquals(aliceState.clue, undefined, 'Clue must stay hidden before host reveals it');

    assertEquals(danaState.wagerLocked, false);
    assertEquals(danaState.wager, undefined, 'Dana must never see Alice wager');
    assertEquals(JSON.stringify(danaState).includes('2000'), false);
    assertEquals(JSON.stringify(aliceState).includes('Rome'), false);
  });

  test('host can override phone wager, enter manual wagers, and advance to clue', () => {
    let session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS);
    session = handlePhoneWager(session, 'p1', 1000).session;

    // Host overrides Alice's wager
    const overridden = setHostWager(session, 'p1', 2400);
    assertEquals(overridden.error, undefined);
    session = overridden.session;
    assertEquals(session.entries.p1.wager, 2400);
    assertEquals(session.entries.p1.wagerSource, 'host');

    // Host enters manual wager for Charlie (p3); Bob (p2) & Dana (p4) not locked -> default 0
    const advanced = advanceToClue(session, { p3: 600 });
    assertEquals(advanced.error, undefined);
    session = advanced.session;

    assertEquals(session.phase, 'clue');
    assertEquals(session.entries.p1.wager, 2400);
    assertEquals(session.entries.p2.wager, 0);
    assertEquals(session.entries.p3.wager, 600);
    assertEquals(session.entries.p4.wager, 0);

    // Late phone wager after advancing to clue is rejected
    const lateWager = handlePhoneWager(session, 'p4', 100);
    assertEquals(typeof lateWager.error, 'string');
  });

  test('phone response submission flow, validation, and cross-player isolation', () => {
    let session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS);

    // Response before clue phase rejected
    const tooEarly = handlePhoneResponse(session, 'p1', 'What is Rome?');
    assertEquals(typeof tooEarly.error, 'string');

    session = handlePhoneWager(session, 'p1', 1000).session;
    session = advanceToClue(session, { p3: 500 }).session;

    // Empty / whitespace response rejected
    const blank = handlePhoneResponse(session, 'p1', '   ');
    assertEquals(typeof blank.error, 'string');

    // Valid response trimmed and locked
    const ok = handlePhoneResponse(session, 'p1', '  What is Rome?  ');
    assertEquals(ok.error, undefined);
    session = ok.session;
    assertEquals(session.entries.p1.response, 'What is Rome?');
    assertEquals(session.entries.p1.responseLocked, true);
    assertEquals(session.entries.p1.responseSource, 'phone');

    // Duplicate response rejected
    const dup = handlePhoneResponse(session, 'p1', 'What is Paris?');
    assertEquals(typeof dup.error, 'string');
    assertEquals(dup.session.entries.p1.response, 'What is Rome?');

    // Very long response is capped at MAX_FJ_RESPONSE_LENGTH
    const longRes = handlePhoneResponse(session, 'p4', 'A'.repeat(MAX_FJ_RESPONSE_LENGTH + 50));
    assertEquals(longRes.error, undefined);
    assertEquals(longRes.session.entries.p4.response.length, MAX_FJ_RESPONSE_LENGTH);
    session = longRes.session;

    // Privacy check: Dana's phone state does NOT include Alice's response, and Alice's does NOT include Dana's
    const alicePhone = getPhoneStateForPlayer(session, SAMPLE_PLAYERS[0]);
    const danaPhone = getPhoneStateForPlayer(session, SAMPLE_PLAYERS[3]);
    assertEquals(alicePhone.clue, SAMPLE_FJ.answer);
    assertEquals(alicePhone.response, 'What is Rome?');
    assertEquals(JSON.stringify(danaPhone).includes('Rome'), false);
    assertEquals(JSON.stringify(alicePhone).includes('AAAA'), false);
  });

  test('phone reconnecting mid-Final restores exact authoritative state across phases', () => {
    let session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS);
    session = handlePhoneWager(session, 'p1', 1200).session;

    // Reconnect during wager phase -> gets wagerLocked=true, wager=1200
    const reconnectWager = getPhoneStateForPlayer(session, {
      id: 'p1',
      name: 'Alice',
      score: 2400,
    });
    assertEquals(reconnectWager.phase, 'wager');
    assertEquals(reconnectWager.wagerLocked, true);
    assertEquals(reconnectWager.wager, 1200);
    assertEquals(reconnectWager.clue, undefined);

    // Advance to clue, Alice disconnects before submitting response, then reconnects
    session = advanceToClue(session).session;
    session = syncPlayersIntoSession(session, SAMPLE_PLAYERS);
    const reconnectClueBefore = getPhoneStateForPlayer(session, {
      id: 'p1',
      name: 'Alice',
      score: 2400,
    });
    assertEquals(reconnectClueBefore.phase, 'clue');
    assertEquals(reconnectClueBefore.clue, SAMPLE_FJ.answer);
    assertEquals(reconnectClueBefore.wagerLocked, true);
    assertEquals(reconnectClueBefore.wager, 1200);
    assertEquals(reconnectClueBefore.responseLocked, false);

    // Alice submits response, disconnects, reconnects -> gets responseLocked=true + her response
    session = handlePhoneResponse(session, 'p1', 'What is Rome?').session;
    const reconnectClueAfter = getPhoneStateForPlayer(session, {
      id: 'p1',
      name: 'Alice',
      score: 2400,
    });
    assertEquals(reconnectClueAfter.responseLocked, true);
    assertEquals(reconnectClueAfter.response, 'What is Rome?');
  });

  test('TV-style reveal flow: lowest score first, manual override, verdict, wager reveal, score delta', () => {
    let session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS);
    session = handlePhoneWager(session, 'p1', 1000).session;
    session = handlePhoneWager(session, 'p2', 0).session;
    session = handlePhoneWager(session, 'p4', 1200).session;
    session = advanceToClue(session, { p3: 400 }).session;

    session = handlePhoneResponse(session, 'p1', 'What is Rome?').session;
    session = handlePhoneResponse(session, 'p2', 'What is Venice?').session;
    session = setHostResponse(session, 'p3', 'What is Rome?');
    // p4 didn't submit (disconnected)

    session = advanceToReveal(session, SAMPLE_PLAYERS);
    assertEquals(session.phase, 'reveal');
    assertEquals(session.correctResponseShown, false);
    assertDeepEquals(session.revealOrder, ['p2', 'p3', 'p4', 'p1']);
    assertEquals(session.revealIndex, 0);

    // Host chooses to reveal correct response explicitly
    session = setCorrectResponseShown(session, true);
    assertEquals(session.correctResponseShown, true);

    // 1. Bob (p2, score -400, wager 0) -> judged incorrect -> delta 0
    session = judgePlayer(session, 'p2', 'incorrect');
    const r1 = revealPlayerWager(session, 'p2');
    assertEquals(r1.scoreDelta, 0);
    session = r1.session;
    assertEquals(areAllPlayersRevealed(session), false);

    // Double reveal is a safe no-op
    const r1Dup = revealPlayerWager(session, 'p2');
    assertEquals(r1Dup.scoreDelta, 0);

    // Next unrevealed is index 1 (Charlie p3)
    const next1 = nextUnrevealedIndex(session);
    assertEquals(next1, 1);
    session = setRevealIndex(session, next1!);

    // 2. Charlie (p3, score 1200, wager 400) -> judge incorrect, undo, then judge correct -> +400
    session = judgePlayer(session, 'p3', 'incorrect');
    session = clearPlayerVerdict(session, 'p3');
    assertEquals(session.entries.p3.verdict, null);
    session = judgePlayer(session, 'p3', 'correct');
    const r2 = revealPlayerWager(session, 'p3');
    assertEquals(r2.scoreDelta, 400);
    session = r2.session;

    // Cannot override wager after reveal
    const afterRevealOverride = setHostWager(session, 'p3', 100);
    assertEquals(typeof afterRevealOverride.error, 'string');

    // 3. Dana (p4, score 1200, wager 1200) -> judged incorrect -> -1200
    const next2 = nextUnrevealedIndex(session);
    assertEquals(next2, 2);
    session = setRevealIndex(session, next2!);
    session = judgePlayer(session, 'p4', 'incorrect');
    const r3 = revealPlayerWager(session, 'p4');
    assertEquals(r3.scoreDelta, -1200);
    session = r3.session;

    // 4. Alice (p1, score 2400, wager 1000) -> judged correct -> +1000
    const next3 = nextUnrevealedIndex(session);
    assertEquals(next3, 3);
    session = setRevealIndex(session, next3!);
    session = judgePlayer(session, 'p1', 'correct');
    const r4 = revealPlayerWager(session, 'p1');
    assertEquals(r4.scoreDelta, 1000);
    session = r4.session;

    assertEquals(areAllPlayersRevealed(session), true);
    assertEquals(nextUnrevealedIndex(session), null);

    // Alice's phone now reflects her revealed result & new score
    const aliceDonePhone = getPhoneStateForPlayer(session, {
      id: 'p1',
      name: 'Alice',
      score: 3400,
    });
    assertEquals(aliceDonePhone.revealResult, 'correct');
    assertEquals(aliceDonePhone.newScore, 3400);
    assertEquals(aliceDonePhone.score, 3400);

    session = advanceToDone(session);
    assertEquals(session.phase, 'done');
  });

  test('syncPlayersIntoSession adds new late-joining player without clobbering existing entries', () => {
    let session = createFinalJeopardySession(SAMPLE_FJ, SAMPLE_PLAYERS.slice(0, 1));
    session = handlePhoneWager(session, 'p1', 900).session;
    session = advanceToClue(session).session;

    const updatedPlayers = [
      ...SAMPLE_PLAYERS.slice(0, 1),
      { id: 'p5', name: 'Eve', score: 0, buzzerPeerId: 'peer-5' },
    ];
    session = syncPlayersIntoSession(session, updatedPlayers);
    assertEquals(session.entries.p1.wager, 900);
    assertEquals(session.entries.p5.wager, 0);
    assertEquals(session.entries.p5.wagerLocked, true);
    assertEquals(session.entries.p5.responseLocked, false);
  });

  test('formatScore formats positive, zero, and negative scores cleanly', () => {
    assertEquals(formatScore(0), '$0');
    assertEquals(formatScore(2400), '$2,400');
    assertEquals(formatScore(-400), '-$400');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
  }
}

runTests();
