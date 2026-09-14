import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { BuildPrerenderTask } from "../tasks/BuildPrerenderTask.ts";

/**
 * Exposes the protected writer, so a page can be rendered to disk without
 * driving a whole build.
 */
class TestBuildPrerenderTask extends BuildPrerenderTask {
  public testRenderFile = this.renderFile.bind(this);
}

describe("BuildPrerenderTask", () => {
  const setup = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      task: alepha.inject(TestBuildPrerenderTask),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  /**
   * A page whose render answers the URL the router built, which is what
   * `ReactPageProvider.compile` produces: params through
   * `encodeURIComponent`.
   */
  const pageAt = (pathname: string) => ({
    render: async () => ({
      html: `<html>${pathname}</html>`,
      state: { url: new URL(`http://localhost${pathname}`) },
    }),
  });

  describe("the file a page is written to", () => {
    it("names a page whose param holds $ with the decoded pathname", async ({
      expect,
    }) => {
      // The slug `$sitemap` renders at `%24sitemap`. Cloudflare's asset worker
      // decodes the request path before its manifest lookup, and Bay stats
      // Go's decoded `r.URL.Path`: a file named `%24sitemap.html` was a 404 on
      // both, for every $primitive page of alepha.dev.
      const { task, fs } = setup();
      const slug = encodeURIComponent("reference-primitives-$sitemap");

      await task.testRenderFile(pageAt(`/docs/${slug}`), {}, "/dist/public");

      expect(
        fs.wasWritten("/dist/public/docs/reference-primitives-$sitemap.html"),
      ).toBe(true);
      expect(
        fs.wasWritten("/dist/public/docs/reference-primitives-%24sitemap.html"),
      ).toBe(false);
    });

    it("writes / as index.html", async ({ expect }) => {
      const { task, fs } = setup();

      await task.testRenderFile(pageAt("/"), {}, "/dist/public");

      expect(fs.wasWritten("/dist/public/index.html")).toBe(true);
    });

    it("leaves a plain pathname as it is", async ({ expect }) => {
      const { task } = setup();

      expect(task.fileName("/docs/guides-server-building-api")).toBe(
        "/docs/guides-server-building-api.html",
      );
    });

    it("decodes every segment the way Cloudflare does", async ({ expect }) => {
      const { task } = setup();

      expect(task.fileName("/a%20b/caf%C3%A9")).toBe("/a b/café.html");
    });

    it("keeps a malformed escape verbatim", async ({ expect }) => {
      const { task } = setup();

      expect(task.fileName("/docs/100%")).toBe("/docs/100%.html");
    });

    it("refuses a path that decodes out of the public directory", async ({
      expect,
    }) => {
      const { task } = setup();

      expect(() => task.fileName("/docs/%2E%2E/%2E%2E/etc")).toThrow(
        AlephaError,
      );
    });
  });
});
