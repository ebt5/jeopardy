/**
 * Verify Reynolds Family TG new clues via ?board=reynolds, including a browser
 * whose localStorage was seeded with the old Reynolds preset.
 *
 * Run (vite already serving):
 *   npx tsx tests/reynolds-board-refresh-e2e.ts
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

async function launchBrowser() {
  const systemChrome = '/usr/local/bin/google-chrome';
  if (fs.existsSync(systemChrome)) {
    return chromium.launch({ headless: true, executablePath: systemChrome });
  }
  return chromium.launch({ headless: true });
}

async function readParade800AndFj(page: import('playwright').Page) {
  const cats = page.locator('.setup-category');
  const catCount = await cats.count();
  let parade800: { answer: string; question: string; dd: boolean } | null = null;
  for (let i = 0; i < catCount; i++) {
    const name = await cats.nth(i).locator('.category-name-input').inputValue();
    if (name !== 'PARADES & PIGSKIN') continue;
    const clue = cats.nth(i).locator('.setup-clue').nth(3); // $800
    parade800 = {
      answer: await clue.locator('input[placeholder="Answer (shown first)"]').inputValue(),
      question: await clue
        .locator('input[placeholder="Question (What/Who is…?)"]')
        .inputValue(),
      dd: await clue.locator('input[type="checkbox"]').isChecked(),
    };
  }
  const fj = {
    category: await page.locator('.fj-setup input').nth(0).inputValue(),
    answer: await page.locator('.fj-setup input').nth(1).inputValue(),
    question: await page.locator('.fj-setup input').nth(2).inputValue(),
  };
  const banner = await page.locator('.board-name-banner').innerText().catch(() => '');
  return { parade800, fj, banner };
}

async function runTest() {
  console.log('Starting Reynolds board refresh E2E...\n');
  const browser = await launchBrowser();

  try {
    // --- Fresh browser: ?board=reynolds ---
    console.log('1. Fresh browser loads ?board=reynolds with new clues...');
    const fresh = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const freshPage = await fresh.newPage();
    await freshPage.goto(`${BASE_URL}?board=reynolds`, { waitUntil: 'networkidle' });
    await freshPage.waitForSelector('.setup');
    await sleep(300);

    let data = await readParade800AndFj(freshPage);
    assert(data.banner.includes('Reynolds Family TG'), `banner: ${data.banner}`);
    assert(data.parade800?.question === 'Who is John Madden?', `got ${data.parade800?.question}`);
    assert(data.parade800?.dd === true, 'PARADES $800 must be Daily Double');
    assert(data.fj.category === 'THANKSGIVING HISTORY', `FJ cat: ${data.fj.category}`);
    assert(
      data.fj.question === 'What is the Mayflower Compact?',
      `FJ q: ${data.fj.question}`,
    );
    console.log('   ✓ Fresh ?board=reynolds shows Madden DD + THANKSGIVING HISTORY');

    // Saved boards list should include Reynolds
    const names = await freshPage.locator('.saved-board-info strong').allInnerTexts();
    assert(names.includes('Reynolds Family TG'), `saved list: ${names.join(' | ')}`);
    assert(names.includes('Family Thanksgiving 2026'), 'Family Thanksgiving still listed');
    console.log('   ✓ Both Thanksgiving boards listed');
    await fresh.close();

    // --- Seeded browser: old Reynolds in localStorage ---
    console.log('2. Browser seeded with OLD Reynolds in localStorage...');
    const seeded = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const seededPage = await seeded.newPage();
    await seededPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await seededPage.evaluate(() => {
      const oldReynolds = {
        id: 'preset-reynolds-family-tg',
        name: 'Reynolds Family TG',
        savedAt: '2026-11-27T10:00:00-07:00',
        categories: [
          {
            name: 'PARADES & PIGSKIN',
            clues: [
              {
                value: 200,
                answer: 'old',
                question: 'What is Macy\'s?',
                played: false,
                dailyDouble: false,
              },
              {
                value: 400,
                answer: 'old',
                question: 'Who are the Detroit Lions?',
                played: false,
                dailyDouble: false,
              },
              {
                value: 600,
                answer: 'old',
                question: 'Who is Vince Lombardi?',
                played: false,
                dailyDouble: false,
              },
              {
                value: 800,
                answer: 'OLD Miracle clue',
                question: 'What is Miracle on 34th Street?',
                played: false,
                dailyDouble: true,
              },
              {
                value: 1000,
                answer: 'old',
                question: 'What is a safety?',
                played: false,
                dailyDouble: false,
              },
            ],
          },
        ],
        finalJeopardy: {
          category: 'PRESIDENTS',
          answer: 'Franksgiving',
          question: 'Who is Franklin D. Roosevelt?',
        },
      };
      localStorage.setItem('jeopardy-saved-boards', JSON.stringify([oldReynolds]));
      localStorage.setItem(
        'jeopardy-game-config',
        JSON.stringify({
          boardName: 'Reynolds Family TG',
          players: [
            { id: 'p1', name: 'Erik', score: 0 },
            { id: 'p2', name: 'Guest', score: 0 },
          ],
          categories: oldReynolds.categories,
          finalJeopardy: oldReynolds.finalJeopardy,
        }),
      );
    });

    // Refresh without query param — game config should overlay latest preset by boardName
    await seededPage.reload({ waitUntil: 'networkidle' });
    await seededPage.waitForSelector('.setup');
    await sleep(300);
    data = await readParade800AndFj(seededPage);
    assert(data.banner.includes('Reynolds Family TG'), `seeded banner: ${data.banner}`);
    assert(
      data.parade800?.question === 'Who is John Madden?',
      `seeded refresh still old? got ${data.parade800?.question}`,
    );
    assert(data.parade800?.dd === true, 'seeded DD');
    assert(data.fj.category === 'THANKSGIVING HISTORY', `seeded FJ: ${data.fj.category}`);
    console.log('   ✓ Refresh with stale game-config localStorage shows new clues');

    // Also verify ?board=reynolds on the seeded browser
    await seededPage.goto(`${BASE_URL}?board=reynolds`, { waitUntil: 'networkidle' });
    await seededPage.waitForSelector('.setup');
    await sleep(300);
    data = await readParade800AndFj(seededPage);
    assert(data.parade800?.question === 'Who is John Madden?', 'seeded ?board=reynolds');
    assert(data.fj.category === 'THANKSGIVING HISTORY', 'seeded ?board=reynolds FJ');

    // Load from Saved boards list after refresh merge
    const reynoldsRow = seededPage.locator('.saved-board-row', {
      hasText: 'Reynolds Family TG',
    });
    assert((await reynoldsRow.count()) > 0, 'Reynolds in saved list after refresh');
    await reynoldsRow.getByRole('button', { name: 'Load' }).click();
    await sleep(300);
    data = await readParade800AndFj(seededPage);
    assert(data.parade800?.question === 'Who is John Madden?', 'Load from saved list');
    assert(data.fj.category === 'THANKSGIVING HISTORY', 'Load from saved list FJ');

    // User-created board must still be preservable — seed one and confirm it survives
    await seededPage.evaluate(() => {
      const raw = localStorage.getItem('jeopardy-saved-boards');
      const boards = raw ? (JSON.parse(raw) as unknown[]) : [];
      boards.push({
        id: 'board-user-custom',
        name: 'Erik Custom Party',
        savedAt: '2020-01-01T00:00:00.000Z',
        categories: [],
        finalJeopardy: { category: 'CUSTOM', answer: 'a', question: 'q' },
      });
      localStorage.setItem('jeopardy-saved-boards', JSON.stringify(boards));
    });
    await seededPage.reload({ waitUntil: 'networkidle' });
    await seededPage.waitForSelector('.setup');
    const afterNames = await seededPage.locator('.saved-board-info strong').allInnerTexts();
    assert(afterNames.includes('Erik Custom Party'), `user board missing: ${afterNames.join(' | ')}`);
    assert(afterNames.includes('Reynolds Family TG'), 'Reynolds still present');
    console.log('   ✓ Stale preset refreshed; user-created board kept');

    await seeded.close();
    console.log('\nAll Reynolds board refresh checks passed.');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('\nReynolds board refresh E2E failed:', err);
  process.exit(1);
});
