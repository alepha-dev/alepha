import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { LinkProvider } from "alepha/server/links";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { ArtifactCommand } from "../commands/ArtifactCommand.ts";
import {
  type ArtifactUploaded,
  type ArtifactUploadInput,
  ArtifactUploader,
} from "../services/ArtifactUploader.ts";

/**
 * `alepha lore artifacts push`: pack what was built, send it, say what it is.
 *
 * The upload itself is covered against a real server in
 * `ArtifactUploader.spec.ts`. What is worth asserting here is everything
 * AROUND it, because each of these is silent when wrong:
 *
 * - **the name passed to `pack` is the name the push files it under.** Deriving
 *   it twice is what once let `pack` write one file while its caller looked for
 *   another;
 * - **`--tag` defaults to `latest`**, the one tag that may be replaced, so the
 *   default push is not a pin somebody has to `--force` their way out of;
 * - **the digest reaches `$GITHUB_OUTPUT`.** A tag can be moved by another job
 *   and a digest cannot, so a step deploying exactly these bytes needs the
 *   second.
 */
class FakeUploader extends ArtifactUploader {
  public uploads: ArtifactUploadInput[] = [];
  public rejectWith?: Error;
  public stored = true;

  override async upload(input: ArtifactUploadInput): Promise<ArtifactUploaded> {
    if (this.rejectWith) throw this.rejectWith;
    this.uploads.push(input);
    return {
      artifact: {
        app: input.app,
        tag: input.tag,
        runtime: "workerd",
        sha256: "b".repeat(64),
        size: 2048,
      },
      stored: this.stored,
    };
  }
}

/**
 * The endpoints the command reaches before it uploads: only the slug lookup.
 */
class FakeLinkProvider extends LinkProvider {
  override client(): any {
    return {
      getProjectBySlug: async (config: any) => ({
        id: 7,
        slug: config.params.slug,
      }),
    };
  }
}

