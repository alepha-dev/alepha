import { DiscordNotificationChannel, DiscordTransport } from "@alepha/discord";
import { $inject } from "alepha";
import {
  WebhookDestinationPolicy,
  WebhookEndpointService,
  type WebhookEndpointResource,
} from "alepha/api/webhooks";
import { CryptoProvider } from "alepha/crypto";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";

import { eventSubscriptions } from "../entities/eventSubscriptions.ts";
import {
  notificationChannels,
  type ProjectChannel,
} from "../entities/notificationChannels.ts";
import type { ProjectChannelCreated } from "../schemas/projectChannelCreatedSchema.ts";
import type { ProjectChannelResource } from "../schemas/projectChannelResourceSchema.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { ProjectRecipients } from "./ProjectRecipients.ts";

/**
 * A project's notification channels (#Q3614, #Q3891): where a subscription
 * posts instead of a member. Discord channels for now, as many as a project
 * wants, each a name and a sealed webhook URL.
 *
 * The URL is the whole credential. It is validated against the framework's
 * pattern, proven by a test post before it is saved, sealed under its own
 * purpose, and never read back: no response, log line, outbox row, run
 * snapshot or receipt carries it.
 *
 * Reads need `subscription:read`, writes `subscription:manage` (#Q3891);
 * Deleting a channel deletes its subscriptions.
 */
export class ProjectChannelService {
  protected readonly log = $logger();
  protected readonly recipients = $inject(ProjectRecipients);
  protected readonly rows = $repository(notificationChannels);
  protected readonly subscriptions = $repository(eventSubscriptions);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly transport = $inject(DiscordTransport);
  protected readonly endpoints = $inject(WebhookEndpointService);
  protected readonly policy = $inject(WebhookDestinationPolicy);

  /**
   * Inbox and Email, then every configured channel: never a URL.
   */
  public async list(
    projectId: number,
    user: UserAccountToken,
  ): Promise<ProjectChannelResource[]> {
    await this.assert(projectId, user, "read");
    const rows = await this.rows.findMany({
      where: { projectId },
      orderBy: [{ column: "name", direction: "asc" }],
      limit: 100,
    });
    const managing = await this.holds(projectId, user, "manage");
    const resources: ProjectChannelResource[] = [];
    for (const row of rows) resources.push(await this.resource(row, managing));
    return [
      { id: "inbox", kind: "inbox", name: "In-app", builtIn: true },
      { id: "email", kind: "email", name: "Email", builtIn: true },
      ...resources,
    ];
  }

  public async add(
    projectId: number,
    user: UserAccountToken,
    input: { kind?: "discord" | "webhook"; name: string; url: string },
  ): Promise<ProjectChannelCreated> {
    await this.assert(projectId, user, "manage");
    const name = this.name(input.name);
    await this.unique(projectId, name);
    if (input.kind === "webhook")
      return this.addWebhook(projectId, user, name, input.url);
    const url = await this.prove(input.url, name);
    const row = await this.rows.create({
      id: `discord-${this.crypto.randomUUID()}`,
      projectId,
      kind: "discord",
      name,
      url: await this.seal.seal(url, CredentialSealService.DISCORD_PURPOSE),
      createdBy: user.id,
    });
    return this.resource(row, true);
  }

  /**
   * A webhook channel (#Q3900): one `webhook_endpoints` row scoped to the
   * project, subscribed to every event (Lore picks the receivers from its
   * own subscriptions, never the framework's subscription list). Its secret
   * is returned this once.
   */
  protected async addWebhook(
    projectId: number,
    user: UserAccountToken,
    name: string,
    value: string,
  ): Promise<ProjectChannelCreated> {
    const url = this.webhookUrl(value);
    const created = await this.endpoints.create(
      { url, description: name, events: [], createdBy: user.id },
      { scope: ProjectChannelService.scope(projectId), userId: user.id },
    );
    const row = await this.rows.create({
      id: `webhook-${this.crypto.randomUUID()}`,
      projectId,
      kind: "webhook",
      name,
      url: "",
      endpointId: created.endpoint.id,
      createdBy: user.id,
    });
    return {
      ...this.webhookResource(row, created.endpoint, true),
      secret: created.secret,
    };
  }

  /**
   * A new signing secret for a webhook channel, in clear, this once. The
   * old one keeps signing for 24 hours (the framework's rotation).
   */
  public async rotate(
    projectId: number,
    user: UserAccountToken,
    id: string,
  ): Promise<ProjectChannelCreated> {
    await this.assert(projectId, user, "manage");
    const row = await this.row(projectId, id);
    if (row.kind !== "webhook" || !row.endpointId)
      throw new BadRequestError("Only a webhook channel has a secret");
    const rotated = await this.endpoints.rotateSecret(
      row.endpointId,
      {},
      { scope: ProjectChannelService.scope(projectId), userId: user.id },
    );
    return {
      ...this.webhookResource(row, rotated.endpoint, true),
      secret: rotated.secret,
    };
  }

  /**
   * The tenancy scope of a project's webhook endpoints.
   */
  public static scope(projectId: number): string {
    return `project:${projectId}`;
  }

