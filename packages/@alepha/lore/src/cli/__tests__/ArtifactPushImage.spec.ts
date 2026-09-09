import { Alepha, z } from "alepha";
import { CliProvider } from "alepha/command";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerLinks } from "alepha/server/links";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { ArtifactCommand } from "../commands/ArtifactCommand.ts";

/**
 * `lore artifacts push-image`: name a reference, and let Lore read the image.
 *
 * ## ⚠️ Through a real server, not a mock
 *
 * The endpoint is addressed by PATH - `$client` builds the request from the
 * action's own metadata - so a renamed route answers an older CLI with a 404
 * rather than failing typecheck. A `LinkProvider` fake would agree with
 * whatever the client produced and prove nothing about that, which is exactly
 * the reasoning `ArtifactUploader.spec.ts` writes down for the upload.
 *
 * So every case here posts over the network to an `$action` declaring the same
 * path and body shape `ArtifactController.pushImage` declares, and asserts
 * what arrived.
 */
class Sink {
  public received?: Record<string, unknown>;
  public status: "ok" | "refuse" = "ok";
  public stored = true;

  public pushImage = $action({
    method: "POST",
    path: "/projects/:projectId/artifacts/image",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        app: z.string(),
        tag: z.string(),
        reference: z.string(),
        commitSha: z.string().optional(),
        force: z.boolean().optional(),
        digest: z.string().optional(),
      }),
      response: z.object({
        artifact: z.object({
          app: z.string(),
          tag: z.string(),
          runtime: z.string(),
          format: z.string(),
          reference: z.string().optional(),
          sha256: z.string(),
        }),
        stored: z.boolean(),
      }),
    },
    handler: async ({ params, body }) => {
      this.received = { ...body, projectId: params.projectId };

      if (this.status === "refuse") {
        throw new Error(
          `${body.reference} declares no \`dev.alepha.runtime\` label`,
        );
      }

      return {
        artifact: {
          app: body.app,
          tag: body.tag,
          runtime: "node",
          format: "image",
          reference: body.reference,
          sha256: "a".repeat(64),
        },
        stored: this.stored,
      };
    },
  });
}

