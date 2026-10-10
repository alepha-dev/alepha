import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import type { OtaChannelGetResponse } from "../../ota/protocol/otaChannelGetResponseSchema.ts";
import type { OtaChannelListResponse } from "../../ota/protocol/otaChannelListResponseSchema.ts";
import type { OtaChannelSetResponse } from "../../ota/protocol/otaChannelSetResponseSchema.ts";
import type { OtaDevice } from "../../ota/protocol/otaDeviceSchema.ts";
import type { OtaStatsEvent } from "../../ota/protocol/otaStatsEventSchema.ts";
import type { OtaUpdateResponse } from "../../ota/protocol/otaUpdateResponseSchema.ts";
import { type OtaAppEntity, otaApps } from "../entities/otaApps.ts";
import { type OtaBundleEntity, otaBundles } from "../entities/otaBundles.ts";
import { otaChannels } from "../entities/otaChannels.ts";
import { otaDeviceOverrides } from "../entities/otaDeviceOverrides.ts";
import { type OtaDeviceEntity, otaDevices } from "../entities/otaDevices.ts";
import { OtaDownloadLinks } from "./OtaDownloadLinks.ts";

/**
 * The device side of the protocol: which bundle a device should run, its
 * telemetry, and its channel.
 *
 * An update check decides, in this order:
 *
 * 1. the app, platform and exact native build must be known: some bundle of
 *    the app lists the device's `version_code`. Anything else gets
 *    `blocked`, never a bundle;
 * 2. killed bundles, bundles this device rolled back from, and bundles that
 *    do not list its build are out;
 * 3. an operator's device override wins: its pinned bundle, else its
 *    channel. Otherwise the device's own channel choice when that channel is
 *    self-assignable, else the app's default channel;
 * 4. the channel's cohort for the device's platform and fingerprint: its
 *    `active` bundle to devices inside the rollout (a stable hash of app,
 *    channel and device into 0-99; 0 and 100 are exact), its `fallback` to
 *    the others and when `active` is out;
 * 5. no target and the device runs a killed or failed bundle: back to the
 *    built-in layer. No target otherwise: nothing to do.
 *
 * The answer names what the device should run, not what changed: the device
 * cancels a downloaded bundle it no longer gets told to run.
 */
export class OtaUpdateService {
  protected static readonly MAX_FAILED_VERSIONS = 20;

  protected readonly apps = $repository(otaApps);
  protected readonly bundles = $repository(otaBundles);
  protected readonly channels = $repository(otaChannels);
  protected readonly devices = $repository(otaDevices);
  protected readonly overrides = $repository(otaDeviceOverrides);
  protected readonly links = $inject(OtaDownloadLinks);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  public async check(
    device: OtaDevice,
    origin: string,
  ): Promise<{ status: number; body: OtaUpdateResponse }> {
    const app = await this.app(device.app_id);
    if (!app) {
      return this.blocked(
        "unknown_app",
        `No live updates are published for ${device.app_id}`,
      );
    }

    const bundles = await this.bundles.findMany({
      where: {
        appRef: { eq: app.id },
        platform: { eq: device.platform },
        status: { eq: "ready" },
      },
    });
    const known = bundles.filter((it) =>
      it.builds.includes(device.version_code),
    );
    if (known.length === 0) {
      return this.blocked(
        "unknown_native_build",
        `No release targets ${device.platform} build ${device.version_code} of ${app.appId}`,
      );
    }

    const record = await this.devices.findOne({
      where: { appRef: { eq: app.id }, deviceId: { eq: device.device_id } },
    });
    const failed = new Set(record?.failedVersions ?? []);
    const usable = (bundle?: OtaBundleEntity): bundle is OtaBundleEntity =>
      !!bundle &&
      !bundle.killedAt &&
      bundle.builds.includes(device.version_code) &&
      !failed.has(bundle.version);
    const byId = new Map(known.map((it) => [it.id, it]));

    const override = await this.overrides.findOne({
      where: { appRef: { eq: app.id }, deviceId: { eq: device.device_id } },
    });
    let target: OtaBundleEntity | undefined;
    if (override?.bundleId) {
      const pinned = byId.get(override.bundleId);
      if (usable(pinned)) {
        target = pinned;
      }
    }

    const channel =
      override?.channel ??
      (await this.selfAssigned(app, device.defaultChannel)) ??
      app.defaultChannel;

    if (!target) {
      const row = await this.channels.findOne({
        where: { appRef: { eq: app.id }, name: { eq: channel } },
      });
      const cohort =
        row?.cohorts[this.cohortKey(device.platform, known[0].fingerprint)];
      if (cohort) {
        const active = cohort.active ? byId.get(cohort.active) : undefined;
        const fallback = cohort.fallback
          ? byId.get(cohort.fallback)
          : undefined;
        if (
          usable(active) &&
          (await this.inRollout(
            app.appId,
            channel,
            device.device_id,
            cohort.rollout,
          ))
        ) {
          target = active;
        } else if (usable(fallback)) {
          target = fallback;
        }
      }
    }

    await this.see(app, device, channel);

    if (target) {
      if (target.version === device.version_name) {
        return this.none();
      }
      const { url } = this.links.create(target, origin);
      await this.markLinked(target);
      return {
        status: 200,
        body: {
          version: target.version,
          url,
          session_key: target.sessionKey,
          checksum: target.checksum,
        },
      };
    }

    const current = bundles.find((it) => it.version === device.version_name);
    if (current && (current.killedAt || failed.has(current.version))) {
      return {
        status: 200,
        body: { version: "builtin" },
      };
    }
    return this.none();
  }

