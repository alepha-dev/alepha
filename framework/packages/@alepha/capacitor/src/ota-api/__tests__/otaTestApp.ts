import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaApiKeys, ApiKeyService } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrm } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, type UserAccountToken } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";

import { OtaArchiveWriter } from "../../cli/services/OtaArchiveWriter.ts";
import { OtaEnvelope } from "../../cli/services/OtaEnvelope.ts";
import type { OtaDevice } from "../../ota/protocol/otaDeviceSchema.ts";
import type { OtaReleaseManifest } from "../../ota/protocol/otaReleaseManifestSchema.ts";
import { OtaAdminController } from "../controllers/OtaAdminController.ts";
import { AlephaCapacitorOtaApi } from "../index.ts";
import { OtaAdminService } from "../services/OtaAdminService.ts";
import { OtaPublishService } from "../services/OtaPublishService.ts";
import { OtaRetention } from "../services/OtaRetention.ts";
import { OtaUpdateService } from "../services/OtaUpdateService.ts";

/**
 * The host app of the `ota-api` specs: an issuer whose roles grant the OTA
 * permissions, API keys, and the module.
 */
class Host {
  public readonly issuer = $issuer({
    name: "users",
    secret: "ota-test-secret",
    roles: [
      { name: "publisher", permissions: [{ name: "ota:release" }] },
      { name: "viewer", permissions: [{ name: "ota:read" }] },
      { name: "operator", permissions: [{ name: "ota:*" }] },
    ],
  });
}

const envelope = new OtaEnvelope();
const writer = new OtaArchiveWriter();
// Test-only keys, made once per run.
const keys = envelope.generateKeyPair();
const otherKeys = envelope.generateKeyPair();

/**
 * Every OTA permission, and read only.
 */
export const operator: UserAccountToken = {
  id: "00000000-0000-0000-0000-0000000000a1",
  realm: "users",
  roles: ["operator"],
};
export const viewer: UserAccountToken = {
  id: "00000000-0000-0000-0000-0000000000a2",
  realm: "users",
  roles: ["viewer"],
};

export type OtaTestApp = Awaited<ReturnType<typeof createOtaTestApp>>;

/**
 * A started host on `sqlite` (in memory) or `postgres` (the test service).
 */
