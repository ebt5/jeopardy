import { calculateSyncSample, selectBestOffset, PhoneClockSync } from './clock-sync';

function runTests() {
  console.log('Running clock-sync tests...\n');
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
      throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
    }
  }

  function assertApprox(actual: number, expected: number, tolerance: number, message?: string) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message || 'Assertion failed'}: expected ~${expected}, got ${actual} (tolerance: ${tolerance})`);
    }
  }

  // Test calculateSyncSample
  test('calculateSyncSample: zero offset when clocks are synchronized', () => {
    // Simulate: phone sends at 1000, host receives at 1000, host sends at 1010, phone receives at 1010
    // Both clocks are synchronized (same time)
    const sample = calculateSyncSample(1000, 1000, 1010, 1010);
    assertApprox(sample.offset, 0, 0.1, 'offset should be ~0');
    assertEquals(sample.roundTrip, 0, 'round trip should be 0 when instant');
  });

  test('calculateSyncSample: positive offset when phone clock is behind', () => {
    // Phone clock is 100ms behind host clock
    // Phone thinks it's 1000, but host clock says 1100
    // phoneSend=1000, hostReceive=1100, hostSend=1110, phoneReceive=1010
    const sample = calculateSyncSample(1000, 1100, 1110, 1010);
    assertApprox(sample.offset, 100, 1, 'offset should be ~100 (add to phone time to get host time)');
  });

  test('calculateSyncSample: negative offset when phone clock is ahead', () => {
    // Phone clock is 100ms ahead of host clock
    // Phone thinks it's 1100, but host clock says 1000
    // phoneSend=1100, hostReceive=1000, hostSend=1010, phoneReceive=1110
    const sample = calculateSyncSample(1100, 1000, 1010, 1110);
    assertApprox(sample.offset, -100, 1, 'offset should be ~-100 (add to phone time to get host time)');
  });

  test('calculateSyncSample: accounts for network latency symmetrically', () => {
    // 50ms latency each way, clocks synchronized
    // phoneSend=1000, hostReceive=1050 (50ms later), hostSend=1060, phoneReceive=1110 (50ms later)
    const sample = calculateSyncSample(1000, 1050, 1060, 1110);
    assertApprox(sample.offset, 0, 1, 'offset should be ~0 with symmetric latency');
    assertEquals(sample.roundTrip, 100, 'round trip should be 100ms');
  });

  // Test selectBestOffset
  test('selectBestOffset: returns 0 for empty array', () => {
    assertEquals(selectBestOffset([]), 0, 'should return 0 for empty array');
  });

  test('selectBestOffset: selects sample with lowest round trip', () => {
    const samples = [
      { roundTrip: 100, offset: 50 },  // bad sample
      { roundTrip: 20, offset: 48 },   // best sample
      { roundTrip: 80, offset: 52 },   // mediocre sample
    ];
    assertEquals(selectBestOffset(samples), 48, 'should select offset from best sample');
  });

  // Test PhoneClockSync class
  test('PhoneClockSync: initial offset is 0', () => {
    const sync = new PhoneClockSync();
    assertEquals(sync.offset, 0, 'initial offset should be 0');
    assertEquals(sync.sampleCount, 0, 'initial sample count should be 0');
  });

  test('PhoneClockSync: accumulates samples and updates offset', () => {
    const sync = new PhoneClockSync();
    sync.addSample({ roundTrip: 100, offset: 50 });
    assertEquals(sync.sampleCount, 1, 'sample count should be 1');
    assertEquals(sync.offset, 50, 'offset should be from first sample');

    sync.addSample({ roundTrip: 20, offset: 48 });
    assertEquals(sync.sampleCount, 2, 'sample count should be 2');
    assertEquals(sync.offset, 48, 'offset should be from best sample');
  });

  test('PhoneClockSync: toHostTime converts local time correctly', () => {
    const sync = new PhoneClockSync();
    sync.addSample({ roundTrip: 20, offset: 100 }); // phone is 100ms behind
    
    const localTime = 5000;
    const hostTime = sync.toHostTime(localTime);
    assertEquals(hostTime, 5100, 'should add offset to get host time');
  });

  test('PhoneClockSync: reset clears samples', () => {
    const sync = new PhoneClockSync();
    sync.addSample({ roundTrip: 20, offset: 100 });
    assertEquals(sync.sampleCount, 1, 'should have 1 sample');
    
    sync.reset();
    assertEquals(sync.sampleCount, 0, 'should have 0 samples after reset');
    assertEquals(sync.offset, 0, 'offset should be 0 after reset');
  });

  // Simulation test: multiple phones buzzing at similar times
  test('Simulation: correct ordering with different clock offsets', () => {
    // Simulate 3 phones with different clock offsets buzzing
    // Host arm time would be 10000, phones buzz after arm
    
    // Phone A: 50ms behind host, buzzes at local time 10050 (host time 10100)
    const phoneAOffset = 50;
    const phoneALocalBuzz = 10050;
    const phoneACorrectedBuzz = phoneALocalBuzz + phoneAOffset; // 10100

    // Phone B: 30ms ahead of host, buzzes at local time 10080 (host time 10050)
    const phoneBOffset = -30;
    const phoneBLocalBuzz = 10080;
    const phoneBCorrectedBuzz = phoneBLocalBuzz + phoneBOffset; // 10050

    // Phone C: synchronized, buzzes at local time 10075 (host time 10075)
    const phoneCOffset = 0;
    const phoneCLocalBuzz = 10075;
    const phoneCCorrectedBuzz = phoneCLocalBuzz + phoneCOffset; // 10075

    // Expected order: B (10050), C (10075), A (10100)
    const buzzes = [
      { name: 'A', time: phoneACorrectedBuzz },
      { name: 'B', time: phoneBCorrectedBuzz },
      { name: 'C', time: phoneCCorrectedBuzz },
    ].sort((a, b) => a.time - b.time);

    assertEquals(buzzes[0].name, 'B', 'Phone B should be first');
    assertEquals(buzzes[1].name, 'C', 'Phone C should be second');
    assertEquals(buzzes[2].name, 'A', 'Phone A should be third');
    
    // Verify time gaps
    assertEquals(buzzes[1].time - buzzes[0].time, 25, 'Gap between B and C should be 25ms');
    assertEquals(buzzes[2].time - buzzes[1].time, 25, 'Gap between C and A should be 25ms');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Run if executed directly
runTests();
