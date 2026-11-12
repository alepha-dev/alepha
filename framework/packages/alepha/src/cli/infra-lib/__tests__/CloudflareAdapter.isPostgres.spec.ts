import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";

class TestCloudflareAdapter extends CloudflareAdapter {
  public testIsPostgres(env: string) {
    return this.isPostgres({ root: "/project", env } as never);
  }
}

describe("CloudflareAdapter picks Hyperdrive from DATABASE_URL", () => {
  const adapterWith = async (dotenv: string) => {
    delete process.env.DATABASE_URL;
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    await alepha
      .inject(MemoryFileSystemProvider)
      .writeFile("/project/.env.production", dotenv);
    return alepha.inject(TestCloudflareAdapter);
  };

  it("treats postgres:// and postgresql:// alike", async ({ expect }) => {
    const a = await adapterWith(
      "DATABASE_URL=postgres://u:p@db.example.app/app\n",
    );
    expect(await a.testIsPostgres("production")).toBe(true);

    const b = await adapterWith(
      "DATABASE_URL=postgresql://u:p@db.example.app/app\n",
    );
    expect(await b.testIsPostgres("production")).toBe(true);
  });

  it("means D1 when nothing is set", async ({ expect }) => {
    const adapter = await adapterWith("API_KEY=abc\n");
    expect(await adapter.testIsPostgres("production")).toBe(false);
  });

  it("refuses an unknown scheme rather than provisioning D1", async ({
    expect,
  }) => {
    const adapter = await adapterWith("DATABASE_URL=mysql://u:p@db/app\n");
    await expect(adapter.testIsPostgres("production")).rejects.toThrow(
      "'mysql:'",
    );
  });
});
