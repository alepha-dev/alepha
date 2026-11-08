import { McpServerProvider } from "alepha/mcp";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { DevMcpServer } from "../services/DevMcpServer.ts";

const page = (slug: string, title: string, body: string) =>
  [
    "---",
    `slug: ${JSON.stringify(slug)}`,
    `title: ${JSON.stringify(title)}`,
    `summary: ${JSON.stringify(`About ${title}`)}`,
    `package: "alepha"`,
    `section: "Guides"`,
    "---",
    "",
    body,
  ].join("\n");

describe("alepha mcp: docs_search and docs_read", () => {
  /**
   * A server over a project with two installed pages, and no app running:
   * the run registry is an empty directory of the memory file system.
   */
  const server = async () => {
    const container = new DevMcpServer().create(
      "/project",
      { LOG_LEVEL: "error", ALEPHA_RUN_DIR: "/run" },
      [{ provide: FileSystemProvider, use: MemoryFileSystemProvider }],
    );
    const fs = container.inject(MemoryFileSystemProvider);
    await fs.writeFile(
      "/project/node_modules/alepha/package.json",
      JSON.stringify({ name: "alepha", version: "0.40.0" }),
    );
    await fs.writeFile(
      "/project/node_modules/alepha/docs/guides-entities.md",
      page(
        "guides-entities",
        "Entities",
        "Declare one with $entity.\nThen paginate.",
      ),
    );
    await fs.writeFile(
      "/project/node_modules/alepha/docs/guides-jobs.md",
      page("guides-jobs", "Jobs", "A $job runs later."),
    );
    await container.start();
    const call = async (name: string, params: Record<string, unknown> = {}) =>
      (await container
        .inject(McpServerProvider)
        .getTool(name)!
        .execute(params)) as string;
    return { call, container };
  };

  it("searches and reads the installed pages with no app running", async ({
    expect,
  }) => {
    const { call, container } = await server();

    expect(await call("apps_list")).toMatch(/No Alepha app is running/);
    expect(await call("docs_search", { text: "paginate" })).toBe(
      "guides-entities:10: Then paginate.",
    );
    expect(await call("docs_read", { page: "guides-jobs" })).toContain(
      "A $job runs later.",
    );
    expect(await call("docs_read")).toContain(
      "- guides-entities (Entities): About Entities",
    );
    await container.stop();
  });

  it("suggests the closest pages on a miss", async ({ expect }) => {
    const { call, container } = await server();

    expect(await call("docs_read", { page: "guides-job" })).toMatch(
      /^No page matches "guides-job". Closest:\n\n- guides-jobs/,
    );
    expect(await call("docs_search", { text: "nothing-like-it" })).toBe(
      'No installed page contains "nothing-like-it".',
    );
    await container.stop();
  });
});
