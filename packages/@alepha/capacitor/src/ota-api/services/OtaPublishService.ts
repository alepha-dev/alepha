import { $inject, $store, type FileLike } from "alepha";
import { $storage } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  BadRequestError,
  ConflictError,
  HttpError,
  NotFoundError,
} from "alepha/server";

import {
  type OtaReleaseManifest,
  otaReleaseManifestSchema,
} from "../../ota/protocol/otaReleaseManifestSchema.ts";
import { otaApiOptions } from "../atoms/otaApiOptions.ts";
import { type OtaAppEntity, otaApps } from "../entities/otaApps.ts";
import { type OtaBundleEntity, otaBundles } from "../entities/otaBundles.ts";
import { type OtaChannelEntity, otaChannels } from "../entities/otaChannels.ts";
import { OtaBundleError, OtaBundleInspector } from "./OtaBundleInspector.ts";
import { OtaUpdateService } from "./OtaUpdateService.ts";

/**
 * Publishing: an encrypted bundle and its release manifest in, a durable
 * bundle promoted to its channel out.
 *
 * Nothing in the manifest is taken on faith that the server can check
 * itself: the key it was sealed with, the ciphertext's size and digest, and,
 * opened with the app's public key, the plain archive's digest, file count,
 * expanded size and contents (see {@link OtaBundleInspector}). The server
 * never holds the publisher's private key.
 *
 * Idempotent on the release id: an upload retried after a timeout lands on
 * the same row and succeeds once; the same id with other content, or the
 * same version under another id, is a conflict. A bundle is promoted only
 * once its artifact is durable in storage and its row says `ready`.
 */
export class OtaPublishService {
  protected readonly apps = $repository(otaApps);
  protected readonly bundles = $repository(otaBundles);
  protected readonly channels = $repository(otaChannels);
  protected readonly inspector = $inject(OtaBundleInspector);
  protected readonly updates = $inject(OtaUpdateService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly options = $store(otaApiOptions);
  protected readonly log = $logger();

  /**
   * Where artifacts live. Server writes only: no client may upload here
   * through `POST /api/files`.
   */
  public readonly storage = $storage({
    name: "ota-bundles",
    description: "Encrypted live update bundles",
    maxSize: 1000,
  });

  /**
   * Read a release manifest sent as JSON text, or a 400 naming what is
   * wrong with it.
   */
  public parseManifest(raw: string): OtaReleaseManifest {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new BadRequestError("The release manifest is not JSON");
    }
    const parsed = otaReleaseManifestSchema.safeParse(json);
    if (!parsed.success) {
      throw new BadRequestError(
        `The release manifest is invalid: ${parsed.error.issues.map((it) => `${it.path.join(".")} ${it.message}`).join("; ")}`,
      );
    }
    return parsed.data;
  }

  /**
   * The app a manifest publishes to, or a 404.
   */
  public async appOf(manifest: OtaReleaseManifest): Promise<OtaAppEntity> {
    const app = await this.apps.findOne({
      where: { appId: { eq: manifest.appId } },
    });
    if (!app) {
      throw new NotFoundError(`No live update app ${manifest.appId}`);
    }
    return app;
  }

  /**
   * Verify, store and promote one release.
   */
  public async publish(
    manifest: OtaReleaseManifest,
    ciphertext: Uint8Array,
  ): Promise<{ bundle: OtaBundleEntity; created: boolean }> {
    const app = await this.appOf(manifest);

    if (manifest.keyId !== app.keyId) {
      throw new HttpError({
        status: 422,
        message: `The bundle was sealed for key ${manifest.keyId}, and ${app.appId} trusts ${app.keyId}`,
      });
    }
    if (ciphertext.length > this.options.maxBundleBytes) {
      throw new HttpError({
        status: 413,
        message: `The bundle is ${ciphertext.length} bytes, over the ${this.options.maxBundleBytes} allowed`,
      });
    }
    if (
      ciphertext.length !== manifest.ciphertext.size ||
      (await this.inspector.sha256(ciphertext)) !== manifest.ciphertext.sha256
    ) {
      throw new BadRequestError(
        "The uploaded bundle does not match the manifest's ciphertext size and digest",
      );
    }

    const existing = await this.bundles.findById(manifest.id);
    if (existing) {
      const same =
        existing.appRef === app.id &&
        existing.version === manifest.version &&
        existing.ciphertextSha256 === manifest.ciphertext.sha256;
      if (!same) {
        throw new ConflictError(
          `Release ${manifest.id} was already published with other content`,
        );
      }
      if (existing.status === "ready") {
        return { bundle: existing, created: false };
      }
      if (existing.status !== "uploading") {
        throw new ConflictError(
          `Release ${manifest.id} is ${existing.status} and cannot be published again`,
        );
      }
    }

    const taken = await this.bundles.findOne({
      where: {
        appRef: { eq: app.id },
        platform: { eq: manifest.platform },
        version: { eq: manifest.version },
      },
    });
    if (taken && taken.id !== manifest.id) {
      throw new ConflictError(
        `Version ${manifest.version} of ${app.appId} on ${manifest.platform} already exists`,
      );
    }

    await this.checkBuilds(app, manifest);
    const channel = await this.channel(app, manifest.channel);
    await this.verify(app, manifest, ciphertext);

    const row =
      existing ??
      (await this.bundles.create({
        id: manifest.id,
        appRef: app.id,
        platform: manifest.platform,
        variant: manifest.variant,
        version: manifest.version,
        channel: manifest.channel,
        builds: manifest.builds,
        fingerprint: manifest.fingerprint,
        keyId: manifest.keyId,
        archiveSha256: manifest.archive.sha256,
        expandedSize: manifest.archive.expandedSize,
        files: manifest.archive.files,
        checksum: manifest.checksum,
        sessionKey: manifest.sessionKey,
        ciphertextSha256: manifest.ciphertext.sha256,
        size: manifest.ciphertext.size,
        status: "uploading",
      }));

    const fileId = await this.store(app, manifest, ciphertext);
    const ready = await this.bundles.updateById(row.id, {
      status: "ready",
      fileId,
    });

    await this.promote(channel, ready, manifest.rollout);
    this.log.info("Live update published", {
      appId: app.appId,
      platform: ready.platform,
      version: ready.version,
      channel: channel.name,
      rollout: manifest.rollout,
    });
    return { bundle: ready, created: true };
  }

