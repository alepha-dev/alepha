import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { type OtaAppEntity, otaApps } from "../entities/otaApps.ts";
import { type OtaBundleEntity, otaBundles } from "../entities/otaBundles.ts";
import { type OtaChannelEntity, otaChannels } from "../entities/otaChannels.ts";
import {
  type OtaDeviceOverrideEntity,
  otaDeviceOverrides,
} from "../entities/otaDeviceOverrides.ts";
import { type OtaDeviceEntity, otaDevices } from "../entities/otaDevices.ts";
import { OtaBundleInspector } from "./OtaBundleInspector.ts";
import { OtaPublishService } from "./OtaPublishService.ts";
import { OtaUpdateService } from "./OtaUpdateService.ts";

/**
 * What an operator does: apps and their keys, channels and what each serves,
 * the kill switch, device overrides. Every method here is reached through an
 * `ota:manage` (or `ota:read`) action; none trusts its caller beyond that.
 */
export class OtaAdminService {
  protected readonly apps = $repository(otaApps);
  protected readonly bundles = $repository(otaBundles);
  protected readonly channels = $repository(otaChannels);
  protected readonly devices = $repository(otaDevices);
  protected readonly overrides = $repository(otaDeviceOverrides);
  protected readonly inspector = $inject(OtaBundleInspector);
  protected readonly publisher = $inject(OtaPublishService);
  protected readonly updates = $inject(OtaUpdateService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  // ---------------------------------------------------------------------------
  // Apps
  // ---------------------------------------------------------------------------

  public listApps(): Promise<OtaAppEntity[]> {
    return this.apps.findMany({
      orderBy: { column: "appId", direction: "asc" },
    });
  }

  public async getApp(id: string): Promise<OtaAppEntity> {
    const app = await this.apps.findById(id);
    if (!app) {
      throw new NotFoundError("No such live update app");
    }
    return app;
  }

  /**
   * Register an app with its publisher public key, and its default channel.
   */
  public async createApp(input: {
    appId: string;
    name: string;
    publicKey: string;
    defaultChannel?: string;
  }): Promise<OtaAppEntity> {
    const publicKey = this.publicKey(input.publicKey);
    if (await this.apps.findOne({ where: { appId: { eq: input.appId } } })) {
      throw new ConflictError(`${input.appId} is already registered`);
    }
    const defaultChannel = input.defaultChannel ?? "production";
    const app = await this.apps.create({
      appId: input.appId,
      name: input.name,
      publicKey,
      keyId: this.inspector.keyId(publicKey),
      defaultChannel,
    });
    await this.channels.create({ appRef: app.id, name: defaultChannel });
    return app;
  }

  public async updateApp(
    id: string,
    input: {
      name?: string;
      publicKey?: string;
      defaultChannel?: string;
      publisherKeyIds?: string[];
    },
  ): Promise<OtaAppEntity> {
    const app = await this.getApp(id);
    if (input.defaultChannel && input.defaultChannel !== app.defaultChannel) {
      await this.channelNamed(app, input.defaultChannel);
    }
    const publicKey = input.publicKey
      ? this.publicKey(input.publicKey)
      : undefined;
    return this.apps.updateById(app.id, {
      ...(input.name ? { name: input.name } : {}),
      ...(publicKey
        ? { publicKey, keyId: this.inspector.keyId(publicKey) }
        : {}),
      ...(input.defaultChannel ? { defaultChannel: input.defaultChannel } : {}),
      ...(input.publisherKeyIds
        ? { publisherKeyIds: input.publisherKeyIds }
        : {}),
    });
  }

  /**
   * Remove an app and everything recorded for it. The artifacts go with the
   * next retention run.
   */
  public async deleteApp(id: string): Promise<void> {
    const app = await this.getApp(id);
    await this.apps.deleteById(app.id);
    this.log.info("Live update app deleted", { appId: app.appId });
  }

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  public async listChannels(appRef: string): Promise<OtaChannelEntity[]> {
    await this.getApp(appRef);
    return this.channels.findMany({
      where: { appRef: { eq: appRef } },
      orderBy: { column: "name", direction: "asc" },
    });
  }

  public async createChannel(input: {
    appRef: string;
    name: string;
    allowSelfAssign?: boolean;
  }): Promise<OtaChannelEntity> {
    const app = await this.getApp(input.appRef);
    if (
      await this.channels.findOne({
        where: { appRef: { eq: app.id }, name: { eq: input.name } },
      })
    ) {
      throw new ConflictError(
        `${app.appId} already has a channel ${input.name}`,
      );
    }
    return this.channels.create({
      appRef: app.id,
      name: input.name,
      allowSelfAssign: input.allowSelfAssign ?? false,
    });
  }

  public async updateChannel(
    id: string,
    input: { allowSelfAssign: boolean },
  ): Promise<OtaChannelEntity> {
    const channel = await this.getChannel(id);
    return this.channels.updateById(channel.id, {
      allowSelfAssign: input.allowSelfAssign,
    });
  }

  public async deleteChannel(id: string): Promise<void> {
    const channel = await this.getChannel(id);
    const app = await this.getApp(channel.appRef);
    if (channel.name === app.defaultChannel) {
      throw new BadRequestError("The default channel cannot be deleted");
    }
    await this.channels.deleteById(channel.id);
  }

  /**
   * Serve a bundle from a channel, to `rollout` percent of its cohort. The
   * cohort's previous `active` becomes its `fallback`.
   */
  public async promote(
    channelId: string,
    bundleId: string,
    rollout: number,
  ): Promise<OtaChannelEntity> {
    const channel = await this.getChannel(channelId);
    const bundle = await this.servable(channel, bundleId);
    return this.publisher.promote(channel, bundle, rollout);
  }

  /**
   * Serve an earlier bundle to the whole cohort at once, whatever its
   * version: the answer to a bad release. The bad `active` is not kept as
   * the fallback.
   */
  public async rollback(
    channelId: string,
    bundleId: string,
  ): Promise<OtaChannelEntity> {
    const channel = await this.getChannel(channelId);
    const bundle = await this.servable(channel, bundleId);
    const key = this.updates.cohortKey(bundle.platform, bundle.fingerprint);
    const previous = channel.cohorts[key];
    const fallback =
      previous?.fallback && previous.fallback !== bundle.id
        ? previous.fallback
        : undefined;
    return this.channels.updateById(channel.id, {
      cohorts: {
        ...channel.cohorts,
        [key]: {
          active: bundle.id,
          ...(fallback ? { fallback } : {}),
          rollout: 100,
        },
      },
    });
  }

  public async setRollout(
    channelId: string,
    cohort: string,
    rollout: number,
  ): Promise<OtaChannelEntity> {
    const channel = await this.getChannel(channelId);
    const current = channel.cohorts[cohort];
    if (!current) {
      throw new NotFoundError(
        `Channel ${channel.name} has no cohort ${cohort}`,
      );
    }
    return this.channels.updateById(channel.id, {
      cohorts: { ...channel.cohorts, [cohort]: { ...current, rollout } },
    });
  }

  /**
   * Choose the bundle a cohort falls back to, or none.
   */
  public async setFallback(
    channelId: string,
    cohort: string,
    bundleId?: string,
  ): Promise<OtaChannelEntity> {
    const channel = await this.getChannel(channelId);
    const current = channel.cohorts[cohort];
    if (!current) {
      throw new NotFoundError(
        `Channel ${channel.name} has no cohort ${cohort}`,
      );
    }
    if (bundleId) {
      const bundle = await this.servable(channel, bundleId);
      if (
        this.updates.cohortKey(bundle.platform, bundle.fingerprint) !== cohort
      ) {
        throw new BadRequestError(
          `${bundle.version} does not run on the binaries of cohort ${cohort}`,
        );
      }
    }
    return this.channels.updateById(channel.id, {
      cohorts: {
        ...channel.cohorts,
        [cohort]: {
          ...(current.active ? { active: current.active } : {}),
          ...(bundleId ? { fallback: bundleId } : {}),
          rollout: current.rollout,
        },
      },
    });
  }

  /**
   * The channel's kill switch: kill what every cohort serves. Devices fall
   * back, or reset to their built-in layer, at their next check.
   */
  public async killChannel(
    channelId: string,
    reason?: string,
  ): Promise<OtaBundleEntity[]> {
    const channel = await this.getChannel(channelId);
    const ids = Object.values(channel.cohorts)
      .map((it) => it.active)
      .filter((it): it is string => !!it);
    const killed: OtaBundleEntity[] = [];
    for (const id of ids) {
      killed.push(
        await this.killBundle(id, reason ?? `Channel ${channel.name} killed`),
      );
    }
    return killed;
  }

  // ---------------------------------------------------------------------------
  // Bundles
  // ---------------------------------------------------------------------------

  public async listBundles(appRef: string): Promise<OtaBundleEntity[]> {
    await this.getApp(appRef);
    return this.bundles.findMany({
      where: { appRef: { eq: appRef } },
      orderBy: { column: "createdAt", direction: "desc" },
    });
  }

  /**
   * The bundle's kill switch: never served again, pins and rollouts
   * included, and cancelled where it waits to be applied, at each device's
   * next contact. Its artifact is kept. A device that is offline keeps
   * running it until it checks in.
   */
  public async killBundle(
    id: string,
    reason?: string,
  ): Promise<OtaBundleEntity> {
    const bundle = await this.bundles.findById(id);
    if (!bundle) {
      throw new NotFoundError("No such bundle");
    }
    if (bundle.killedAt) {
      return bundle;
    }
    const killed = await this.bundles.updateById(bundle.id, {
      killedAt: this.dateTime.nowISOString(),
      ...(reason ? { killedReason: reason } : {}),
    });
    this.log.warn("Live update killed", {
      bundle: bundle.id,
      version: bundle.version,
      reason,
    });
    return killed;
  }

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  /**
   * Devices seen in the last seven days. Telemetry they reported, not a
   * list of devices online now.
   */
  public async listDevices(appRef: string): Promise<OtaDeviceEntity[]> {
    await this.getApp(appRef);
    return this.devices.findMany({
      where: {
        appRef: { eq: appRef },
        lastSeenAt: {
          gte: this.dateTime.now().subtract(7, "day").toISOString(),
        },
      },
      orderBy: { column: "lastSeenAt", direction: "desc" },
      limit: 1000,
    });
  }

  public async listOverrides(
    appRef: string,
  ): Promise<OtaDeviceOverrideEntity[]> {
    await this.getApp(appRef);
    return this.overrides.findMany({
      where: { appRef: { eq: appRef } },
      orderBy: { column: "createdAt", direction: "desc" },
    });
  }

  /**
   * Put one device on a channel, or pin it to a bundle, whatever it asks
   * for itself. A killed bundle is never served, pinned or not.
   */
  public async setOverride(input: {
    appRef: string;
    deviceId: string;
    channel?: string;
    bundleId?: string;
    note?: string;
  }): Promise<OtaDeviceOverrideEntity> {
    const app = await this.getApp(input.appRef);
    if (!input.channel && !input.bundleId) {
      throw new BadRequestError(
        "An override names a channel, a bundle, or both",
      );
    }
    if (input.channel) {
      await this.channelNamed(app, input.channel);
    }
    if (input.bundleId) {
      const bundle = await this.bundles.findById(input.bundleId);
      if (!bundle || bundle.appRef !== app.id || bundle.status !== "ready") {
        throw new BadRequestError(
          "The pinned bundle is not a published bundle of this app",
        );
      }
      if (bundle.killedAt) {
        throw new BadRequestError(
          `${bundle.version} was killed and cannot be pinned`,
        );
      }
    }
    // Replaced whole rather than merged, so a device moved from a pinned
    // bundle to a channel loses its pin.
    const existing = await this.overrides.findOne({
      where: { appRef: { eq: app.id }, deviceId: { eq: input.deviceId } },
    });
    if (existing) {
      await this.overrides.deleteById(existing.id);
    }
    return this.overrides.create({
      appRef: app.id,
      deviceId: input.deviceId,
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.bundleId ? { bundleId: input.bundleId } : {}),
      ...(input.note ? { note: input.note } : {}),
    });
  }

