import { Alepha } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { describe, expect, it } from "vitest";

import type { FileEntity } from "../entities/files.ts";
import { FileAccessProvider } from "../providers/FileAccessProvider.ts";

const fileFrom = (creator: string | undefined): FileEntity =>
  ({
    id: "00000000-0000-0000-0000-0000000000aa",
    blobId: "blob",
    bucket: "files",
    name: "secret.txt",
    size: 7,
    mimeType: "text/plain",
    creator,
  }) as unknown as FileEntity;

const uploader: UserAccountToken = {
  id: "11111111-1111-1111-1111-111111111111",
  ownership: true,
};

const other: UserAccountToken = {
  id: "22222222-2222-2222-2222-222222222222",
  ownership: true,
};

const admin: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  ownership: false,
};

describe("FileAccessProvider — default policy", () => {
  const provider = Alepha.create().inject(FileAccessProvider);

  it("allows the uploader to download their own file", async () => {
    await expect(
      provider.assertReadable(fileFrom(uploader.id), uploader),
    ).resolves.toBeUndefined();
  });

  it("denies a non-uploader (different authenticated user)", async () => {
    await expect(
      provider.assertReadable(fileFrom(uploader.id), other),
    ).rejects.toThrow(/access denied|forbidden/i);
  });

  it("allows privileged identities (ownership === false) regardless of creator", async () => {
    await expect(
      provider.assertReadable(fileFrom(uploader.id), admin),
    ).resolves.toBeUndefined();
  });

  it("denies anonymous (no user)", async () => {
    await expect(
      provider.assertReadable(fileFrom(uploader.id), undefined),
    ).rejects.toThrow(/authentication|forbidden/i);
  });

  it("denies files with no recorded creator unless privileged", async () => {
    await expect(
      provider.assertReadable(fileFrom(undefined), uploader),
    ).rejects.toThrow();
    await expect(
      provider.assertReadable(fileFrom(undefined), admin),
    ).resolves.toBeUndefined();
  });
});

describe("FileAccessProvider — override", () => {
  class OpenAccess extends FileAccessProvider {
    async assertReadable() {
      // permissive override
    }
  }

  it("override grants access without changing controller code", async () => {
    const alepha = Alepha.create().with({
      provide: FileAccessProvider,
      use: OpenAccess,
    });
    const provider = alepha.inject(FileAccessProvider);
    await expect(
      provider.assertReadable(fileFrom(uploader.id), other),
    ).resolves.toBeUndefined();
  });
});
