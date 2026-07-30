import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { AlephaBucket } from "../index.ts";
// Relative, never `alepha/bucket`: a file inside the module importing its own
// public barrel is a `bucket -> bucket` cycle. Typecheck and the test run both
// pass anyway — only `yarn build`'s "analyze modules" step catches it.
import { FileStorageProvider } from "../providers/FileStorageProvider.ts";
import { localFileStorageOptions } from "../providers/LocalFileStorageProvider.ts";
import { MemoryFileStorageProvider } from "../providers/MemoryFileStorageProvider.ts";
import { S3FileStorageProvider } from "../providers/S3FileStorageProvider.ts";

/**
 * The local provider's default blob directory is `node_modules/.alepha/buckets`,
 * i.e. inside the deployed bundle. A self-hosted platform that unpacks each
 * release into its own directory therefore destroys every uploaded file on
 * redeploy — silently, because nothing errors.
 *
 * `STORAGE_PATH` is what lets the host put blobs on durable storage, mirroring
 * what `DATABASE_URL` already does for the database.
 */
describe("bucket STORAGE_PATH", () => {
  it("should leave the atom untouched when unset", async () => {
    const alepha = Alepha.create().with(AlephaBucket);
    await alepha.start();
    expect(
      alepha.store.get(localFileStorageOptions.key)?.storagePath,
    ).toBeUndefined();
  });

  it("should let the host override the blob directory", async () => {
    const alepha = Alepha.create({
      env: { STORAGE_PATH: "/var/lib/myapp/storage" },
    }).with(AlephaBucket);
    await alepha.start();
    expect(alepha.store.get(localFileStorageOptions.key)?.storagePath).toBe(
      "/var/lib/myapp/storage",
    );
  });

  it("should ignore an empty value rather than pointing at the working directory", async () => {
    const alepha = Alepha.create({ env: { STORAGE_PATH: "" } }).with(
      AlephaBucket,
    );
    await alepha.start();
    // An empty string must not be written to the atom: it would resolve to the
    // process working directory and scatter blobs wherever bay happened to
    // start the app.
    expect(
      alepha.store.get(localFileStorageOptions.key)?.storagePath,
    ).toBeUndefined();
  });

  it("should not be mistaken for a signal to use S3", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        STORAGE_PATH: "/tmp/blobs",
        // `Alepha.create({ env })` merges with the ambient environment rather
        // than replacing it, and the test setup already provides an S3
        // emulator — so S3_ENDPOINT has to be cleared explicitly here.
        S3_ENDPOINT: "",
        // Production refuses to boot on the built-in default secret.
        APP_SECRET: "test-only-secret-not-used-for-anything-0123456789",
      },
    }).with(AlephaBucket);
    await alepha.start();
    // Choosing S3 is S3_ENDPOINT's job. STORAGE_PATH only says *where* local
    // blobs go, so a host setting it must not accidentally switch backends.
    expect(alepha.inject(FileStorageProvider)).not.toBeInstanceOf(
      S3FileStorageProvider,
    );
  });

  it("should still hand tests an in-memory backend", async () => {
    const alepha = Alepha.create({ env: { STORAGE_PATH: "/tmp/blobs" } }).with(
      AlephaBucket,
    );
    await alepha.start();
    // Test mode deliberately ignores both backends so specs never touch disk;
    // setting STORAGE_PATH must not break that.
    expect(alepha.inject(FileStorageProvider)).toBeInstanceOf(
      MemoryFileStorageProvider,
    );
  });
});

describe("bucket DATA_DIR", () => {
  it("should place blobs under DATA_DIR when STORAGE_PATH is absent", async () => {
    const alepha = Alepha.create({
      env: { DATA_DIR: "/var/lib/app/scratch" },
    }).with(AlephaBucket);
    await alepha.start();
    expect(alepha.store.get(localFileStorageOptions.key)?.storagePath).toBe(
      "/var/lib/app/scratch/buckets",
    );
  });

  it("should let STORAGE_PATH win over DATA_DIR", async () => {
    // A host may relocate everything with DATA_DIR yet still want blobs on a
    // separate, larger volume.
    const alepha = Alepha.create({
      env: { DATA_DIR: "/var/lib/app/scratch", STORAGE_PATH: "/mnt/blobs" },
    }).with(AlephaBucket);
    await alepha.start();
    expect(alepha.store.get(localFileStorageOptions.key)?.storagePath).toBe(
      "/mnt/blobs",
    );
  });
});
