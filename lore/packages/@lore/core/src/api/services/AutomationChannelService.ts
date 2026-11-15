import { DiscordNotificationChannel, DiscordTransport } from "@alepha/discord";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $logger } from "alepha/logger";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import type { AutomationChannel } from "../entities/automationChannels.ts";
import type { AutomationChannelResource } from "../schemas/automationChannelResourceSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationChannelRemoval } from "./AutomationChannelRemoval.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { CredentialSealService } from "./CredentialSealService.ts";

/**
 * A project's configured channels (#Q3614): Settings > Automations >
 * Channels. Discord channels for now, as many as a project wants, each a
 * name and a sealed webhook URL.
 *
 * The URL is the whole credential. It is validated against the framework's
 * pattern, proven by a test post before it is saved, sealed under its own
 * purpose, and never read back: no response, log line, outbox row, run
 * snapshot or receipt carries it.
 *
 * Each channel is an instance of `AutomationChannels` (id, kind, name), so a
 * rule names it by id; deleting one removes it from every rule that named
 * it, which keeps its other channels and is not paused (#Q3613).
 */
export class AutomationChannelService {
  protected readonly log = $logger();
  protected readonly access = $inject(AutomationAccess);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly transport = $inject(DiscordTransport);
  protected readonly removal = $inject(AutomationChannelRemoval);
  protected readonly channels = $inject(AutomationChannels);

  constructor() {
    // Delivery to a project's Discord channels (#Q3615): a room, rendered
    // for Discord, through `LoreDiscordNotificationChannel`.
    this.channels.register("discord", {
      addressable: false,
      target: "discord",
      configured: async () => true,
      templates: {
        automations: "lore:automation:discord",
        releases: "lore:automation:release-discord",
        reminders: "lore:automation:reminder-discord",
      },
    });
    this.channels.registerInstances(async (projectId) =>
      (
        await this.persistence.channels.findMany({
          where: { projectId },
          orderBy: [{ column: "name", direction: "asc" }],
          limit: 100,
        })
      ).map((row) => ({ id: row.id, kind: row.kind, name: row.name })),
    );
  }

  /**
   * Inbox and Email, then every configured channel: never a URL.
   */
  public async list(
    projectId: number,
    user: UserAccountToken,
  ): Promise<AutomationChannelResource[]> {
    await this.access.assert(projectId, user, "automation:read");
    const rows = await this.persistence.channels.findMany({
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
  ): Promise<AutomationChannelResource> {
    await this.access.assert(projectId, user, "automation:manage");
    const name = this.name(input.name);
    await this.unique(projectId, name);
    const url = await this.prove(input.url, name);
    const row = await this.persistence.channels.create({
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
  ): Promise<AutomationChannelResource> {
    await this.access.assert(projectId, user, "automation:manage");
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
    const updated = await this.persistence.channels.updateById(row.id, {
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
    await this.access.assert(projectId, user, "automation:manage");
    const row = await this.row(projectId, id);
    await this.persistence.channels.deleteById(row.id);
    await this.removal.remove(projectId, row.id);
  }

  /**
   * The webhook URL of a channel, unsealed, for the adapter posting to it
   * (#Q3615), after checking the channel belongs to that project.
   */
  public async webhook(projectId: number, id: string): Promise<string> {
    const row = await this.row(projectId, id);
    return this.seal.open(row.url, CredentialSealService.DISCORD_PURPOSE);
  }

  protected resource(row: AutomationChannel): AutomationChannelResource {
    return { id: row.id, kind: row.kind, name: row.name, builtIn: false };
  }

  protected async row(projectId: number, id: string) {
    const row = await this.persistence.channels.findOne({
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
    if (await this.persistence.channels.findOne({ where: { projectId, name } }))
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
        content: `Lore will post automation messages to this channel (${name}).`,
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
