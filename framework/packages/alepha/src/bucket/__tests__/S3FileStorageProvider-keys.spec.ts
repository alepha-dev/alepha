import { Alepha, AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

import { S3FileStorageProvider } from "../providers/S3FileStorageProvider.ts";

/**
 * Object keys are `<prefix>/<container>/<fileId>`. A separator or a dot-dot in
 * a caller-supplied id or bucket name addressed another container on S3 and
 * R2, where the local provider already refused it.
 */
describe("S3FileStorageProvider keys", () => {
  it("refuses a file id that would leave the container", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const storage = alepha.inject(S3FileStorageProvider);
    await alepha.start();

    for (const fileId of ["../other/x.png", "a/b.png", "a\\b.png", ".env"]) {
      await expect(storage.exists("bucket", fileId)).rejects.toThrow(
        AlephaError,
      );
    }

    await alepha.stop();
  });

  it("refuses a bucket name that would leave the prefix", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const storage = alepha.inject(S3FileStorageProvider);
    await alepha.start();

    for (const bucket of ["../other", "a/b", "a\\b", ".."]) {
      await expect(storage.exists(bucket, "x.png")).rejects.toThrow(
        /Invalid bucket name/,
      );
    }

    await alepha.stop();
  });
});
