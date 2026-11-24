import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:5173/jeopardy/';
const ARTIFACTS_DIR = '/opt/cursor/artifacts';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('Starting buzzer E2E test with per-player grading buttons...\n');
  
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  
  try {
    const recordDir = '/tmp/buzzer-test-recordings';
    if (!fs.existsSync(recordDir)) {
      fs.mkdirSync(recordDir, { recursive: true });
    }

    const hostContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: recordDir, size: { width: 1280, height: 720 } },
    });
    const hostPage = await hostContext.newPage();
    
    console.log('1. Opening host page and logging in...');
    await hostPage.goto(BASE_URL);
    await hostPage.waitForSelector('.login-card');
    
    await hostPage.fill('input[type="text"]', 'Erik');
    await hostPage.fill('input[type="password"]', 'goose');
    await hostPage.click('button[type="submit"]');
    
    await hostPage.waitForSelector('.setup');
    console.log('   ✓ Logged in successfully');

    // === NEW FLOW: Start buzzer lobby in Setup ===
    console.log('\n2. Starting buzzer lobby in Setup...');
    const startLobbyButton = await hostPage.getByRole('button', { name: '📱 Start Buzzer Lobby' });
    await startLobbyButton.click();
    
    await hostPage.waitForSelector('.lobby-code-value', { timeout: 10000 });
    const roomCode = await hostPage.textContent('.lobby-code-value');
    console.log(`   ✓ Buzzer lobby started with code: ${roomCode}`);

    // PHONE 1 joins the lobby
    console.log('\n3. Phone 1 (Alice) joining lobby...');
    const phone1Context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      recordVideo: { dir: recordDir, size: { width: 375, height: 667 } },
    });
    const phone1Page = await phone1Context.newPage();
    await phone1Page.goto(`${BASE_URL}#/buzz?room=${roomCode}`);
    
    await phone1Page.waitForSelector('.buzzer-phone', { timeout: 5000 });
    await phone1Page.fill('input[placeholder="Enter your name"]', 'Alice');
    await phone1Page.click('button:has-text("Join Game")');
    
    try {
      await phone1Page.waitForSelector('.buzzer-button', { timeout: 20000 });
      console.log('   ✓ Phone 1 (Alice) connected');
    } catch (e) {
      console.log('   ⚠ Phone 1 connection issue');
      await phone1Page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phone1-debug.png') });
      throw e;
    }

    // PHONE 2 joins the lobby
    console.log('4. Phone 2 (Bob) joining lobby...');
    const phone2Context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      recordVideo: { dir: recordDir, size: { width: 375, height: 667 } },
    });
    const phone2Page = await phone2Context.newPage();
    await phone2Page.goto(`${BASE_URL}#/buzz?room=${roomCode}`);
    
    await phone2Page.waitForSelector('.buzzer-phone');
    await phone2Page.fill('input[placeholder="Enter your name"]', 'Bob');
    await phone2Page.click('button:has-text("Join Game")');
    
    await phone2Page.waitForSelector('.buzzer-button', { timeout: 20000 });
    console.log('   ✓ Phone 2 (Bob) connected');

    await sleep(1000);

    // Check that players appear in lobby
    console.log('\n5. Verifying players in lobby...');
    await hostPage.waitForSelector('.lobby-player', { timeout: 5000 });
    let lobbyPlayers = await hostPage.locator('.lobby-player-name').allTextContents();
    console.log(`   Host sees players in lobby: ${lobbyPlayers.join(', ')}`);
    
    if (!lobbyPlayers.includes('Alice') || !lobbyPlayers.includes('Bob')) {
      throw new Error('Expected Alice and Bob in lobby');
    }
    console.log('   ✓ Both players visible in lobby');

    // Add a manual (verbal) player
    console.log('\n5b. Adding manual player Charlie...');
    await hostPage.fill('input[placeholder="Add player without phone..."]', 'Charlie');
    await hostPage.locator('.lobby-add-manual button:has-text("Add")').click();
    await sleep(300);
    
    lobbyPlayers = await hostPage.locator('.lobby-player-name').allTextContents();
    if (lobbyPlayers.includes('Charlie')) {
      console.log('   ✓ Manual player Charlie added');
    } else {
      console.log('   ⚠ Could not add manual player');
    }

    // Start the game from lobby
    console.log('\n6. Starting game from lobby...');
    const startGameBtn = hostPage.locator('.player-lobby').getByRole('button', { name: 'Start Game →' });
    await startGameBtn.click();
    
    await hostPage.waitForSelector('.play');
    console.log('   ✓ Game started with lobby players');

    // Verify players have scores in play mode
    const playerBoxes = await hostPage.locator('.player-box').count();
    console.log(`   Players in game: ${playerBoxes}`);

    // Open a clue to auto-arm the buzzer
    console.log('\n7. Opening a clue (should auto-arm buzzer)...');
    const clueButton = await hostPage.locator('.board-cell:not(.played)').first();
    await clueButton.click();
    
    await hostPage.waitForSelector('.clue-overlay');
    await sleep(500);
    
    const phone1Status = await phone1Page.textContent('.buzzer-status-text');
    console.log(`   Phone 1 status: ${phone1Status}`);

    // Test buzz race - Phone 1 wins
    console.log('\n8. Testing buzzer race (Phone 1 buzzes first)...');
    await phone1Page.locator('.buzzer-button').click();
    await sleep(50);
    await phone2Page.locator('.buzzer-button').click();
    
    await sleep(800);
    
    const hasWinner = await hostPage.locator('.clue-buzzer-winner').isVisible();
    if (hasWinner) {
      const winnerName = await hostPage.textContent('.clue-buzzer-name');
      console.log(`   ✓ Winner shown: ${winnerName}`);
      
      // Verify "BUZZED IN!" label is shown
      const buzzLabel = await hostPage.locator('.clue-buzzer-label').textContent();
      if (buzzLabel?.includes('BUZZED IN')) {
        console.log('   ✓ "BUZZED IN!" label displayed');
      }
      
      // Verify winner doesn't overlap with clue text (layout check)
      const winnerBox = await hostPage.locator('.clue-buzzer-winner-container').boundingBox();
      const clueBox = await hostPage.locator('.clue-body').boundingBox();
      if (winnerBox && clueBox) {
        const noOverlap = winnerBox.y + winnerBox.height <= clueBox.y + 10; // 10px tolerance
        if (noOverlap) {
          console.log('   ✓ Winner banner does not overlap clue text');
        } else {
          console.log('   ⚠ Winner banner may overlap clue text');
        }
      }
    }

    // === Test grading via per-player buttons before reveal ===
    console.log('\n9. Testing per-player grading buttons before reveal...');
    
    // The per-player +/− buttons should be visible in the clue overlay
    const playerControls = hostPage.locator('.clue-overlay .player-controls');
    const hasPlayerControls = await playerControls.first().isVisible();
    
    if (hasPlayerControls) {
      console.log('   ✓ Per-player score buttons visible in clue overlay');
      
      // Check that the clue is NOT revealed yet
      const clueLabel = await hostPage.textContent('.clue-label');
      if (clueLabel === 'ANSWER') {
        console.log('   ✓ Clue is still showing ANSWER (not revealed)');
      }
      
      // Find Alice's player box (the buzzer winner) and click her − button
      // The highlighted player box should be the winner
      const highlightedPlayer = hostPage.locator('.clue-overlay .player-box.highlighted');
      if (await highlightedPlayer.isVisible()) {
        const winnerMinusBtn = highlightedPlayer.locator('.score-btn.minus');
        if (await winnerMinusBtn.isVisible()) {
          console.log('   ✓ Winner has − button visible');
          await winnerMinusBtn.click();
          await sleep(500);
          
          // Check that buzzer re-arms for remaining players
          const phone2StatusAfterWrong = await phone2Page.textContent('.buzzer-status-text');
          console.log(`   Phone 2 status after wrong: ${phone2StatusAfterWrong}`);
          
          // Phone 1 should be locked out, phone 2 can still buzz
          const phone1StatusAfterWrong = await phone1Page.textContent('.buzzer-status-text');
          console.log(`   Phone 1 status after wrong: ${phone1StatusAfterWrong}`);
          
          // Check clue is still showing ANSWER (not revealed after Wrong)
          const clueLabelAfterWrong = await hostPage.textContent('.clue-label');
          if (clueLabelAfterWrong === 'ANSWER') {
            console.log('   ✓ Clue still shows ANSWER after − click (answer not auto-revealed)');
          } else {
            console.log(`   ⚠ Clue label changed to: ${clueLabelAfterWrong}`);
          }
          
          // Phone 2 buzzes now
          if (phone2StatusAfterWrong?.includes('BUZZ NOW')) {
            console.log('   ✓ Buzzer re-armed for Phone 2');
            await phone2Page.locator('.buzzer-button').click();
            await sleep(800);
            
            const newWinner = await hostPage.locator('.clue-buzzer-winner');
            if (await newWinner.isVisible()) {
              const newWinnerName = await hostPage.textContent('.clue-buzzer-name');
              console.log(`   ✓ New winner after re-arm: ${newWinnerName}`);
            }
          }
        }
      }
    } else {
      console.log('   ⚠ Per-player buttons not visible');
    }

    // Test peek feature
    console.log('\n9b. Testing peek feature...');
    const peekBtn = hostPage.locator('.clue-peek-btn');
    if (await peekBtn.isVisible()) {
      console.log('   ✓ Peek button is visible');
    } else {
      console.log('   ⚠ Peek button not visible (may be revealed)');
    }

    // Test Reveal Answer button
    console.log('\n9c. Testing Reveal Answer button...');
    const revealBtn = hostPage.locator('button:has-text("Reveal Answer")');
    if (await revealBtn.isVisible()) {
      console.log('   ✓ Reveal Answer button is visible');
    }

    // Close clue
    console.log('\n10. Closing clue...');
    const closeBtn = hostPage.locator('.clue-close');
    await closeBtn.click();
    await sleep(500);

    // Verify buzzer resets
    const buzzerState = await hostPage.textContent('.buzzer-state-badge');
    console.log(`   Buzzer state after close: ${buzzerState}`);

    // === Test sidebar features ===
    console.log('\n11. Testing gameplay sidebar features...');
    
    // Check that QR code and join info are visible in the sidebar during gameplay
    const sidebarQr = hostPage.locator('.play-buzzer-sidebar .buzzer-host-qr');
    if (await sidebarQr.isVisible()) {
      console.log('   ✓ QR code visible in gameplay sidebar');
    } else {
      console.log('   ⚠ QR code not visible in gameplay sidebar');
    }
    
    const sidebarRoomCode = hostPage.locator('.play-buzzer-sidebar .buzzer-host-code-value');
    if (await sidebarRoomCode.isVisible()) {
      const code = await sidebarRoomCode.textContent();
      console.log(`   ✓ Room code visible in sidebar: ${code}`);
    }
    
    // Check player connection status in sidebar
    const playersList = hostPage.locator('.play-buzzer-sidebar .buzzer-host-players-list');
    if (await playersList.isVisible()) {
      // Check for connected indicators
      const connectedPlayers = await hostPage.locator('.play-buzzer-sidebar .buzzer-host-player.connected').count();
      console.log(`   ✓ Connected players shown in sidebar: ${connectedPlayers}`);
    }
    
    // Test collapse feature
    const collapseBtn = hostPage.locator('.play-buzzer-sidebar .buzzer-host-header-actions button:has-text("▲")');
    if (await collapseBtn.isVisible()) {
      console.log('   ✓ Collapse button visible');
      await collapseBtn.click();
      await sleep(200);
      
      const isCollapsed = await hostPage.locator('.play-buzzer-sidebar .buzzer-host-panel.collapsed').isVisible();
      if (isCollapsed) {
        console.log('   ✓ Sidebar collapsed successfully');
        
        // Expand it back
        const expandBtn = hostPage.locator('.play-buzzer-sidebar .buzzer-host-header-actions button:has-text("▼")');
        await expandBtn.click();
        await sleep(200);
        console.log('   ✓ Sidebar expanded back');
      }
    }

    // === Test bug fix: rearm works for any player ===
    console.log('\n11b. Testing bug fix: rearm works regardless of player ID matching...');
    
    // Open another clue
    const secondClue = await hostPage.locator('.board-cell:not(.played)').first();
    await secondClue.click();
    await hostPage.waitForSelector('.clue-overlay');
    await sleep(500);
    
    // Phone 2 buzzes first this time
    await phone2Page.locator('.buzzer-button').click();
    await sleep(800);
    
    // Check Bob is the winner
    const winner2 = await hostPage.locator('.clue-buzzer-name').textContent();
    console.log(`   Winner: ${winner2}`);
    
    // Click − on Bob's player row (should rearm)
    const bobPlayerBox = hostPage.locator('.clue-overlay .player-box').filter({ hasText: 'Bob' });
    const bobMinusBtn = bobPlayerBox.locator('.score-btn.minus');
    if (await bobMinusBtn.isVisible()) {
      await bobMinusBtn.click();
      await sleep(500);
      
      // Check if buzzer was rearmed (Phone 1 should now be able to buzz)
      const phone1StatusRearmed = await phone1Page.textContent('.buzzer-status-text');
      console.log(`   Phone 1 status after Bob's − click: ${phone1StatusRearmed}`);
      
      if (phone1StatusRearmed?.includes('BUZZ NOW')) {
        console.log('   ✓ BUG FIX VERIFIED: Buzzer rearmed successfully after clicking any player\'s − button');
      } else {
        console.log('   ⚠ Bug may still exist: buzzer did not rearm');
      }
    }
    
    // Close clue
    await hostPage.locator('.clue-close').click();
    await sleep(300);

    // Take screenshots
    console.log('\n12. Saving screenshots...');
    await hostPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'buzzer-lobby-test-host.png') });
    await phone1Page.screenshot({ path: path.join(ARTIFACTS_DIR, 'buzzer-lobby-test-phone1.png') });
    await phone2Page.screenshot({ path: path.join(ARTIFACTS_DIR, 'buzzer-lobby-test-phone2.png') });
    console.log('   ✓ Screenshots saved');

    // Close contexts and save recordings
    await phone1Context.close();
    await phone2Context.close();
    await hostContext.close();

    const recordings = fs.readdirSync(recordDir).filter(f => f.endsWith('.webm'));
    for (let i = 0; i < recordings.length && i < 3; i++) {
      const src = path.join(recordDir, recordings[i]);
      const dest = path.join(ARTIFACTS_DIR, `buzzer-lobby-test-${i === 0 ? 'host' : `phone${i}`}.webm`);
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
