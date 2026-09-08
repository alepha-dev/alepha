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
   * Delete dynamically-registered clients nobody ever authorized.
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
   * ## ⚠️ Three conditions, and the grace period is the subtle one
   *
   * - `source = 'dcr'` only. A client Platform seeded with an explicit id is
   *   configuration, not litter, and may legitimately have no session yet.
   * - **Older than 24 hours.** An authorization code lives about a minute,
   *   but a client registered while a human reads a consent screen must
   *   survive the wait - and somebody may leave that tab open over lunch.
   *   A tighter window deletes a registration mid-flow, which the client
   *   then cannot complete and cannot diagnose.
   * - **No session references it.** That is what "abandoned" means here.
   *   A client whose sessions have all expired is left alone by this job:
   *   the sessions are `UserJobs.purgeExpiredSessions`'s to remove, and the
   *   client becomes collectable on a later pass once they are gone.
   */
  public readonly purgeAbandonedClients = $job({
    name: "api:oauth:purgeAbandonedClients",
    cron: "20 3 * * *",
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
      }

      this.log.info("Abandoned OAuth clients purged", {
        purged: abandoned.length,
        examined: candidates.length,
      });
    },
  });
}
