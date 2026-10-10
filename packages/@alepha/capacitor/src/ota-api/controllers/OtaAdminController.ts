import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import type { OtaAppEntity } from "../entities/otaApps.ts";
import type { OtaBundleEntity } from "../entities/otaBundles.ts";
import type { OtaChannelEntity } from "../entities/otaChannels.ts";
import type { OtaDeviceOverrideEntity } from "../entities/otaDeviceOverrides.ts";
import type { OtaDeviceEntity } from "../entities/otaDevices.ts";
import { otaAppCreateSchema } from "../schemas/otaAppCreateSchema.ts";
import { otaAppResourceSchema } from "../schemas/otaAppResourceSchema.ts";
import { otaAppUpdateSchema } from "../schemas/otaAppUpdateSchema.ts";
import { otaBundleResourceSchema } from "../schemas/otaBundleResourceSchema.ts";
import { otaChannelCreateSchema } from "../schemas/otaChannelCreateSchema.ts";
import { otaChannelResourceSchema } from "../schemas/otaChannelResourceSchema.ts";
import { otaChannelUpdateSchema } from "../schemas/otaChannelUpdateSchema.ts";
import { otaDeviceResourceSchema } from "../schemas/otaDeviceResourceSchema.ts";
import { otaFallbackSchema } from "../schemas/otaFallbackSchema.ts";
import { otaKillSchema } from "../schemas/otaKillSchema.ts";
import { otaOverrideCreateSchema } from "../schemas/otaOverrideCreateSchema.ts";
import { otaOverrideResourceSchema } from "../schemas/otaOverrideResourceSchema.ts";
import { otaPromoteSchema } from "../schemas/otaPromoteSchema.ts";
import { otaPublishResultSchema } from "../schemas/otaPublishResultSchema.ts";
import { otaRollbackSchema } from "../schemas/otaRollbackSchema.ts";
import { otaRolloutSchema } from "../schemas/otaRolloutSchema.ts";
import { OtaAdminService } from "../services/OtaAdminService.ts";
import { OtaPublishService } from "../services/OtaPublishService.ts";

/**
 * The typed actions behind the OTA admin (`@alepha/capacitor/ota-admin`),
 * under `/api/ota`. Each is enforced on the server with its permission:
 * `ota:read` to look, `ota:manage` to change, `ota:release` to upload. The
 * admin hiding a button is a courtesy, never the guard.
 */
export class OtaAdminController {
  protected readonly url = "/ota";
  protected readonly group = "admin:ota";
  protected readonly admin = $inject(OtaAdminService);
  protected readonly publisher = $inject(OtaPublishService);

  // ---------------------------------------------------------------------------
  // Apps
  // ---------------------------------------------------------------------------

  public readonly otaListApps = $action({
    path: `${this.url}/apps`,
    group: this.group,
    description: "List live update apps",
    use: [$secure({ permissions: ["ota:read"] })],
    schema: { response: z.array(otaAppResourceSchema) },
    handler: async () =>
      (await this.admin.listApps()).map((it) => this.app(it)),
  });

