import { DiscordNotificationChannel, DiscordTransport } from "@alepha/discord";
import { $inject } from "alepha";
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
import type { ProjectChannelResource } from "../schemas/projectChannelResourceSchema.ts";
import { AutomationChannelRemoval } from "./AutomationChannelRemoval.ts";
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
 * `automation:read` and `automation:manage` keep working until #Q3896
 * removes them. Deleting a channel deletes its subscriptions, and still
 * strips it from the automation engine's rules.
 */
export class ProjectChannelService {
  protected readonly log = $logger();
  protected readonly recipients = $inject(ProjectRecipients);
  protected readonly rows = $repository(notificationChannels);
  protected readonly subscriptions = $repository(eventSubscriptions);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly transport = $inject(DiscordTransport);
  protected readonly removal = $inject(AutomationChannelRemoval);

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
    return [
      { id: "inbox", kind: "inbox", name: "In-app", builtIn: true },
      { id: "email", kind: "email", name: "Email", builtIn: true },
      ...rows.map((row) => this.resource(row)),
    ];
  }

  public async add(
    projectId: number,
    user: UserAccountToken,
    input: { name: string; url: string },
  ): Promise<ProjectChannelResource> {
    await this.assert(projectId, user, "manage");
    const name = this.name(input.name);
    await this.unique(projectId, name);
    const url = await this.prove(input.url, name);
    const row = await this.rows.create({
      id: `discord-${this.crypto.randomUUID()}`,
      projectId,
      kind: "discord",
      name,
      url: await this.seal.seal(url, CredentialSealService.DISCORD_PURPOSE),
      createdBy: user.id,
    });
    return this.resource(row);
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
    return this.resource(updated);
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
    await this.removal.remove(projectId, row.id);
  }

  /**
   * `subscription:<level>`, or until #Q3896 the `automation:` permission of
   * the same level.
   */
  protected async assert(
    projectId: number,
    user: UserAccountToken,
    level: "read" | "manage",
  ): Promise<void> {
    const held = await this.recipients.of(projectId, user);
    if (
      !held.includes(`subscription:${level}`) &&
      !held.includes(`automation:${level}`)
    )
      throw new ForbiddenError(`Missing subscription:${level}`);
  }

  /**
   * The webhook URL of a channel, unsealed, for the adapter posting to it
   * (#Q3615), after checking the channel belongs to that project.
   */
  public async webhook(projectId: number, id: string): Promise<string> {
    const row = await this.row(projectId, id);
    return this.seal.open(row.url, CredentialSealService.DISCORD_PURPOSE);
  }

  protected resource(row: ProjectChannel): ProjectChannelResource {
    return { id: row.id, kind: row.kind, name: row.name, builtIn: false };
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
