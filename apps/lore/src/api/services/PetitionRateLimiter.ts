import { $inject, Alepha, AlephaError } from "alepha";
import { files } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, sql } from "alepha/orm";
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
   * Throws when the caller has already created the max allowed petitions in
   * the last 24h. The cap is keyed on the reporter email rather than a user
   * id so it applies uniformly to first-party and (future) anonymous-sigil
   * paths. If `email` is `undefined` the check is skipped — the caller must
   * ensure this only happens when the submission path has its own cap
   * (e.g. the per-sigil cap covers anonymous submits).
   */
  async assertPetitionAllowed(email: string | undefined): Promise<void> {
    if (!email) {
      return;
    }
    const limit = this.options().maxPetitionsPerUserPerDay;
    const cutoff = this.dayAgoIso();
    const count = await this.petitions.count({
      reporterEmail: { eq: email },
      createdAt: { gte: cutoff },
    });
    if (count >= limit) {
      throw new AlephaError(
        `Petition rate limit reached (${limit} per 24h). Try again later.`,
      );
    }
  }

  /**
   * Throws when a single sigil has already submitted the max allowed
   * petitions in the last 24h — caps the blast radius of a leaked sigil id
   * lifted off a partner page. Counted across all users / campaigns from the
   * `petitions.source.sigilId` JSON field (DB-derived, like the per-user cap).
   * No-op for first-party petitions (`sigilId` is empty / undefined).
   */
  async assertSigilPetitionAllowed(sigilId: string | undefined): Promise<void> {
    if (!sigilId) {
      return;
    }
    const limit = this.options().maxPetitionsPerSigilPerDay;
    const cutoff = this.dayAgoIso();
    // The `createdAt` filter goes through the repository's structured where
    // (so the ISO `cutoff` is codec-converted to the column's storage
    // format); the `source.sigilId` match has no structured operator, so it
    // is supplied as a raw SQL fragment in the same `and`.
    const count = await this.petitions.count({
      and: [
        { createdAt: { gte: cutoff } },
        sql`json_extract(${this.petitions.table.source}, '$.sigilId') = ${sigilId}`,
      ],
    });
    if (count >= limit) {
      throw new AlephaError(
        `This sigil has reached its petition rate limit (${limit} per 24h). Try again later.`,
      );
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
      throw new AlephaError(
        `Attachment upload rate limit reached (${limit} per 24h). Try again later.`,
      );
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
