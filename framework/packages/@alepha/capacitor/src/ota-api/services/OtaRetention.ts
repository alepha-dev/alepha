import { $inject, $store } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { otaApiOptions } from "../atoms/otaApiOptions.ts";
import { type OtaBundleEntity, otaBundles } from "../entities/otaBundles.ts";
import { otaChannels } from "../entities/otaChannels.ts";
import { otaDeviceOverrides } from "../entities/otaDeviceOverrides.ts";
import { OtaPublishService } from "./OtaPublishService.ts";
import { OtaUpdateService } from "./OtaUpdateService.ts";

/**
 * Keeps storage bounded without ever deleting what a device may still need.
 *
 * Per channel and compatibility cohort it keeps the newest `retention`
 * bundles (10 by default), and always: every cohort's `active` and
 * `fallback`, every bundle a device override pins, and every bundle whose
 * download link may still be live. A candidate is checked again against a
 * fresh read of those references just before its artifact goes, and its row
 * stays, as `deleted`, so its version is never reused. A storage failure
 * leaves the bundle as it was for the next run.
 *
 * Also cleans what an interrupted upload left: rows stuck in `uploading`
 * past `staleUploadMinutes`, and artifacts no row points to.
 *
 * The kill switch never deletes anything: retention treats a killed bundle
 * like any other old one.
 */
export class OtaRetention {
  protected readonly bundles = $repository(otaBundles);
  protected readonly channels = $repository(otaChannels);
  protected readonly overrides = $repository(otaDeviceOverrides);
  protected readonly publisher = $inject(OtaPublishService);
  protected readonly updates = $inject(OtaUpdateService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly options = $store(otaApiOptions);
  protected readonly log = $logger();

  public async run(): Promise<{
    deleted: number;
    abandoned: number;
    orphans: number;
  }> {
    const abandoned = await this.abandonStaleUploads();
    const deleted = await this.deleteExpired();
    const orphans = await this.deleteOrphans();
    if (deleted + abandoned + orphans > 0) {
      this.log.info("OTA retention", { deleted, abandoned, orphans });
    }
    return { deleted, abandoned, orphans };
  }

  /**
   * The bundles that must not lose their artifact, read fresh.
   */
  public async protectedIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const channel of await this.channels.findMany({})) {
      for (const cohort of Object.values(channel.cohorts)) {
        if (cohort.active) ids.add(cohort.active);
        if (cohort.fallback) ids.add(cohort.fallback);
      }
    }
    for (const override of await this.overrides.findMany({})) {
      if (override.bundleId) ids.add(override.bundleId);
    }
    const linkWindow = this.dateTime
      .now()
      .subtract(this.options.linkTtlSeconds, "second")
      .toISOString();
    for (const bundle of await this.bundles.findMany({
      where: { status: { eq: "ready" }, lastLinkAt: { gte: linkWindow } },
    })) {
      ids.add(bundle.id);
    }
    return ids;
  }

  protected async deleteExpired(): Promise<number> {
    const ready = await this.bundles.findMany({
      where: { status: { eq: "ready" } },
      orderBy: { column: "createdAt", direction: "desc" },
    });
    const groups = new Map<string, OtaBundleEntity[]>();
    for (const bundle of ready) {
      const key = `${bundle.appRef}\n${bundle.channel}\n${this.updates.cohortKey(bundle.platform, bundle.fingerprint)}`;
      groups.set(key, [...(groups.get(key) ?? []), bundle]);
    }
    const candidates = [...groups.values()].flatMap((group) =>
      group.slice(this.options.retention),
    );
    if (candidates.length === 0) {
      return 0;
    }

    let deleted = 0;
    let keep = await this.protectedIds();
    for (const bundle of candidates) {
      if (keep.has(bundle.id)) {
        continue;
      }
      // Recheck against a fresh read: an operator may have promoted it, or
      // pinned a device to it, since the run began.
      keep = await this.protectedIds();
      if (keep.has(bundle.id)) {
        continue;
      }
      if (await this.deleteArtifact(bundle)) {
        await this.bundles.updateById(bundle.id, {
          status: "deleted",
        });
        deleted++;
      }
    }
    return deleted;
  }

  protected async abandonStaleUploads(): Promise<number> {
    const stale = await this.bundles.findMany({
      where: {
        status: { eq: "uploading" },
        createdAt: {
          lt: this.dateTime
            .now()
            .subtract(this.options.staleUploadMinutes, "minute")
            .toISOString(),
        },
      },
    });
    for (const bundle of stale) {
      await this.deleteArtifact(bundle);
      await this.bundles.updateById(bundle.id, {
        status: "failed",
      });
    }
    return stale.length;
  }

  /**
   * Artifacts in the OTA storage that no bundle row points to: an upload
   * whose row update failed, or an app deleted with its bundles.
   */
  protected async deleteOrphans(): Promise<number> {
    const referenced = new Set(
      (await this.bundles.findMany({ where: { fileId: { isNotNull: true } } }))
        .map((it) => it.fileId)
        .filter((it): it is string => !!it),
    );
    const before = this.dateTime
      .now()
      .subtract(this.options.staleUploadMinutes, "minute")
      .toISOString();
    let removed = 0;
    for (let page = 0; ; page++) {
      const files = await this.publisher.storage.list({
        page,
        size: 100,
        createdBefore: before,
      });
      const orphans = files.content.filter((it) => !referenced.has(it.id));
      if (orphans.length > 0) {
        removed += (
          await this.publisher.storage.deleteMany(orphans.map((it) => it.id))
        ).length;
      }
      if (files.content.length < 100) {
        break;
      }
    }
    return removed;
  }

  protected async deleteArtifact(bundle: OtaBundleEntity): Promise<boolean> {
    if (!bundle.fileId) {
      return true;
    }
    try {
      await this.publisher.storage.delete(bundle.fileId);
      return true;
    } catch (error) {
      this.log.warn("Could not delete an OTA artifact; retrying next run", {
        bundle: bundle.id,
        error,
      });
      return false;
    }
  }
}
