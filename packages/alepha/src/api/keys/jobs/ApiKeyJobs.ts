import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { ApiKeyService } from "../services/ApiKeyService.ts";

/**
 * Scheduled enforcement of the API key retention windows.
 *
 * Expired and revoked keys stay listed, because a dead key is information:
 * it is the answer to "why did CI stop working". This is what eventually
 * removes them, so `api_keys` does not grow without bound.
 */
export class ApiKeyJobs {
  protected readonly apiKeyService = $inject(ApiKeyService);

  /**
   * Delete keys past `purgeExpiredAfterDays` (from `expiresAt`) or
   * `purgeRevokedAfterDays` (from `revokedAt`), each disabled by `0`.
   *
   * Runs daily, and deletes in bounded batches: see
   * {@link ApiKeyService.purgeDeadKeys}.
   */
  public readonly purgeExpired = $job({
    name: "system.keys.purge-expired",
    cron: "0 3 * * *", // Daily at 03:00
    description: "Deletes API keys past their retention window.",
    handler: async () => {
      await this.apiKeyService.purgeDeadKeys();
    },
  });

  /**
   * Tell each key's owner, once, that the key enters its expiry warning
   * window (`expiryWarningDays`, `0` disabling the notice). Does nothing
   * where `ApiKeyNotifications` is not registered. See
   * {@link ApiKeyService.notifyExpiring}.
   */
  public readonly notifyExpiring = $job({
    name: "system.keys.notify-expiring",
    cron: "0 9 * * *", // Daily at 09:00
    description: "Warns the owners of API keys about to expire, once per key.",
    handler: async () => {
      await this.apiKeyService.notifyExpiring();
    },
  });
}
