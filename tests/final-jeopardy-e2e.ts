import { chromium } from 'playwright';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/jeopardy/';

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
    await hostPage.waitForSelector('.fj-overlay');

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

    // Verify host screen shows checkmarks ONLY (does NOT expose Alice's $600 wager)
    await hostPage.getByRole('button', { name: 'Continue' }).click();
    await hostPage.waitForSelector('.fj-wager-list');
    const hostWagersText = await hostPage.textContent('.fj-wager-list');
    assert(
      !hostWagersText?.includes('600'),
      'Host wager screen must not display phone-submitted wager amount',
    );
    const lockedBadges = await hostPage.locator('.fj-check-badge').count();
    assert(lockedBadges === 2, `Expected 2 locked badges, got ${lockedBadges}`);
    console.log('   ✓ Host shows checkmarks only (no phone wager content leaked)');

    // Host enters manual wager for Charlie ($300) and advances to clue
    await hostPage.fill('input[aria-label="Charlie wager"]', '300');
    await hostPage.getByRole('button', { name: /Lock wagers/i }).click();
    await hostPage.waitForSelector('.fj-clue-stage');

    // Both phones switch to Clue + Response screen
    await phone1Page.waitForSelector('.fj-phone-response-input', { timeout: 10000 });
    await phone2Page.waitForSelector('.fj-phone-response-input', { timeout: 10000 });
    console.log('   ✓ Both phones received clue and response input');

    // Alice submits response
    await phone1Page.fill('.fj-phone-response-input', 'What is Paris?');
    await phone1Page.getByRole('button', { name: /Submit & Lock Response/i }).click();
    await phone1Page.waitForSelector('.fj-phone-locked-title:has-text("Response Locked!")', {
      timeout: 5000,
    });
    console.log('   ✓ Alice submitted response');

    // Mid-Final Reconnect test: reload Alice's phone and rejoin
    console.log('5. Testing mid-Final phone reconnect for Alice...');
    await phone1Page.reload();
    await phone1Page.waitForSelector('.buzzer-join-btn', { timeout: 10000 });
    await phone1Page.click('.buzzer-join-btn');
    await phone1Page.waitForSelector('.fj-phone-locked-title:has-text("Response Locked!")', {
      timeout: 20000,
    });
    const restoredResponse = await phone1Page.textContent('.fj-phone-secret-response');
    assert(
      restoredResponse?.includes('What is Paris?'),
      `Reconnected Alice should see her locked response, got ${restoredResponse}`,
    );
    console.log('   ✓ Reconnected Alice got her exact locked Final Jeopardy state back');

    // Bob submits response
    await phone2Page.fill('.fj-phone-response-input', 'What is London?');
    await phone2Page.getByRole('button', { name: /Submit & Lock Response/i }).click();
    await phone2Page.waitForSelector('.fj-phone-locked-title:has-text("Response Locked!")', {
      timeout: 5000,
    });

    // Verify host clue screen hides response text (checkmarks only)
    const hostClueText = await hostPage.textContent('.fj-clue-stage');
    assert(
      !hostClueText?.includes('Paris') && !hostClueText?.includes('London'),
      'Host clue screen must not expose player response text',
    );
    console.log('   ✓ Host clue screen shows checkmarks only (no response text leaked)');

    // Test optional 30s Think Timer
    await hostPage.getByRole('button', { name: /Start 30s Think Timer/i }).click();
    await sleep(1200);
    const clockText = await hostPage.textContent('.fj-timer-clock');
    assert(clockText !== '0:30', `Timer should tick down from 0:30, got ${clockText}`);
    await hostPage.getByRole('button', { name: /Pause/i }).click();
    console.log(`   ✓ Think timer ticked down (${clockText}) and paused cleanly`);

    // Begin TV-style Reveal
    console.log('6. Running TV-style reveal (lowest score first)...');
    await hostPage.getByRole('button', { name: /Begin Reveal/i }).click();
    await hostPage.waitForSelector('.fj-podium-stage');

    // Correct response must be hidden initially
    assert(
      (await hostPage.locator('.fj-correct-response-banner').count()) === 0,
      'Correct response must remain hidden until host chooses to reveal it',
    );

    // First up: Bob (-$200)
    assert(
      (await hostPage.textContent('.fj-podium-name'))?.trim() === 'Bob',
      'Lowest scorer (Bob) should be revealed first',
    );
    assert(
      (await hostPage.textContent('.fj-response-big-text'))?.includes('What is London?'),
      'Bob response should be shown big on screen',
    );
    await hostPage.getByRole('button', { name: '✗ Incorrect' }).click();
    await hostPage.getByRole('button', { name: 'Reveal Wager' }).click();
    await sleep(300);
    await hostPage.getByRole('button', { name: /Next Player: Charlie/i }).click();
    console.log('   ✓ Revealed Bob (Incorrect, -$0)');

    // Second up: Charlie ($400, manual player)
    assert(
      (await hostPage.textContent('.fj-podium-name'))?.trim() === 'Charlie',
      'Second lowest scorer (Charlie) should be revealed next',
    );
    await hostPage.getByRole('button', { name: '+ Type response' }).click();
    await hostPage.fill('.fj-response-inline-edit input', 'What is Tokyo?');
    await hostPage.locator('.fj-response-inline-actions button:has-text("Save")').click();
    await hostPage.getByRole('button', { name: '✓ Correct' }).click();
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

    // Third up: Alice ($1,000)
    assert(
      (await hostPage.textContent('.fj-podium-name'))?.trim() === 'Alice',
      'Highest scorer (Alice) should be revealed last',
    );
    assert(
      (await hostPage.textContent('.fj-response-big-text'))?.includes('What is Paris?'),
      'Alice response should be shown big on screen',
    );
    await hostPage.getByRole('button', { name: '✓ Correct' }).click();
    await hostPage.getByRole('button', { name: 'Reveal Wager' }).click();
    await sleep(1000);
    const aliceNewScore = await hostPage.textContent('.fj-podium-score');
    assert(
      aliceNewScore?.includes('$1,600'),
      `Alice score should animate to $1,600, got ${aliceNewScore}`,
    );

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
    await hostPage.getByRole('button', { name: 'Back to board' }).click();
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