  public readonly otaGetApp = $action({
    path: `${this.url}/apps/:id`,
    group: this.group,
    description: "Get a live update app",
    use: [$secure({ permissions: ["ota:read"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: otaAppResourceSchema,
    },
    handler: async ({ params }) => this.app(await this.admin.getApp(params.id)),
  });

  public readonly otaCreateApp = $action({
    method: "POST",
    path: `${this.url}/apps`,
    group: this.group,
    description: "Register a live update app and its publisher public key",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: { body: otaAppCreateSchema, response: otaAppResourceSchema },
    handler: async ({ body }) => this.app(await this.admin.createApp(body)),
  });

  public readonly otaUpdateApp = $action({
    method: "PATCH",
    path: `${this.url}/apps/:id`,
    group: this.group,
    description: "Change a live update app",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: otaAppUpdateSchema,
      response: otaAppResourceSchema,
    },
    handler: async ({ params, body }) =>
      this.app(await this.admin.updateApp(params.id, body)),
  });

  public readonly otaDeleteApp = $action({
    method: "DELETE",
    path: `${this.url}/apps/:id`,
    group: this.group,
    description: "Delete a live update app and its records",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: { params: z.object({ id: z.uuid() }), response: okSchema },
    handler: async ({ params }) => {
      await this.admin.deleteApp(params.id);
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  public readonly otaListChannels = $action({
    path: `${this.url}/apps/:id/channels`,
    group: this.group,
    description: "List an app's channels and what each serves",
    use: [$secure({ permissions: ["ota:read"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.array(otaChannelResourceSchema),
    },
    handler: async ({ params }) => {
      const app = await this.admin.getApp(params.id);
      return (await this.admin.listChannels(app.id)).map((it) =>
        this.channel(it, app),
      );
    },
  });

  public readonly otaCreateChannel = $action({
    method: "POST",
    path: `${this.url}/channels`,
    group: this.group,
    description: "Create a channel",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      body: otaChannelCreateSchema,
      response: otaChannelResourceSchema,
    },
    handler: async ({ body }) =>
      this.channelOf(await this.admin.createChannel(body)),
  });

  public readonly otaUpdateChannel = $action({
    method: "PATCH",
    path: `${this.url}/channels/:id`,
    group: this.group,
    description: "Open a channel to self-assignment, or close it",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: otaChannelUpdateSchema,
      response: otaChannelResourceSchema,
    },
    handler: async ({ params, body }) =>
      this.channelOf(await this.admin.updateChannel(params.id, body)),
  });

  public readonly otaDeleteChannel = $action({
    method: "DELETE",
    path: `${this.url}/channels/:id`,
    group: this.group,
    description: "Delete a channel",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: { params: z.object({ id: z.uuid() }), response: okSchema },
    handler: async ({ params }) => {
      await this.admin.deleteChannel(params.id);
      return { ok: true };
    },
  });

  public readonly otaPromote = $action({
    method: "POST",
    path: `${this.url}/channels/:id/promote`,
    group: this.group,
    description: "Serve a bundle from a channel, to a share of its devices",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: otaPromoteSchema,
      response: otaChannelResourceSchema,
    },
    handler: async ({ params, body }) =>
      this.channelOf(
        await this.admin.promote(params.id, body.bundleId, body.rollout),
      ),
  });

  public readonly otaRollback = $action({
    method: "POST",
    path: `${this.url}/channels/:id/rollback`,
    group: this.group,
    description:
      "Serve an earlier bundle to a whole cohort, whatever its version",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: otaRollbackSchema,
      response: otaChannelResourceSchema,
    },
    handler: async ({ params, body }) =>
      this.channelOf(await this.admin.rollback(params.id, body.bundleId)),
  });

  public readonly otaSetRollout = $action({
    method: "POST",
    path: `${this.url}/channels/:id/rollout`,
    group: this.group,
    description: "Change the share of a cohort that gets its active bundle",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: otaRolloutSchema,
      response: otaChannelResourceSchema,
    },
    handler: async ({ params, body }) =>
      this.channelOf(
        await this.admin.setRollout(params.id, body.cohort, body.rollout),
      ),
  });

  public readonly otaSetFallback = $action({
    method: "POST",
    path: `${this.url}/channels/:id/fallback`,
    group: this.group,
    description: "Choose the bundle a cohort falls back to",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: otaFallbackSchema,
      response: otaChannelResourceSchema,
    },
    handler: async ({ params, body }) =>
      this.channelOf(
        await this.admin.setFallback(params.id, body.cohort, body.bundleId),
      ),
  });

  public readonly otaKillChannel = $action({
    method: "POST",
    path: `${this.url}/channels/:id/kill`,
    group: this.group,
    description:
      "Kill what a channel serves; devices fall back at their next check",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: otaKillSchema,
      response: z.array(otaBundleResourceSchema),
    },
    handler: async ({ params, body }) =>
      (await this.admin.killChannel(params.id, body.reason)).map((it) =>
        this.bundle(it),
      ),
  });

  // ---------------------------------------------------------------------------
  // Bundles
  // ---------------------------------------------------------------------------

  public readonly otaListBundles = $action({
    path: `${this.url}/apps/:id/bundles`,
    group: this.group,
    description: "List an app's bundles",
    use: [$secure({ permissions: ["ota:read"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.array(otaBundleResourceSchema),
    },
    handler: async ({ params }) =>
      (await this.admin.listBundles(params.id)).map((it) => this.bundle(it)),
  });

  public readonly otaKillBundle = $action({
    method: "POST",
    path: `${this.url}/bundles/:id/kill`,
    group: this.group,
    description: "Kill a bundle; devices drop it at their next check",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: otaKillSchema,
      response: otaBundleResourceSchema,
    },
    handler: async ({ params, body }) =>
      this.bundle(await this.admin.killBundle(params.id, body.reason)),
  });

  /**
   * Upload what `alepha capacitor release --dry-run` wrote: the encrypted
   * bundle and its manifest, already sealed by the publisher. The browser
   * never sees a raw ZIP or a private key.
   */
  public readonly otaUploadBundle = $action({
    method: "POST",
    path: `${this.url}/bundles`,
    group: this.group,
    description: "Publish a pre-encrypted bundle and its manifest",
    use: [$secure({ permissions: ["ota:release"] })],
    schema: {
      body: z.object({
        manifest: z.file({ maxBytes: 20_000 }),
        bundle: z.file({ maxBytes: 100_000_000 }),
      }),
      response: otaPublishResultSchema,
    },
    handler: async ({ body }) => {
      const manifest = this.publisher.parseManifest(await body.manifest.text());
      const { bundle, created } = await this.publisher.publish(
        manifest,
        new Uint8Array(await body.bundle.arrayBuffer()),
      );
      return {
        id: bundle.id,
        version: bundle.version,
        platform: bundle.platform,
        channel: bundle.channel,
        created,
      };
    },
  });

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  public readonly otaListDevices = $action({
    path: `${this.url}/apps/:id/devices`,
    group: this.group,
    description: "Devices seen in the last seven days (telemetry)",
    use: [$secure({ permissions: ["ota:read"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.array(otaDeviceResourceSchema),
    },
    handler: async ({ params }) =>
      (await this.admin.listDevices(params.id)).map((it) => this.device(it)),
  });

  public readonly otaListOverrides = $action({
    path: `${this.url}/apps/:id/overrides`,
    group: this.group,
    description: "List device overrides",
    use: [$secure({ permissions: ["ota:read"] })],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.array(otaOverrideResourceSchema),
    },
    handler: async ({ params }) =>
      (await this.admin.listOverrides(params.id)).map((it) =>
        this.overrideOf(it),
      ),
  });

  public readonly otaSetOverride = $action({
    method: "POST",
    path: `${this.url}/overrides`,
    group: this.group,
    description: "Put a device on a channel or pin it to a bundle",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: {
      body: otaOverrideCreateSchema,
      response: otaOverrideResourceSchema,
    },
    handler: async ({ body }) =>
      this.overrideOf(await this.admin.setOverride(body)),
  });

  public readonly otaDeleteOverride = $action({
    method: "DELETE",
    path: `${this.url}/overrides/:id`,
    group: this.group,
    description: "Remove a device override",
    use: [$secure({ permissions: ["ota:manage"] })],
    schema: { params: z.object({ id: z.uuid() }), response: okSchema },
    handler: async ({ params }) => {
      await this.admin.deleteOverride(params.id);
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------------------

  protected app(it: OtaAppEntity) {
    return {
      id: it.id,
      appId: it.appId,
      name: it.name,
      publicKey: it.publicKey,
      keyId: it.keyId,
      defaultChannel: it.defaultChannel,
      publisherKeyIds: it.publisherKeyIds,
      createdAt: it.createdAt,
    };
  }

  protected async channelOf(it: OtaChannelEntity) {
    return this.channel(it, await this.admin.getApp(it.appRef));
  }

  protected channel(it: OtaChannelEntity, app: OtaAppEntity) {
    return {
      id: it.id,
      appRef: it.appRef,
      name: it.name,
      allowSelfAssign: it.allowSelfAssign,
      isDefault: it.name === app.defaultChannel,
      cohorts: Object.entries(it.cohorts)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, cohort]) => {
          const at = key.indexOf(":");
          return {
            key,
            platform: key.slice(0, at),
            fingerprint: key.slice(at + 1),
            ...cohort,
          };
        }),
    };
  }

  protected bundle(it: OtaBundleEntity) {
    return {
      id: it.id,
      appRef: it.appRef,
      platform: it.platform,
      variant: it.variant,
      version: it.version,
      channel: it.channel,
      builds: it.builds,
      fingerprint: it.fingerprint,
      keyId: it.keyId,
      archiveSha256: it.archiveSha256,
      ciphertextSha256: it.ciphertextSha256,
      size: it.size,
      expandedSize: it.expandedSize,
      files: it.files,
      status: it.status,
      killedAt: it.killedAt,
      killedReason: it.killedReason,
      createdAt: it.createdAt,
    };
  }

  protected device(it: OtaDeviceEntity) {
    return {
      id: it.id,
      deviceId: it.deviceId,
      platform: it.platform,
      versionCode: it.versionCode,
      versionBuild: it.versionBuild,
      versionName: it.versionName,
      channel: it.channel,
      pluginVersion: it.pluginVersion,
      isEmulator: it.isEmulator,
      failedVersions: it.failedVersions,
      lastSeenAt: it.lastSeenAt,
    };
  }

  protected overrideOf(it: OtaDeviceOverrideEntity) {
    return {
      id: it.id,
      deviceId: it.deviceId,
      channel: it.channel,
      bundleId: it.bundleId,
      note: it.note,
      createdAt: it.createdAt,
    };
  }
}
