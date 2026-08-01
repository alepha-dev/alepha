import { $inject, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, sql } from "alepha/orm";
import { $action, HttpError } from "alepha/server";
import { blights } from "../entities/blights.ts";
import { campaignSources } from "../entities/campaignSources.ts";
import { BlightRuleService } from "../services/BlightRuleService.ts";

/** Refuse anything larger, rather than truncate it. */
const MAX_FINGERPRINTS = 50;

/**
 * Where an observer files blights.
 *
 * The only ingestion endpoint Lore keeps. What arrives here is already
 * deduplicated — one line per distinct failure with a count — because the
 * division of labour is that **Sigil deduplicates and Lore judges**. Raw error
 * events never reach this app any more, which is what turns the inbox from a
 * firehose into something a person can act on.
 *
 * Authenticated by a campaign source key, never by a user session: this is a
 * machine talking. And never by `api_keys`, which carry a person's roles.
 */
export class SourceIngestController {
  protected readonly log = $logger();
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly rules = $inject(BlightRuleService);

  protected readonly sources = $repository(campaignSources);
  protected readonly blights = $repository(blights);

  ingestBlights = $action({
    method: "POST",
    path: "/blights/ingest",
    description:
      "File deduplicated blights into a campaign (bearer = source key)",
    schema: {
      headers: z.object({ authorization: z.string().optional() }),
      body: z.object({
        fingerprints: z.array(
          z.object({
            fingerprint: z.string().min(1).max(128),
            name: z.string().max(200),
            message: z.string().max(2000),
            stackSample: z.string().max(4096).optional(),
            sourceUrl: z.string().max(2000).optional(),
            release: z.string().max(200).optional(),
            origin: z.enum(["client", "server"]).optional(),
            windowCount: z.integer().min(1),
            firstSeenAt: z.string(),
            lastSeenAt: z.string(),
            pulseUrl: z.string().max(2000).optional(),
          }),
        ),
      }),
      response: z.object({ accepted: z.integer(), ignored: z.integer() }),
    },
    handler: async ({ headers, body }) => {
      const source = await this.resolve(headers.authorization);

      if (body.fingerprints.length > MAX_FINGERPRINTS) {
        // Refused, not trimmed: dropping the tail of a batch leaves the sender
        // believing it was delivered.
        throw new HttpError({
          status: 413,
          message: `At most ${MAX_FINGERPRINTS} fingerprints per request, got ${body.fingerprints.length}`,
        });
      }

      // Loaded once for the whole batch rather than per row.
      const ignoreRules = await this.rules.listForCampaign(source.campaignId);

      let accepted = 0;
      let ignored = 0;

      for (const item of body.fingerprints) {
        // Applied BEFORE insertion. Filtering on read would mean a muted error
        // still grows the table and still lights up every count.
        if (this.rules.matches(item.message, ignoreRules)) {
          ignored++;
          continue;
        }

        await this.blights.upsert(
          {
            campaignId: source.campaignId,
            sourceId: source.id,
            fingerprint: item.fingerprint,
            name: item.name,
            message: item.message,
            stack: item.stackSample ?? "",
            sourceUrl: item.sourceUrl ?? "",
            release: item.release,
            origin: item.origin ?? "client",
            pulseUrl: item.pulseUrl,
            firstSeenAt: item.firstSeenAt,
            lastSeenAt: item.lastSeenAt,
            count: item.windowCount,
          },
          {
            target: ["campaignId", "fingerprint"],
            set: {
              count: sql`${this.blights.table.count} + ${item.windowCount}`,
              lastSeenAt: item.lastSeenAt,
              // Refreshed because they describe the current state of the bug:
              // which release still shows it, and where to go look.
              release: item.release,
              pulseUrl: item.pulseUrl,
            },
          },
        );
        accepted++;
      }

      await this.sources.updateById(source.id, {
        lastSeenAt: new Date(this.dateTime.nowMillis()).toISOString(),
      } as any);

      // Shown, never inferred: a sender whose reports are all being muted
      // should see that here rather than wonder at an empty inbox.
      return { accepted, ignored };
    },
  });

  /**
   * Resolves a bearer to a live source with the right scope.
   *
   * One 401 for missing, malformed, unknown, revoked and under-scoped alike —
   * telling them apart lets anyone probe for keys that once existed.
   */
  protected async resolve(authorization: string | undefined) {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : undefined;
    const source = token
      ? await this.sources.findOne({
          where: { tokenHash: this.crypto.hash(token) },
        })
      : undefined;

    if (
      !source ||
      source.revokedAt ||
      !(source.scopes ?? []).includes("blight:write")
    ) {
      throw new HttpError({
        status: 401,
        message: "Unknown or revoked source key",
      });
    }
    return source;
  }
}
