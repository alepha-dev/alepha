import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { Alepha } from "alepha";
import { AlephaReactRouter, ReactPageProvider } from "alepha/react/router";

import { bootLore } from "../test/fixtures/bootLore.ts";

/**
 * Prints the three inventories `CLAUDE.md` keeps by hand: the route table,
 * the state atoms, and the component count.
 *
 * It exists because all three had rotted at once - the route table was
 * missing four pages, the atom list named two that were gone and missed ten,
 * and the component count was off by a third. A list nobody can regenerate
 * is a list that drifts silently, and CLAUDE.md is read by every session
 * before it touches this app.
 *
 * The routes come from the REAL router, booted the way `app-routes.spec.ts`
 * boots it - not from a grep over `$page(` - so a page that exists but is
 * unreachable still shows up, and a renamed one cannot be missed.
 *
 *   yarn w lore inventory
 *
 * The output is meant to be read and folded into CLAUDE.md by hand: the
 * table's Notes column carries reasoning no generator can produce.
 */
class AppInventory {
  /**
   * The param name substituted back in for itself, so a path prints as the
   * `/:projectSlug/quests/:shortId` shape CLAUDE.md documents rather than a
   * sample value. Any param NOT listed here comes out as a literal
   * `:segment`, which is the same thing - the list only exists because
   * `pathname()` throws on a param it was given nothing for.
   */
  protected readonly sampleParams = {
    projectSlug: ":projectSlug",
    appName: ":appName",
    shortId: ":shortId",
    epicNumber: ":epicNumber",
    areaId: ":areaId",
  };

  async run(): Promise<void> {
    await this.printRoutes();
    await this.printAtoms();
    await this.printComponentCount();
  }

  protected async printRoutes(): Promise<void> {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });
    alepha.with(AlephaReactRouter);
    // Every router, the account pages included: without them the /account
    // pages Lore declares itself are silently absent.
    bootLore(alepha, ["routes"]);
    const pages = alepha.inject(ReactPageProvider);
    await alepha.start();

    const rows = pages
      .getPages()
      .map((page) => ({
        // `pathname()` percent-encodes what it substitutes, so the `:` of
        // each placeholder comes back as `%3A`.
        path: decodeURIComponent(
          pages.pathname(page.name, { params: this.sampleParams }),
        ),
        name: page.name,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    console.log(`\n## Routes (${rows.length})\n`);
    console.log("| Path | Route name |");
    console.log("| --- | --- |");
    for (const row of rows) {
      console.log(`| \`${row.path}\` | \`${row.name}\` |`);
    }

    await alepha.stop();
  }

  /**
   * Each `@lore/*` package's source root, where the atoms and the components
   * live since #E75.
   */
  protected readonly packages = ["core", "work", "knowledge", "deploy"].map(
    (pkg) => ({
      pkg,
      src: join(import.meta.dirname, "../../../packages/@lore", pkg, "src"),
    }),
  );

  protected async printAtoms(): Promise<void> {
    for (const { pkg, src } of this.packages) {
      for (const dir of ["web/app/atoms", "api/atoms"]) {
        const names = (await readdir(join(src, dir)).catch(() => []))
          .filter((f) => f.endsWith(".ts") && !f.includes(".spec."))
          .map((f) => f.replace(/\.ts$/, ""))
          .sort();
        if (names.length === 0) continue;
        console.log(`\n## Atoms in @lore/${pkg} ${dir} (${names.length})\n`);
        for (const name of names) {
          console.log(`- \`${name}\``);
        }
      }
    }
  }

  protected async printComponentCount(): Promise<void> {
    const walk = async (dir: string): Promise<number> => {
      let total = 0;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          total += await walk(join(dir, entry.name));
        } else if (
          entry.name.endsWith(".tsx") &&
          !entry.name.includes(".spec.")
        ) {
          total += 1;
        }
      }
      return total;
    };
    console.log("\n## Components\n");
    for (const { pkg, src } of this.packages) {
      const root = join(src, "web/app/components");
      const count = await walk(root).catch(() => 0);
      console.log(`- @lore/${pkg}: ${count} .tsx files`);
    }
  }
}

await new AppInventory().run();
