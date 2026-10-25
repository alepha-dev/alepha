import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";

import { AlephaEmailSmtp } from "../index.workerd.ts";

/**
 * What a Cloudflare Worker gets when it imports `alepha/email/smtp`.
 *
 * Nodemailer needs `node:net` and `node:tls`, which workerd does not have, and
 * a server build bundles every `import()` it can see - including Lore's, which
 * sits behind an `EMAIL_HOST` check that is never true on a Worker. So the
 * `workerd` condition selects an entry that never reaches nodemailer: the
 * Worker's bundle loses 222 kB it could never run, and a Worker that registers
 * SMTP anyway is told so at boot, not on its first send.
 */
describe("alepha/email/smtp under workerd", () => {
  const root = resolve(__dirname, "..");

  /**
   * The transitive relative-import closure of a module: every file it reaches
   * and every bare (package) specifier it names on the way.
   */
  const walk = (entry: string) => {
    const visited = new Set<string>();
    const bare = new Set<string>();
    const queue = [entry];
    const importPattern =
      /(?:import|export)[^"'`;]*?from\s*["'`]([^"'`]+)["'`]/g;
    while (queue.length > 0) {
      const file = queue.pop();
      if (!file || visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const spec = match[1];
        if (spec.startsWith(".")) {
          queue.push(join(dirname(file), spec));
        } else {
          bare.add(spec);
        }
      }
    }
    return { visited, bare };
  };

  it("is the entry the workerd condition selects", ({ expect }) => {
    const pkg = JSON.parse(
      readFileSync(resolve(root, "../../../package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> };

    expect(pkg.exports["./email/smtp"].workerd).toBe(
      "./src/email/smtp/index.workerd.ts",
    );
  });

  it("never reaches nodemailer or the provider that wraps it", ({ expect }) => {
    const { visited, bare } = walk(join(root, "index.workerd.ts"));

    expect([...bare].filter((spec) => spec.startsWith("nodemailer"))).toEqual(
      [],
    );
    expect(
      [...visited].find((file) => file.endsWith("NodemailerEmailProvider.ts")),
    ).toBeUndefined();
  });

  it("refuses to register, and names the module that works on a Worker", ({
    expect,
  }) => {
    const alepha = Alepha.create();

    expect(() => alepha.with(AlephaEmailSmtp)).toThrow(AlephaError);
    expect(() => Alepha.create().with(AlephaEmailSmtp)).toThrow(
      /AlephaEmailCloudflare/,
    );
  });
});
