import { Alepha, AlephaError } from "alepha";
import { AlephaServer, type HelmetOptions, helmetOptions } from "alepha/server";
import { HeadersFileReader } from "alepha/server/static";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { BuildClientTask } from "../tasks/BuildClientTask.ts";
import { BuildHeadersTask } from "../tasks/BuildHeadersTask.ts";

/**
 * Exposes what the client build captured, so a spec can say where Vite's
 * resolved public directory was without running Vite.
 */
class TestBuildClientTask extends BuildClientTask {
  public setPublicDir(dir: string | undefined) {
    this.publicDir = dir;
  }
}

const ROOT = "/root/my-app";
const PUBLIC = `${ROOT}/dist/public`;
const HEADERS = `${PUBLIC}/_headers`;

/**
 * The app's container, which the build reads helmet's headers from.
 */
const appWithHelmet = (options?: Partial<HelmetOptions>) => {
  const app = Alepha.create({ env: { LOG_LEVEL: "error" } }).with(AlephaServer);
  if (options) {
    app.store.mut(helmetOptions, (old) => ({ ...old, ...options }));
  }
  return app;
};

/**
 * An app with no `ServerHelmetProvider` at all: every by-name lookup throws,
 * as `Alepha.inject` does for a service nobody registered.
 */
const appWithoutHelmet = {
  inject: () => {
    throw new AlephaError("Service not found");
  },
} as unknown as Alepha;

