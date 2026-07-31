import { randomBytes } from "node:crypto";
import { $inject, z } from "alepha";
import { CryptoProvider, SecretProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import { pulseApps } from "../entities/pulseApps.ts";
import { AppKeyService } from "../services/AppKeyService.ts";

/**
 * Managing which apps Pulse observes.
 *
 * Admin-only, and a different realm from the ingest endpoints: these actions
 * mint and revoke the credentials those endpoints accept, so an ingest key must
 * never be able to reach them.
 */
export class PulseAppController {
  protected readonly apps = $repository(pulseApps);
  protected readonly keys = $inject(AppKeyService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly secrets = $inject(SecretProvider);

  list = $action({
    method: "GET",
    path: "/pulse/apps",
    use: [$secure({ roles: ["admin"] })],
    description: "Apps enrolled with this Pulse",
    schema: {
      response: z.array(
        z.object({
          id: z.uuid(),
          slug: z.text(),
          name: z.text(),
          kind: z.enum(["bay", "external"]),
          ingestKeyPrefix: z.text(),
          petitionUrl: z.text().optional(),
          revokedAt: z.text().optional(),
        }),
      ),
    },
    handler: async () => (await this.apps.findMany({})) as any,
  });

  /**
   * Enrols an app and hands back its key — once.
   *
   * The cleartext key is returned here and nowhere else, because only its hash
   * is stored. An operator who loses it rotates rather than recovers, which is
   * the same contract as `api_keys` and the only one a hashed secret can honour.
   */
  enroll = $action({
    method: "POST",
    path: "/pulse/apps",
    use: [$secure({ roles: ["admin"] })],
    description: "Enrol an app and issue its ingest key",
    schema: {
      body: z.object({
        slug: z.text({ minLength: 1, maxLength: 120 }),
        name: z.text({ minLength: 1, maxLength: 200 }),
        kind: z.enum(["bay", "external"]).optional(),
        petitionUrl: z.text({ maxLength: 2000 }).optional(),
      }),
      response: z.object({
        id: z.uuid(),
        slug: z.text(),
        /** Shown once. Never retrievable afterwards. */
        token: z.text(),
      }),
    },
    handler: async ({ body }) => {
      const taken = await this.apps.findOne({ where: { slug: body.slug } });
      if (taken) {
        // Named rather than swallowed: silently reusing the row would hand the
        // caller a second key for someone else's app.
        throw new HttpError({
          status: 409,
          message: `An app already uses the slug "${body.slug}"`,
        });
      }

      const key = this.keys.generate();
      const app = await this.apps.create({
        slug: body.slug,
        name: body.name,
        kind: body.kind ?? "external",
        ingestKeyHash: key.hash,
        ingestKeyPrefix: key.prefix,
        petitionUrl: body.petitionUrl,
      });

      return { id: app.id, slug: app.slug, token: key.token };
    },
  });

  /**
   * Sets how much this app should send.
   *
   * The reason the config is fetched at runtime rather than read from the app's
   * env: an app drowning its sink has to be turnable down from the sink's side,
   * now, without a redeploy of the app. Merged into whatever is already stored
   * so tuning one knob does not silently reset the others.
   */
  setAppetite = $action({
    method: "POST",
    path: "/pulse/apps/:id/appetite",
    use: [$secure({ roles: ["admin"] })],
    description: "Tune what this app collects and how often",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        metricsIntervalSec: z.integer().min(5).optional(),
        enabled: z.record(z.text(), z.boolean()).optional(),
        sampling: z.record(z.text(), z.number()).optional(),
      }),
      response: z.object({ appetite: z.record(z.text(), z.any()) }),
    },
    handler: async ({ params, body }) => {
      const app = await this.apps.findOne({ where: { id: params.id } });
      const appetite = {
        ...((app?.appetite ?? {}) as Record<string, unknown>),
        ...Object.fromEntries(
          Object.entries(body).filter(([, v]) => v !== undefined),
        ),
      };
      await this.apps.updateById(params.id, { appetite } as any);
      return { appetite } as any;
    },
  });

  /**
   * Points an app's error groups at a Lore campaign.
   *
   * The key is encrypted before it is stored: Pulse's database is backed up to
   * S3 by Bay, and a campaign-scoped credential sitting in cleartext inside a
   * backup is an avoidable leak — the backup travels further, and lives longer,
   * than the database.
   */
  configureLore = $action({
    method: "POST",
    path: "/pulse/apps/:id/lore",
    use: [$secure({ roles: ["admin"] })],
    description: "Forward this app's error groups to a Lore campaign",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        url: z.text({ minLength: 1, maxLength: 2000 }),
        campaignId: z.integer(),
        key: z.text({ minLength: 1, maxLength: 512 }),
      }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, body }) => {
      const salt = randomBytes(16).toString("hex");
      const derived = await this.crypto.deriveKeyFromPassphrase(
        this.secrets.secretKey,
        salt,
      );
      const keyCipher = await this.crypto.encryptWithPassphrase(
        body.key,
        derived,
        salt,
      );

      await this.apps.updateById(params.id, {
        lore: { url: body.url, campaignId: body.campaignId, keyCipher },
      } as any);
      return { ok: true };
    },
  });

  /**
   * Revokes an app's key without deleting anything it reported.
   *
   * The error groups and analytics collected under it stay meaningful after the
   * key dies; deleting the app would take its history with it, which is the
   * opposite of what an observer is for. A revoked app can be re-enrolled with
   * a fresh key and keeps its past.
   */
  revoke = $action({
    method: "POST",
    path: "/pulse/apps/:id/revoke",
    use: [$secure({ roles: ["admin"] })],
    description: "Revoke an app's ingest key, keeping its history",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ revokedAt: z.text() }),
    },
    handler: async ({ params }) => {
      const revokedAt = new Date(this.dateTime.nowMillis()).toISOString();
      await this.apps.updateById(params.id, { revokedAt } as any);
      return { revokedAt };
    },
  });

  /**
   * Issues a fresh key for an app that already exists.
   *
   * Separate from enrolment so that rotating a key is not the same gesture as
   * adding an app: the first is routine, the second is a decision.
   */
  rotate = $action({
    method: "POST",
    path: "/pulse/apps/:id/rotate",
    use: [$secure({ roles: ["admin"] })],
    description: "Issue a new ingest key, invalidating the old one",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ token: z.text() }),
    },
    handler: async ({ params }) => {
      const key = this.keys.generate();
      await this.apps.updateById(params.id, {
        ingestKeyHash: key.hash,
        ingestKeyPrefix: key.prefix,
        // Rotating un-revokes: handing out a working key while the app is still
        // marked dead would be a credential that authenticates nothing.
        revokedAt: null,
      } as any);
      return { token: key.token };
    },
  });
}
