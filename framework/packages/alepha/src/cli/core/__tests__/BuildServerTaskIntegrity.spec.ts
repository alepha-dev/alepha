import { createHash } from "node:crypto";

import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { BuildServerTask } from "../tasks/BuildServerTask.ts";

class TestServerTask extends BuildServerTask {
  public integrity(files: string[], publicDir: string, base: string) {
    return this.integrityOf(files, publicDir, base);
  }
}

/**
 * The build's SHA-384 of each emitted JS and CSS file (#Q3319), parallel to
 * the preload table's `files`.
 */
describe("BuildServerTask integrity", () => {
  const setup = async () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const fs = alepha.inject(MemoryFileSystemProvider);
    await fs.writeFile("/app/dist/public/assets/entry.js", "console.log(1)");
    await fs.writeFile("/app/dist/public/assets/style.css", "body{}");
    await fs.writeFile("/app/dist/public/assets/logo.svg", "<svg/>");
    return alepha.inject(TestServerTask);
  };

  const sri = (content: string) =>
    `sha384-${createHash("sha384").update(content).digest("base64")}`;

  it("hashes each JS and CSS file as a browser checks it, and nothing else", async ({
    expect,
  }) => {
    const task = await setup();

    const integrity = await task.integrity(
      [
        "/assets/entry.js",
        "/assets/style.css",
        "/assets/logo.svg",
        "/assets/missing.js",
      ],
      "/app/dist/public",
      "",
    );

    expect(integrity).toEqual([sri("console.log(1)"), sri("body{}"), "", ""]);
  });

  it("strips the asset base to find the file on disk", async ({ expect }) => {
    const task = await setup();

    const integrity = await task.integrity(
      ["/app-base/assets/entry.js", "https://cdn.example.com/assets/style.css"],
      "/app/dist/public",
      "/app-base",
    );
    expect(integrity[0]).toBe(sri("console.log(1)"));

    const cdn = await task.integrity(
      ["https://cdn.example.com/assets/style.css"],
      "/app/dist/public",
      "https://cdn.example.com",
    );
    expect(cdn).toEqual([sri("body{}")]);
  });
});