describe("lore artifacts push-image", () => {
  /**
   * ⚠️ Two containers, and it has to be two: the sink's port is only knowable
   * after it starts, and `$env` resolves `LORE_URL` when the container holding
   * the command boots. Writing `alepha.env.LORE_URL` after `start()` looks
   * like it works and does not - the push would reach the PUBLIC Lore, whose
   * 404 makes a wiring mistake look like a routing one.
   */
  const setup = async (options: { env?: Record<string, string> } = {}) => {
    const server = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaServer)
      // ⚠️ `$client` resolves an action NAME to a path through the server's
      // own `/api/_links` registry, so a sink without this module answers 404
      // to the registry fetch - which surfaces as a 404 on the push and reads
      // like a wrong path rather than a missing module.
      .with(AlephaServerLinks)
      .with(Sink);

    await server.start();

    const cli = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "lore_secret",
        LORE_URL: server.inject(ServerProvider).hostname,
        // Blanked unless a case sets them, for the reason the GITHUB_* ones
        // below carry: `ci.yml` sets `LORE_PROJECT: alepha` for every job, so
        // a suite that does not clear it never sees the no-project branch -
        // the run resolves the CI slug, asks the sink for `getProjectBySlug`,
        // and fails with a missing action instead. Green locally, red in CI.
        LORE_PROJECT: "",
        LORE_APP: "",
        // Blanked unless a case sets them: Actions sets both on every job, so
        // a suite that does not clear them reads the real CI commit.
        GITHUB_SHA: "",
        GITHUB_REF_NAME: "",
        GITHUB_OUTPUT: "",
        ...options.env,
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with(ArtifactCommand);

    const fs = cli.inject(MemoryFileSystemProvider);
    await fs.writeJsonFile("/repo/package.json", { name: "@acme/my-app" });

    return {
      server,
      cli,
      sink: server.inject(Sink),
      cliProvider: cli.inject(CliProvider),
      command: cli.inject(ArtifactCommand),
      fs,
    };
  };

  const run = async (
    argv: string,
    options: Parameters<typeof setup>[0] = {},
  ) => {
    const ctx = await setup(options);
    await ctx.cliProvider.run(ctx.command.pushImage, { argv, root: "/repo" });
    return ctx;
  };

  const REFERENCE = "ghcr.io/alepha-dev/lore:0.30.0";

  describe("what it sends", () => {
    it("posts the reference and the tag to the image endpoint", async () => {
      const ctx = await run(`--project 7 --tag 0.30.0 --image ${REFERENCE}`);

      expect(ctx.sink.received).toMatchObject({
        projectId: 7,
        app: "acme-my-app",
        tag: "0.30.0",
        reference: REFERENCE,
      });
    });

    /**
     * ⚠️ The rule `push` carries, now over two fields. Neither the runtime nor
     * the architecture is the caller's to assert: the first is in the image's
     * own label and the second is inside its index.
     *
     * There is no branch rejecting them - `CliProvider` throws `Unknown flag`
     * on anything it was not given - so this asserts the framework's refusal
     * rather than code that could be deleted.
     */
    it("has no --runtime and no --arch to pass", async () => {
      const ctx = await setup();

      for (const flag of [
        "--runtime node",
        "--arch amd64",
        "--platform linux/amd64",
      ]) {
        await expect(
          ctx.cliProvider.run(ctx.command.pushImage, {
            argv: `--project 7 --image ${REFERENCE} ${flag}`,
            root: "/repo",
          }),
        ).rejects.toThrowError(/[Uu]nknown flag/);
      }
    });

    it("resolves the app from package.json, and lets --app override it", async () => {
      // Same chain `artifacts push` walks, so one build cannot be filed under
      // two names depending on which verb pushed it.
      const derived = await run(`--project 7 --image ${REFERENCE}`);
      expect(derived.sink.received?.app).toBe("acme-my-app");

      const named = await run(`--project 7 --app my-docs --image ${REFERENCE}`);
      expect(named.sink.received?.app).toBe("my-docs");
    });

    it("defaults the tag to latest, the one tag that may be replaced", async () => {
      const ctx = await run(`--project 7 --image ${REFERENCE}`);

      expect(ctx.sink.received?.tag).toBe("latest");
    });

    it("passes force and digest through when they are given", async () => {
      const ctx = await run(
        `--project 7 --image ${REFERENCE} --force --digest sha256:${"a".repeat(64)}`,
      );

      expect(ctx.sink.received).toMatchObject({
        force: true,
        digest: `sha256:${"a".repeat(64)}`,
      });
    });

    it("carries the commit when CI names one", async () => {
      const ctx = await run(`--project 7 --image ${REFERENCE}`, {
        env: { GITHUB_SHA: "0b35cb375ffffffffffffffffffffffffffffff" },
      });

      expect(ctx.sink.received?.commitSha).toBe(
        "0b35cb375ffffffffffffffffffffffffffffff",
      );
    });
  });

  describe("what it refuses", () => {
    it("names the missing --image flag rather than posting an empty one", async () => {
      // A CI log saying which FLAG is missing is the difference between a
      // one-line fix and reading a request body.
      const ctx = await setup();

      await expect(
        ctx.cliProvider.run(ctx.command.pushImage, {
          argv: "--project 7",
          root: "/repo",
        }),
      ).rejects.toThrowError(/No image named. Pass --image/);
      expect(ctx.sink.received).toBeUndefined();
    });

    it("names no project as its own error", async () => {
      const ctx = await setup();

      await expect(
        ctx.cliProvider.run(ctx.command.pushImage, {
          argv: `--image ${REFERENCE}`,
          root: "/repo",
        }),
      ).rejects.toThrowError(/No Lore project named/);
    });

    /**
     * ⚠️ Exits non-zero with the SERVER's reason. A build that cannot be
     * reported is worth a red step, and a generic "push failed" would send
     * somebody to the wrong place - the reason here is that the image was
     * built before the runtime label existed.
     */
    it("surfaces the server's refusal rather than a generic failure", async () => {
      const ctx = await setup();
      ctx.sink.status = "refuse";

      await expect(
        ctx.cliProvider.run(ctx.command.pushImage, {
          argv: `--project 7 --image ${REFERENCE}`,
          root: "/repo",
        }),
      ).rejects.toThrowError();
    });
  });

  describe("what it reports", () => {
    it("writes the digest to GITHUB_OUTPUT, so a later step can pin it", async () => {
      // A tag can be moved by another job; a digest cannot.
      const ctx = await run(`--project 7 --image ${REFERENCE}`, {
        env: { GITHUB_OUTPUT: "/repo/gh-output" },
      });

      expect(await ctx.fs.readTextFile("/repo/gh-output")).toBe(
        `sha256=${"a".repeat(64)}\n`,
      );
    });

    it("says already recorded rather than claiming a write", async () => {
      const ctx = await setup();
      ctx.sink.stored = false;

      // A re-run of a release job. It must exit 0, and it must not say it
      // recorded something it did not.
      await expect(
        ctx.cliProvider.run(ctx.command.pushImage, {
          argv: `--project 7 --image ${REFERENCE}`,
          root: "/repo",
        }),
      ).resolves.not.toThrow();
    });
  });
});
