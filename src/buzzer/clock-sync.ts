import type { ClockSample } from './types';
import { SYNC_SAMPLE_COUNT } from './types';

/**
 * Calculate clock offset from a sync exchange.
 * Uses NTP-style calculation: offset = ((t1 - t0) + (t2 - t3)) / 2
 * where t0 = phone send, t1 = host receive, t2 = host send, t3 = phone receive
 */
export function calculateSyncSample(
  phoneSendTime: number,
  hostReceiveTime: number,
  hostSendTime: number,
  phoneReceiveTime: number
): ClockSample {
  const roundTrip = (phoneReceiveTime - phoneSendTime) - (hostSendTime - hostReceiveTime);
  // offset: how much to ADD to phone time to get host time
  const offset = ((hostReceiveTime - phoneSendTime) + (hostSendTime - phoneReceiveTime)) / 2;
  return { roundTrip, offset };
}

/**
 * Select the best clock offset from samples.
 * Uses the sample with the lowest round-trip time, as it has the least network jitter.
 */
export function selectBestOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a.roundTrip - b.roundTrip);
  return sorted[0].offset;
}

/**
 * Manager for accumulating clock sync samples on the phone side.
 */
export class PhoneClockSync {
  private samples: ClockSample[] = [];
  private _offset = 0;

  get offset(): number {
    return this._offset;
  }

  addSample(sample: ClockSample): void {
    this.samples.push(sample);
    if (this.samples.length > SYNC_SAMPLE_COUNT * 2) {
      this.samples = this.samples.slice(-SYNC_SAMPLE_COUNT);
    }
    this._offset = selectBestOffset(this.samples);
  }

  reset(): void {
    this.samples = [];
    this._offset = 0;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Convert local performance.now() to estimated host time */
  toHostTime(localTime: number): number {
    return localTime + this._offset;
  }
}

/**
 * Manager for tracking clock offsets on the host side (for debugging/display).
 */
export class HostClockTracker {
  private offsets = new Map<string, number>();

  setOffset(peerId: string, offset: number): void {
    this.offsets.set(peerId, offset);
  }

  getOffset(peerId: string): number {
    return this.offsets.get(peerId) ?? 0;
  }

  clear(): void {
    this.offsets.clear();
  }
}
