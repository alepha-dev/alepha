import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AlephaError } from "alepha";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORK = join(ROOT, ".e2e-tmp/redis");
const APP = join(WORK, "app");
const DIST = join(APP, "dist");

/**
 * A string literal of `@redis/client` that survives minification.
 */
const CLIENT_MARKER = "Socket already opened";

class Command {
  public static async run(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string | undefined> = {},
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolveCommand, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          NODE_ENV: "production",
          LOG_LEVEL: "error",
          CLAUDECODE: "",
          YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
          REDIS_URL: undefined,
          ...env,
        },
      });
      let output = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new AlephaError(`${command} timed out: ${output.slice(-4000)}`));
      }, 240_000);
      child.stdout?.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        output += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveCommand({ code, output });
      });
    });
  }

  public static async ok(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<string> {
    const { code, output } = await Command.run(command, args, cwd, {
      NODE_ENV: "development",
    });
    if (code !== 0) {
      throw new AlephaError(
        `${command} exited ${code}: ${output.slice(-8000)}`,
      );
    }
    return output;
  }
}

/**
 * `@redis/client` is 447 KB minified, and the server build is minified and
 * bundled (`noExternal`). `NodeRedisProvider` imports it with `import()` on
 * connect, so a Node app that never sets `REDIS_URL` must carry it as a chunk
 * of its own and never load it. Proven on a packed `alepha`, as a consumer
 * would install it.
 */
describe("the Node Redis client loads lazily", () => {
  beforeAll(async () => {
    await readFile(join(ROOT, "packages/alepha/dist/core/index.js"));
    await rm(WORK, { recursive: true, force: true });
    await mkdir(join(APP, "src"), { recursive: true });
    const tarball = join(WORK, "alepha.tgz");
    await Command.ok(
      "yarn",
      ["workspace", "alepha", "pack", "-o", tarball],
      ROOT,
    );
    await writeFile(
      join(APP, "package.json"),
      JSON.stringify({ name: "redis-lazy", private: true, type: "module" }),
    );
    await Command.ok(
      "npm",
      ["install", "--no-audit", "--no-fund", tarball],
      APP,
    );
    await writeFile(
      join(APP, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "Bundler",
          allowImportingTsExtensions: true,
          noEmit: true,
          strict: true,
        },
      }),
    );
    // Redis is reachable from the app, behind a runtime switch, so the bundler
    // must keep it; without the switch nothing ever connects.
    await writeFile(
      join(APP, "src/main.server.ts"),
      `import { Alepha } from "alepha";
import { AlephaRedis } from "alepha/redis";

const app = Alepha.create();
if (process.env.PROBE_REDIS) app.with(AlephaRedis);
await app.start();
console.log("STARTED");
await app.stop();
`,
    );
    await Command.ok(
      process.execPath,
      [
        join(APP, "node_modules/alepha/dist/bin/index.js"),
        "build",
        "--runtime=node",
      ],
      APP,
    );
  }, 600_000);

  afterAll(async () => {
    await rm(WORK, { recursive: true, force: true });
  });

  /**
   * Every JavaScript file the Node slice emitted, with its source.
   */
  const serverFiles = async () => {
    const files: { path: string; source: string }[] = [];
    const walk = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (path !== join(DIST, "public")) await walk(path);
        } else if (/\.m?js$/.test(entry.name)) {
          files.push({ path, source: await readFile(path, "utf8") });
        }
      }
    };
    await walk(DIST);
    return files;
  };

  it("emits the client as a chunk of its own, apart from the entry", async () => {
    const files = await serverFiles();
    const holders = files.filter((file) => file.source.includes(CLIENT_MARKER));

    expect(holders).toHaveLength(1);
    expect(holders[0].path).not.toBe(join(DIST, "index.node.js"));
  });

  it("boots without REDIS_URL with the client chunk deleted, and the chunk is what a connect loads", async () => {
    const files = await serverFiles();
    const chunk = files.find((file) => file.source.includes(CLIENT_MARKER));
    expect(chunk).toBeDefined();
    await rm(chunk!.path);

    const without = await Command.run(
      process.execPath,
      [join(DIST, "index.node.js")],
      APP,
    );
    expect(without.output).toContain("STARTED");
    expect(without.code).toBe(0);

    // The same build, told to connect, now fails on the missing chunk:
    // the deleted file was the client, reached only by connecting.
    const connect = await Command.run(
      process.execPath,
      [join(DIST, "index.node.js")],
      APP,
      { PROBE_REDIS: "1", REDIS_URL: "redis://localhost:16379" },
    );
    expect(connect.code).not.toBe(0);
    expect(connect.output).not.toContain("STARTED");
    expect(connect.output).toContain(chunk!.path.split("/").at(-1));
  });
});
