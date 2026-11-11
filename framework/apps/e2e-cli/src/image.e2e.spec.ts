/**
 * `alepha image` on real Docker.
 *
 * The specs of `DockerImageBuilder` and `ImageCommand` substitute
 * `MemoryShellProvider`: they check an argv and the text of a Dockerfile,
 * which cannot disagree with Docker. This suite builds the images a consumer
 * would build, runs them, and reads back what a registry holds.
 *
 * The fixture is the project `alepha init` scaffolds, on a packed `alepha`
 * (the bytes npm would serve, see `cli.e2e.spec.ts`), so no second fixture
 * app is kept in step with the scaffold.
 *
 * ⚠️ **It fails without Docker, it never skips.** A skipped case is how a
 * green run lies, the rule this job already applies to Deno.
 *
 * ⚠️ **One platform, the runner's.** No emulation: a multi-platform build is
 * proved by hand, once.
 *
 * Everything it starts carries the label `dev.alepha.e2e=<run id>`, and
 * `afterAll` removes every container, volume and image of that run, on
 * failure too.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AlephaError } from "alepha";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORK = join(ROOT, ".e2e-tmp", "image");
const PROJECT = join(WORK, "proj");
const CLI = join(PROJECT, "node_modules", ".bin", "alepha");

/**
 * One id per run, so two worktrees running this suite at once never remove
 * each other's containers.
 */
const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;
const LABEL = `dev.alepha.e2e=image-${RUN_ID}`;
const STANDARD_TAG = `alepha-e2e-standard:${RUN_ID}`;
const COMPILED_TAG = `alepha-e2e-compiled:${RUN_ID}`;

/**
 * The bases the generated Dockerfiles start from, and the registry. Pulled
 * up front, so a rate limit on a shared runner reads as a failed pull rather
 * than as a failed assertion about the image.
 */
const BASES = [
  "node:24-alpine",
  "gcr.io/distroless/cc-debian12",
  "registry:2",
] as const;

const APP_SECRET = "e2e-only-not-a-real-secret-0123456789abcdef";

/**
 * A loopback port nothing listens on right now.
 */
const freePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolvePort(port));
    });
  });

class Shell {
  /**
   * Run a command with an argv, never through a shell, and resolve with its
   * exit code and its combined output.
   */
  public static async run(
    command: string,
    args: string[],
    cwd: string = WORK,
    timeoutMs = 300_000,
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolveRun, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          NODE_ENV: "development",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          // An agent session implies `--verbose`, which buries the output.
          CLAUDECODE: "",
          YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
        },
      });
      let output = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(
          new AlephaError(
            `${command} ${args.join(" ")} timed out: ${output.slice(-4000)}`,
          ),
        );
      }, timeoutMs);
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
        resolveRun({ code, output });
      });
    });
  }

  /**
   * Run a command that must succeed, and return its output.
   */
  public static async ok(
    command: string,
    args: string[],
    cwd: string = WORK,
    timeoutMs?: number,
  ): Promise<string> {
    const { code, output } = await Shell.run(command, args, cwd, timeoutMs);
    if (code !== 0) {
      throw new AlephaError(
        `${command} ${args.join(" ")} exited ${code}:\n${output.slice(-8000)}`,
      );
    }
    return output;
  }
}

class Docker {
  /**
   * `docker inspect --format`, trimmed.
   */
  public static async inspect(target: string, format: string): Promise<string> {
    return (
      await Shell.ok("docker", ["inspect", "--format", format, target])
    ).trim();
  }

  /**
   * Start a container from an image, detached, with its port 3000 published
   * on a free loopback port. Returns the container id and the base URL.
   */
  public static async start(
    image: string,
    extra: string[] = [],
  ): Promise<{ id: string; base: string }> {
    const id = (
      await Shell.ok("docker", [
        "run",
        "-d",
        "--label",
        LABEL,
        "-p",
        "127.0.0.1::3000",
        "-e",
        `APP_SECRET=${APP_SECRET}`,
        ...extra,
        image,
      ])
    ).trim();
    const port = (await Shell.ok("docker", ["port", id, "3000/tcp"]))
      .trim()
      .split("\n")[0]
      .split(":")
      .at(-1);
    return { id, base: `http://127.0.0.1:${port}` };
  }

