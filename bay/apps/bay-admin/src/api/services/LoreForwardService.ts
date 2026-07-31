import { $inject } from "alepha";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { HttpClient } from "alepha/server";
import { errorGroups } from "../entities/errorGroups.ts";
import { loreOutbox } from "../entities/loreOutbox.ts";
import { type PulseApp, pulseApps } from "../entities/pulseApps.ts";

/** Never send more than this in one POST, however much has piled up. */
const MAX_PER_BATCH = 50;

/**
 * Hands deduplicated error groups to Lore.
 *
 * **Pulse deduplicates, Lore judges.** Raw errors never travel: what crosses is
 * one line per distinct failure with a count, which is what makes an inbox
 * something a human can triage rather than a firehose. Lore decides what
 * becomes a quest; Pulse only decides what is the same bug.
 *
 * **Through an outbox, always.** The batch is written down before the request
 * and deleted on acknowledgement, so a Lore that is down — or a key
 * mid-rotation — costs a retry rather than a silent loss of exactly the report
 * that was in flight when something broke.
 */
export class LoreForwardService {
  protected readonly log = $logger();
  protected readonly http = $inject(HttpClient);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly secrets = $inject(SecretProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly apps = $repository(pulseApps);
  protected readonly errors = $repository(errorGroups);
  protected readonly outbox = $repository(loreOutbox);

  /**
   * Queues everything that changed since the last forward, for every app that
   * has a Lore configured.
   */
  async collect(): Promise<number> {
    const apps = await this.apps.findMany({});
    let queued = 0;
    for (const app of apps) {
      if (!this.loreOf(app)) continue;
      queued += await this.collectApp(app);
    }
    return queued;
  }

  /**
   * Queues one app's changed groups.
   *
   * "Changed" means seen since it was last forwarded — a group nobody has hit
   * again costs nothing to keep and has nothing new to say.
   */
  async collectApp(app: PulseApp): Promise<number> {
    const groups = await this.errors.findMany({
      where: { appId: app.id },
      orderBy: { column: "lastSeenAt", direction: "desc" },
      limit: MAX_PER_BATCH,
    });

    const fresh = groups.filter(
      (g) => !g.forwardedAt || g.forwardedAt < g.lastSeenAt,
    );
    if (!fresh.length) {
      return 0;
    }

    await this.outbox.create({
      appId: app.id,
      payload: {
        fingerprints: fresh.map((g) => ({
          fingerprint: g.fingerprint,
          name: g.name,
          message: g.message,
          stackSample: g.stackSample,
          sourceUrl: g.sourceUrl,
          release: g.release,
          origin: g.origin,
          windowCount: g.count,
          firstSeenAt: g.firstSeenAt,
          lastSeenAt: g.lastSeenAt,
          // The link back. Cheapest possible integration: Lore shows a blight
          // and one click lands on the group it came from.
          pulseUrl: `/apps/${app.slug}/errors/${g.fingerprint}`,
        })),
      },
    });

    const forwardedAt = new Date(this.dateTime.nowMillis()).toISOString();
    for (const group of fresh) {
      await this.errors.updateById(group.id, { forwardedAt } as any);
    }

    return fresh.length;
  }

  /**
   * Drains the outbox.
   *
   * A row is deleted only once Lore has acknowledged it. A failure increments
   * the attempt count and leaves the row: a batch that has failed fifteen times
   * is a configuration problem, and it should be visible as one rather than as
   * an inbox that quietly stays empty.
   */
  async drain(): Promise<{ sent: number; failed: number }> {
    const rows = await this.outbox.findMany({ limit: MAX_PER_BATCH });
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const app = await this.apps.findOne({ where: { id: row.appId } });
      const lore = app ? this.loreOf(app) : undefined;
      if (!app || !lore) {
        // The app lost its Lore configuration after the batch was queued.
        // Dropping the row is right: there is nowhere to send it, and keeping
        // it would retry forever.
        await this.outbox.deleteById(row.id);
        continue;
      }

      try {
        await this.http.fetch(
          `${lore.url.replace(/\/$/, "")}/api/blights/ingest`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${await this.keyOf(lore)}`,
            },
            body: JSON.stringify({
              campaignId: lore.campaignId,
              ...(row.payload as Record<string, unknown>),
            }),
          },
        );
        await this.outbox.deleteById(row.id);
        sent++;
      } catch (error) {
        await this.outbox.updateById(row.id, {
          attempts: row.attempts + 1,
          lastError: String((error as Error)?.message ?? error).slice(0, 2000),
        } as any);
        failed++;
      }
    }

    return { sent, failed };
  }

  /**
   * An app's Lore settings, or `undefined` when it has none.
   */
  protected loreOf(
    app: PulseApp,
  ): { url: string; campaignId: number; keyCipher: string } | undefined {
    const lore = app.lore as
      | { url?: string; campaignId?: number; keyCipher?: string }
      | undefined;
    if (!lore?.url || !lore.campaignId || !lore.keyCipher) {
      return undefined;
    }
    return {
      url: lore.url,
      campaignId: lore.campaignId,
      keyCipher: lore.keyCipher,
    };
  }

  /**
   * Decrypts a stored Lore key.
   *
   * Encrypted at rest because Pulse's SQLite is backed up to S3 by Bay, and a
   * campaign-scoped key sitting in cleartext inside a backup is an avoidable
   * leak — the backup travels further, and lives longer, than the database.
   */
  protected async keyOf(lore: { keyCipher: string }): Promise<string> {
    return await this.crypto.decryptWithPassphrase(
      lore.keyCipher,
      this.secrets.secretKey,
    );
  }
}