  /**
   * Record a stats batch: when each device was last seen on which version,
   * and which bundle versions it rolled back from. Nothing else is kept.
   */
  public async stats(events: OtaStatsEvent[]): Promise<void> {
    const latest = new Map<string, OtaStatsEvent>();
    const rolledBack = new Map<string, string[]>();
    for (const event of events) {
      const key = `${event.app_id}\n${event.device_id}`;
      latest.set(key, event);
      if (event.action === "update_fail" && event.version_name) {
        rolledBack.set(key, [
          ...(rolledBack.get(key) ?? []),
          event.version_name,
        ]);
      }
    }

    const apps = new Map<string, OtaAppEntity | undefined>();
    for (const [key, event] of latest) {
      if (!apps.has(event.app_id)) {
        apps.set(event.app_id, await this.app(event.app_id));
      }
      const app = apps.get(event.app_id);
      if (!app) {
        continue;
      }
      const record = await this.see(app, event);
      const failures = rolledBack.get(key);
      if (failures?.length) {
        const merged = [
          ...record.failedVersions.filter((it) => !failures.includes(it)),
          ...failures,
        ].slice(-OtaUpdateService.MAX_FAILED_VERSIONS);
        await this.devices.updateById(record.id, { failedVersions: merged });
        this.log.info("A device rolled back a live update", {
          appId: app.appId,
          versions: failures,
        });
      }
    }
  }

  /**
   * `setChannel()`: allowed onto a self-assignable channel; asking for the
   * default channel clears the device's choice.
   */
  public async setChannel(
    device: OtaDevice,
  ): Promise<{ status: number; body: OtaChannelSetResponse }> {
    const app = await this.app(device.app_id);
    const name = device.channel ?? "";
    if (app && name === app.defaultChannel) {
      return {
        status: 200,
        body: {
          status: "ok",
          unset: true,
          message: "Following the default channel",
        },
      };
    }
    if (app && (await this.selfAssigned(app, name))) {
      return {
        status: 200,
        body: { status: "ok", message: `Channel set to ${name}` },
      };
    }
    return {
      status: 403,
      body: {
        status: "error",
        error: "channel_self_set_not_allowed",
        message: "This channel does not accept devices assigning themselves",
      },
    };
  }

  /**
   * `getChannel()`: the channel this device is served from.
   */
  public async getChannel(device: OtaDevice): Promise<OtaChannelGetResponse> {
    const app = await this.app(device.app_id);
    if (!app) {
      return { channel: "", status: "unknown", allowSet: false };
    }
    const override = await this.overrides.findOne({
      where: { appRef: { eq: app.id }, deviceId: { eq: device.device_id } },
    });
    if (override?.channel) {
      return { channel: override.channel, status: "override", allowSet: false };
    }
    const chosen = await this.selfAssigned(app, device.defaultChannel);
    return chosen
      ? { channel: chosen, status: "self", allowSet: true }
      : { channel: app.defaultChannel, status: "default", allowSet: true };
  }

