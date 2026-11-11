import { $inject, $store, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, RepositoryProvider } from "alepha/orm";

import { webhookDeliveryEntity } from "../entities/webhookDeliveryEntity.ts";
import {
  type WebhookEndpointEntity,
  webhookEndpointEntity,
} from "../entities/webhookEndpointEntity.ts";
import { WebhookNotifications } from "../notifications/WebhookNotifications.ts";
import type { WebhookDisabledReason } from "../schemas/webhookDisabledReasonSchema.ts";
import { webhookOptions } from "../schemas/webhookOptionsAtom.ts";

/**
 * What keeps endpoints and the delivery log healthy over days: the
 * automatic disable and its notice, and the hourly purge.
 */
export class WebhookHealthService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly repositoryProvider = $inject(RepositoryProvider);
  protected readonly endpoints = $repository(webhookEndpointEntity);
  protected readonly deliveries = $repository(webhookDeliveryEntity);

  protected readonly options = $store(webhookOptions);

  /**
   * Whether a failed attempt now ends the endpoint: its unbroken run of
   * failures began at least `disableAfterDays` ago. Decided on a fresh
   * failure, so a quiet endpoint is never disabled for a bad day long past.
   */
  public failingTooLong(endpoint: WebhookEndpointEntity): boolean {
    if (!endpoint.failingSince) return false;
    const since = this.dateTime.of(endpoint.failingSince).valueOf();
    const limit = this.options.disableAfterDays * 24 * 60 * 60 * 1000;
    return this.dateTime.nowMillis() - since >= limit;
  }

  /**
   * Disable an endpoint the module can no longer deliver to, emit
   * `webhooks:endpoint:disabled`, and tell the user who registered it when
   * the app registers `WebhookNotifications`. Names the host, never the URL.
   */
  public async disable(
    endpoint: WebhookEndpointEntity,
    reason: WebhookDisabledReason,
  ): Promise<void> {
    await this.endpoints.updateById(endpoint.id, {
      status: "disabled",
      disabledReason: reason,
    });
    const host = this.hostOf(endpoint.url);
    this.log.warn("Webhook endpoint disabled", {
      endpointId: endpoint.id,
      host,
      reason,
    });
    await this.alepha.events.emit("webhooks:endpoint:disabled", {
      endpointId: endpoint.id,
      host,
      reason,
      scope: endpoint.scope,
    });
    await this.notifyCreator(endpoint, host, reason);
  }

  /**
   * The hourly purge: deliveries past the retention window, expired previous
   * secrets, and deliveries stuck `pending` with no job left to move them.
   * Each duty works in bounded batches.
   */
  public async purge(): Promise<{
    deleted: number;
    secretsCleared: number;
    stuckFailed: number;
  }> {
    const now = this.dateTime.nowMillis();
    const options = this.options;
    const day = 24 * 60 * 60 * 1000;
    const cutoff = new Date(now - options.retentionDays * day).toISOString();

    let deleted = 0;
    for (let batch = 0; batch < options.maxPurgeBatches; batch++) {
      const rows = await this.deliveries.findMany({
        where: { createdAt: { lt: cutoff } },
        columns: ["id"],
        limit: options.purgeBatchSize,
      });
      if (rows.length === 0) break;
      await this.deliveries.deleteMany({
        id: { inArray: rows.map((it) => it.id) },
      });
      deleted += rows.length;
      if (rows.length < options.purgeBatchSize) break;
    }

    const nowIso = new Date(now).toISOString();
    const cleared = await this.endpoints.updateMany(
      { previousSecretExpiresAt: { lte: nowIso } },
      { previousSecret: null as any, previousSecretExpiresAt: null as any },
    );

    const stuckBefore = new Date(
      now - options.stuckAfterHours * 60 * 60 * 1000,
    ).toISOString();
    const paused = await this.endpoints.findMany({
      where: { status: { eq: "paused" } },
      columns: ["id"],
    });
    let stuckFailed = 0;
    for (let batch = 0; batch < options.maxPurgeBatches; batch++) {
      const rows = await this.deliveries.findMany({
        where: {
          status: { eq: "pending" },
          updatedAt: { lt: stuckBefore },
          ...(paused.length > 0
            ? { endpointId: { notInArray: paused.map((it) => it.id) } }
            : {}),
        },
        columns: ["id"],
        limit: options.purgeBatchSize,
      });
      if (rows.length === 0) break;
      await this.deliveries.updateMany(
        { id: { inArray: rows.map((it) => it.id) } },
        { status: "failed", error: "no outcome recorded" },
      );
      stuckFailed += rows.length;
      if (rows.length < options.purgeBatchSize) break;
    }

    if (deleted + cleared.length + stuckFailed > 0) {
      this.log.info("Webhook purge", {
        deleted,
        secretsCleared: cleared.length,
        stuckFailed,
      });
    }
    return { deleted, secretsCleared: cleared.length, stuckFailed };
  }

  protected async notifyCreator(
    endpoint: WebhookEndpointEntity,
    host: string,
    reason: WebhookDisabledReason,
  ): Promise<void> {
    if (!endpoint.createdBy || !this.alepha.has(WebhookNotifications)) return;
    try {
      // Resolved at runtime, not imported: the users module is optional.
      const users = this.repositoryProvider
        .getRepositories()
        .find((repo) => repo.entity.name === "users");
      if (!users) return;
      const user = (await users.findById(endpoint.createdBy)) as
        | { email?: string }
        | undefined;
      if (!user?.email) return;
      const { en, fr } = this.explanations[reason];
      await this.alepha.inject(WebhookNotifications).endpointDisabled.push({
        contact: user.email,
        variables: {
          email: user.email,
          host,
          reason,
          explanation: en,
          explanationFr: fr,
        },
      });
    } catch (error) {
      // A notice that cannot be queued never undoes the disable.
      this.log.warn("Webhook disabled notice not sent", {
        endpointId: endpoint.id,
        error,
      });
    }
  }

  protected readonly explanations: Record<
    WebhookDisabledReason,
    { en: string; fr: string }
  > = {
    gone: {
      en: "The receiver answered 410 Gone, which unsubscribes it.",
      fr: "Le récepteur a répondu 410 Gone, ce qui le désabonne.",
    },
    failing: {
      en: "Every delivery to it has failed for several days in a row.",
      fr: "Toutes les livraisons ont échoué plusieurs jours de suite.",
    },
    secret: {
      en: "Its signing secret can no longer be read, usually because the application secret changed. Rotate the secret, give the receiver the new one, then enable the endpoint.",
      fr: "Son secret de signature ne peut plus être lu, en général parce que le secret de l'application a changé. Renouvelez le secret, donnez le nouveau au récepteur, puis réactivez le point de réception.",
    },
  };

  protected hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return "invalid-url";
    }
  }
}
