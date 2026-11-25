import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:5173/jeopardy/';
const SCREENSHOT_DIR = process.env.FJ_SCREENSHOT_DIR || '';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function launchBrowser() {
  const systemChrome = '/usr/local/bin/google-chrome';
  if (fs.existsSync(systemChrome)) {
    return chromium.launch({ headless: true, executablePath: systemChrome });
  }
  return chromium.launch({ headless: true });
}

async function maybeScreenshot(page: import('playwright').Page, filename: string) {
  if (!SCREENSHOT_DIR) return;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const target = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: target });
  console.log(`   📸 Saved screenshot: ${target}`);
}

async function assertHostDomDoesNotContain(
  hostPage: import('playwright').Page,
  forbidden: string[],
  context: string,
) {
  const overlay = hostPage.locator('.fj-overlay');
  const text = (await overlay.textContent()) ?? '';
  const html = await overlay.innerHTML();
  for (const secret of forbidden) {
    assert(
      !text.includes(secret),
      `${context}: host overlay textContent leaked "${secret}"`,
    );
    assert(
      !html.includes(secret),
      `${context}: host overlay innerHTML leaked "${secret}"`,
    );
  }
}

async function runTest() {
  console.log('Starting Final Jeopardy phone integration E2E test...\n');

  const browser = await launchBrowser();

  try {
    const hostContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const hostPage = await hostContext.newPage();

    // Auto-accept confirm dialogs (e.g. unplayed clues confirmation)
    hostPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    console.log('1. Logging in as host and loading demo game...');
    await hostPage.goto(BASE_URL);
    await hostPage.waitForSelector('.login-card');
    await hostPage.fill('input[type="text"]', 'Erik');
    await hostPage.fill('input[type="password"]', 'goose');
    await hostPage.click('button[type="submit"]');
    await hostPage.waitForSelector('.setup');

    await hostPage.getByRole('button', { name: 'Load demo game' }).click();
    await sleep(200);

    // Verify custom local music file upload (IndexedDB) + clear in Setup
    const tinyWav = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x2c, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
      0x40, 0x1f, 0x00, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00,
      0x64, 0x61, 0x74, 0x61, 0x08, 0x00, 0x00, 0x00, 0x80, 0x80, 0x80, 0x80,
      0x80, 0x80, 0x80, 0x80,
    ]);
    await hostPage
      .locator('input[aria-label="Choose custom Final Jeopardy music file"]')
      .setInputFiles({
        name: 'custom-think.wav',
        mimeType: 'audio/wav',
        buffer: tinyWav,
      });
    await hostPage.waitForSelector('.think-music-filename:has-text("custom-think.wav")', {
      timeout: 5000,
    });
    await hostPage.reload();
    await hostPage.waitForSelector('.think-music-filename:has-text("custom-think.wav")', {
      timeout: 5000,
    });
    console.log('   ✓ Custom music file saved and persisted in IndexedDB across reload');

    // Test Clear button reverts to default synthesized tune
    await hostPage.locator('.think-music-setting button:has-text("Clear")').click();
    await hostPage.waitForSelector('.think-music-default', { timeout: 5000 });
    console.log('   ✓ Clear button reverted to default 60s synthesized tune');

    console.log('2. Starting buzzer lobby...');
    await hostPage.getByRole('button', { name: '📱 Start Buzzer Lobby' }).click();
    await hostPage.waitForSelector('.lobby-code-value', { timeout: 15000 });
    const roomCode = (await hostPage.textContent('.lobby-code-value'))?.trim();
    assert(roomCode, 'Room code should be generated');
    console.log(`   ✓ Room started: ${roomCode}`);

    // Connect Phone 1 (Alice) and Phone 2 (Bob)
    const phone1Context = await browser.newContext({
      viewport: { width: 375, height: 740 },
    });
    const phone1Page = await phone1Context.newPage();
    await phone1Page.goto(`${BASE_URL}#/buzz?room=${roomCode}`);
    await phone1Page.fill('input[placeholder="Enter your name"]', 'Alice');
    await phone1Page.click('button:has-text("Join Game")');
    await phone1Page.waitForSelector('.buzzer-button', { timeout: 20000 });
    console.log('   ✓ Phone 1 (Alice) joined');

    const phone2Context = await browser.newContext({
      viewport: { width: 375, height: 740 },
    });
    const phone2Page = await phone2Context.newPage();
    await phone2Page.goto(`${BASE_URL}#/buzz?room=${roomCode}`);
    await phone2Page.fill('input[placeholder="Enter your name"]', 'Bob');
    await phone2Page.click('button:has-text("Join Game")');
    await phone2Page.waitForSelector('.buzzer-button', { timeout: 20000 });
    console.log('   ✓ Phone 2 (Bob) joined');

    await sleep(500);

    // Add manual player Charlie
    await hostPage.fill('input[placeholder="Add player without phone..."]', 'Charlie');
    await hostPage.locator('.lobby-add-manual button:has-text("Add")').click();
    await sleep(300);

    // Remove default demo players so we have exactly Alice, Bob, Charlie
    for (const defaultName of ['Alex', 'Jordan', 'Sam', 'Player 1', 'Player 2', 'Player 3']) {
      const row = hostPage.locator('.lobby-player', { hasText: defaultName });
      if ((await row.count()) > 0) {
        await row.first().locator('button[title="Remove player"]').click();
        await sleep(100);
      }
    }

    console.log('3. Starting game and setting varied scores (including negative)...');
    await hostPage
      .locator('.player-lobby')
      .getByRole('button', { name: 'Start Game →' })
      .click();
    await hostPage.waitForSelector('.play');

    // Open a $1000 clue to give Alice +1000
    await hostPage.locator('.board-cell:not(.played)', { hasText: '$1000' }).first().click();
    await hostPage.waitForSelector('.clue-overlay');
    await hostPage
      .locator('.clue-overlay .player-box', { hasText: 'Alice' })
      .locator('.score-btn.plus')
      .click();
    await hostPage.locator('.clue-close').click();
    await sleep(200);

    // Open a $400 clue to give Charlie +400
    await hostPage.locator('.board-cell:not(.played)', { hasText: '$400' }).first().click();
    await hostPage.waitForSelector('.clue-overlay');
    await hostPage
      .locator('.clue-overlay .player-box', { hasText: 'Charlie' })
      .locator('.score-btn.plus')
      .click();
    await hostPage.locator('.clue-close').click();
    await sleep(200);

    // Open a $200 clue to give Bob -200
    await hostPage.locator('.board-cell:not(.played)', { hasText: '$200' }).first().click();
    await hostPage.waitForSelector('.clue-overlay');
    await hostPage
      .locator('.clue-overlay .player-box', { hasText: 'Bob' })
      .locator('.score-btn.minus')
      .click();
    await hostPage.locator('.clue-close').click();
    await sleep(200);
    console.log('   ✓ Scores set: Alice $1,000, Charlie $400, Bob -$200');

    console.log('4. Starting Final Jeopardy...');
    await hostPage.getByRole('button', { name: 'Final Jeopardy' }).click();
    await hostPage.waitForSelector('.fj-tv-wagers-stage');

    // ThinkMusicSetting must NOT appear on the Final Jeopardy screen
    assert(
      (await hostPage.locator('.think-music-setting').count()) === 0,
      'ThinkMusicSetting must not appear on Final Jeopardy screen',
    );
    assert(
      !(await hostPage.locator('.fj-overlay').textContent())?.includes('Use your own music'),
      'Final Jeopardy screen must not show custom music uploader UI',
    );
    // Host drawer must be collapsed by default
    assert(
      (await hostPage.locator('.fj-host-drawer').count()) === 0,
      'Host override drawer should be collapsed by default',
    );

    // Both phones should immediately switch to Final Jeopardy wager screen
    await phone1Page.waitForSelector('.fj-phone-wager-input', { timeout: 10000 });
    await phone2Page.waitForSelector('.fj-phone-wager-input', { timeout: 10000 });
    console.log('   ✓ Both phones switched to Final Jeopardy wager screen');

    // Verify Alice sees $1,000 and can lock $600
    const aliceScoreText = await phone1Page.textContent('.fj-phone-big-score');
    assert(aliceScoreText?.includes('$1,000'), `Alice should see $1,000, got ${aliceScoreText}`);
    await phone1Page.fill('.fj-phone-wager-input', '600');
    await phone1Page.getByRole('button', { name: 'Lock Wager' }).click();
    await phone1Page.waitForSelector('.fj-phone-locked-title:has-text("Wager Locked!")', {
      timeout: 5000,
    });
    console.log('   ✓ Alice locked $600 wager');

    // Verify Bob (negative score) sees -$200, input disabled at 0, and can lock $0
    const bobScoreText = await phone2Page.textContent('.fj-phone-big-score');
    assert(bobScoreText?.includes('-$200'), `Bob should see -$200, got ${bobScoreText}`);
    const bobInputDisabled = await phone2Page.locator('.fj-phone-wager-input').isDisabled();
    assert(bobInputDisabled, 'Bob wager input should be disabled when score <= 0');
    await phone2Page.getByRole('button', { name: 'Lock $0 Wager' }).click();
    await phone2Page.waitForSelector('.fj-phone-locked-title:has-text("Wager Locked!")', {
      timeout: 5000,
    });
    console.log('   ✓ Bob (negative score) locked $0 wager');

    // Wait briefly for host state update, then verify host screen shows neutral status ONLY
    await hostPage.waitForFunction(
      () => document.querySelectorAll('.fj-contestant-card.is-locked').length === 2,
      undefined,
      { timeout: 5000 },
    );
    await sleep(300);
    await assertHostDomDoesNotContain(hostPage, ['600'], 'Wagering phase after phone lock');
    await maybeScreenshot(hostPage, 'fj-host-wagering.png');
    console.log('   ✓ Host wagering screen shows neutral status only (no wager amount in DOM)');

    // Host opens collapsed drawer to enter manual wager for Charlie ($300) using masked input
    await hostPage.getByRole('button', { name: /Enter \/ Override Wagers/i }).click();
    await hostPage.waitForSelector('.fj-host-drawer');

    const aliceWagerInput = hostPage.locator('input[aria-label="Alice wager"]');
    const charlieWagerInput = hostPage.locator('input[aria-label="Charlie wager"]');
    assert(
      (await aliceWagerInput.getAttribute('type')) === 'password',
      'Host wager override input must be masked (type="password")',
    );
    assert(
      (await aliceWagerInput.inputValue()) === '',
      'Host wager override input must not pre-fill secret phone wager',
    );
    assert(
      (await charlieWagerInput.getAttribute('type')) === 'password',
      'Manual wager input must be masked (type="password")',
    );
    await assertHostDomDoesNotContain(hostPage, ['600'], 'Wagering drawer open');

    await charlieWagerInput.fill('300');
    await hostPage
      .locator('.fj-host-drawer-row', { hasText: 'Charlie' })
      .getByRole('button', { name: 'Lock' })
      .click();
    await hostPage.waitForFunction(
      () => document.querySelectorAll('.fj-contestant-card.is-locked').length === 3,
      undefined,
      { timeout: 5000 },
    );
    assert(
      (await charlieWagerInput.inputValue()) === '',
      'Manual wager input must clear immediately after locking',
    );
    await assertHostDomDoesNotContain(hostPage, ['600', '300'], 'After locking manual wager');
    console.log('   ✓ Host entered Charlie $300 via masked drawer input (cleared & hidden from DOM)');

    // Advance to Clue & 60s Timer
    await hostPage.getByRole('button', { name: /Lock Wagers & Reveal Clue/i }).click();
    await hostPage.waitForSelector('.fj-tv-clue-stage');

    // ThinkMusicSetting must NOT appear on Clue screen either, and wager amounts stay absent
    assert(
      (await hostPage.locator('.think-music-setting').count()) === 0,
      'ThinkMusicSetting must not appear on Final Jeopardy clue screen',
    );
    await assertHostDomDoesNotContain(hostPage, ['600', '300'], 'Clue phase start');

    // Timer & music should auto-start immediately at 1:00 and tick down automatically
    await sleep(1300);
    const autoClock = (await hostPage.textContent('.fj-timer-clock'))?.trim();
    assert(
      autoClock && autoClock !== '1:00' && autoClock.startsWith('0:5'),
      `60s timer should auto-start and tick down into 0:5x, got ${autoClock}`,
    );
    console.log(`   ✓ 60s timer auto-started on clue reveal (clock: ${autoClock})`);

    // Both phones switch to Clue + Response screen and show the synced countdown
    await phone1Page.waitForSelector('.fj-phone-response-input', { timeout: 10000 });
    await phone2Page.waitForSelector('.fj-phone-response-input', { timeout: 10000 });
    await phone1Page.waitForSelector('.fj-phone-timer-clock', { timeout: 5000 });
    const phone1Clock = (await phone1Page.textContent('.fj-phone-timer-clock'))?.trim();
    assert(
      phone1Clock && phone1Clock.startsWith('0:5'),
      `Phone 1 should show synced countdown (0:5x), got ${phone1Clock}`,
    );
    console.log(`   ✓ Both phones received clue, response input, and synced timer (${phone1Clock})`);

    // Alice submits response
    await phone1Page.fill('.fj-phone-response-input', 'What is the Berlin Wall?');
    await phone1Page.getByRole('button', { name: /Submit & Lock Response/i }).click();
    await phone1Page.waitForSelector('.fj-phone-locked-title:has-text("Response Locked!")', {
      timeout: 5000,
    });
    console.log('   ✓ Alice submitted response');

    // Mid-Final Reconnect test: reload Alice's phone — should auto-rejoin WITHOUT showing name form
    console.log('5. Testing seamless mid-Final phone auto-rejoin on reload for Alice...');
    await phone1Page.reload();
    await phone1Page.waitForSelector('.fj-phone-locked-title:has-text("Response Locked!")', {
      timeout: 20000,
    });
    assert(
      (await phone1Page.locator('.buzzer-join-btn').count()) === 0,
      'Reloaded phone should auto-rejoin without showing the name form',
    );
    const restoredResponse = await phone1Page.textContent('.fj-phone-secret-response');
    assert(
      restoredResponse?.includes('What is the Berlin Wall?'),
      `Reconnected Alice should see her locked response, got ${restoredResponse}`,
    );
    console.log('   ✓ Reloaded Alice auto-rejoined seamlessly (no name form) with exact locked FJ state');

    // Bob submits response
    await phone2Page.fill('.fj-phone-response-input', 'What is the Iron Curtain?');
    await phone2Page.getByRole('button', { name: /Submit & Lock Response/i }).click();
    await phone2Page.waitForSelector('.fj-phone-locked-title:has-text("Response Locked!")', {
      timeout: 5000,
    });

    await hostPage.waitForFunction(
      () => document.querySelectorAll('.fj-contestant-card.is-locked').length === 2,
      undefined,
      { timeout: 5000 },
    );
    await sleep(300);

    // Verify host clue screen hides response text AND wager amounts completely
    await assertHostDomDoesNotContain(
      hostPage,
      ['Berlin', 'Iron Curtain', '600', '300'],
      'Clue phase after phone responses locked',
    );
    await maybeScreenshot(hostPage, 'fj-host-clue-timer.png');
    console.log('   ✓ Host clue screen shows neutral checkmarks only (no responses or wagers in DOM)');

    // Verify clue-phase Overrides drawer uses masked password inputs and never exposes text
    await hostPage.getByRole('button', { name: 'Overrides' }).click();
    await hostPage.waitForSelector('.fj-host-drawer');
    const aliceRespOverride = hostPage.locator('input[aria-label="Alice response"]');
    assert(
      (await aliceRespOverride.getAttribute('type')) === 'password',
      'Clue-phase response override input must be masked (type="password")',
    );
    assert(
      (await aliceRespOverride.inputValue()) === '',
      'Clue-phase response override input must not leak phone response',
    );
    await assertHostDomDoesNotContain(
      hostPage,
      ['Berlin', 'Iron Curtain', '600', '300'],
      'Clue phase with Overrides drawer open',
    );
    await hostPage.locator('.fj-host-drawer button:has-text("Done")').click();

    // Test Pause / Music Off / Reset controls in bottom host bar
    await hostPage.getByRole('button', { name: /Pause/i }).click();
    await hostPage.waitForSelector('button:has-text("Resume")', { timeout: 3000 });
    await hostPage.getByRole('button', { name: /Music On/i }).click();
    await hostPage.waitForSelector('button:has-text("Music Off")', { timeout: 3000 });
    await hostPage.getByRole('button', { name: /Reset/i }).click();
    const resetClock = (await hostPage.textContent('.fj-timer-clock'))?.trim();
    assert(resetClock === '1:00', `Reset should restore timer to 1:00, got ${resetClock}`);
    console.log('   ✓ Pause, Music On/Off, Reset (to 1:00), and masked Overrides drawer verified');

    // Begin TV-style Reveal
    console.log('6. Running TV-style reveal (lowest score first)...');
    await hostPage.getByRole('button', { name: /Begin Reveal/i }).click();
    await hostPage.waitForSelector('.fj-podium-stage');

    // Correct response must be hidden initially; unrevealed wagers (300, 600) must NOT be in DOM
    assert(
      (await hostPage.locator('.fj-correct-response-banner').count()) === 0,
      'Correct response must remain hidden until host chooses to reveal it',
    );
    await assertHostDomDoesNotContain(
      hostPage,
      ['600', '300', 'Berlin'],
      'Reveal phase on Bob (first player) before other players revealed',
    );

    // First up: Bob (-$200)
    assert(
      (await hostPage.textContent('.fj-podium-name'))?.trim() === 'Bob',
      'Lowest scorer (Bob) should be revealed first',
    );
    assert(
      (await hostPage.textContent('.fj-response-big-text'))?.includes('What is the Iron Curtain?'),
      'Bob response should be shown big on screen',
    );
    await hostPage.getByRole('button', { name: '✗ Incorrect' }).click();
    await hostPage.getByRole('button', { name: 'Reveal Wager' }).click();
    await sleep(300);
    await hostPage.getByRole('button', { name: /Next Player: Charlie/i }).click();
    console.log('   ✓ Revealed Bob (Incorrect, -$0)');

    // Second up: Charlie ($400, manual player) — wager $300 must STILL be hidden before Reveal Wager
    assert(
      (await hostPage.textContent('.fj-podium-name'))?.trim() === 'Charlie',
      'Second lowest scorer (Charlie) should be revealed next',
    );
    await assertHostDomDoesNotContain(
      hostPage,
      ['300', '600'],
      'Reveal phase on Charlie before Reveal Wager',
    );

    await hostPage.getByRole('button', { name: '+ Type Response / Override' }).click();
    await hostPage.waitForSelector('.fj-host-drawer');
    const revealWagerOverride = hostPage.locator('input[aria-label="Override player wager"]');
    assert(
      (await revealWagerOverride.getAttribute('type')) === 'password',
      'Reveal wager override input must be masked (type="password")',
    );
    assert(
      (await revealWagerOverride.inputValue()) === '',
      'Reveal wager override input must not leak unrevealed wager',
    );
    await hostPage.fill('input[aria-label="Edit player response"]', 'What is the Berlin Wall?');
    await hostPage.locator('.fj-host-drawer button:has-text("Save")').click();

    await hostPage.getByRole('button', { name: '✓ Correct' }).click();
    // Still hidden before clicking Reveal Wager!
    await assertHostDomDoesNotContain(
      hostPage,
      ['300', '600'],
      'Reveal phase on Charlie after judging, before Reveal Wager',
    );

    await hostPage.getByRole('button', { name: 'Reveal Wager' }).click();
    await sleep(1000);
    const charlieNewScore = await hostPage.textContent('.fj-podium-score');
    assert(
      charlieNewScore?.includes('$700'),
      `Charlie score should animate to $700, got ${charlieNewScore}`,
    );
    await hostPage.getByRole('button', { name: /Next Player: Alice/i }).click();
    console.log('   ✓ Revealed Charlie (manual response, Correct, +$300 -> $700)');

    // Host now chooses to reveal correct response
    await hostPage.getByRole('button', { name: 'Reveal Correct Response' }).click();
    await hostPage.waitForSelector('.fj-correct-response-banner');
    console.log('   ✓ Host explicitly revealed correct response');

    // Third up: Alice ($1,000) — $600 must NOT appear in DOM until Reveal Wager is clicked
    assert(
      (await hostPage.textContent('.fj-podium-name'))?.trim() === 'Alice',
      'Highest scorer (Alice) should be revealed last',
    );
    assert(
      (await hostPage.textContent('.fj-response-big-text'))?.includes('What is the Berlin Wall?'),
      'Alice response should be shown big on screen',
    );
    await assertHostDomDoesNotContain(
      hostPage,
      ['600'],
      'Reveal phase on Alice before Reveal Wager',
    );

    await hostPage.getByRole('button', { name: '✓ Correct' }).click();
    await assertHostDomDoesNotContain(
      hostPage,
      ['600'],
      'Reveal phase on Alice after judging, before Reveal Wager',
    );

    await hostPage.getByRole('button', { name: 'Reveal Wager' }).click();
    await sleep(1000);
    const aliceNewScore = await hostPage.textContent('.fj-podium-score');
    assert(
      aliceNewScore?.includes('$1,600'),
      `Alice score should animate to $1,600, got ${aliceNewScore}`,
    );
    await maybeScreenshot(hostPage, 'fj-host-reveal.png');

    // Check Alice's phone received her revealed result & final score
    await phone1Page.waitForSelector('.fj-phone-result-badge.correct', { timeout: 5000 });
    console.log('   ✓ Revealed Alice (Correct, +$600 -> $1,600) and phone updated');

    // Show final scores
    await hostPage.getByRole('button', { name: /Show Final Scores/i }).click();
    await hostPage.waitForSelector('.fj-final-list');
    const winnerText = await hostPage.textContent('.fj-final-list li.winner');
    assert(
      winnerText?.includes('Alice') && winnerText?.includes('$1,600'),
      `Winner should be Alice with $1,600, got ${winnerText}`,
    );
    console.log('   ✓ Final scores screen verified');

    // Exit Final Jeopardy -> phones return to buzzer screen
    await hostPage.getByRole('button', { name: 'Back to Board' }).click();
    await phone1Page.waitForSelector('.buzzer-button', { timeout: 5000 });
    await phone2Page.waitForSelector('.buzzer-button', { timeout: 5000 });
    console.log('   ✓ Phones returned to buzzer screen after Final Jeopardy closed');

    await phone1Context.close();
    await phone2Context.close();
    await hostContext.close();

    console.log('\n✓ Final Jeopardy E2E test passed completely!');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('\n✗ Final Jeopardy E2E test failed:', err);
  process.exit(1);
});