  /**
   * `listChannels()`: the default channel and every self-assignable one.
   * The plugin reads `id` as an integer, so it is a position.
   */
  public async listChannels(appId: string): Promise<OtaChannelListResponse> {
    const app = await this.app(appId);
    if (!app) {
      return [];
    }
    const rows = await this.channels.findMany({
      where: { appRef: { eq: app.id } },
    });
    return rows
      .filter((it) => it.allowSelfAssign || it.name === app.defaultChannel)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((it, index) => ({
        id: index + 1,
        name: it.name,
        public: it.name === app.defaultChannel,
        allow_self_set: it.allowSelfAssign,
      }));
  }

  /**
   * The key a channel keeps a cohort's state under.
   */
  public cohortKey(platform: string, fingerprint: string): string {
    return `${platform}:${fingerprint}`;
  }

  /**
   * Whether a device falls inside a rollout percentage: a stable hash of
   * app, channel and device into 0-99, so the same devices stay in as a
   * rollout grows. 0 is nobody and 100 everybody, exactly.
   */
  public async inRollout(
    appId: string,
    channel: string,
    deviceId: string,
    rollout: number,
  ): Promise<boolean> {
    if (rollout <= 0) {
      return false;
    }
    if (rollout >= 100) {
      return true;
    }
    return (await this.bucket(appId, channel, deviceId)) < rollout;
  }

  /**
   * The device's bucket, 0 to 99.
   */
  public async bucket(
    appId: string,
    channel: string,
    deviceId: string,
  ): Promise<number> {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${appId}\n${channel}\n${deviceId}`),
      ),
    );
    const value =
      ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>>
      0;
    return value % 100;
  }

  protected app(appId: string): Promise<OtaAppEntity | undefined> {
    return this.apps.findOne({ where: { appId: { eq: appId } } });
  }

  /**
   * The channel a device asked for, when it may have it.
   */
  protected async selfAssigned(
    app: OtaAppEntity,
    name?: string,
  ): Promise<string | undefined> {
    if (!name || name === app.defaultChannel) {
      return undefined;
    }
    const channel = await this.channels.findOne({
      where: { appRef: { eq: app.id }, name: { eq: name } },
    });
    return channel?.allowSelfAssign ? channel.name : undefined;
  }

  /**
   * Upsert what the device said about itself.
   */
  protected async see(
    app: OtaAppEntity,
    device: OtaDevice,
    channel?: string,
  ): Promise<OtaDeviceEntity> {
    const seen = {
      platform: device.platform,
      versionCode: device.version_code,
      versionBuild: device.version_build,
      versionName: device.version_name,
      pluginVersion: device.plugin_version,
      isEmulator: device.is_emulator,
      lastSeenAt: this.dateTime.nowISOString(),
      ...(channel ? { channel } : {}),
    };
    return this.devices.upsert(
      { appRef: app.id, deviceId: device.device_id, ...seen },
      { target: ["appRef", "deviceId"], set: seen },
    );
  }

  /**
   * Note that a link for this bundle went out, at most once a minute, so
   * retention spares it while the link may be in use.
   */
  protected async markLinked(bundle: OtaBundleEntity): Promise<void> {
    const now = this.dateTime.nowMillis();
    if (
      bundle.lastLinkAt &&
      now - this.dateTime.of(bundle.lastLinkAt).valueOf() < 60_000
    ) {
      return;
    }
    await this.bundles.updateById(bundle.id, {
      lastLinkAt: this.dateTime.nowISOString(),
    });
  }

  protected none(): { status: number; body: OtaUpdateResponse } {
    return {
      status: 200,
      body: {
        error: "no_new_version_available",
        message: "No new version available",
        kind: "up_to_date",
      },
    };
  }

  protected blocked(
    error: string,
    message: string,
  ): { status: number; body: OtaUpdateResponse } {
    return { status: 200, body: { error, message, kind: "blocked" } };
  }
}
