import { Alepha } from "alepha";
import {
  CliProvider,
  CommandError,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { DocsCommand } from "../commands/docs.ts";

/**
 * A page as `package:docs` writes it: JSON-quoted front matter, a blank line,
 * the body word for word.
 */
const page = (meta: {
  slug: string;
  title: string;
  summary: string;
  package: string;
  section: string;
  body: string;
}) =>
  [
    "---",
    `slug: ${JSON.stringify(meta.slug)}`,
    `title: ${JSON.stringify(meta.title)}`,
    `summary: ${JSON.stringify(meta.summary)}`,
    `package: ${JSON.stringify(meta.package)}`,
    `section: ${JSON.stringify(meta.section)}`,
    "---",
    "",
    meta.body,
  ].join("\n");

describe("alepha docs", () => {
  const createTestEnv = async (
    options: { modules?: string; withUi?: boolean } = {},
  ) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    const modules = options.modules ?? "/project/node_modules";

    const write = async (pkg: string, version: string, pages: string[]) => {
      await fs.writeFile(
        `${modules}/${pkg}/package.json`,
        JSON.stringify({ name: pkg, version }),
      );
      for (const content of pages) {
        const slug = JSON.parse(content.split("\n")[1].slice(6));
        await fs.writeFile(`${modules}/${pkg}/docs/${slug}.md`, content);
      }
    };

    await write("alepha", "0.40.0", [
      page({
        slug: "guides-server-building-an-api",
        title: "Building an API",
        summary: "Type-safe HTTP endpoints through `$action`.",
        package: "alepha",
        section: "guides",
        body: "# Building an API\n\nUse `paginate()` for lists.\n\nSee [$entity](./reference-primitives-$entity.md).\n",
      }),
      page({
        slug: "reference-primitives-$entity",
        title: "$entity",
        summary: "Creates a database entity primitive.",
        package: "alepha",
        section: "reference",
        body: "# $entity\n\n## Overview\n\nCreates a database entity primitive.\n",
      }),
      page({
        slug: "reference-primitives-$action",
        title: "$action",
        summary: "Creates a server action primitive.",
        package: "alepha",
        section: "reference",
        body: "# $action\n\nPaginate with `paginate`.\n",
      }),
      page({
        slug: "packages-alepha-server-cors",
        title: "Alepha - Server Cors",
        summary: "CORS headers.",
        package: "alepha",
        section: "packages",
        body: "# Alepha - Server Cors\n",
      }),
    ]);
    // A package with no docs folder is installed but has nothing to say.
    await fs.writeFile(
      `${modules}/@alepha/protobuf/package.json`,
      JSON.stringify({ name: "@alepha/protobuf", version: "0.40.0" }),
    );
    if (options.withUi) {
      await write("@alepha/ui", "0.40.0", [
        page({
          slug: "packages-alepha-ui-form",
          title: "Alepha - Ui - Form",
          summary: "Schema-driven forms.",
          package: "@alepha/ui",
          section: "packages",
          body: "# Form\n\nForms paginate nothing.\n",
        }),
      ]);
    }

    return {
      fs,
      cli: alepha.inject(CliProvider),
      cmd: alepha.inject(DocsCommand),
      output: alepha.inject(MemoryOutputProvider),
    };
  };

  describe("the index", () => {
    it("lists one line per installed page, grouped by package and section", async () => {
      const { cli, cmd, output } = await createTestEnv();

      await cli.run(cmd.docs, { root: "/project" });

      expect(output.text).toContain("## alepha@0.40.0 - guides");
      expect(output.text).toContain(
        "- guides-server-building-an-api (Building an API): Type-safe HTTP endpoints through `$action`.",
      );
      expect(output.text).toContain(
        "- reference-primitives-$entity ($entity): Creates a database entity primitive.",
      );
    });

    it("never prints a page body", async () => {
      const { cli, cmd, output } = await createTestEnv();

      await cli.run(cmd.docs, { root: "/project" });

      expect(output.text).not.toContain("Use `paginate()` for lists.");
    });

    it("lists only the packages the project installed", async () => {
      const without = await createTestEnv();
      await without.cli.run(without.cmd.docs, { root: "/project" });
      expect(without.output.text).not.toContain("@alepha/ui");

      const withUi = await createTestEnv({ withUi: true });
      await withUi.cli.run(withUi.cmd.docs, { root: "/project" });
      expect(withUi.output.text).toContain("## @alepha/ui@0.40.0 - packages");
      expect(withUi.output.text).toContain("- packages-alepha-ui-form");
    });

    it("finds packages hoisted to a parent node_modules, as Node would", async () => {
      const { cli, cmd, output } = await createTestEnv({
        modules: "/repo/node_modules",
      });

      await cli.run(cmd.docs, { root: "/repo/apps/web" });

      expect(output.text).toContain("- reference-primitives-$entity");
    });

    it("stops at the node_modules holding alepha, ignoring any above it", async () => {
      const { cli, cmd, output, fs } = await createTestEnv();
      // An outer checkout's install, one level above the project.
      await fs.writeFile(
        "/node_modules/@alepha/ui/package.json",
        JSON.stringify({ name: "@alepha/ui", version: "9.9.9" }),
      );
      await fs.writeFile(
        "/node_modules/@alepha/ui/docs/packages-alepha-ui-form.md",
        '---\nslug: "packages-alepha-ui-form"\n---\n\n# Form\n',
      );

      await cli.run(cmd.docs, { root: "/project" });

      expect(output.text).not.toContain("@alepha/ui");
    });

    it("says where it looked when no package ships docs", async () => {
      const { cli, cmd } = await createTestEnv();

      await expect(cli.run(cmd.docs, { root: "/elsewhere" })).rejects.toThrow(
        CommandError,
      );
    });
  });

  describe("one page", () => {
    it("prints a page by slug, word for word, without its front matter", async () => {
      const { cli, cmd, output } = await createTestEnv();

      await cli.run(cmd.docs, {
        root: "/project",
        argv: "guides-server-building-an-api",
      });

      expect(output.text).toBe(
        "# Building an API\n\nUse `paginate()` for lists.\n\nSee [$entity](./reference-primitives-$entity.md).",
      );
    });

    it("resolves a primitive name to its reference page", async () => {
      const { cli, cmd, output } = await createTestEnv();

      await cli.run(cmd.docs, { root: "/project", argv: "$entity" });

      expect(output.text).toMatch(/^# \$entity\n/);
    });

    it("resolves a primitive name typed without its $", async () => {
      const { cli, cmd, output } = await createTestEnv();

      await cli.run(cmd.docs, { root: "/project", argv: "action" });

      expect(output.text).toMatch(/^# \$action\n/);
    });

    it("resolves the last part of a slug", async () => {
      const { cli, cmd, output } = await createTestEnv();

      await cli.run(cmd.docs, { root: "/project", argv: "server-cors" });

      expect(output.text).toBe("# Alepha - Server Cors");
    });

    it("prints the closest pages for an unknown name, and fails", async () => {
      const { cli, cmd, output } = await createTestEnv();

      await expect(
        cli.run(cmd.docs, { root: "/project", argv: "entty" }),
      ).rejects.toThrow('No docs page matches "entty"');

      expect(output.text).toContain('No page matches "entty". Closest:');
      expect(output.text.split("\n")[2]).toBe(
        "- reference-primitives-$entity ($entity): Creates a database entity primitive.",
      );
    });
  });

  describe("--grep", () => {
    it("prints every matching line of every installed page, with its slug and line", async () => {
      const { cli, cmd, output } = await createTestEnv({ withUi: true });

      await cli.run(cmd.docs, { root: "/project", argv: "--grep paginate" });

      expect(output.text.split("\n")).toEqual([
        "guides-server-building-an-api:11: Use `paginate()` for lists.",
        "reference-primitives-$action:11: Paginate with `paginate`.",
        "packages-alepha-ui-form:11: Forms paginate nothing.",
      ]);
    });

    it("does not search the front matter", async () => {
      const { cli, cmd, output } = await createTestEnv();

      await cli.run(cmd.docs, { root: "/project", argv: "--grep section" });

      expect(output.text).toBe('No installed page contains "section".');
    });
  });
});
