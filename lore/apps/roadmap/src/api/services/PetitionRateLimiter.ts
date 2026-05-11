import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { beacons } from "../entities/beacons.ts";

interface WindowEntry {
  ts: number;
  ipHash: string;
  campaignId: number;
}

/**
 * Sliding-window per-minute rate limit + 24h daily cap for beacon submissions.
 *
 * The per-minute window is held in memory (per process). The daily cap is
 * derived from the database — counts `beacons` rows created in the last 24h
 * for the campaign.
 */
export class BeaconRateLimiter {
  protected dateTime = $inject(DateTimeProvider);
  protected beacons = $repository(beacons);

  protected window: WindowEntry[] = [];

  /**
   * Sliding 60-second window per (campaignId, ipHash).
   * Returns true if within limit, false if exceeded.
   */
  checkPerMinute(
    campaignId: number,
    ipHash: string,
    limitPerMin: number,
  ): boolean {
    const now = this.dateTime.nowMillis();
    const cutoff = now - 60_000;
    this.window = this.window.filter((e) => e.ts >= cutoff);
    const count = this.window.filter(
      (e) => e.campaignId === campaignId && e.ipHash === ipHash,
    ).length;
    if (count >= limitPerMin) {
      return false;
    }
    this.window.push({ ts: now, ipHash, campaignId });
    return true;
  }

  /**
   * Daily cap: count beacons created in the last 24h for the campaign.
   * Returns true if under the cap, false if it would be exceeded.
   */
  async checkDailyCap(campaignId: number, cap: number): Promise<boolean> {
    const cutoff = new Date(
      this.dateTime.nowMillis() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const count = await this.beacons.count({
      campaignId: { eq: campaignId },
      createdAt: { gte: cutoff },
    });
    return count < cap;
  }
}
