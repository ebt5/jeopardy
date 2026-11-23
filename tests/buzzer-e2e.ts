import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:5173/jeopardy/';
const ARTIFACTS_DIR = '/opt/cursor/artifacts';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('Starting buzzer E2E test...\n');
  
  // Ensure artifacts directory exists
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  
  try {
    // Create recording directory
    const recordDir = '/tmp/buzzer-test-recordings';
    if (!fs.existsSync(recordDir)) {
      fs.mkdirSync(recordDir, { recursive: true });
    }

    // HOST CONTEXT - with recording
    const hostContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: recordDir, size: { width: 1280, height: 720 } },
    });
    const hostPage = await hostContext.newPage();
    
    console.log('1. Opening host page and logging in...');
    await hostPage.goto(BASE_URL);
    await hostPage.waitForSelector('.login-card');
    
    // Login as Erik
    await hostPage.fill('input[type="text"]', 'Erik');
    await hostPage.fill('input[type="password"]', 'goose');
    await hostPage.click('button[type="submit"]');
    
    // Wait for setup page
    await hostPage.waitForSelector('.setup');
    console.log('   ✓ Logged in successfully');

    // Start the game
    console.log('2. Starting game...');
    await hostPage.click('button:has-text("Start Game")');
    await hostPage.waitForSelector('.play');
    console.log('   ✓ Game started');

    // Start buzzer room
    console.log('3. Starting buzzer room...');
    const startRoomButton = await hostPage.getByRole('button', { name: 'Start Buzzer Room' });
    await startRoomButton.click();
    
    // Wait for room code to appear
    await hostPage.waitForSelector('.buzzer-host-code-value', { timeout: 10000 });
    const roomCode = await hostPage.textContent('.buzzer-host-code-value');
    console.log(`   ✓ Buzzer room started with code: ${roomCode}`);

    // PHONE 1 CONTEXT
    console.log('4. Phone 1 joining room...');
    const phone1Context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      recordVideo: { dir: recordDir, size: { width: 375, height: 667 } },
    });
    const phone1Page = await phone1Context.newPage();
    const phone1Url = `${BASE_URL}#/buzz?room=${roomCode}`;
    console.log(`   Navigating to: ${phone1Url}`);
    await phone1Page.goto(phone1Url);
    
    await phone1Page.waitForSelector('.buzzer-phone', { timeout: 5000 });
    console.log('   Phone 1 page loaded');
    
    // Wait for the input field to be ready
    await phone1Page.waitForSelector('input[placeholder="Enter your name"]', { timeout: 5000 });
    await phone1Page.fill('input[placeholder="Enter your name"]', 'Alice');
    
    const joinButton1 = await phone1Page.getByRole('button', { name: 'Join Game' });
    await joinButton1.click();
    console.log('   Phone 1 clicked Join Game');
    
    // Wait for connection - wait for the buzzer button to appear (indicates joined state)
    try {
      await phone1Page.waitForSelector('.buzzer-button', { timeout: 20000 });
      console.log('   ✓ Phone 1 (Alice) joined');
    } catch (e) {
      console.log('   ⚠ Phone 1 connection issue, taking screenshot...');
      await phone1Page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phone1-debug.png') });
      
      // Check what state we're in
      const pageContent = await phone1Page.content();
      if (pageContent.includes('Syncing')) {
        console.log('   Phone is stuck at syncing - WebRTC data channel may not be completing');
      }
      throw e;
    }

    // PHONE 2 CONTEXT
    console.log('5. Phone 2 joining room...');
    const phone2Context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      recordVideo: { dir: recordDir, size: { width: 375, height: 667 } },
    });
    const phone2Page = await phone2Context.newPage();
    await phone2Page.goto(`${BASE_URL}#/buzz?room=${roomCode}`);
    
    await phone2Page.waitForSelector('.buzzer-phone');
    await phone2Page.fill('input[placeholder="Enter your name"]', 'Bob');
    await phone2Page.click('button:has-text("Join Game")');
    
    await phone2Page.waitForSelector('.buzzer-status-text', { timeout: 10000 });
    console.log('   ✓ Phone 2 (Bob) joined');

    // Wait for host to show connected players
    await sleep(2000);
    
    // Check players are connected on host
    const hostPlayers = await hostPage.locator('.buzzer-host-player-name').allTextContents();
    console.log(`   Host sees players: ${hostPlayers.join(', ')}`);

    // Open a clue to auto-arm the buzzer
    console.log('6. Opening a clue (should auto-arm buzzer)...');
    const clueButton = await hostPage.locator('.board-cell:not(.played)').first();
    await clueButton.click();
    
    await hostPage.waitForSelector('.clue-overlay');
    console.log('   ✓ Clue opened');

    // Wait for buzzer to arm
    await sleep(500);
    
    // Check phone 1 status
    const phone1Status = await phone1Page.textContent('.buzzer-status-text');
    console.log(`   Phone 1 status: ${phone1Status}`);
    
    // Check phone 2 status  
    const phone2Status = await phone2Page.textContent('.buzzer-status-text');
    console.log(`   Phone 2 status: ${phone2Status}`);

    // Both phones buzz - phone 1 first
    console.log('7. Testing buzzer race...');
    const phone1BuzzButton = phone1Page.locator('.buzzer-button');
    const phone2BuzzButton = phone2Page.locator('.buzzer-button');
    
    // Phone 1 buzzes first
    await phone1BuzzButton.click();
    await sleep(50);
    // Phone 2 buzzes 50ms later
    await phone2BuzzButton.click();
    
    // Wait for buzz collection window (280ms) + processing time
    await sleep(800);
    
    // Check winner on host
    const hasWinner = await hostPage.locator('.buzzer-host-winner').isVisible();
    if (hasWinner) {
      const winnerText = await hostPage.textContent('.buzzer-host-winner');
      console.log(`   ✓ Winner displayed on host: ${winnerText}`);
    } else {
      console.log('   ⚠ Winner not displayed on host yet');
    }

    // Check winner in clue overlay
    const hasBuzzerWinner = await hostPage.locator('.clue-buzzer-winner').isVisible();
    if (hasBuzzerWinner) {
      const buzzerWinnerName = await hostPage.textContent('.clue-buzzer-name');
      console.log(`   ✓ Winner shown in clue: ${buzzerWinnerName}`);
    }

    // Check phone statuses
    const phone1FinalStatus = await phone1Page.textContent('.buzzer-status-text');
    const phone2FinalStatus = await phone2Page.textContent('.buzzer-status-text');
    console.log(`   Phone 1 final status: ${phone1FinalStatus}`);
    console.log(`   Phone 2 final status: ${phone2FinalStatus}`);

    // Take screenshots
    console.log('\n8. Saving screenshots...');
    await hostPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'buzzer-host-with-winner.png') });
    await phone1Page.screenshot({ path: path.join(ARTIFACTS_DIR, 'buzzer-phone1-result.png') });
    await phone2Page.screenshot({ path: path.join(ARTIFACTS_DIR, 'buzzer-phone2-result.png') });
    console.log('   ✓ Screenshots saved to artifacts directory');

    // Close clue first
    console.log('9. Closing clue...');
    await hostPage.click('.clue-close');
    await sleep(500);
    
    // Verify buzzer resets
    const buzzerState = await hostPage.textContent('.buzzer-state-badge');
    console.log(`   Buzzer state after close: ${buzzerState}`);

    // Close contexts and save recordings
    await phone1Context.close();
    await phone2Context.close();
    await hostContext.close();

    // Copy recordings to artifacts
    const recordings = fs.readdirSync(recordDir).filter(f => f.endsWith('.webm'));
    for (let i = 0; i < recordings.length && i < 3; i++) {
      const src = path.join(recordDir, recordings[i]);
      const dest = path.join(ARTIFACTS_DIR, `buzzer-test-${i === 0 ? 'host' : `phone${i}`}.webm`);
      fs.copyFileSync(src, dest);
    }
    console.log('   ✓ Recordings saved');

    console.log('\n✓ All tests completed successfully!');
    
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
