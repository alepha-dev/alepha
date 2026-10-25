import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { AlephaError } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import type { DocNode, DocProduct } from "./interfaces.ts";

interface DocItem {
  product: string;
  slug: string;
  path: string;
}

/**
 * Generates the site's `llms.txt`, and the raw markdown every line of it links
 * to.
 *
 * `/llms.txt` is the framework: `public/llms-index.md`, long enough to deserve
 * a file and audited by `check:docs`, followed by its page list. Bay and Lore
 * had their own, at `/bay/llms.txt` and `/lore/llms.txt`, until they left this
 * repository (#E72).
 *
 * ⚠️ There is no `llms-full.txt` any more, deliberately. It concatenated every
 * page into ~1.2 MB (~290k tokens): larger than most context windows, and a
 * fetch tool that summarises what it reads kept almost none of it. An index of
 * links to plain-markdown pages lets an agent fetch exactly the pages it needs.
 */
export class LlmsCommand {
  protected log = $logger();

  llms = $command({
    name: "gen:llms",
    description: "Generate llms.txt, and the raw markdown pages it links to",
    handler: async ({ run }) => {
      const docsDir = join(import.meta.dirname, "../.gen");
      const publicDir = join(import.meta.dirname, "../public");
      const outputDir = join(import.meta.dirname, "../dist/public");

      await run("check generated docs", async () => {
        try {
          await fs.access(docsDir);
        } catch {
          throw new AlephaError(`Docs directory not found: ${docsDir}`);
        }
      });

      const indexModule = await import("../.gen/index.ts");
      const trees = indexModule.trees as Record<DocProduct, DocNode[]>;

      await run("write llms.txt", async () => {
        const preamble = await fs.readFile(
          join(publicDir, "llms-index.md"),
          "utf-8",
        );

        await this.write(
          join(outputDir, "llms.txt"),
          [preamble.trimEnd(), "", this.renderTree(trees[""] ?? [])].join("\n"),
        );
      });

      await run("copy markdown files to dist", async () => {
        const docs = indexModule.docs as DocItem[];
        const rootDir = join(import.meta.dirname, "../../..");

        let copiedCount = 0;
        for (const doc of docs) {
          // The product goes in the PATH, mirroring the URL these files
          // stand in for: `/docs/x.md` for the framework, `/<product>/docs/x.md`
          // for any other doc set. A slug is unique only within a product, so
          // a flat directory would keep whichever was written last (#1603).
          const destDir = doc.product
            ? join(outputDir, doc.product, "docs")
            : join(outputDir, "docs");
          const label = doc.product ? `${doc.product}/${doc.slug}` : doc.slug;

          try {
            const content = await fs.readFile(join(rootDir, doc.path), "utf-8");
            await this.write(join(destDir, `${doc.slug}.md`), content);
            copiedCount++;
          } catch (error) {
            this.log.warn(`Failed to copy ${label}:`, error);
          }
        }

        this.log.debug(`Copied ${copiedCount} markdown files`);
      });
    },
  });

  protected async write(file: string, content: string): Promise<void> {
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf-8");
    this.log.trace(`Wrote ${content.length} chars to ${file}`);
  }

  /**
   * One doc set's page list: a `##` per top-level category, one link per page.
   *
   * Every `href` already carries its full path (`/docs/…`), so the absolute
   * URLs need nothing done to them here.
   */
  protected renderTree(tree: DocNode[]): string {
    const lines: string[] = [];
    for (const node of tree) {
      this.renderNode(node, lines, 0);
    }
    return lines.join("\n");
  }

  protected renderNode(
    node: DocNode,
    lines: string[],
    depth: number,
    parentName?: string,
  ): void {
    // Skip asset nodes (like llms.txt itself)
    if (node.asset) {
      return;
    }

    if (node.children && node.children.length > 0) {
      // Only render heading for top-level categories (depth 0)
      if (depth === 0) {
        const title = this.formatTitle(node.name);
        lines.push(`## ${title}`);
        lines.push("");
      }

      // Pass current node name as parent for nested categories (depth > 0)
      // Skip "Alepha" as parent since it's redundant in the Packages section
      const formattedName = this.formatTitle(node.name);
      const nextParent =
        depth > 0 && formattedName !== "Alepha" ? formattedName : undefined;

      for (const child of node.children) {
        this.renderNode(child, lines, depth + 1, nextParent);
      }

      if (depth === 0) {
        lines.push("");
      }
    } else if (node.href) {
      // Leaf node - render as list item with .md extension for markdown files
      const title = this.formatTitle(node.name);
      const displayTitle = parentName ? `${parentName} - ${title}` : title;
      const url = `https://alepha.dev${node.href}.md`;
      const description = node.description ? `: ${node.description}` : "";
      lines.push(`- [${displayTitle}](${url})${description}`);
    }
  }

  protected formatTitle(name: string): string {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}