export const createOtaTestApp = async (
  dialect: "sqlite" | "postgres",
  substitute?: (alepha: Alepha) => void,
) => {
  const alepha = Alepha.create(
    dialect === "sqlite" ? { env: { DATABASE_URL: ":memory:" } } : {},
  );
  // Before the module: the first substitution recorded is the one kept.
  substitute?.(alepha);
  alepha
    .with(AlephaServer)
    .with(dialect === "postgres" ? AlephaOrmPostgres : AlephaOrm)
    .with(AlephaApiKeys)
    .with(AlephaCapacitorOtaApi)
    .with(Host);
  const host = alepha.inject(Host);
  const apiKeys = alepha.inject(ApiKeyService);
  await alepha.start();
  host.issuer.registerResolver(apiKeys.createResolver());
  const { hostname } = alepha.inject(ServerProvider);

  const ctx = {
    alepha,
    hostname,
    keys,
    otherKeys,
    admin: alepha.inject(OtaAdminController),
    adminService: alepha.inject(OtaAdminService),
    updates: alepha.inject(OtaUpdateService),
    publisher: alepha.inject(OtaPublishService),
    retention: alepha.inject(OtaRetention),
    dateTime: alepha.inject(DateTimeProvider),
    apiKeys,

    /**
     * A new app with its default channel, under a unique bundle id.
     */
    app: async (options: { publicKey?: string; allowKey?: string } = {}) => {
      const appId = `dev.alepha.ota${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const created = await ctx.admin.otaCreateApp(
        {
          body: {
            appId,
            name: "OTA test",
            publicKey: options.publicKey ?? keys.publicKey,
          },
        },
        { user: operator },
      );
      if (options.allowKey) {
        await ctx.admin.otaUpdateApp(
          {
            params: { id: created.id },
            body: { publisherKeyIds: [options.allowKey] },
          },
          { user: operator },
        );
      }
      return created;
    },

    /**
     * A sealed release and its manifest, as `alepha capacitor release`
     * writes them.
     */
    release: (
      appId: string,
      options: Partial<
        Pick<
          OtaReleaseManifest,
          | "version"
          | "builds"
          | "fingerprint"
          | "channel"
          | "rollout"
          | "platform"
          | "id"
        >
      > & { privateKey?: string; html?: string } = {},
    ) => {
      const version = options.version ?? `1.0.0-${randomUUID().slice(0, 8)}`;
      const archive = writer.write([
        {
          path: "index.html",
          data: new TextEncoder().encode(options.html ?? `<p>${version}</p>`),
        },
        { path: "assets/app.js", data: new TextEncoder().encode("x();") },
      ]);
      const sealed = envelope.seal(
        archive,
        options.privateKey ?? keys.privateKey,
      );
      const manifest: OtaReleaseManifest = {
        format: "alepha-ota/1",
        id: options.id ?? randomUUID(),
        appId,
        platform: options.platform ?? "ios",
        variant: "base",
        channel: options.channel ?? "production",
        version,
        builds: options.builds ?? ["1"],
        fingerprint: options.fingerprint ?? "f1",
        keyId: envelope.keyId(keys.publicKey),
        archive: {
          sha256: sealed.archiveSha256,
          size: archive.length,
          expandedSize:
            4 +
            new TextEncoder().encode(options.html ?? `<p>${version}</p>`)
              .length,
          files: 2,
        },
        checksum: sealed.checksum,
        sessionKey: sealed.sessionKey,
        ciphertext: {
          sha256: sealed.ciphertextSha256,
          size: sealed.ciphertext.length,
        },
        rollout: options.rollout ?? 100,
        createdAt: new Date(0).toISOString(),
      };
      return { manifest, ciphertext: sealed.ciphertext };
    },

    /**
     * Publish in-process, as the publisher route does once authorized.
     */
    publish: async (release: {
      manifest: OtaReleaseManifest;
      ciphertext: Uint8Array;
    }) =>
      (await ctx.publisher.publish(release.manifest, release.ciphertext))
        .bundle,

    /**
     * An update check from one device.
     */
    device: (appId: string, overrides: Partial<OtaDevice> = {}): OtaDevice => ({
      platform: "ios",
      device_id: randomUUID(),
      app_id: appId,
      version_code: "1",
      version_build: "1.0",
      version_name: "1.0",
      plugin_version: "8.52.1",
      ...overrides,
    }),

    check: (device: OtaDevice) => ctx.updates.check(device, hostname),

    /**
     * An API key for a publisher, scoped to `ota:release`.
     */
    publisherKey: async () => {
      const { apiKey, token } = await apiKeys.create({
        userId: randomUUID(),
        name: `publisher ${randomUUID().slice(0, 8)}`,
        roles: ["publisher"],
      });
      return { id: apiKey.id, token };
    },

    /**
     * `POST /ota/bundles` over HTTP, as the CLI does.
     */
    upload: (
      release: { manifest: OtaReleaseManifest; ciphertext: Uint8Array },
      token?: string,
    ) => {
      const form = new FormData();
      form.append(
        "manifest",
        new Blob([JSON.stringify(release.manifest)], {
          type: "application/json",
        }),
        "manifest.json",
      );
      form.append(
        "bundle",
        new Blob([release.ciphertext.slice().buffer as ArrayBuffer], {
          type: "application/zip",
        }),
        "bundle.zip",
      );
      return fetch(`${hostname}/ota/bundles`, {
        method: "POST",
        body: form,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    },
  };
  return ctx;
};
