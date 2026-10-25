import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { oauthClientEntity } from "../entities/oauthClientEntity.ts";
import { OAuthClientService } from "../services/OAuthClientService.ts";

/**
 * Scheduled cleanup for the OAuth module.
 *
 * Declared as a module variant - not auto-injected - and registered from
 * `$realm`'s `features.oauth` branch, following `UserJobs`. A job that
 * mounted itself would run in every application that merely imports this
 * module.
 */
export class OAuthJobs {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly clients = $repository(oauthClientEntity);
  protected readonly clientService = $inject(OAuthClientService);

  /**
   * Delete dynamically-registered clients that never received a token.
   *
   * ## Why the table grows at all
   *
   * RFC 7591 registration is unauthenticated by design, and a client may
   * register and then never complete the flow - claude.ai registers twice
   * per attempt and usually abandons both. Production held **39 rows named
   * "Claude" of which 7 ever got a session**, plus 3 "ChatGPT" rows with
   * none. Dedupe stops new ones accumulating; this collects what is already
   * there and anything a future client abandons.
   *
   * ## ⚠️ Four conditions, and "never used" is the one that matters
   *
   * - `source = 'dcr'` only. A client Platform seeded with an explicit id is
   *   configuration, not litter, and may legitimately have no session yet.
   * - **Older than 24 hours.** An authorization code lives about a minute,
   *   but a client registered while a human reads a consent screen must
   *   survive the wait - and somebody may leave that tab open over lunch.
   *   A tighter window deletes a registration mid-flow, which the client
   *   then cannot complete and cannot diagnose.
   * - **`lastUsedAt` is null**: no grant ever succeeded for it. That is what
   *   "abandoned" means. The job used to read "no session right now"
   *   instead (#Q2413), and that deleted clients in use: ChatGPT registers
   *   once and keeps its `client_id` for the life of the connector, so when
   *   its session ended (the idle timeout, a revoke, the absolute ceiling)
   *   the next night removed the client, and every sign-in after it was
   *   answered `unknown client_id` until a human removed and re-added the
   *   connector. A client used once is kept: a row is cheap, a connector
   *   that cannot sign in again is not.
   * - **No session references it.** For a row whose grant predates
   *   `lastUsedAt` being written: while it still holds a session it is left
   *   alone. Once its sessions are gone it is collected, the pre-v1 cost of
   *   rows older than the column.
   *
   * Each deletion is logged with the client's id, name and dates. It is the
   * only trace one leaves: a cron run keeps no `job_executions.logs`, and a
   * count cannot say whose connector just stopped working.
   */
  public readonly purgeAbandonedClients = $job({
    name: "system.oauth.purge-abandoned-clients",
    description:
      "Deletes dynamically registered OAuth clients older than a day that never received a token.",
    // `0 3 * * *`, shared with the other daily purges rather than given a
    // minute of its own. Cloudflare counts cron triggers per account and
    // shares them across every Worker on it, so a distinct expression for
    // a purge that measures in the low hundreds of milliseconds spends a
    // slot every app on the account pays for. It was `20 3 * * *` until
    // 2026-09-20.
    cron: "0 3 * * *",
    timeout: [30, "seconds"],
    handler: async () => {
      const cutoff = this.dateTime
        .now()
        .subtract(24, "hours")
        .toDate()
        .toISOString();

      const candidates = await this.clients.findMany({
        where: {
          source: { eq: "dcr" },
          createdAt: { lt: cutoff },
          lastUsedAt: { isNull: true },
        },
      });
      if (candidates.length === 0) {
        return;
      }

      const used = await this.clientService.clientIdsWithSessions(
        candidates.map((client) => client.clientId),
      );
      const abandoned = candidates.filter(
        (client) => !used.has(client.clientId),
      );
      if (abandoned.length === 0) {
        return;
      }

      for (const client of abandoned) {
        await this.clients.deleteById(client.id);
        this.log.info("Abandoned OAuth client purged", {
          clientId: client.clientId,
          clientName: client.clientName,
          createdAt: client.createdAt,
          lastUsedAt: client.lastUsedAt ?? null,
        });
      }

      this.log.info("Abandoned OAuth clients purged", {
        purged: abandoned.length,
        examined: candidates.length,
      });
    },
  });
}