describe("BuildHeadersTask", () => {
  const setup = (publicDir: string | undefined = `${ROOT}/public`) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: BuildClientTask, use: TestBuildClientTask });
    alepha.inject(TestBuildClientTask).setPublicDir(publicDir);
    return {
      task: alepha.inject(BuildHeadersTask),
      fs: alepha.inject(MemoryFileSystemProvider),
      reader: new HeadersFileReader(),
    };
  };

  const build = async (
    task: BuildHeadersTask,
    options: {
      app?: Alepha;
      static?: { source: string };
      prebuilt?: boolean;
    } = {},
  ) => {
    await task.run({
      alepha: options.app ?? appWithHelmet(),
      root: ROOT,
      options: options.static ? { static: options.static } : {},
      flags: { prebuilt: options.prebuilt },
      run: ((step: { handler: () => Promise<void> }) =>
        step.handler()) as never,
    } as never);
  };

  const withPublic = async (fs: MemoryFileSystemProvider, author?: string) => {
    await fs.writeFile(`${PUBLIC}/index.html`, "<!doctype html>");
    if (author !== undefined) {
      await fs.writeFile(HEADERS, author);
    }
  };

  describe("the layout", () => {
    it("writes helmet's headers under /*, then the three hash rules", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(fs);

      await build(task);

      expect(fs.getFileContent(HEADERS)).toBe(
        [
          BuildHeadersTask.GENERATED,
          "",
          "/*",
          "  Strict-Transport-Security: max-age=15552000; includeSubDomains",
          "  X-Content-Type-Options: nosniff",
          "  X-Frame-Options: SAMEORIGIN",
          "  Referrer-Policy: strict-origin-when-cross-origin",
          "",
          "/entry.*",
          "  ! Cache-Control",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
          "/chunk.*",
          "  ! Cache-Control",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
          "/asset.*",
          "  ! Cache-Control",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
        ].join("\n"),
      );
    });

    it("writes a file the reader accepts, and caches a hashed file for a year", async ({
      expect,
    }) => {
      const { task, fs, reader } = setup();
      await withPublic(
        fs,
        "# Logos change twice a year.\n/*.png\n  Cache-Control: public, max-age=86400\n",
      );

      await build(task);

      const rules = reader.read(fs.getFileContent(HEADERS) ?? "");
      const defaults: Record<string, string> = {
        "cache-control": "public, max-age=0, must-revalidate",
      };
      const image = reader.apply(rules, "/asset.AbCd1234.png", defaults);
      expect(image["cache-control"]).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(image["x-frame-options"]).toBe("SAMEORIGIN");
      const logo = reader.apply(
        rules,
        "/logo.png",
        {} as Record<string, string>,
      );
      expect(logo["cache-control"]).toBe("public, max-age=86400");
    });

    it("keeps the author's other rules and comments verbatim, between the generated rules", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      const author =
        "# The installer is read before it is run.\n/bay/install.sh\n  Content-Type: text/plain; charset=utf-8\n";
      await withPublic(fs, author);

      await build(task);

      const written = fs.getFileContent(HEADERS) ?? "";
      expect(written).toContain(`\n\n${author.trim()}\n\n/entry.*`);
    });

    it("writes the security rule from the configured CSP", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(fs);

      await build(task, {
        app: appWithHelmet({
          contentSecurityPolicy: {
            directives: { "default-src": ["'self'"], "img-src": ["https:"] },
          },
        }),
      });

      expect(fs.getFileContent(HEADERS)).toContain(
        "\n  Content-Security-Policy: default-src 'self'; img-src https:\n",
      );
    });

    it("writes no /* rule when helmet is disabled", async ({ expect }) => {
      const { task, fs } = setup();
      await withPublic(fs);

      await build(task, { app: appWithHelmet({ disabled: true }) });

      const written = fs.getFileContent(HEADERS) ?? "";
      expect(written).not.toContain("/*");
      expect(written).toContain("/entry.*");
    });

    it("writes no /* rule when the app has no helmet at all", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(fs);

      await build(task, { app: appWithoutHelmet });

      const written = fs.getFileContent(HEADERS) ?? "";
      expect(written).not.toContain("/*");
      expect(written).toContain("/chunk.*");
    });
  });

  describe("an author /*", () => {
    it("folds into the generated /*, and a removal drops the generated line", async ({
      expect,
    }) => {
      const { task, fs, reader } = setup();
      await withPublic(
        fs,
        "/*\n  ! X-Frame-Options\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=()\n",
      );

      await build(task);

      const written = fs.getFileContent(HEADERS) ?? "";
      expect(written).toContain(
        [
          "/*",
          "  Strict-Transport-Security: max-age=15552000; includeSubDomains",
          "  X-Content-Type-Options: nosniff",
          "  Referrer-Policy: strict-origin-when-cross-origin",
          "  ! X-Frame-Options",
          "  X-Frame-Options: DENY",
          "  Permissions-Policy: camera=()",
          "",
        ].join("\n"),
      );
      expect(written.match(/^\/\*$/gm)).toHaveLength(1);
      const headers = reader.apply(reader.read(written), "/", {
        "x-frame-options": "SAMEORIGIN",
      });
      expect(headers["x-frame-options"]).toBe("DENY");
    });

    it("refuses setting a generated header without ! Name, citing the author's line", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(
        fs,
        "# Stricter framing.\n/*\n  X-Frame-Options: DENY\n",
      );

      await expect(build(task)).rejects.toThrow(
        /public\/_headers:3: `\/\*` sets `X-Frame-Options`, which the build already sets/,
      );
      expect(fs.getFileContent(HEADERS)).toContain("# Stricter framing.");
    });
  });

  describe("refusals", () => {
    it("names the author's lines for a file that does not parse", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(fs, "\n/movies/:title\n  X-A: b\n");

      await expect(build(task)).rejects.toThrow(
        /public\/_headers:2: .*placeholder/,
      );
    });

    it("refuses an author rule for a path the build writes", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(
        fs,
        "/entry.*\n  Cache-Control: public, max-age=31536000, immutable\n",
      );

      await expect(build(task)).rejects.toThrow(
        /public\/_headers:1: `\/entry\.\*` is written by the build/,
      );
    });

    it("validates the merged order: an author /* written last is folded first", async ({
      expect,
    }) => {
      // Written last, this `/*` replaced X-A for every script. Folded to the
      // top it comes first, and `/*.js` would then join onto it: refused, at
      // the author's two lines, rather than silently meaning something else.
      const { task, fs } = setup();
      await withPublic(fs, "/*.js\n  X-A: 1\n/*\n  ! X-A\n  X-A: 2\n");

      await expect(build(task)).rejects.toThrow(
        /public\/_headers:2, 5: `\/\*` and `\/\*\.js` both set `X-A`/,
      );
    });

    it("refuses a file already generated, since dist/ was not cleaned", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(fs, `${BuildHeadersTask.GENERATED}\n\n/*\n  X-A: b\n`);

      await expect(build(task)).rejects.toThrow(/was not cleaned/);
    });

    it("refuses a top-level public file named like a hashed one", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(fs);
      await fs.writeFile(`${ROOT}/public/asset.logo.png`, "png");
      await fs.writeFile(`${ROOT}/public/images/asset.fine.png`, "png");

      await expect(build(task)).rejects.toThrow(/`asset\.logo\.png`/);
    });
  });

  describe("a static.source build", () => {
    it("gets the security rule and its own file, but no hash rule and no reserved name", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await withPublic(fs, "/*.png\n  Cache-Control: public, max-age=86400\n");
      await fs.writeFile(`${ROOT}/public/asset.logo.png`, "png");

      await build(task, { static: { source: "dist-client" } });

      const written = fs.getFileContent(HEADERS) ?? "";
      expect(written).toContain("/*\n  Strict-Transport-Security:");
      expect(written).toContain(
        "/*.png\n  Cache-Control: public, max-age=86400",
      );
      expect(written).not.toContain("/asset.*");
    });

    it("cites the adopted directory in an error", async ({ expect }) => {
      const { task, fs } = setup();
      await withPublic(fs, "/a\n  X A: b\n");

      await expect(
        build(task, { static: { source: "dist-client/" } }),
      ).rejects.toThrow(/dist-client\/_headers:2: /);
    });
  });

  it("does nothing under --prebuilt", async ({ expect }) => {
    const { task, fs } = setup();
    await withPublic(fs);

    await build(task, { prebuilt: true });

    expect(await fs.exists(HEADERS)).toBe(false);
  });

  it("does nothing for an app with no dist/public", async ({ expect }) => {
    const { task, fs } = setup();

    await build(task);

    expect(await fs.exists(HEADERS)).toBe(false);
  });
});