  /**
   * Make a bundle its channel cohort's `active`, at `rollout` percent. The
   * previous `active` becomes the `fallback`, the only bundle anyone vouched
   * for by having served it.
   */
  public async promote(
    channel: OtaChannelEntity,
    bundle: OtaBundleEntity,
    rollout: number,
  ): Promise<OtaChannelEntity> {
    const key = this.updates.cohortKey(bundle.platform, bundle.fingerprint);
    const previous = channel.cohorts[key];
    const fallback =
      previous?.active && previous.active !== bundle.id
        ? previous.active
        : previous?.fallback;
    return this.channels.updateById(channel.id, {
      cohorts: {
        ...channel.cohorts,
        [key]: {
          active: bundle.id,
          ...(fallback && fallback !== bundle.id ? { fallback } : {}),
          rollout,
        },
      },
    });
  }

  /**
   * One native build number is one binary: it cannot belong to two
   * fingerprints.
   */
  protected async checkBuilds(
    app: OtaAppEntity,
    manifest: OtaReleaseManifest,
  ): Promise<void> {
    const others = await this.bundles.findMany({
      where: {
        appRef: { eq: app.id },
        platform: { eq: manifest.platform },
        fingerprint: { ne: manifest.fingerprint },
      },
    });
    const clash = others.find((it) =>
      it.builds.some((build) => manifest.builds.includes(build)),
    );
    if (clash) {
      throw new ConflictError(
        `${manifest.platform} build ${clash.builds.find((build) => manifest.builds.includes(build))} of ${app.appId} was published with another native fingerprint (${clash.version})`,
      );
    }
  }

  protected async channel(
    app: OtaAppEntity,
    name: string,
  ): Promise<OtaChannelEntity> {
    const channel = await this.channels.findOne({
      where: { appRef: { eq: app.id }, name: { eq: name } },
    });
    if (!channel) {
      throw new NotFoundError(
        `${app.appId} has no channel ${name}: create it in the OTA admin first`,
      );
    }
    return channel;
  }

  /**
   * Open the bundle with the app's public key and hold it to its manifest.
   */
  protected async verify(
    app: OtaAppEntity,
    manifest: OtaReleaseManifest,
    ciphertext: Uint8Array,
  ): Promise<void> {
    try {
      const { archive, archiveSha256 } = await this.inspector.open({
        ciphertext,
        sessionKey: manifest.sessionKey,
        checksum: manifest.checksum,
        publicKey: app.publicKey,
      });
      if (
        archiveSha256 !== manifest.archive.sha256 ||
        archive.length !== manifest.archive.size
      ) {
        throw new OtaBundleError(
          "The archive does not match the manifest's digest and size",
        );
      }
      const inspected = await this.inspector.inspect(archive, {
        maxFiles: this.options.maxFiles,
        maxExpandedSize: this.options.maxExpandedBytes,
      });
      if (
        inspected.files !== manifest.archive.files ||
        inspected.expandedSize !== manifest.archive.expandedSize
      ) {
        throw new OtaBundleError(
          "The archive does not hold what the manifest says it holds",
        );
      }
    } catch (error) {
      if (error instanceof OtaBundleError) {
        throw new HttpError({ status: 422, message: error.message });
      }
      throw error;
    }
  }

  /**
   * Write the artifact to storage, and answer its file id. A failure here
   * leaves the row `uploading`: a retry of the same release finishes it,
   * and retention abandons it past `staleUploadMinutes`.
   */
  protected async store(
    app: OtaAppEntity,
    manifest: OtaReleaseManifest,
    ciphertext: Uint8Array,
  ): Promise<string> {
    const file = await this.storage.upload(
      this.file(
        `${app.appId}-${manifest.platform}-${manifest.version}.zip`,
        ciphertext,
      ),
    );
    return file.id;
  }

  protected file(name: string, bytes: Uint8Array): FileLike {
    const lastModified = this.dateTime.nowMillis();
    return {
      name,
      type: "application/zip",
      size: bytes.length,
      lastModified,
      stream: () => new Blob([bytes.slice().buffer as ArrayBuffer]).stream(),
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }
}