  /**
   * Wait for `/health` to answer 200 with `ready: true`, and fail with the
   * container's own logs when it never does.
   */
  public static async waitHealthy(
    container: { id: string; base: string },
    timeoutMs = 60_000,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    let last = "no answer";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${container.base}/health`);
        const body = await response.text();
        last = `${response.status} ${body}`;
        if (response.status === 200) {
          const json = JSON.parse(body) as Record<string, unknown>;
          if (json.ready === true) {
            return json;
          }
        }
      } catch (error) {
        last = String(error);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const logs = await Shell.run("docker", ["logs", container.id]);
    throw new AlephaError(
      `/health never answered ready within ${timeoutMs}ms (last: ${last}).\nContainer logs:\n${logs.output.slice(-4000)}`,
    );
  }
}

/**
 * The local registry, and how to read a manifest out of it.
 */
class Registry {
  public static host = "";

  /**
   * The media types a client must accept to see an index rather than have
   * the registry pick one platform's manifest for it.
   */
  public static readonly accept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(", ");

  /**
   * Fetch a manifest by tag or digest, with the digest the registry gives it.
   */
  public static async manifest(
    repository: string,
    reference: string,
  ): Promise<{ digest: string; mediaType: string; body: any }> {
    const response = await fetch(
      `http://${Registry.host}/v2/${repository}/manifests/${reference}`,
      { headers: { accept: Registry.accept } },
    );
    if (response.status !== 200) {
      throw new AlephaError(
        `${repository}:${reference} is not in the registry: ${response.status} ${await response.text()}`,
      );
    }
    return {
      digest: response.headers.get("docker-content-digest") ?? "",
      mediaType: response.headers.get("content-type") ?? "",
      body: await response.json(),
    };
  }
}

/**
 * Remove whatever this run left: containers (with their anonymous volumes),
 * named volumes, and the images it built or tagged.
 */
