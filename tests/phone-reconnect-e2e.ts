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

interface PhoneWindowHooks extends Window {
  __wakeLockRequests?: number;
  __wakeLockReleases?: number;
  __activeWakeLocks?: Array<{
    released: boolean;
    triggerRelease: () => void;
  }>;
  __rtcConnections?: RTCPeerConnection[];
  __simulateSleepAndWake?: () => void;
}

async function runTest() {
  console.log('Starting phone auto-reconnect, Wake Lock & 15-player layout E2E test...\n');

  const browser = await launchBrowser();

  try {
    const hostContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const hostPage = await hostContext.newPage();
    hostPage.on('pageerror', (err) => console.error('HOST PAGEERROR:', err));
    hostPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    console.log('1. Opening host setup directly (no login), verifying BYOK xAI key UI, and starting buzzer lobby...');
    await hostPage.goto(BASE_URL);
    await hostPage.waitForSelector('.setup');
    assert(
      (await hostPage.locator('.login-card').count()) === 0,
      'App must open straight to Setup with no login gate',
    );

    // Verify BYOK xAI API key controls (no default key, localStorage-only, inline prompt, Forget key)
    const keyInput = hostPage.locator('#byok-api-key-input');
    const keyStatus = hostPage.locator('.api-key-status');
    const forgetBtn = hostPage.getByRole('button', { name: 'Forget key' });
    assert((await keyInput.getAttribute('type')) === 'password', 'API key input must default to password type');
    assert((await keyInput.inputValue()) === '', 'API key input must start empty with no baked-in default');
    assert(
      (await keyStatus.textContent())?.trim() === 'No key',
      `Expected "No key" status, got ${await keyStatus.textContent()}`,
    );
    assert(await forgetBtn.isDisabled(), 'Forget key should be disabled when no key is saved');
    assert(
      (await hostPage.locator('a[href="https://console.x.ai"]').count()) === 1,
      'Setup must link to https://console.x.ai',
    );

    // Clicking Generate with no key shows an inline error prompt (no crash)
    await hostPage.getByRole('button', { name: 'Generate game' }).click();
    await hostPage.waitForSelector('.ai-error', { timeout: 3000 });

    // Saving a key persists only in localStorage, never leaks to game config or saved boards
    const dummyKey = 'test-browser-only-key-999';
    await keyInput.fill(dummyKey);
    assert(
      (await keyStatus.textContent())?.trim() === 'Key saved in this browser',
      'Status should update to "Key saved in this browser"',
    );
    await hostPage.getByRole('button', { name: 'Show' }).click();
    assert((await keyInput.getAttribute('type')) === 'text', 'Show button should toggle input to text');
    await hostPage.getByRole('button', { name: 'Hide' }).click();
    assert((await keyInput.getAttribute('type')) === 'password', 'Hide button should toggle input back to password');

    await hostPage.reload();
    await hostPage.waitForSelector('.setup');
    assert(
      (await hostPage.locator('.api-key-status').textContent())?.trim() === 'Key saved in this browser',
      'Saved key status should persist in localStorage across reload',
    );
    const leakedIntoConfig = await hostPage.evaluate((k) => {
      const cfg = localStorage.getItem('jeopardy-game-config') ?? '';
      const boards = localStorage.getItem('jeopardy-saved-boards') ?? '';
      return cfg.includes(k) || boards.includes(k);
    }, dummyKey);
    assert(!leakedIntoConfig, 'API key must never be stored in game config or saved boards');

    await hostPage.getByRole('button', { name: 'Forget key' }).click();
    assert(
      (await hostPage.locator('.api-key-status').textContent())?.trim() === 'No key',
      'Forget key must revert status to "No key"',
    );
    const keyAfterForget = await hostPage.evaluate(() => localStorage.getItem('jeopardy_xai_api_key'));
    assert(keyAfterForget === null, 'Forget key must remove key from localStorage');
    console.log('   ✓ Direct-to-Setup (no login) and BYOK xAI API key UI verified');

    await hostPage.getByRole('button', { name: 'Load demo game' }).click();
    await sleep(200);

    await hostPage.getByRole('button', { name: '📱 Start Buzzer Lobby' }).click();
    await hostPage.waitForSelector('.lobby-code-value', { timeout: 15000 });
    const roomCode = (await hostPage.textContent('.lobby-code-value'))?.trim();
    assert(roomCode, 'Room code should be generated');
    console.log(`   ✓ Room started: ${roomCode}`);

    // Phone context with spies for Screen Wake Lock API & RTCPeerConnection lifecycle
    const phoneContext = await browser.newContext({
      viewport: { width: 375, height: 740 },
    });

    await phoneContext.addInitScript({
      content: `
        window.__wakeLockRequests = 0;
        window.__wakeLockReleases = 0;
        window.__activeWakeLocks = [];
        window.__rtcConnections = [];

        var mockRequest = function (type) {
          if (type !== 'screen') return Promise.reject(new Error('Unsupported wakeLock type'));
          window.__wakeLockRequests += 1;
          var listeners = [];
          var sentinel = {
            released: false,
            addEventListener: function (ev, cb) {
              if (ev === 'release') listeners.push(cb);
            },
            removeEventListener: function () {},
            release: function () {
              if (!sentinel.released) {
                sentinel.released = true;
                window.__wakeLockReleases += 1;
                listeners.forEach(function (cb) { cb(); });
              }
              return Promise.resolve();
            },
            triggerRelease: function () {
              if (!sentinel.released) {
                sentinel.released = true;
                listeners.forEach(function (cb) { cb(); });
              }
            }
          };
          window.__activeWakeLocks.push(sentinel);
          return Promise.resolve(sentinel);
        };

        if ('wakeLock' in navigator && navigator.wakeLock) {
          Object.defineProperty(navigator.wakeLock, 'request', {
            value: mockRequest,
            configurable: true,
            writable: true
          });
        } else {
          Object.defineProperty(navigator, 'wakeLock', {
            value: { request: mockRequest },
            configurable: true
          });
        }

        var NativeRTC = window.RTCPeerConnection;
        if (NativeRTC) {
          var WrappedRTC = function () {
            var args = Array.prototype.slice.call(arguments);
            var pc = new (Function.prototype.bind.apply(NativeRTC, [null].concat(args)))();
            window.__rtcConnections.push(pc);
            return pc;
          };
          WrappedRTC.prototype = NativeRTC.prototype;
          window.RTCPeerConnection = WrappedRTC;
        }
      `,
    });

    const phonePage = await phoneContext.newPage();
    phonePage.on('pageerror', (err) => console.error('PHONE PAGEERROR:', err));

    console.log('2. Joining as Alice and verifying Screen Wake Lock activates immediately on Join...');
    await phonePage.goto(`${BASE_URL}#/buzz?room=${roomCode}`);
    await phonePage.waitForSelector('.buzzer-join-btn');

    const wakeBeforeJoin = await phonePage.evaluate(
      () => (window as unknown as PhoneWindowHooks).__wakeLockRequests ?? 0,
    );
    assert(wakeBeforeJoin === 0, `Wake Lock should not be requested before Join, got ${wakeBeforeJoin}`);

    await phonePage.fill('input[placeholder="Enter your name"]', 'Alice');
    await phonePage.click('.buzzer-join-btn');
    await phonePage.waitForSelector('.buzzer-button', { timeout: 20000 });

    const wakeAfterJoin = await phonePage.evaluate(
      () => (window as unknown as PhoneWindowHooks).__wakeLockRequests ?? 0,
    );
    assert(
      wakeAfterJoin >= 1,
      `Wake Lock should be requested immediately on Join tap, got ${wakeAfterJoin}`,
    );

    // Verify per-room identity + linked gamePlayerId persisted in localStorage
    await phonePage.waitForFunction(
      (code) => {
        const raw = localStorage.getItem(`jeopardy-buzzer-session-${code}`);
        if (!raw) return false;
        try {
          const parsed = JSON.parse(raw);
          return Boolean(parsed.name === 'Alice' && parsed.deviceId && parsed.gamePlayerId);
        } catch {
          return false;
        }
      },
      roomCode,
      { timeout: 10000 },
    );
    console.log('   ✓ Alice joined, Wake Lock acquired immediately, and room identity persisted');

    // Remove default demo players so Alice is clearly tracked, then start game and give Alice +$600
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

    // Award Alice +$600
    await hostPage.locator('.board-cell:not(.played)', { hasText: '$600' }).first().click();
    await hostPage.waitForSelector('.clue-overlay');
    await hostPage
      .locator('.clue-overlay .player-box', { hasText: 'Alice' })
      .locator('.score-btn.plus')
      .click();
    await hostPage.locator('.clue-close').click();
    await sleep(200);
    console.log('   ✓ Game started and Alice awarded $600');

    console.log('3. Reloading phone page — verifying seamless auto-rejoin without name form...');
    let sawNameFormOnReload = false;
    phonePage.on('domcontentloaded', async () => {
      try {
        if ((await phonePage.locator('.buzzer-join-btn').count()) > 0) {
          sawNameFormOnReload = true;
        }
      } catch {
        /* ignore */
      }
    });

    await phonePage.reload();
    await phonePage.waitForSelector('.buzzer-button', { timeout: 20000 });
    assert(!sawNameFormOnReload, 'Auto-rejoin on reload must never show the name entry form');
    assert(
      (await phonePage.locator('.buzzer-join-btn').count()) === 0,
      'Join form must not be rendered after reload',
    );
    const wakeAfterReload = await phonePage.evaluate(
      () => (window as unknown as PhoneWindowHooks).__wakeLockRequests ?? 0,
    );
    assert(
      wakeAfterReload >= 1,
      `Wake Lock should be requested automatically on auto-rejoin load, got ${wakeAfterReload}`,
    );

    // Host must still have exactly 1 Alice with $600 (no duplicate!)
    const aliceSidebarCountAfterReload = await hostPage
      .locator('.buzzer-host-player', { hasText: 'Alice' })
      .count();
    assert(
      aliceSidebarCountAfterReload === 1,
      `Expected 1 Alice in host sidebar after reload, got ${aliceSidebarCountAfterReload}`,
    );
    const aliceScoreAfterReload = await hostPage
      .locator('.players-bar .player-box', { hasText: 'Alice' })
      .textContent();
    assert(
      aliceScoreAfterReload?.includes('$600'),
      `Alice should still have $600 after reload, got ${aliceScoreAfterReload}`,
    );
    console.log('   ✓ Auto-rejoined seamlessly on reload (no name form, Wake Lock active, no duplicate, $600 preserved)');

    console.log('4. Simulating phone sleep (WebRTC drop + Wake Lock release) and wake/resume...');
    const wakeCountBeforeSleep = await phonePage.evaluate(
      () => (window as unknown as PhoneWindowHooks).__wakeLockRequests ?? 0,
    );
    const rtcCountBeforeSleep = await phonePage.evaluate(
      () => (window as unknown as PhoneWindowHooks).__rtcConnections?.length ?? 0,
    );

    // Simulate OS screen lock: release wake lock sentinel, close active WebRTC peer connections,
    // then wake with visibilitychange -> visible, pageshow, focus, online.
    await phonePage.evaluate(() => {
      const w = window as unknown as PhoneWindowHooks;
      for (const wl of w.__activeWakeLocks ?? []) {
        wl.triggerRelease();
      }
      for (const pc of w.__rtcConnections ?? []) {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
      }
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });

    // Wait for a brand-new RTCPeerConnection to be created and for the buzzer to return to joined state
    await phonePage.waitForFunction(
      (prevCount) =>
        ((window as unknown as PhoneWindowHooks).__rtcConnections?.length ?? 0) > prevCount,
      rtcCountBeforeSleep,
      { timeout: 15000 },
    );
    await phonePage.waitForSelector('.buzzer-button', { timeout: 20000 });
    assert(
      (await phonePage.locator('.buzzer-join-btn').count()) === 0,
      'Auto-reconnect after sleep must never show the name form',
    );

    const wakeCountAfterWake = await phonePage.evaluate(
      () => (window as unknown as PhoneWindowHooks).__wakeLockRequests ?? 0,
    );
    assert(
      wakeCountAfterWake > wakeCountBeforeSleep,
      `Wake Lock should be re-acquired on visibilitychange after sleep (${wakeCountBeforeSleep} -> ${wakeCountAfterWake})`,
    );

    // Verify host replaced stale connection cleanly (still 1 Alice, $600) AND Alice can buzz!
    await sleep(400);
    const aliceSidebarCountAfterWake = await hostPage
      .locator('.buzzer-host-player', { hasText: 'Alice' })
      .count();
    assert(
      aliceSidebarCountAfterWake === 1,
      `Expected 1 Alice in host sidebar after wake reconnect, got ${aliceSidebarCountAfterWake}`,
    );

    // Open a clue and verify Alice's buzzer arms and wins (proves Peer + clock sync re-ran!)
    await hostPage.locator('.board-cell:not(.played)', { hasText: '$400' }).first().click();
    await hostPage.waitForSelector('.clue-overlay');
    await phonePage.waitForSelector('.buzzer-button.active', { timeout: 10000 });
    await phonePage.click('.buzzer-button.active');
    try {
      await phonePage.waitForSelector('.status-winner', { timeout: 5000 });
    } catch (e) {
      const phoneClass = await phonePage.locator('.buzzer-phone').getAttribute('class');
      const phoneStatus = await phonePage.locator('.buzzer-status-text').textContent().catch(() => null);
      const hostBadge = await hostPage.locator('.buzzer-state-badge').textContent().catch(() => null);
      const hostPlayers = await hostPage.locator('.buzzer-host-players-label').textContent().catch(() => null);
      console.error('DEBUG after buzz click:', { phoneClass, phoneStatus, hostBadge, hostPlayers });
      throw e;
    }
    await hostPage.locator('.clue-close').click();
    await sleep(200);
    console.log('   ✓ Phone recovered from sleep/WebRTC drop, re-acquired Wake Lock, re-synced clocks, and buzzed in with no duplicate');

    console.log('5. Testing "Not you? Change name" link...');
    await phonePage.getByRole('button', { name: 'Not you? Change name' }).click();
    await phonePage.waitForSelector('.buzzer-join-btn', { timeout: 5000 });
    const clearedSession = await phonePage.evaluate(
      (code) => localStorage.getItem(`jeopardy-buzzer-session-${code}`),
      roomCode,
    );
    assert(clearedSession === null, 'Clicking "Not you? Change name" must clear saved room session');

    await phonePage.fill('input[placeholder="Enter your name"]', 'Dana');
    await phonePage.click('.buzzer-join-btn');
    await phonePage.waitForSelector('.buzzer-button', { timeout: 20000 });
    await sleep(400);

    // Alice ($600) and Dana ($0) should now both exist as separate players
    const aliceBox = await hostPage
      .locator('.players-bar .player-box', { hasText: 'Alice' })
      .textContent();
    const danaBox = await hostPage
      .locator('.players-bar .player-box', { hasText: 'Dana' })
      .textContent();
    assert(aliceBox?.includes('$600'), `Alice should keep $600, got ${aliceBox}`);
    assert(danaBox?.includes('$0'), `Dana should start as separate player with $0, got ${danaBox}`);
    console.log('   ✓ "Not you? Change name" cleared identity and joined Dana as a distinct player');

    console.log('6. Sanity-checking 15-player layout (sidebar, players bar, Final Jeopardy)...');
    await hostPage.getByRole('button', { name: 'Setup' }).click();
    await hostPage.waitForSelector('.player-lobby');

    // Add manual players until we have 15 total
    for (let i = 3; i <= 15; i++) {
      await hostPage.fill('input[placeholder="Add player without phone..."]', `Guest ${i}`);
      await hostPage.locator('.lobby-add-manual button:has-text("Add")').click();
      await sleep(30);
    }
    const lobbyCount = await hostPage.locator('.lobby-player').count();
    assert(lobbyCount === 15, `Expected 15 players in lobby, got ${lobbyCount}`);

    await hostPage
      .locator('.player-lobby')
      .getByRole('button', { name: 'Start Game →' })
      .click();
    await hostPage.waitForSelector('.play');
    await sleep(200);

    // Check gameplay sidebar + players-bar have no horizontal overflow and stay compact/scrollable
    const playMetrics = await hostPage.evaluate(() => {
      const docOverflowX =
        document.documentElement.scrollWidth > document.documentElement.clientWidth;
      const sidebar = document.querySelector('.buzzer-host-panel');
      const playersList = document.querySelector('.buzzer-host-players-list');
      const bar = document.querySelector('.players-bar');
      return {
        docOverflowX,
        sidebarHeight: sidebar?.getBoundingClientRect().height ?? 0,
        playersListHeight: playersList?.getBoundingClientRect().height ?? 0,
        barHeight: bar?.getBoundingClientRect().height ?? 0,
        hasManyClass: bar?.classList.contains('players-bar--many') ?? false,
      };
    });
    assert(!playMetrics.docOverflowX, '15-player gameplay must have no horizontal overflow');
    assert(playMetrics.hasManyClass, '15-player PlayersBar should activate compact players-bar--many');
    assert(
      playMetrics.sidebarHeight <= 740,
      `15-player buzzer sidebar should fit cleanly within 800px viewport, got ${playMetrics.sidebarHeight}px`,
    );
    assert(
      playMetrics.barHeight <= 190,
      `15-player PlayersBar should stay compact/scrollable, got ${playMetrics.barHeight}px`,
    );

    // Open Final Jeopardy with 15 players and verify Wagering, Clue, and Reveal fit cleanly
    await hostPage.getByRole('button', { name: 'Final Jeopardy' }).click();
    await hostPage.waitForSelector('.fj-tv-wagers-stage');
    const fjWagerMetrics = await hostPage.evaluate(() => {
      const strip = document.querySelector('.fj-podium-strip');
      const hostBar = document.querySelector('.fj-host-bar');
      return {
        hasManyClass: strip?.classList.contains('many-players') ?? false,
        hostBarBottom: hostBar?.getBoundingClientRect().bottom ?? 9999,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    assert(!fjWagerMetrics.overflowX, '15-player Final Jeopardy wagering must have no horizontal overflow');
    assert(fjWagerMetrics.hasManyClass, '15-player Final Jeopardy should use compact many-players grid');
    assert(
      fjWagerMetrics.hostBarBottom <= 810,
      `15-player Final Jeopardy host bar should stay visible in viewport, got bottom=${fjWagerMetrics.hostBarBottom}px`,
    );

    await hostPage.getByRole('button', { name: /Lock Wagers & Reveal Clue/i }).click();
    await hostPage.waitForSelector('.fj-tv-clue-stage');
    const fjClueHostBarBottom = await hostPage.evaluate(
      () => document.querySelector('.fj-host-bar')?.getBoundingClientRect().bottom ?? 9999,
    );
    assert(
      fjClueHostBarBottom <= 810,
      `15-player Final Jeopardy clue host bar should stay visible in viewport, got bottom=${fjClueHostBarBottom}px`,
    );

    await hostPage.getByRole('button', { name: /Begin Reveal/i }).click();
    await hostPage.waitForSelector('.fj-podium-stage');
    const fjRevealQueueHeight = await hostPage.evaluate(
      () => document.querySelector('.fj-reveal-queue')?.getBoundingClientRect().height ?? 9999,
    );
    assert(
      fjRevealQueueHeight <= 110,
      `15-player Final Jeopardy reveal queue should stay bounded/scrollable, got ${fjRevealQueueHeight}px`,
    );
    console.log('   ✓ 15-player layout verified across lobby, sidebar, scoreboard, and Final Jeopardy');

    await phoneContext.close();
    await hostContext.close();

    console.log('\n✓ Phone auto-reconnect, Wake Lock & 15-player E2E test passed completely!');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('\n✗ Phone auto-reconnect E2E test failed:', err);
  process.exit(1);
});
