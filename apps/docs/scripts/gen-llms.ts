import { promises as fs } from "node:fs";
import path, { join } from "node:path";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import type { DocNode } from "./interfaces.ts";

/**
 * Command for generating llms.txt and llms-full.txt files from documentation
 */
export class LlmsCommand {
  protected log = $logger();

  llms = $command({
    name: "gen:llms",
    description: "Generate llms.txt index and llms-full.txt from documentation",
    handler: async ({ run }) => {
      this.log.debug("Starting llms generation");
      const docsDir = join(import.meta.dirname, "../node_modules/.docs");
      const outputDir = join(import.meta.dirname, "../dist/public");
      const outputFileFull = join(outputDir, "llms-full.txt");
      const outputFileIndex = join(outputDir, "llms.txt");

      this.log.debug(`Docs directory: ${docsDir}`);
      this.log.debug(`Output files: ${outputFileIndex}, ${outputFileFull}`);

      await run("scan markdown files", async () => {
        try {
          await fs.access(docsDir);
          this.log.trace("Docs directory exists");
        } catch {
          this.log.error(`Docs directory not found: ${docsDir}`);
          throw new Error(`Docs directory not found: ${docsDir}`);
        }
      });

      let markdownFiles: string[] = [];

      await run("find markdown files", async () => {
        const files = await fs.readdir(docsDir);
        markdownFiles = files
          .filter((file) => file.endsWith(".md"))
          .map((file) => join(docsDir, file))
          .sort();
        this.log.debug(`Found ${markdownFiles.length} markdown files`);
      });

      let concatenatedContent = "";

      await run("concatenate markdown files", async () => {
        for (const file of markdownFiles) {
          this.log.trace(`Reading file: ${file}`);
          const content = await fs.readFile(file, "utf-8");
          const fileName = path.basename(file);
          concatenatedContent += `# ${fileName}\n\n${content}\n\n---\n\n`;
          this.log.trace(`Added ${content.length} chars from ${fileName}`);
        }
        this.log.debug(
          `Total concatenated content: ${concatenatedContent.length} chars`,
        );
      });

      let indexContent = "";

      await run("generate index", async () => {
        const indexModule = await import("../node_modules/.docs/index.ts");
        const tree = indexModule.tree as DocNode[];
        indexContent = this.generateIndex(tree);
        this.log.debug(`Generated index: ${indexContent.length} chars`);
      });

      await run("write files", async () => {
        await fs.mkdir(outputDir, { recursive: true });
        this.log.trace(`Created/verified output directory: ${outputDir}`);

        await fs.writeFile(outputFileFull, concatenatedContent, "utf-8");
        this.log.debug(
          `Wrote ${concatenatedContent.length} chars to ${outputFileFull}`,
        );

        await fs.writeFile(outputFileIndex, indexContent, "utf-8");
        this.log.debug(
          `Wrote ${indexContent.length} chars to ${outputFileIndex}`,
        );
      });

      this.log.debug(`Successfully created: ${outputFileIndex}, ${outputFileFull}`);
      this.log.debug(`Full docs: ${concatenatedContent.length} characters`);
      this.log.debug(`Index: ${indexContent.length} characters`);
      this.log.debug(`Files processed: ${markdownFiles.length}`);
    },
  });

  protected generateIndex(tree: DocNode[]): string {
    const lines: string[] = [];

    lines.push("# Alepha");
    lines.push("");
    lines.push(
      "> Alepha is a convention-driven TypeScript framework for building robust, end-to-end type-safe full-stack applications.",
    );
    lines.push("");
    lines.push("## Overview");
    lines.push("");
    lines.push("**Core Principles:**");
    lines.push(
      "- **Primitive Architecture**: Define features using `$`-prefixed primitives (`$action`, `$entity`, `$page`) that auto-register with the framework",
    );
    lines.push(
      "- **Zero-Mapping**: No route files, no config files - code structure IS the configuration",
    );
    lines.push(
      "- **End-to-End Type Safety**: Types flow from database schema → API → React components",
    );
    lines.push(
      "- **Convention over Configuration**: Sensible defaults, minimal boilerplate",
    );
    lines.push("");
    lines.push(
      "**Built on**: Drizzle (ORM), React (SSR), Vite (bundler), TypeBox (validation)",
    );
    lines.push(
      "**Runs on**: Node.js 22+, Bun, Cloudflare Workers, Vercel, Docker",
    );
    lines.push("");
    lines.push("**Quick Start**: `npx alepha init` - Creates minimal config files to use Alepha in current directory");
    lines.push("");
    lines.push("## Quick Reference");
    lines.push("");
    lines.push("Core primitives:");
    lines.push("");
    lines.push("- `$action` - `import { $action } from \"alepha/server\"`");
    lines.push("- `$entity` - `import { $entity } from \"alepha/orm\"`");
    lines.push("- `$repository` - `import { $repository } from \"alepha/orm\"`");
    lines.push("- `$page` - `import { $page } from \"@alepha/react\"`");
    lines.push("- `$queue` - `import { $queue } from \"alepha/queue\"`");
    lines.push("- `$scheduler` - `import { $scheduler } from \"alepha/scheduler\"`");
    lines.push("- `$cache` - `import { $cache } from \"alepha/cache\"`");
    lines.push("- `$bucket` - `import { $bucket } from \"alepha/bucket\"`");
    lines.push("- `$realm` - `import { $realm } from \"alepha/security\"`");
    lines.push("- `$command` - `import { $command } from \"alepha/command\"`");
    lines.push("- `$module` - `import { $module } from \"alepha\"`");
    lines.push("");
    lines.push("## Docs");
    lines.push("");
    lines.push(
      "- [Full Docs](https://alepha.dev/llms-full.txt): Complete documentation of Alepha with all details.",
    );
    lines.push(
      "- [Examples](https://github.com/feunard/alepha/tree/main/apps): Example applications",
    );
    lines.push("");

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
      // Leaf node - render as list item
      const title = this.formatTitle(node.name);
      const displayTitle = parentName ? `${parentName} - ${title}` : title;
      const url = `https://alepha.dev${node.href}`;
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
