/**
 * Final Jeopardy think-music lifecycle E2E.
 * Verifies the synthesized tune stays active across timer ticks, phone
 * submission state updates, Pause/Resume/Reset, and cleanly stops on Reveal.
 *
 * Run (with vite already serving):
 *   npx tsx tests/fj-think-music-e2e.ts
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

const BASE_URL = process.env.FJ_BASE_URL || 'http://127.0.0.1:5173/jeopardy/';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

type ThinkDiag = {
  active: boolean;
  startCount: number;
  stopCount: number;
  beatsScheduled: number;
};

async function getDiag(page: import('playwright').Page): Promise<ThinkDiag> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as {
        __JEOPARDY_THINK_MUSIC__?: { getDiagnostics: () => ThinkDiag };
      }
    ).__JEOPARDY_THINK_MUSIC__;
    if (!hook) {
      return { active: false, startCount: 0, stopCount: 0, beatsScheduled: 0 };
    }
    return hook.getDiagnostics();
  });
}

async function launchBrowser() {
  const systemChrome = '/usr/local/bin/google-chrome';
  if (fs.existsSync(systemChrome)) {
    return chromium.launch({ headless: true, executablePath: systemChrome });
  }
  return chromium.launch({ headless: true });
}

async function runTest() {
  console.log('Starting Final Jeopardy think-music lifecycle E2E...\n');
  const browser = await launchBrowser();

  try {
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const hostPage = await hostContext.newPage();
    hostPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    console.log('1. Setup demo game + buzzer lobby...');
    await hostPage.goto(BASE_URL);
    await hostPage.waitForSelector('.setup');
    await hostPage.getByRole('button', { name: 'Load demo game' }).click();
    await sleep(200);

    await hostPage.getByRole('button', { name: '📱 Start Buzzer Lobby' }).click();
    await hostPage.waitForSelector('.lobby-code-value', { timeout: 15000 });
    const roomCode = (await hostPage.textContent('.lobby-code-value'))?.trim();
    assert(roomCode, 'Room code should be generated');

    const phoneContext = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const phonePage = await phoneContext.newPage();
    await phonePage.goto(`${BASE_URL}#/buzz?room=${roomCode}`);
    await phonePage.fill('input[placeholder="Enter your name"]', 'Alice');
    await phonePage.click('button:has-text("Join Game")');
    await phonePage.waitForSelector('.buzzer-button', { timeout: 20000 });

    // Keep a second local player so Final Jeopardy has a full contestant row
    await hostPage.fill('input[placeholder="Add player without phone..."]', 'Bob');
    await hostPage.locator('.lobby-add-manual button:has-text("Add")').click();
    await sleep(200);

    for (const defaultName of ['Alex', 'Jordan', 'Sam', 'Player 1', 'Player 2', 'Player 3']) {
      const row = hostPage.locator('.lobby-player', { hasText: defaultName });
      if ((await row.count()) > 0) {
        await row.first().locator('button[title="Remove player"]').click();
        await sleep(80);
      }
    }

    await hostPage
      .locator('.player-lobby')
      .getByRole('button', { name: 'Start Game →' })
      .click();
    await hostPage.waitForSelector('.play');

    // Give Alice and Bob positive scores so wagers can be locked
    await hostPage.locator('.board-cell:not(.played)', { hasText: '$400' }).first().click();
    await hostPage.waitForSelector('.clue-overlay');
    await hostPage
      .locator('.clue-overlay .player-box', { hasText: 'Alice' })
      .locator('.score-btn.plus')
      .click();
    await hostPage.locator('.clue-close').click();
    await sleep(150);

    await hostPage.locator('.board-cell:not(.played)', { hasText: '$200' }).first().click();
    await hostPage.waitForSelector('.clue-overlay');
    await hostPage
      .locator('.clue-overlay .player-box', { hasText: 'Bob' })
      .locator('.score-btn.plus')
      .click();
    await hostPage.locator('.clue-close').click();
    await sleep(150);

    console.log('2. Enter Final Jeopardy, lock wagers, reveal clue...');
    await hostPage.getByRole('button', { name: 'Final Jeopardy' }).click();
    await hostPage.waitForSelector('.fj-tv-wagers-stage');

    await phonePage.waitForSelector('.fj-phone-wager-input', { timeout: 10000 });
    await phonePage.fill('.fj-phone-wager-input', '100');
    await phonePage.getByRole('button', { name: 'Lock Wager' }).click();
    await phonePage.waitForSelector('.fj-phone-locked-title:has-text("Wager Locked!")', {
      timeout: 5000,
    });

    await hostPage.getByRole('button', { name: /Enter \/ Override Wagers/i }).click();
    await hostPage.waitForSelector('.fj-host-drawer');
    await hostPage.locator('input[aria-label="Bob wager"]').fill('50');
    await hostPage
      .locator('.fj-host-drawer-row', { hasText: 'Bob' })
      .getByRole('button', { name: 'Lock' })
      .click();
    await sleep(200);

    // Reset diagnostics just before clue reveal so startCount is meaningful
    await hostPage.evaluate(() => {
      (
        window as unknown as {
          __JEOPARDY_THINK_MUSIC__?: { reset: () => void };
        }
      ).__JEOPARDY_THINK_MUSIC__?.reset();
    });

    await hostPage.getByRole('button', { name: /Lock Wagers & Reveal Clue/i }).click();
    await hostPage.waitForSelector('.fj-tv-clue-stage');
    await sleep(400);

    let diag = await getDiag(hostPage);
    assert(diag.active, `music should be active right after clue reveal (diag=${JSON.stringify(diag)})`);
    assert(diag.startCount >= 1, `expected startCount >= 1, got ${diag.startCount}`);
    const beatsAfterStart = diag.beatsScheduled;
    console.log(`   ✓ Music active after clue reveal (beats=${beatsAfterStart})`);

    console.log('3. Verify music stays active across multiple timer ticks...');
    const clock1 = (await hostPage.textContent('.fj-timer-clock'))?.trim();
    await sleep(2500);
    const clock2 = (await hostPage.textContent('.fj-timer-clock'))?.trim();
    assert(clock1 !== clock2, `timer should tick (${clock1} → ${clock2})`);

    diag = await getDiag(hostPage);
    assert(diag.active, `music must still be active after timer ticks (diag=${JSON.stringify(diag)})`);
    assert(
      diag.beatsScheduled > beatsAfterStart,
      `beats should keep growing across ticks (${beatsAfterStart} → ${diag.beatsScheduled})`,
    );
    console.log(
      `   ✓ Music still active after ticks (${clock1} → ${clock2}, beats=${diag.beatsScheduled})`,
    );

    console.log('4. Phone response submission must NOT stop music...');
    await phonePage.waitForSelector('.fj-phone-response-input', { timeout: 10000 });
    await phonePage.fill('.fj-phone-response-input', 'What is a test answer?');
    await phonePage.getByRole('button', { name: /Submit & Lock Response/i }).click();
    await phonePage.waitForSelector('.fj-phone-locked-title:has-text("Response Locked!")', {
      timeout: 5000,
    });
    await sleep(800);

    // Force additional host re-renders the way PeerJS sync / session updates do
    for (let i = 0; i < 3; i++) {
      await sleep(1000);
      diag = await getDiag(hostPage);
      assert(
        diag.active,
        `music must survive submission + re-renders at tick ${i + 1} (diag=${JSON.stringify(diag)})`,
      );
    }
    console.log(`   ✓ Music survived phone submission + re-renders (beats=${diag.beatsScheduled})`);

    console.log('5. Pause / Resume / Reset music behavior...');
    const beatsBeforePause = diag.beatsScheduled;
    await hostPage.getByRole('button', { name: /Pause/i }).click();
    await hostPage.waitForSelector('button:has-text("Resume")', { timeout: 3000 });
    await sleep(300);
    diag = await getDiag(hostPage);
    assert(!diag.active, `music should stop on Pause (diag=${JSON.stringify(diag)})`);
    const stopAfterPause = diag.stopCount;
    console.log('   ✓ Pause stops music');

    await hostPage.getByRole('button', { name: /Resume/i }).click();
    await sleep(500);
    diag = await getDiag(hostPage);
    assert(diag.active, `music should resume (diag=${JSON.stringify(diag)})`);
    assert(diag.startCount >= 2, `resume should start music again (startCount=${diag.startCount})`);
    await sleep(1200);
    diag = await getDiag(hostPage);
    assert(
      diag.beatsScheduled > beatsBeforePause,
      `beats should continue after resume (${beatsBeforePause} → ${diag.beatsScheduled})`,
    );
    console.log('   ✓ Resume restarts music and continues scheduling');

    await hostPage.getByRole('button', { name: /Reset/i }).click();
    await sleep(300);
    const resetClock = (await hostPage.textContent('.fj-timer-clock'))?.trim();
    assert(resetClock === '1:00', `Reset should restore 1:00, got ${resetClock}`);
    diag = await getDiag(hostPage);
    assert(!diag.active, `music should stop on Reset (diag=${JSON.stringify(diag)})`);
    assert(diag.stopCount >= stopAfterPause + 1, 'Reset should stop music');
    console.log('   ✓ Reset stops music and restores 1:00');

    // Restart so we can verify Reveal stop
    await hostPage.getByRole('button', { name: /Start/i }).click();
    await sleep(400);
    diag = await getDiag(hostPage);
    assert(diag.active, 'music should be active after Start');

    console.log('6. Reveal must stop music cleanly...');
    await hostPage.getByRole('button', { name: /Begin Reveal/i }).click();
    await hostPage.waitForSelector('.fj-podium-stage');
    await sleep(300);
    diag = await getDiag(hostPage);
    assert(!diag.active, `music must stop on Reveal (diag=${JSON.stringify(diag)})`);
    console.log('   ✓ Reveal stops music');

    console.log('\nAll think-music lifecycle checks passed.');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('\nThink-music E2E failed:', err);
  process.exit(1);
});