  /**
   * A webhook URL: the framework's rules, and on every runtime a literal
   * private or loopback address is refused (#Q3900). A host name that
   * resolves to one is caught only where a resolver runs (Node and Bun),
   * not on Workers.
   */
  public webhookUrl(value: string): string {
    const url = value.trim();
    let parsed: URL;
    try {
      parsed = this.policy.checkUrl(url);
    } catch (error) {
      throw new BadRequestError(
        `url: ${error instanceof Error ? error.message : "refused"}`,
      );
    }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (this.policy.isLocalName(host) || this.policy.isPrivateAddress(host))
      throw new BadRequestError(`url: ${host} is a private address`);
    return url;
  }

  public async update(
    projectId: number,
    user: UserAccountToken,
    id: string,
    input: { name?: string; url?: string },
  ): Promise<ProjectChannelResource> {
    await this.assert(projectId, user, "manage");
    const row = await this.row(projectId, id);
    const name = input.name !== undefined ? this.name(input.name) : row.name;
    if (name !== row.name) await this.unique(projectId, name);
    if (row.kind === "webhook" && row.endpointId) {
      const endpoint = await this.endpoints.update(
        row.endpointId,
        {
          description: name,
          ...(input.url !== undefined
            ? { url: this.webhookUrl(input.url) }
            : {}),
        },
        { scope: ProjectChannelService.scope(projectId), userId: user.id },
      );
      const renamed = await this.rows.updateById(row.id, { name });
      return this.webhookResource(renamed, endpoint, true);
    }
    const url =
      input.url !== undefined
        ? await this.seal.seal(
            await this.prove(input.url, name),
            CredentialSealService.DISCORD_PURPOSE,
          )
        : row.url;
    const updated = await this.rows.updateById(row.id, {
      name,
      url,
    });
    return this.resource(updated, true);
  }

  /**
   * Delete a channel: it leaves every rule that named it first, which keeps
   * notifying on its other channels, unpaused (#Q3613).
   */
  public async remove(
    projectId: number,
    user: UserAccountToken,
    id: string,
  ): Promise<void> {
    await this.assert(projectId, user, "manage");
    const row = await this.row(projectId, id);
    await this.subscriptions.deleteMany({
      projectId: { eq: projectId },
      channelId: { eq: row.id },
    });
    await this.rows.deleteById(row.id);
    if (row.kind === "webhook" && row.endpointId)
      await this.endpoints.delete(row.endpointId, {
        scope: ProjectChannelService.scope(projectId),
        userId: user.id,
      });
  }

  /**
   * `subscription:<level>`.
   */
  protected async assert(
    projectId: number,
    user: UserAccountToken,
    level: "read" | "manage",
  ): Promise<void> {
    if (!(await this.holds(projectId, user, level)))
      throw new ForbiddenError(`Missing subscription:${level}`);
  }

  protected async holds(
    projectId: number,
    user: UserAccountToken,
    level: "read" | "manage",
  ): Promise<boolean> {
    const held = await this.recipients.of(projectId, user);
    return held.includes(`subscription:${level}`);
  }

  /**
   * The webhook URL of a channel, unsealed, for the adapter posting to it
   * (#Q3615), after checking the channel belongs to that project.
   */
  public async webhook(projectId: number, id: string): Promise<string> {
    const row = await this.row(projectId, id);
    return this.seal.open(row.url, CredentialSealService.DISCORD_PURPOSE);
  }

  protected async resource(
    row: ProjectChannel,
    managing: boolean,
  ): Promise<ProjectChannelResource> {
    if (row.kind === "webhook" && row.endpointId) {
      const endpoint = await this.endpoints
        .get(row.endpointId, {
          scope: ProjectChannelService.scope(row.projectId),
        })
        .catch(() => undefined);
      if (endpoint) return this.webhookResource(row, endpoint, managing);
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        builtIn: false,
        status: "disabled",
      };
    }
    return { id: row.id, kind: row.kind, name: row.name, builtIn: false };
  }

  /**
   * A webhook channel with its endpoint's state. The URL only for whoever
   * manages notifications.
   */
  protected webhookResource(
    row: ProjectChannel,
    endpoint: WebhookEndpointResource,
    managing: boolean,
  ): ProjectChannelResource {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      builtIn: false,
      ...(managing ? { url: endpoint.url } : {}),
      status: endpoint.status,
      ...(endpoint.disabledReason
        ? { disabledReason: endpoint.disabledReason }
        : {}),
      secretPrefix: endpoint.secretPrefix,
    };
  }

  protected async row(projectId: number, id: string) {
    const row = await this.rows.findOne({
      where: { projectId, id },
    });
    if (!row) throw new NotFoundError("No such channel in this project");
    return row;
  }

  protected name(value: string): string {
    const name = value.trim();
    if (!name || name.length > 64)
      throw new BadRequestError("name: between 1 and 64 characters");
    return name;
  }

  protected async unique(projectId: number, name: string) {
    if (await this.rows.findOne({ where: { projectId, name } }))
      throw new ConflictError(`A channel named "${name}" already exists`);
  }

  /**
   * The URL, checked against the framework's pattern and proven by a test
   * post. A refusal names neither the URL nor Discord's answer body.
   */
  protected async prove(value: string, name: string): Promise<string> {
    const url = value.trim();
    if (!DiscordNotificationChannel.WEBHOOK_URL.test(url))
      throw new BadRequestError(
        "url: expected https://discord.com/api/webhooks/<id>/<token>",
      );
    try {
      await this.transport.post(url, {
        content: `Lore will post notifications to this channel (${name}).`,
        allowed_mentions: { parse: [] },
      } as never);
    } catch {
      throw new BadRequestError(
        "url: Discord refused the test message; check the webhook and try again",
      );
    }
    return url;
  }
}
