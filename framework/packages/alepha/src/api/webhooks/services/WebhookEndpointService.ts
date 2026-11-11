import { $inject, AlephaError } from "alepha";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import {
  type WebhookEndpointEntity,
  webhookEndpointEntity,
} from "../entities/webhookEndpointEntity.ts";
import type { CreateWebhookEndpoint } from "../schemas/createWebhookEndpointSchema.ts";
import type { WebhookEndpointResource } from "../schemas/webhookEndpointResourceSchema.ts";
import type { WebhookEndpointWithSecret } from "../schemas/webhookEndpointWithSecretSchema.ts";

/**
 * The write path of webhook endpoints, and the one place their secrets are
 * generated, encrypted and decrypted.
 *
 * Every operation an admin screen or an app's own settings page drives
 * lives here, so an app offering webhooks to its customers writes a thin
 * controller of its own over it, passing its tenancy key as `scope`.
 */
export class WebhookEndpointService {
  protected readonly log = $logger();
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly secrets = $inject(SecretProvider);
  protected readonly endpoints = $repository(webhookEndpointEntity);

  /**
   * How a signing secret begins, as the Standard Webhooks specification
   * names it.
   */
  public readonly secretPrefix = "whsec_";

  /**
   * Register an endpoint and return its signing secret, in clear, this once.
   *
   * The secret is `whsec_` and 32 random bytes in base64, stored encrypted
   * with `APP_SECRET`. No read ever returns it again.
   */
  public async create(
    input: CreateWebhookEndpoint & { createdBy?: string },
  ): Promise<WebhookEndpointWithSecret> {
    const secret = this.generateSecret();
    const row = await this.endpoints.create({
      url: input.url,
      description: input.description,
      events: this.normalizeEvents(input.events),
      scope: input.scope,
      createdBy: input.createdBy,
      secret: await this.encryptSecret(secret),
      secretPrefix: secret.slice(0, 10),
      status: "active",
    });
    this.log.info("Webhook endpoint created", {
      endpointId: row.id,
      host: this.hostOf(row.url),
    });
    return { endpoint: this.toResource(row), secret };
  }

  /**
   * The active endpoints an event of `eventType` reaches.
   *
   * **Scope is fail-closed.** Without a scope, only unscoped endpoints. With
   * one, the unscoped endpoints and the endpoints of exactly that scope. A
   * scoped endpoint therefore never receives an event sent without its
   * scope: forgetting `scope` in a multi-tenant app delivers to the
   * operator's own endpoints, never to another tenant's.
   *
   * The subscription filter runs in memory over the rows selected by status
   * and scope: array operators are Postgres-only in the ORM.
   */
  public async subscribers(
    eventType: string,
    scope?: string,
  ): Promise<WebhookEndpointEntity[]> {
    const rows = await this.endpoints.findMany({
      where: {
        status: { eq: "active" },
        ...(scope === undefined
          ? { scope: { isNull: true } }
          : { or: [{ scope: { isNull: true } }, { scope: { eq: scope } }] }),
      },
    });
    return rows.filter(
      (row) => row.events.length === 0 || row.events.includes(eventType),
    );
  }

  /**
   * An endpoint as reads return it: never a secret.
   */
  public toResource(row: WebhookEndpointEntity): WebhookEndpointResource {
    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      url: row.url,
      description: row.description,
      events: row.events,
      status: row.status,
      disabledReason: row.disabledReason,
      scope: row.scope,
      createdBy: row.createdBy,
      secretPrefix: row.secretPrefix,
      hasPreviousSecret: !!row.previousSecret,
      previousSecretExpiresAt: row.previousSecretExpiresAt,
      failingSince: row.failingSince,
      lastDeliveryAt: row.lastDeliveryAt,
      lastSuccessAt: row.lastSuccessAt,
    };
  }

  /**
   * The host of an endpoint's URL: what logs, errors and hook payloads name,
   * never the URL, which can carry a token in its query string.
   */
  public hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return "invalid-url";
    }
  }

  /**
   * Decrypt a stored secret. Throws when it does not decrypt, which means
   * `APP_SECRET` changed or was lost since the secret was written.
   */
  public async decryptSecret(encrypted: string): Promise<string> {
    try {
      return await this.crypto.decrypt(encrypted, this.secrets.secretKey);
    } catch (error) {
      throw new AlephaError(
        "Webhook endpoint secret does not decrypt with the current APP_SECRET",
        { cause: error },
      );
    }
  }

  protected encryptSecret(secret: string): Promise<string> {
    return this.crypto.encrypt(secret, this.secrets.secretKey);
  }

  /**
   * `whsec_` and 32 random bytes, base64: the Standard Webhooks shape, whose
   * receivers base64-decode what follows the prefix to get the HMAC key.
   */
  protected generateSecret(): string {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `${this.secretPrefix}${btoa(binary)}`;
  }

  protected normalizeEvents(events?: string[]): string[] {
    return [...new Set((events ?? []).map((it) => it.trim()).filter(Boolean))];
  }
}