const cleanup = async (): Promise<void> => {
  const containers = (
    await Shell.run("docker", ["ps", "-aq", "--filter", `label=${LABEL}`])
  ).output
    .split("\n")
    .filter(Boolean);
  if (containers.length) {
    await Shell.run("docker", ["rm", "-fv", ...containers]);
  }
  const volumes = (
    await Shell.run("docker", [
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=${LABEL}`,
    ])
  ).output
    .split("\n")
    .filter(Boolean);
  if (volumes.length) {
    await Shell.run("docker", ["volume", "rm", "-f", ...volumes]);
  }
  const images = (
    await Shell.run("docker", [
      "images",
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ])
  ).output
    .split("\n")
    .filter((it) => it.endsWith(`:${RUN_ID}`));
  if (images.length) {
    await Shell.run("docker", ["rmi", "-f", ...images]);
  }
};

describe("alepha image on real Docker", () => {
  beforeAll(async () => {
    const version = await Shell.run(
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      ROOT,
    );
    if (version.code !== 0) {
      throw new AlephaError(
        "This suite needs a running Docker daemon, and it fails rather than " +
          `skips without one.\n${version.output}`,
      );
    }
    if (!existsSync(join(ROOT, "packages/alepha/dist/bin/index.js"))) {
      throw new AlephaError(
        "packages/alepha/dist is missing: run `yarn build` before `yarn e2e-cli`. " +
          "This suite installs a packed tarball, and the tarball carries dist/.",
      );
    }

    for (const base of BASES) {
      const pulled = await Shell.run("docker", ["pull", base], ROOT);
      if (pulled.code !== 0) {
        throw new AlephaError(
          `Pulling ${base} failed, before any image was built (a registry ` +
            `rate limit reads like this):\n${pulled.output.slice(-2000)}`,
        );
      }
    }

    await rm(WORK, { recursive: true, force: true });
    await mkdir(PROJECT, { recursive: true });

    const tarball = join(WORK, "alepha.tgz");
    await Shell.ok(
      "yarn",
      ["workspace", "alepha", "pack", "-o", tarball],
      ROOT,
    );
    await writeFile(
      join(PROJECT, "package.json"),
      `${JSON.stringify({ name: "image-e2e", version: "1.0.0", private: true }, null, 2)}\n`,
    );
    await Shell.ok(
      "npm",
      ["install", "--no-audit", "--no-fund", tarball],
      PROJECT,
    );
    await Shell.ok(CLI, ["init"], PROJECT);

    // ⚠️ A port chosen here, never one Docker picks (`127.0.0.1::5000`).
    // The daemon pushes, not this process, and on Docker Desktop it runs in a
    // VM that reaches a fixed published port on its own loopback and an
    // ephemeral one not at all: the push dies with `connection refused`.
    const port = await freePort();
    await Shell.ok("docker", [
      "run",
      "-d",
      "--label",
      LABEL,
      "-p",
      `127.0.0.1:${port}:5000`,
      "registry:2",
    ]);
    Registry.host = `127.0.0.1:${port}`;
  }, 600_000);

  afterAll(async () => {
    await cleanup();
    await rm(WORK, { recursive: true, force: true });
  }, 120_000);

  describe("the standard image", () => {
    beforeAll(async () => {
      await rm(join(PROJECT, "Dockerfile"), { force: true });
      await Shell.ok(CLI, ["build"], PROJECT);
      await Shell.ok(CLI, ["image", `--tag=${STANDARD_TAG}`], PROJECT);
    }, 600_000);

    it("is configured to run as uid 1000", async () => {
      expect(await Docker.inspect(STANDARD_TAG, "{{.Config.User}}")).toBe(
        "1000",
      );
    });

    it("boots and answers /health with ready: true, as uid 1000", async () => {
      const container = await Docker.start(STANDARD_TAG);
      const health = await Docker.waitHealthy(container);
      expect(health.ready).toBe(true);
      const uid = await Shell.ok("docker", ["exec", container.id, "id", "-u"]);
      expect(uid.trim()).toBe("1000");
    });

    it("is pushed to a registry and read back by digest", async () => {
      const remote = `${Registry.host}/alepha-e2e/standard:${RUN_ID}`;
      await Shell.ok("docker", ["tag", STANDARD_TAG, remote]);
      await Shell.ok("docker", ["push", remote]);
      const byTag = await Registry.manifest("alepha-e2e/standard", RUN_ID);
      expect(byTag.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      const byDigest = await Registry.manifest(
        "alepha-e2e/standard",
        byTag.digest,
      );
      expect(byDigest.digest).toBe(byTag.digest);
    });
  });

  describe("the compiled image", () => {
    beforeAll(async () => {
      // The standard case's Dockerfile would be reused untouched: the
      // compiled variant is a different file.
      await rm(join(PROJECT, "Dockerfile"), { force: true });
      await Shell.ok(CLI, ["build", "--runtime=bun"], PROJECT);
      await Shell.ok(
        CLI,
        ["image", "--compile", `--tag=${COMPILED_TAG}`],
        PROJECT,
        600_000,
      );
    }, 900_000);

    it("boots and answers /health with ready: true", async () => {
      const container = await Docker.start(COMPILED_TAG);
      const health = await Docker.waitHealthy(container);
      expect(health.ready).toBe(true);
    });

    it("is pushed to a registry and read back by digest", async () => {
      const remote = `${Registry.host}/alepha-e2e/compiled:${RUN_ID}`;
      await Shell.ok("docker", ["tag", COMPILED_TAG, remote]);
      await Shell.ok("docker", ["push", remote]);
      const byTag = await Registry.manifest("alepha-e2e/compiled", RUN_ID);
      expect(byTag.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      const byDigest = await Registry.manifest(
        "alepha-e2e/compiled",
        byTag.digest,
      );
      expect(byDigest.digest).toBe(byTag.digest);
    });
  });
});
