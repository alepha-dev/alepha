import { Alepha } from "alepha";
import { currentTenantAtom } from "alepha/security";
import { FileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { MemoryFileStorageProvider } from "../providers/MemoryFileStorageProvider.ts";

/**
 * A tenant active on the current request/job (`currentTenantAtom`) scopes every
 * file under a `{tenantId}/…` key prefix, so a pooled multi-tenant app keeps
 * each tenant's objects isolated even when they reuse the same fileId. No tenant
 * → the historical un-prefixed layout (covered tenant-less by the per-provider
 * shared suites). Exercised here on the Memory provider; R2/S3/Local share the
 * same `currentTenantAtom` resolution in their key/path builders.
 */
describe("tenant-scoped bucket storage", () => {
  const BUCKET = "media";
  const ID = "shared-id";

  const setup = () => {
    const alepha = Alepha.create();
    const fs = alepha.inject(FileSystemProvider);
    return {
      alepha,
      provider: alepha.inject(MemoryFileStorageProvider),
      file: (text: string) => fs.createFile({ text, name: "f.txt" }),
    };
  };

  it("isolates files per tenant and never collides on a shared fileId", async () => {
    const { alepha, provider, file } = setup();

    // Tenant A uploads under a shared id.
    alepha.store.set(currentTenantAtom, { id: "org-a" });
    await provider.upload(BUCKET, file("a"), ID);
    expect(await provider.exists(BUCKET, ID)).toBe(true);
    expect(await provider.list(BUCKET)).toEqual([ID]);

    // Tenant B sees nothing of A's, and the same id does not collide.
    alepha.store.set(currentTenantAtom, { id: "org-b" });
    expect(await provider.exists(BUCKET, ID)).toBe(false);
    expect(await provider.list(BUCKET)).toEqual([]);
    await provider.upload(BUCKET, file("b"), ID);
    expect(await provider.list(BUCKET)).toEqual([ID]);
    expect(await (await provider.download(BUCKET, ID)).text()).toBe("b");

    // Back to A — still A's bytes, untouched by B.
    alepha.store.set(currentTenantAtom, { id: "org-a" });
    expect(await (await provider.download(BUCKET, ID)).text()).toBe("a");

    // Deleting in A leaves B intact.
    await provider.delete(BUCKET, ID);
    expect(await provider.exists(BUCKET, ID)).toBe(false);
    alepha.store.set(currentTenantAtom, { id: "org-b" });
    expect(await provider.exists(BUCKET, ID)).toBe(true);

    // No tenant → a separate, un-prefixed namespace (neither tenant's files).
    alepha.store.set(currentTenantAtom, undefined);
    expect(await provider.list(BUCKET)).toEqual([]);
  });
});