  public async deleteOverride(id: string): Promise<void> {
    await this.overrides.deleteById(id);
  }

  // ---------------------------------------------------------------------------

  protected async getChannel(id: string): Promise<OtaChannelEntity> {
    const channel = await this.channels.findById(id);
    if (!channel) {
      throw new NotFoundError("No such channel");
    }
    return channel;
  }

  protected async channelNamed(
    app: OtaAppEntity,
    name: string,
  ): Promise<OtaChannelEntity> {
    const channel = await this.channels.findOne({
      where: { appRef: { eq: app.id }, name: { eq: name } },
    });
    if (!channel) {
      throw new NotFoundError(`${app.appId} has no channel ${name}`);
    }
    return channel;
  }

  /**
   * A bundle a channel may serve: this app's, published, not killed.
   */
  protected async servable(
    channel: OtaChannelEntity,
    bundleId: string,
  ): Promise<OtaBundleEntity> {
    const bundle = await this.bundles.findById(bundleId);
    if (!bundle || bundle.appRef !== channel.appRef) {
      throw new NotFoundError("No such bundle in this app");
    }
    if (bundle.status !== "ready") {
      throw new BadRequestError(`${bundle.version} is ${bundle.status}`);
    }
    if (bundle.killedAt) {
      throw new BadRequestError(`${bundle.version} was killed`);
    }
    return bundle;
  }

  protected publicKey(pem: string): string {
    const trimmed = pem.trim();
    if (!this.inspector.isPublicKey(trimmed)) {
      throw new BadRequestError(
        "The public key must be an RSA public key in PKCS#1 PEM (-----BEGIN RSA PUBLIC KEY-----), the publisher's public half",
      );
    }
    return `${trimmed}\n`;
  }
}
