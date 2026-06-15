import { $inject, Alepha } from "alepha";
import { files } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { HttpError } from "alepha/server";
import { petitionOptionsAtom } from "../atoms/petitionOptionsAtom.ts";
import { petitions } from "../entities/petitions.ts";

/**
 * Per-user / per-day caps for petitions and attachment uploads.
 *
 * Counts are derived from the database (no in-memory state) so they survive
 * process restarts and are correct across multiple workers. The trade-off is
 * one COUNT query per check — acceptable for a low-traffic endpoint.
 *
 * Limits come from `petitionOptionsAtom` so tests / ops can override them.
 */
export class PetitionRateLimiter {
  protected alepha = $inject(Alepha);
  protected dateTime = $inject(DateTimeProvider);
  protected petitions = $repository(petitions);
  protected files = $repository(files);

  /**
   * Bucket name used by petition attachments. Kept here so the rate limiter
   * can scope its COUNT to attachment uploads only (not avatar uploads, etc.)
   * — also used by `PetitionController` when creating the bucket and writing
   * files.
   */
  static readonly ATTACHMENT_BUCKET = "petition-attachments";

  /**
   * Throws when the user has already created the max allowed petitions in
   * the last 24h. Otherwise returns silently.
   */
  async assertPetitionAllowed(userId: string): Promise<void> {
    const limit = this.options().maxPetitionsPerUserPerDay;
    const cutoff = this.dayAgoIso();
    const count = await this.petitions.count({
      reporterUserId: { eq: userId },
      createdAt: { gte: cutoff },
    });
    if (count >= limit) {
      // 429 (not a bare AlephaError → 500): a 4xx keeps its message through to
      // the client, so the user sees the real reason instead of the generic
      // "Internal Server Error" that production substitutes for any 5xx.
      throw new HttpError({
        status: 429,
        message: `Petition rate limit reached (${limit} per 24h). Try again later.`,
      });
    }
  }

  /**
   * Throws when the user has already uploaded the max allowed attachments in
   * the last 24h. Otherwise returns silently.
   */
  async assertAttachmentAllowed(userId: string): Promise<void> {
    const limit = this.options().maxAttachmentsPerUserPerDay;
    const cutoff = this.dayAgoIso();
    const count = await this.files.count({
      creator: { eq: userId },
      bucket: { eq: PetitionRateLimiter.ATTACHMENT_BUCKET },
      createdAt: { gte: cutoff },
    });
    if (count >= limit) {
      throw new HttpError({
        status: 429,
        message: `Attachment upload rate limit reached (${limit} per 24h). Try again later.`,
      });
    }
  }

  public options() {
    return this.alepha.store.get(petitionOptionsAtom);
  }

  protected dayAgoIso(): string {
    return new Date(
      this.dateTime.nowMillis() - 24 * 60 * 60 * 1000,
    ).toISOString();
  }
}