describe("alepha lore artifacts push", () => {
  const setup = async (
    options: {
      env?: Record<string, string>;
      pkg?: Record<string, unknown>;
    } = {},
  ) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "lore_secret",
        LORE_PROJECT: "alepha",
        // Blanked unless a case sets them: GitHub Actions sets both on every
        // job, so a suite that does not clear them reads the real CI commit
        // and asserts nothing. Same trap `QualityCommand.spec.ts` documents.
        GITHUB_SHA: "",
        GITHUB_REF_NAME: "",
        GITHUB_OUTPUT: "",
        ...options.env,
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with({ provide: ArtifactUploader, use: FakeUploader })
      .with(ArtifactCommand);

    const fs = alepha.inject(MemoryFileSystemProvider);
    // What `alepha pack` refuses to run without.
    await fs.mkdir("/repo/dist", { recursive: true });
    await fs.writeFile(
      "/repo/dist/manifest.json",
      JSON.stringify({ version: 1, project: "my-app", runtime: "workerd" }),
    );
    await fs.writeJsonFile(
      "/repo/package.json",
      options.pkg ?? { name: "@acme/my-app" },
    );

    return {
      alepha,
      cli: alepha.inject(CliProvider),
      command: alepha.inject(ArtifactCommand),
      uploader: alepha.inject(FakeUploader) as FakeUploader,
      shell: alepha.inject(MemoryShellProvider),
      fs,
    };
  };

  const push = async (argv = "", options: Parameters<typeof setup>[0] = {}) => {
    const ctx = await setup(options);
    await ctx.cli.run(ctx.command.push, { argv, root: "/repo" });
    return ctx;
  };

  describe("what it packs", () => {
    /**
     * ⚠️ The name is derived ONCE and handed to `pack` as `--name`, so the
     * file `pack` writes and the file the upload reads cannot be two
     * different paths. A scoped package is where that would break first.
     */
    it("slugifies the package name and files the artifact under it", async () => {
      const ctx = await push();

      expect(ctx.uploader.uploads[0].app).toBe("acme-my-app");
      expect(ctx.uploader.uploads[0].filename).toBe(
        "acme-my-app-latest.tar.gz",
      );
      expect(ctx.uploader.uploads[0].archivePath).toBe(
        "/repo/node_modules/.alepha/acme-my-app-latest.tar.gz",
      );
    });

    it("lets --app override it", async () => {
      const ctx = await push("--app my-docs");

      expect(ctx.uploader.uploads[0].app).toBe("my-docs");
    });

    it("packs into the same path it then uploads", async () => {
      const ctx = await push();

      expect(
        ctx.shell.wasCalledMatching(
          /tar -czf '\/repo\/node_modules\/\.alepha\/acme-my-app-latest\.tar\.gz'/,
        ),
      ).toBe(true);
    });

    /**
     * The tarball is a means, not an output. Left behind in `node_modules` it
     * is invisible until it is stale; `alepha pack` is what to run when the
     * file itself is wanted.
     */
    it("removes the tarball afterwards", async () => {
      const ctx = await push();

      expect(
        await ctx.fs.exists(
          "/repo/node_modules/.alepha/acme-my-app-latest.tar.gz",
        ),
      ).toBe(false);
    });
  });

  describe("the tag", () => {
    it("defaults to latest, the one tag that may be replaced", async () => {
      const ctx = await push();

      expect(ctx.uploader.uploads[0].tag).toBe("latest");
    });

    it("takes the one it is given", async () => {
      const ctx = await push("--tag 1.2.3");

      expect(ctx.uploader.uploads[0].tag).toBe("1.2.3");
    });

    it("forwards --force", async () => {
      const ctx = await push("--tag 1.2.3 --force");

      expect(ctx.uploader.uploads[0].force).toBe(true);
    });

    it("sends no force when none was asked for", async () => {
      const ctx = await push();

      expect(ctx.uploader.uploads[0].force).toBeUndefined();
    });
  });

  describe("the commit", () => {
    it("names the one CI is building", async () => {
      const ctx = await push("", {
        env: { GITHUB_SHA: "0b35cb375", GITHUB_REF_NAME: "main" },
      });

      expect(ctx.uploader.uploads[0].commitSha).toBe("0b35cb375");
    });
  });

  describe("the digest", () => {
    /**
     * A tag can be moved by another job; a digest cannot. A step meaning to
     * deploy exactly these bytes needs the second, and should not have to
     * scrape it out of a log line.
     */
    it("writes sha256 to $GITHUB_OUTPUT when Actions set one", async () => {
      const ctx = await push("", {
        env: { GITHUB_OUTPUT: "/repo/github-output" },
      });

      expect(await ctx.fs.readTextFile("/repo/github-output")).toBe(
        `sha256=${"b".repeat(64)}\n`,
      );
    });

    it("writes nothing anywhere when Actions set none", async () => {
      const ctx = await push();

      expect(await ctx.fs.exists("/repo/github-output")).toBe(false);
    });
  });

  describe("failing", () => {
    /**
     * A push that cannot happen exits non-zero. There is no `--soft` in v1:
     * the safety is where the command runs, since the CI step is
     * `continue-on-error` and gates no deploy.
     */
    it("propagates an upload failure instead of swallowing it", async () => {
      const ctx = await setup();
      ctx.uploader.rejectWith = new Error("409 Conflict");

      await expect(
        ctx.cli.run(ctx.command.push, { root: "/repo" }),
      ).rejects.toThrowError(/409/);
    });

    it("still removes the tarball when the upload fails", async () => {
      const ctx = await setup();
      ctx.uploader.rejectWith = new Error("409 Conflict");

      await expect(
        ctx.cli.run(ctx.command.push, { root: "/repo" }),
      ).rejects.toThrowError();

      expect(
        await ctx.fs.exists(
          "/repo/node_modules/.alepha/acme-my-app-latest.tar.gz",
        ),
      ).toBe(false);
    });

    it("says what to do when package.json names nothing", async () => {
      const ctx = await setup({ pkg: {} });

      await expect(
        ctx.cli.run(ctx.command.push, { root: "/repo" }),
      ).rejects.toThrowError(/--app/);
    });
  });
});
